#!/usr/bin/env python3
"""
Validates a Session Bundle (and optionally a Work Map) against the contract invariants and the
challenge's hard requirements. No dependencies.

    python3 scripts/validate_bundle.py fixtures/demo-session
    python3 scripts/validate_bundle.py fixtures/demo-session --workmap fixtures/demo-session/expected_workmap.json
    python3 scripts/validate_bundle.py <bundle> --part capture|map|teach   # only that part's checks

Exit code 1 if any ERROR. WARN lines are things to look at, not blockers.
"""
import argparse
import json
import os
import sys

GUARDRAIL_CATEGORIES = {"guardrail_limit", "exception", "stop_and_ask", "never_do"}
errors, warns = [], []


def err(msg):
    errors.append(msg)


def warn(msg):
    warns.append(msg)


def load(bundle):
    with open(os.path.join(bundle, "session.json")) as f:
        session = json.load(f)
    events = []
    with open(os.path.join(bundle, "events.jsonl")) as f:
        for n, line in enumerate(f, 1):
            if line.strip():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError as e:
                    err(f"events.jsonl:{n} invalid JSON: {e}")
    return session, events


def check_log(bundle, session, events):
    """Invariants every writer (Capture, Map's debrief, Teach) must keep."""
    ids, prev_seq = set(), 0
    for e in events:
        for k in ("id", "sessionId", "seq", "t", "wall", "phase", "type", "source", "payload"):
            if k not in e:
                err(f"{e.get('id', '?')}: missing field '{k}'")
        if e["id"] in ids:
            err(f"duplicate event id {e['id']}")
        ids.add(e["id"])
        if e["sessionId"] != session["id"]:
            err(f"{e['id']}: sessionId {e['sessionId']} != session {session['id']}")
        if e["seq"] <= prev_seq:
            err(f"{e['id']}: seq {e['seq']} not strictly increasing (prev {prev_seq})")
        prev_seq = e["seq"]
        if "tEnd" in e and e["tEnd"] < e["t"]:
            err(f"{e['id']}: tEnd < t")
    for e in events:
        for r in e.get("causedBy", []) + ([e["supersedes"]] if e.get("supersedes") else []):
            if r not in ids:
                err(f"{e['id']}: causedBy/supersedes unknown event {r}")

    # off-record: nothing but the markers inside the span
    spans, start = [], None
    for e in events:
        if e["type"] == "marker.off_record":
            if e["payload"]["state"] == "start":
                start = e["t"]
            elif start is not None:
                spans.append((start, e["t"]))
                start = None
    if start is not None:
        err("off-record span started but never ended")
    for e in events:
        if e["type"] == "marker.off_record":
            continue
        for a, b in spans:
            if a <= e["t"] < b or ("tEnd" in e and a < e["tEnd"] <= b and e["type"] == "utterance"):
                err(f"{e['id']} ({e['type']}) inside off-record span [{a},{b})")

    # utterances: word timings inside the span
    utts = {}
    for e in events:
        if e["type"] != "utterance":
            continue
        p = e["payload"]
        utts[p["utteranceId"]] = e
        if not p.get("words"):
            err(f"{e['id']}: utterance without word timestamps")
            continue
        if "tEnd" not in e:
            err(f"{e['id']}: utterance without tEnd")
            continue
        for w in p["words"]:
            if w["t"] < e["t"] - 50 or w["tEnd"] > e["tEnd"] + 50 or w["tEnd"] < w["t"]:
                err(f"{e['id']}: word '{w['w']}' timing outside utterance span")
                break

    # frames on disk
    missing = [e["payload"]["uri"] for e in events if e["type"] == "frame.captured" and not os.path.exists(os.path.join(bundle, e["payload"]["uri"]))]
    if missing:
        warn(f"{len(missing)} frame files missing on disk (first: {missing[0]})")

    # answers quote the expert verbatim
    for e in events:
        if e["type"] == "answer.linked":
            p = e["payload"]
            text = " ".join(utts[u]["payload"]["text"] for u in p["utteranceIds"] if u in utts)
            if p["quote"] not in text:
                err(f"{e['id']}: answer quote is not verbatim from its utterances")

    # corrections point at real things
    actions = {e["id"] for e in events if e["type"] == "screen.action"}
    for e in events:
        if e["type"] != "knowledge.correction":
            continue
        tg = e["payload"]["targets"]
        for a in tg.get("actionIds", []) + e["payload"].get("undoneBy", []):
            if a not in actions:
                err(f"{e['id']}: correction targets unknown screen.action {a}")
        for u in tg.get("utteranceIds", []) + e["payload"]["utteranceIds"]:
            if u not in utts:
                err(f"{e['id']}: correction references unknown utterance {u}")
    return utts


def check_capture(events, utts):
    """Module 1 requirements."""
    pauses = {e["id"]: e for e in events if e["type"] == "pause.detected"}
    live = [e for e in events if e["type"] == "agent.question" and e["phase"] == "capture"]
    if len(live) < 3:
        err(f"capture: {len(live)} live questions, brief requires >= 3")
    if not any(q["payload"]["category"] in GUARDRAIL_CATEGORIES for q in live):
        err("capture: no live question about a guardrail (brief requires >= 1)")
    for q in live:
        p = q["payload"]
        tp = p.get("triggerPauseId")
        if not tp or tp not in pauses or pauses[tp]["payload"]["decision"] != "ask":
            err(f"capture: question {p['questionId']} not triggered by a pause.detected with decision 'ask'")
        if not p["about"]["actionIds"]:
            err(f"capture: question {p['questionId']} is not about anything on screen (about.actionIds empty)")
    # never talk over the expert
    expert = [(e["t"], e["tEnd"]) for e in events if e["type"] == "utterance" and e["payload"]["speaker"] == "expert"]
    for e in events:
        if e["type"] == "agent.turn" and e["payload"]["intent"] in ("question", "follow_up"):
            for a, b in expert:
                if a < e["t"] < b:
                    err(f"capture: agent asked at t={e['t']} while the expert was speaking")
    # budget: max 5 per rolling 10 min
    ts = sorted(q["t"] for q in live)
    for i, t in enumerate(ts):
        if len([x for x in ts[i:] if x - t < 600_000]) > 5:
            warn("capture: more than 5 live questions within 10 minutes (brief tip: 3-5)")
            break
    answered = {e["payload"]["questionId"] for e in events if e["type"] == "answer.linked"}
    for q in live:
        if q["payload"]["questionId"] not in answered:
            warn(f"capture: question {q['payload']['questionId']} has no answer.linked")
    if not any(e["type"] == "frame.captured" for e in events):
        err("capture: no frames")
    if not any(e["type"] == "screen.action" for e in events):
        err("capture: no screen.action events")


def check_map_log(events):
    """Module 2 requirements visible in the log (debrief + teach-back)."""
    debrief = [e for e in events if e["type"] == "agent.question" and e["phase"] == "debrief"]
    if len(debrief) < 3:
        err(f"map: {len(debrief)} debrief questions, brief requires >= 3")
    live_texts = {e["payload"]["text"] for e in events if e["type"] == "agent.question" and e["phase"] == "capture"}
    for q in debrief:
        if q["payload"]["text"] in live_texts:
            err(f"map: debrief question repeats a live question: {q['payload']['text'][:60]}")
        if not q["payload"].get("gapId"):
            warn(f"map: debrief question {q['payload']['questionId']} has no gapId")
    verdicts = [e for e in events if e["type"] == "teachback.verdict"]
    if not verdicts:
        err("map: no teach-back verdicts")
    last = {}
    for v in verdicts:
        last[v["payload"]["segmentId"]] = v["payload"]["verdict"]
    if any(v == "unclear" for v in last.values()):
        err("map: teach-back segment left 'unclear'")


def check_workmap(wm, events, utts):
    frames = {e["payload"]["frameId"] for e in events if e["type"] == "frame.captured"}
    ev_ids = {e["id"] for e in events}

    def check_claim(kind, c, need_quote):
        if not c["evidence"]["moments"]:
            err(f"workmap {kind} {c['id']}: no screen moment")
        for m in c["evidence"]["moments"]:
            if m["frameId"] not in frames:
                err(f"workmap {kind} {c['id']}: moment frame {m['frameId']} not in session")
            for x in m["eventIds"]:
                if x not in ev_ids:
                    err(f"workmap {kind} {c['id']}: moment references unknown event {x}")
        if need_quote and not c["evidence"]["quotes"]:
            err(f"workmap {kind} {c['id']}: no quote in the expert's own words")
        for q in c["evidence"]["quotes"]:
            check_quote(f"{kind} {c['id']}", q)
        if c["provenance"] == ["inferred"] and c["confirmedByExpert"]:
            err(f"workmap {kind} {c['id']}: inferred-only claim marked as confirmed")
        for h in c.get("history", []):
            if h["correctionEventId"] not in ev_ids:
                err(f"workmap {kind} {c['id']}: history points at unknown correction")

    def check_quote(where, q):
        text = " ".join(utts[u]["payload"]["text"] for u in q["utteranceIds"] if u in utts)
        if q["text"] not in text:
            err(f"workmap {where}: quote not verbatim: '{q['text'][:50]}'")
        spans = [(utts[u]["t"], utts[u]["tEnd"]) for u in q["utteranceIds"] if u in utts]
        if spans and not (min(a for a, _ in spans) - 50 <= q["t"] <= q["tEnd"] <= max(b for _, b in spans) + 50):
            err(f"workmap {where}: quote time outside its utterances")

    for s in wm["steps"]:
        check_claim("step", s, need_quote=False)
    for d in wm["decisions"]:
        check_claim("decision", d, need_quote=True)
        check_quote(f"decision {d['id']} reason", d["reason"])
    for g in wm["guardrails"]:
        check_claim("guardrail", g, need_quote=True)
    ids = {x["id"] for x in wm["steps"] + wm["decisions"] + wm["guardrails"]}
    for s in wm["steps"]:
        for r in s["decisionIds"] + s["guardrailIds"]:
            if r not in ids:
                err(f"workmap step {s['id']}: unknown ref {r}")
    if wm["status"] == "confirmed" and wm["teachBack"]["status"] != "confirmed":
        err("workmap: status confirmed but teach-back not confirmed")
    if any(g["status"] == "open" and g["priority"] >= 0.5 for g in wm["gaps"]) and wm["status"] == "confirmed":
        err("workmap: confirmed with open high-priority gaps")
    st = wm["stats"]
    if st["guardrails"] != len(wm["guardrails"]):
        warn("workmap: stats.guardrails mismatch")
    # corrections in the log should be reflected somewhere
    applied = {h["correctionEventId"] for c in wm["steps"] + wm["decisions"] + wm["guardrails"] for h in c.get("history", [])}
    applied |= {m["correctionEventId"] for m in wm.get("commonMistakes", [])}
    for e in events:
        if e["type"] == "knowledge.correction" and e["id"] not in applied:
            warn(f"workmap: correction {e['id']} ({e['payload']['kind']}: {e['payload']['after'][:50]}) not reflected in any claim history / commonMistakes")


def check_teach(events):
    iv = [e for e in events if e["type"] == "tutor.intervention"]
    if not any(e["payload"]["beforeSave"] for e in iv):
        err("teach: no tutor.intervention with beforeSave=true (brief: catch >= 1 wrong decision before it is saved)")
    for e in iv:
        if not (e["payload"].get("guardrailId") or e["payload"].get("decisionId")):
            err(f"teach: intervention {e['id']} not tied to a guardrail/decision from the Work Map")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bundle")
    ap.add_argument("--workmap")
    ap.add_argument("--part", choices=["capture", "map", "teach", "all"], default="all")
    a = ap.parse_args()
    session, events = load(a.bundle)
    utts = check_log(a.bundle, session, events)
    kind = session.get("kind", "capture")
    if kind == "capture" and a.part in ("capture", "all"):
        check_capture(events, utts)
    if kind == "capture" and a.part in ("map", "all"):
        check_map_log(events)
    if a.workmap:
        with open(a.workmap) as f:
            check_workmap(json.load(f), events, utts)
    if kind == "teach" or a.part == "teach":
        check_teach(events)
    for w in warns:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    print(f"{len(events)} events · {len(errors)} errors · {len(warns)} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
