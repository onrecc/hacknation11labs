#!/usr/bin/env python3
"""
Generates fixtures/demo-session/: a realistic Session Bundle for the 3-invoice demo, plus the
Work Map that Map should produce from it (expected_workmap.json) as a test oracle.

    python3 scripts/make_fixture.py

Edit the SCRIPT section below to change the story. Everything else (ids, seq, frames, word timings,
input activity, vision observations, media chunks) is derived, so the bundle stays consistent.
"""
import datetime as dt
import hashlib
import html
import json
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "fixtures", "demo-session")
SID = "ses_demo_sabine_01"
WM_ID = "wm_ap_invoices_01"
T0 = dt.datetime(2026, 12, 3, 15, 10, 0, tzinfo=dt.timezone.utc)  # Thu 16:10 CET
# Set by the script as the story unfolds (everything is timed relative to the previous speech).
B = {"capture_end": 1e9, "debrief_end": 1e9, "teachback_end": 1e9, "screen_end": 1e9}
OFF_RECORD = [1e9, 1e9]

# ───────────────────────── plumbing ─────────────────────────

events, _counters, _order = [], {}, [0]


def nid(prefix):
    _counters[prefix] = _counters.get(prefix, 0) + 1
    return f"{prefix}_{_counters[prefix]:04d}"


def wall(t):
    return (T0 + dt.timedelta(seconds=t)).isoformat().replace("+00:00", "Z")


def ms(t):
    return int(round(t * 1000))


def phase_at(t):
    if t < B["capture_end"]:
        return "capture"
    if t < B["debrief_end"]:
        return "debrief"
    if t < B["teachback_end"]:
        return "teachback"
    return "review"


CASES = {}  # caseId -> (t0, t1)


def case_at(t):
    for cid, (a, b) in CASES.items():
        if a <= t <= b:
            return cid
    return None


def in_off_record(t):
    return OFF_RECORD[0] <= t < OFF_RECORD[1]


def ev(t, type_, source, payload, tEnd=None, causedBy=None, supersedes=None, caseId="auto", phase=None):
    assert not in_off_record(t) or type_ == "marker.off_record", f"{type_} at {t} is inside off-record span"
    e = {"id": nid("evt"), "sessionId": SID, "seq": 0, "t": ms(t)}
    if tEnd is not None:
        e["tEnd"] = ms(tEnd)
    e["wall"] = wall(t)
    e["phase"] = phase or "?"  # resolved when the bundle is written
    e["type"] = type_
    e["source"] = source
    if caseId != "auto":
        if caseId:
            e["caseId"] = caseId
    else:
        e["_autocase"] = True
    if causedBy:
        e["causedBy"] = causedBy
    if supersedes:
        e["supersedes"] = supersedes
    e["payload"] = payload
    _order[0] += 1
    e["_o"] = _order[0]
    events.append(e)
    return e


def h(s, mod=1000):
    return int(hashlib.sha1(s.encode()).hexdigest(), 16) % mod


# ───────────────────────── the sandbox ERP world ─────────────────────────

INVOICES = {
    "4471": dict(supplier="Krauss Maschinenteile GmbH", group="External", date="2026-11-27", amount=7850.00,
                 desc="CNC spindle replacement, machine hall 2", category="equipment", dn="DN-77104",
                 iban="DE89 3704 0044 0532 0130 00", costCenter="4711", assetNo="", status="open",
                 approver="", comment=""),
    "4472": dict(supplier="Hofmann Industriebedarf", group="External", date="2026-12-01", amount=1240.00,
                 desc="Lubricants & filters, monthly delivery", category="consumables", dn="DN-88213",
                 iban="DE44 5001 0517 5407 3249 31", costCenter="4711", assetNo="", status="open",
                 approver="", comment=""),
    "4473": dict(supplier="Brno Precision s.r.o.", group="Intercompany CZ", date="2026-11-30", amount=3100.00,
                 desc="Spare parts, gearbox housings", category="spare_parts", dn="DN-CZ-5530",
                 iban="CZ65 0800 0000 1920 0014 5399", costCenter="4711", assetNo="", status="open",
                 approver="", comment=""),
}
LIST_EXTRA = [("4474", "Schreiber Logistik", 860.00), ("4475", "Würth", 312.40), ("4476", "Festo AG", 2290.00)]
SEARCH_RESULTS = [("4431", "2026-11-28", 1240.00, "DN-88213", "paid"), ("4310", "2026-10-30", 1180.00, "DN-87650", "paid")]

# Screen mutations: (t, kind, args). "type" spans t..t_end and shows partial text while typing.
MUT = []


def m_view(t, view, inv=None):
    MUT.append((t, "view", dict(view=view, inv=inv)))


def m_set(t, inv, field, value):
    MUT.append((t, "set", dict(inv=inv, field=field, value=value)))


def m_type(t, t_end, inv, field, value):
    MUT.append((t, "type", dict(inv=inv, field=field, value=value, t_end=t_end)))


def state_at(t):
    st = dict(view="list", inv=None, focus=None, typing=False, query="", results=False,
              invoices={k: dict(v) for k, v in INVOICES.items()})
    for (mt, kind, a) in sorted(MUT, key=lambda x: x[0]):
        if mt > t:
            break
        if kind == "view":
            st["view"], st["inv"] = a["view"], a["inv"]
            st["focus"] = None
        elif kind == "set":
            if a["inv"] == "_search":
                st[a["field"]] = a["value"]
            else:
                st["invoices"][a["inv"]][a["field"]] = a["value"]
            st["focus"] = a["field"]
        elif kind == "type":
            frac = min(1.0, (t - mt) / max(0.1, a["t_end"] - mt))
            val = a["value"][: max(1, int(round(len(a["value"]) * frac)))]
            if a["inv"] == "_search":
                st["query"] = val
            else:
                st["invoices"][a["inv"]][a["field"]] = val
            st["focus"] = a["field"]
            st["typing"] = t < a["t_end"]
    return st


def visible_fields(st):
    if st["view"] == "invoice":
        i = st["invoices"][st["inv"]]
        return {"view": "invoice", "inv": st["inv"], **i}
    if st["view"] == "search":
        return {"view": "search", "query": st["query"], "resultCount": len(SEARCH_RESULTS) if st["results"] else 0}
    return {"view": "list", **{f"{k}.status": v["status"] for k, v in st["invoices"].items()}}


FIELD_BOX = {  # normalized bboxes in the invoice detail view
    "supplier": (0.05, 0.22), "group": (0.05, 0.29), "date": (0.05, 0.36), "amount": (0.05, 0.43),
    "desc": (0.05, 0.50), "dn": (0.05, 0.57), "iban": (0.05, 0.64),
    "costCenter": (0.52, 0.22), "assetNo": (0.52, 0.29), "status": (0.52, 0.36), "approver": (0.52, 0.43),
    "comment": (0.52, 0.50),
}
LABEL = {"supplier": "Supplier", "group": "Supplier group", "date": "Invoice date", "amount": "Amount (EUR)",
         "desc": "Description", "dn": "Delivery note", "iban": "IBAN", "costCenter": "Cost center",
         "assetNo": "Asset no.", "status": "Status", "approver": "2nd approver", "comment": "Comment"}


def bbox(field):
    x, y = FIELD_BOX[field]
    return {"x": x, "y": y, "w": 0.42, "h": 0.055}


def render_svg(st, t):
    W, H = 1280, 720
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="Helvetica,Arial,sans-serif">',
         f'<rect width="{W}" height="{H}" fill="#f4f5f7"/>',
         f'<rect width="{W}" height="56" fill="#1f3a5f"/>',
         '<text x="24" y="36" fill="#fff" font-size="20" font-weight="bold">MiniERP · Accounts Payable</text>',
         f'<text x="{W-24}" y="36" fill="#cfd8e3" font-size="15" text-anchor="end">Thu 03.12.2026 · {16 + (10*60 + int(t))//3600:02d}:{(10 + int(t)//60) % 60:02d} · S. Keller</text>']
    esc = lambda s: html.escape(str(s))
    if st["view"] == "list":
        o.append('<text x="40" y="100" font-size="22" font-weight="bold" fill="#222">Open items · month-end close</text>')
        o.append('<text x="40" y="126" font-size="14" fill="#666">60 open · showing 6</text>')
        rows = [(k, v["supplier"], v["amount"], v["status"]) for k, v in st["invoices"].items()] + \
               [(k, s, a, "open") for k, s, a in LIST_EXTRA]
        for n, (k, s, a, stt) in enumerate(rows):
            y = 160 + n * 52
            o.append(f'<rect x="40" y="{y}" width="1200" height="44" fill="#fff" stroke="#dde"/>')
            o.append(f'<text x="60" y="{y+28}" font-size="16">INV-{k}</text><text x="220" y="{y+28}" font-size="16">{esc(s)}</text>')
            o.append(f'<text x="760" y="{y+28}" font-size="16" text-anchor="end">{a:,.2f}</text><text x="820" y="{y+28}" font-size="16" fill="#555">{esc(stt)}</text>')
    elif st["view"] == "search":
        o.append('<text x="40" y="100" font-size="22" font-weight="bold">Supplier history</text>')
        o.append(f'<rect x="40" y="120" width="600" height="40" fill="#fff" stroke="#4a7bd0" stroke-width="2"/><text x="56" y="146" font-size="16">{esc(st["query"])}</text>')
        if st["results"]:
            for n, (k, d, a, dn, s) in enumerate(SEARCH_RESULTS):
                y = 190 + n * 52
                o.append(f'<rect x="40" y="{y}" width="1200" height="44" fill="#fff" stroke="#dde"/>')
                o.append(f'<text x="60" y="{y+28}" font-size="16">INV-{k}   {d}   {a:,.2f} EUR   {dn}   {s}</text>')
    else:
        i = st["invoices"][st["inv"]]
        o.append(f'<text x="40" y="110" font-size="24" font-weight="bold">Invoice INV-{st["inv"]}</text>')
        for f, (x, y) in FIELD_BOX.items():
            px, py = x * W, y * H
            focus = st["focus"] == f
            val = "████████████████" if f == "iban" else (f"{i[f]:,.2f}" if f == "amount" else i[f])
            o.append(f'<text x="{px}" y="{py-6}" font-size="12" fill="#666">{LABEL[f]}</text>')
            o.append(f'<rect x="{px}" y="{py}" width="{0.42*W}" height="{0.055*H}" fill="#fff" stroke="{"#4a7bd0" if focus else "#ccd"}" stroke-width="{2 if focus else 1}"/>')
            o.append(f'<text x="{px+12}" y="{py+26}" font-size="16">{esc(val)}</text>')
        o.append('<rect x="660" y="600" width="120" height="44" rx="6" fill="#1f3a5f"/><text x="720" y="628" fill="#fff" font-size="16" text-anchor="middle">Save</text>')
        o.append('<rect x="800" y="600" width="140" height="44" rx="6" fill="#2e7d32"/><text x="870" y="628" fill="#fff" font-size="16" text-anchor="middle">Approve</text>')
    o.append("</svg>")
    return "\n".join(o)


# ───────────────────────── speech helpers ─────────────────────────

UTTS = []  # for overlap checks


def say(t, speaker, text, addressedTo="agent", inReplyTo=None, redactions=None, wps=2.8, source="stt"):
    words, dur = text.split(), len(text.split()) / wps
    total = sum(len(w) + 2 for w in words)
    cur, wl = t, []
    for w in words:
        d = dur * (len(w) + 2) / total
        wl.append({"w": w, "t": ms(cur), "tEnd": ms(cur + d * 0.92), "conf": round(0.86 + h(w + str(cur), 140) / 1000, 3)})
        cur += d
    uid = nid("utt")
    ev(t, "speech.vad", "stt", {"speaker": speaker, "state": "start"})
    p = {"utteranceId": uid, "speaker": speaker, "text": text, "words": wl,
         "language": "en-US", "transcriptVersion": 1, "sttModel": "scribe_v2_realtime", "addressedTo": addressedTo}
    if inReplyTo:
        p["inReplyToQuestionId"] = inReplyTo
    e = ev(t, "utterance", source, p, tEnd=t + dur)
    ev(t + dur, "speech.vad", "stt", {"speaker": speaker, "state": "end"})
    for (ent_type, raw, repl) in (redactions or []):
        a = text.index(repl)
        ev(t + dur + 0.1, "redaction.applied", "redactor",
           {"targetEventId": e["id"], "entities": [{"type": ent_type, "replacement": repl, "charSpan": [a, a + len(repl)]}]},
           causedBy=[e["id"]])
    UTTS.append((speaker, t, t + dur, text))
    return {"uid": uid, "eid": e["id"], "t": t, "tEnd": t + dur, "text": text}


def model_call(t, purpose, model, inputRefs, latency, prompt="v1"):
    mc = nid("mc")
    ev(t, "model.call", "system", {"modelCallId": mc, "purpose": purpose, "model": model, "promptVersion": prompt,
                                   "inputRefs": inputRefs, "detailUri": f"model_calls/{mc}.json", "latencyMs": latency,
                                   "tokens": {"input": 1800 + h(mc, 900), "output": 120 + h(mc + "o", 200)}})
    return mc


AGENT_TURNS = []


def agent_say(t, text, intent, questionId=None):
    u = say(t, "agent", text, addressedTo="other_person", source="agent", wps=2.6)
    p = {"text": text, "audio": {"uri": f"media/agent-turn-{len(AGENT_TURNS)+1:02d}.mp3", "offsetMs": 0},
         "intent": intent, "interrupted": False, "utteranceId": u["uid"]}
    if questionId:
        p["questionId"] = questionId
    e = ev(t, "agent.turn", "agent", p, tEnd=u["tEnd"], causedBy=[u["eid"]])
    AGENT_TURNS.append(e)
    u["turnEid"] = e["id"]
    return u


def skip(t, reason, after=None):
    ev(t, "agent.skipped_turn", "agent", {"reason": reason}, causedBy=[after["eid"]] if after else None)


def pause(t, kind, dur_ms, decision, reason, sinceKey=None, sinceSpeech=None, diff=None, speaking=False):
    sig = {"expertSpeaking": speaking}
    if sinceKey is not None:
        sig["msSinceKeystroke"] = sinceKey
    if sinceSpeech is not None:
        sig["msSinceSpeech"] = sinceSpeech
    if diff is not None:
        sig["screenDiff"] = diff
    return ev(t, "pause.detected", "pause_detector",
              {"kind": kind, "durationMs": dur_ms, "signals": sig, "decision": decision, "reason": reason})


QUESTIONS = {}


def ask(t, text, category, aboutActions, frameT, scores, rejected=(), pauseEv=None, gapId=None, entity=None):
    qid = nid("q")
    tc = ev(t - 1.6, "agent.tool_call", "agent", {"tool": "get_recent_screen_events", "args": {"sinceMs": ms(max(0, t - 60))},
                                                  "result": [ACTION_DESC[a] for a in aboutActions], "latencyMs": 40})
    mc = model_call(t - 1.2, "question_pick", "claude-sonnet-5-5", aboutActions + ([pauseEv["id"]] if pauseEv else []), 640)
    about = {"actionIds": aboutActions}
    if frameT is not None:
        about["frameId"] = frame_id_at(frameT)
    if entity:
        about["entity"] = entity
    p = {"questionId": qid, "text": text, "category": category, "about": about, "scores": scores,
         "rejectedCandidates": [{"text": a, "category": b, "reason": c} for a, b, c in rejected]}
    if pauseEv:
        p["triggerPauseId"] = pauseEv["id"]
    if gapId:
        p["gapId"] = gapId
    qe = ev(t - 0.1, "agent.question", "question_picker", p, causedBy=[tc["id"]] + ([pauseEv["id"]] if pauseEv else []))
    u = agent_say(t, text, "question" if not gapId else "follow_up", questionId=qid)
    QUESTIONS[qid] = dict(text=text, t=t, eid=qe["id"], category=category)
    return qid, u


def link_answer(qid, utts, quote, summary, completeness="full", followUp=False):
    t = utts[-1]["tEnd"] + 0.6
    mc = model_call(t - 0.3, "answer_link", "claude-sonnet-5-5", [u["eid"] for u in utts], 520)
    a = text_span(utts, quote)
    return ev(t, "answer.linked", "map" if t >= B["capture_end"] else "agent",
              {"questionId": qid, "utteranceIds": [u["uid"] for u in utts], "quote": quote,
               "quoteSpan": {"t": ms(a[0]), "tEnd": ms(a[1])}, "summary": summary,
               "completeness": completeness, "needsFollowUp": followUp},
              causedBy=[QUESTIONS[qid]["eid"]] + [u["eid"] for u in utts])


def text_span(utts, quote):
    """Find the time span of a verbatim quote across utterances (word-level)."""
    for u in utts:
        if quote in u["text"]:
            e = next(x for x in events if x["id"] == u["eid"])
            words = e["payload"]["words"]
            start = len(u["text"][: u["text"].index(quote)].split())
            n = len(quote.split())
            return words[start]["t"] / 1000, words[min(start + n, len(words)) - 1]["tEnd"] / 1000
    return utts[0]["t"], utts[-1]["tEnd"]


def correction(t, detectedBy, kind, utt, quote, targets, before, after, undoneBy=None, appliesTo="always", source="agent"):
    mc = model_call(t - 0.4, "correction_detect", "claude-sonnet-5-5", [utt["eid"]], 450)
    p = {"correctionId": nid("cor"), "detectedBy": detectedBy, "kind": kind, "utteranceIds": [utt["uid"]],
         "quote": quote, "targets": targets, "before": before, "after": after, "appliesTo": appliesTo, "confidence": 0.93}
    if undoneBy:
        p["undoneBy"] = undoneBy
    return ev(t, "knowledge.correction", source, p, causedBy=[utt["eid"]])


# ───────────────────────── app actions (ground truth + semantic) ─────────────────────────

ACTION_DESC, TYPING, CLICKS, READING = {}, [], [], []


def act(t, verb, inv, desc, field=None, frm=None, to=None, app_action="change", typed_from=None, mutate=True):
    """One user action: app.event (ground truth) + screen.action (semantic) + screen mutation."""
    if mutate and field and inv:
        if typed_from is not None:
            m_type(typed_from, t, inv, field, to)
            TYPING.append((typed_from, t, len(str(to))))
        else:
            m_set(t, inv, field, to)
            CLICKS.append(t)
    entity = {"kind": "invoice", "key": inv} if inv in INVOICES else ({"kind": "supplier_search"} if inv == "_search" else {"kind": "open_items_list"})
    snap = dict(INVOICES[inv]) if inv in INVOICES else None
    ap = {"action": app_action, "entity": entity, "route": f"/ap/invoices/{inv}" if inv in INVOICES else ("/ap/search" if inv == "_search" else "/ap/list")}
    if field:
        ap.update({"field": field, "oldValue": frm, "newValue": to, "selector": f"#{field}"})
    if snap is not None and app_action == "save":
        st = state_at(t + 0.01)
        ap["snapshot"] = {k: v for k, v in st["invoices"][inv].items() if k != "iban"}
    ae = ev(t, "app.event", "app", ap)
    sp = {"verb": verb, "entity": entity, "description": desc,
          "evidence": {"frameIds": [frame_id_at(t + 1)], "observedIds": [], "appEventIds": [ae["id"]]},
          "sourceAgreement": "both_agree", "confidence": 0.97}
    if field:
        sp.update({"field": field, "from": frm, "to": to})
    se = ev(t + 0.05, "screen.action", "app", sp, causedBy=[ae["id"]])
    ACTION_DESC[se["id"]] = desc
    ev(t + 0.3, "agent.context_pushed", "agent", {"text": f"[screen t={t:.0f}s] {desc}", "eventIds": [se["id"]]}, causedBy=[se["id"]])
    return se["id"]


def nav(t, view, inv=None, desc=None, verb="navigate"):
    m_view(t, view, inv)
    CLICKS.append(t)
    return act(t, verb, inv if inv else None, desc or f"Navigated to {view}", app_action="view" if verb == "open" else "navigate", mutate=False) \
        if desc else None


def frame_id_at(t):
    s = int(t)
    while s > 0 and (in_off_record(s) or s > B["screen_end"]):
        s -= 1
    return f"frm_{s:04d}"


def case(cid, key, t0, t1, outcome):
    CASES[cid] = (t0, t1)
    c = {"id": cid, "kind": "invoice", "key": key, "label": INVOICES[key]["supplier"]}
    ev(t0, "marker.case_boundary", "app", {"state": "start", "case": c, "detectedBy": "app"}, caseId=cid)
    ev(t1, "marker.case_boundary", "app", {"state": "end", "case": c, "outcome": outcome, "detectedBy": "app"}, caseId=cid)


# ═════════════════════════ SCRIPT ═════════════════════════
# Times inside a case are offsets from the case start `b`; speech chains off the previous utterance's end.
GAPS = {}

# ── Case 1: Krauss, equipment over €5k → capex ──
b = 8.0
c1_start = b - 0.5
s_open1 = nav(b, "invoice", "4471", "Opened invoice INV-4471 (Krauss Maschinenteile GmbH, 7,850.00 EUR)", verb="open")
u = say(b + 1.5, "expert", "Okay, Krauss, the spindle replacement. Seven thousand eight fifty.", addressedTo="self")
skip(u["tEnd"] + 0.2, "Expert thinking aloud (addressedTo=self); no pause yet.", u)
READING.append((b + 5, b + 16))
pause(b + 10, "screen_static", 2400, "hold", "Expert reading invoice details (scroll activity, no keystrokes); case just opened.", sinceKey=10000, sinceSpeech=5800, diff=0.004)
s_cc1 = act(b + 19, "edit", "4471", "Re-coded INV-4471 cost center 4711 (Opex) -> 0400 (Capex)", "costCenter", "4711", "0400", "input", typed_from=b + 17.2)
pause(b + 20.2, "typing_stopped", 1200, "skip", "Typing burst likely continues: focus moved to the asset number field.", sinceKey=1200, sinceSpeech=15000, diff=0.03)
s_as1 = act(b + 27, "edit", "4471", "Entered asset number AN-2026-118 on INV-4471", "assetNo", "", "AN-2026-118", "input", typed_from=b + 21.5)
s_sv1 = act(b + 30, "save", "4471", "Saved INV-4471 (status open -> coded)", "status", "open", "coded", "save")
p1 = pause(b + 32.1, "save_completed", 2100, "ask", "Save completed, no typing for 2.1 s, expert silent; unexplained cost-center change is salient.", sinceKey=2100, sinceSpeech=26000, diff=0.01)
q1, qu1 = ask(b + 33.5, "You changed the cost center from 4711 to 0400 on that one. What made you do that?", "why",
              [s_cc1, s_as1], b + 19.5, {"infoGain": 0.86, "screenAlreadyAnswers": 0.1, "guardrailValue": 0.6},
              rejected=[("What does cost center 0400 mean?", "definition", "Partly answered by the screen (label shows Capex); lower info gain than asking why."),
                        ("Why did you open this invoice first?", "why", "Low value: list order, likely a habit.")],
              pauseEv=p1, entity={"kind": "invoice", "key": "4471"})
a1 = say(qu1["tEnd"] + 0.9, "expert", "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand. Three thousand was the old limit, that changed in 2021.", inReplyTo=q1)
c1 = correction(a1["tEnd"] + 0.4, "speech", "statement_revised", a1, "No, wait, sorry, five thousand. Three thousand was the old limit",
                {"utteranceIds": [a1["uid"]]}, "Capex threshold for equipment: 3,000 EUR", "Capex threshold for equipment: 5,000 EUR (3,000 was the pre-2021 limit)")
a1b = say(a1["tEnd"] + 0.8, "expert", "And no asset number, no capex booking. Ever.", inReplyTo=q1)
al1 = link_answer(q1, [a1, a1b], "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand.",
                  "Equipment over 5,000 EUR is always capex (self-corrected from 3,000); capex requires an asset number.")
ack1 = agent_say(a1b["tEnd"] + 1.0, "Got it. Five thousand, and an asset number first.", "ack")
s_back1 = nav(ack1["tEnd"] + 0.8, "list", None, "Returned to open-items list")
c1_end = ack1["tEnd"] + 1.0

# ── Case 2: Hofmann, December double-billing → hold ──
b = c1_end + 2.0
c2_start = b - 0.5
s_open2 = nav(b, "invoice", "4472", "Opened invoice INV-4472 (Hofmann Industriebedarf, 1,240.00 EUR, dated 2026-12-01)", verb="open")
u = say(b + 1.5, "expert", "Hofmann. December. Of course.", addressedTo="self")
skip(u["tEnd"] + 0.2, "Expert thinking aloud (addressedTo=self).", u)
m_view(b + 4, "search")
CLICKS.append(b + 4)
m_type(b + 4.5, b + 7, "_search", "query", "Hofmann")
TYPING.append((b + 4.5, b + 7, 7))
s_search2 = act(b + 8, "search", "_search", "Searched supplier history for 'Hofmann'; found INV-4431 (1,240.00 EUR, DN-88213, paid 2026-11-28)",
                "query", "", "Hofmann", "submit", mutate=False)
m_set(b + 8, "_search", "results", True)
READING.append((b + 9, b + 18))
pause(b + 13, "screen_static", 3000, "hold", "Expert comparing search results (mouse over rows); a question would interrupt reading.", sinceKey=6000, sinceSpeech=9800, diff=0.002)
u = say(b + 18.5, "expert", "Same delivery note. Again.", addressedTo="self")
skip(u["tEnd"] + 0.2, "Expert thinking aloud; still mid-case.", u)
s_back2 = nav(b + 21.5, "invoice", "4472", "Returned to INV-4472 from supplier history", verb="navigate")
s_hold2 = act(b + 23.5, "hold", "4472", "Set INV-4472 status open -> on_hold", "status", "open", "on_hold")
s_cm2 = act(b + 32, "comment", "4472", "Commented on INV-4472: 'Possible duplicate of INV-4431 (DN-88213). Waiting for credit note.'",
            "comment", "", "Possible duplicate of INV-4431 (DN-88213). Waiting for credit note.", "input", typed_from=b + 24.5)
s_sv2 = act(b + 33.5, "save", "4472", "Saved INV-4472 (on hold)", None, None, None, "save")
p2 = pause(b + 35.8, "save_completed", 2300, "ask", "Save completed; expert silent 15 s; hold decision is a likely guardrail.", sinceKey=2300, sinceSpeech=14500, diff=0.01)
q2, qu2 = ask(b + 37, "You put it on hold rather than rejecting it. What has to happen before it can be released, and is there anyone you'd check with?",
              "stop_and_ask", [s_search2, s_hold2, s_cm2], b + 33, {"infoGain": 0.82, "screenAlreadyAnswers": 0.25, "guardrailValue": 0.9},
              rejected=[("Why did you put it on hold?", "why", "Screen already answers it: the comment says 'possible duplicate of INV-4431'."),
                        ("Is the December hold for all suppliers?", "scope", "Good, but over the live question budget: deferred to debrief.")],
              pauseEv=p2, entity={"kind": "invoice", "key": "4472"})
a2 = say(qu2["tEnd"] + 0.9, "expert", "Hofmann double-bills us every December, every single year. I never release it until I have their credit note, or they confirm in writing it's not a duplicate. I call [PERSON] at their AR desk on [PHONE_NUMBER]. And I don't reject it, because then their dunning starts.",
         inReplyTo=q2, redactions=[("PERSON", "Mrs. Bauer", "[PERSON]"), ("PHONE_NUMBER", "0711 555 0192", "[PHONE_NUMBER]")])
al2 = link_answer(q2, [a2], "I never release it until I have their credit note, or they confirm in writing it's not a duplicate.",
                  "Hofmann double-bills every December. Hold until credit note or written confirmation; call their AR desk; don't reject (triggers dunning).")
ev(a2["tEnd"] + 1.0, "question.deferred", "question_picker", {"text": "Is the December hold specific to Hofmann, or do you do it for other suppliers too?",
                                                               "category": "scope", "about": {"actionIds": [s_hold2], "frameId": frame_id_at(b + 33)},
                                                               "reason": "budget"})
s_back3 = nav(a2["tEnd"] + 1.5, "list", None, "Returned to open-items list")
c2_end = a2["tEnd"] + 1.6

# ── Off the record (nothing between the markers is persisted) ──
u_off = say(c2_end + 1.0, "expert", "Off the record for a sec.", addressedTo="agent")
OFF_RECORD[:] = [round(u_off["tEnd"] + 0.4, 3), round(u_off["tEnd"] + 27.4, 3)]
ev(OFF_RECORD[0], "marker.off_record", "user", {"state": "start", "trigger": "voice"}, tEnd=OFF_RECORD[1], causedBy=[u_off["eid"]])
ev(OFF_RECORD[1], "marker.off_record", "user", {"state": "end", "trigger": "hotkey"})

# ── Case 3: Brno (Czech subsidiary) → approves by mistake, reverts, routes to controller ──
b = OFF_RECORD[1] + 2.0
c3_start = b - 0.5
s_open3 = nav(b, "invoice", "4473", "Opened invoice INV-4473 (Brno Precision s.r.o., Intercompany CZ, 3,100.00 EUR)", verb="open")
u = say(b + 1.5, "expert", "Brno, spare parts, three-one.", addressedTo="self")
skip(u["tEnd"] + 0.2, "Expert thinking aloud.", u)
READING.append((b + 4, b + 12))
s_ap3 = act(b + 13, "approve", "4473", "Approved INV-4473 (status open -> approved)", "status", "open", "approved", "click")
u_oops = say(b + 14.5, "expert", "Oh, no, no, that's wrong. That's Brno, that needs Weber first.", addressedTo="self")
s_rv3 = act(u_oops["tEnd"] + 0.6, "edit", "4473", "Reverted INV-4473 status approved -> open", "status", "approved", "open")
c2 = correction(u_oops["tEnd"] + 0.9, "speech", "action_was_mistake", u_oops, "Oh, no, no, that's wrong. That's Brno, that needs Weber first.",
                {"actionIds": [s_ap3]}, "Approved Brno invoice directly",
                "Brno (Czech subsidiary) invoices need the controller (Weber) as second approver first", undoneBy=[s_rv3])
b3 = u_oops["tEnd"] + 1.5
s_rt3 = act(b3 + 3.5, "route", "4473", "Set 2nd approver on INV-4473: M. Weber (Controlling)", "approver", "", "M. Weber (Controlling)", "input", typed_from=b3)
s_cm3 = act(b3 + 12, "comment", "4473", "Commented on INV-4473: 'Intercompany CZ, 2nd approval controller'", "comment", "",
            "Intercompany CZ, 2nd approval controller", "input", typed_from=b3 + 5)
s_st3 = act(b3 + 13.2, "route", "4473", "Set INV-4473 status open -> awaiting_approval", "status", "open", "awaiting_approval")
s_sv3 = act(b3 + 14, "save", "4473", "Saved INV-4473 (awaiting 2nd approval)", None, None, None, "save")
p3 = pause(b3 + 16, "save_completed", 2000, "ask", "Save completed; the expert reverted an approval (high-salience judgment). Expert silent.", sinceKey=2000, sinceSpeech=17000, diff=0.01)
q3, qu3 = ask(b3 + 17.5, "You started to approve that one and then sent it to Weber instead. What's different about invoices from Brno?", "why",
              [s_ap3, s_rv3, s_rt3], b3 + 4, {"infoGain": 0.9, "screenAlreadyAnswers": 0.2, "guardrailValue": 0.8},
              rejected=[("Who is M. Weber?", "definition", "Screen shows 'Controlling'; low info gain.")],
              pauseEv=p3, entity={"kind": "invoice", "key": "4473"})
a3 = say(qu3["tEnd"] + 0.9, "expert", "Brno is our Czech subsidiary. Anything intercompany goes to the controller for a second approval, because of transfer pricing. I'm not allowed to sign those off alone, whatever the amount.", inReplyTo=q3)
al3 = link_answer(q3, [a3], "Anything intercompany goes to the controller for a second approval, because of transfer pricing.",
                  "Brno = Czech subsidiary. All intercompany invoices need the controller as second approver regardless of amount (transfer pricing).")
s_back4 = nav(a3["tEnd"] + 1.5, "list", None, "Returned to open-items list")
c3_end = a3["tEnd"] + 1.6
u_done = say(c3_end + 0.6, "expert", "That's the three. Done.", addressedTo="agent")
B["screen_end"] = u_done["tEnd"]  # screen share stops; debrief + teach-back are voice only
B["capture_end"] = u_done["tEnd"] + 0.8
ev(B["capture_end"], "phase.changed", "system", {"from": "capture", "to": "debrief"})

# ── Debrief (voice only) ──
intro = agent_say(B["capture_end"] + 0.6, "Thanks, that was really helpful. I have a few things I couldn't work out from the screen.", "other")
GAPS.update({
    "gap_01": dict(kind="deferred_question", desc="December hold: scope unknown (Hofmann only, or all suppliers?).", q="Is that just Hofmann, or other suppliers too?", prio=0.9, about=[s_hold2]),
    "gap_02": dict(kind="who_decides", desc="Who releases a held invoice, and does the amount matter?", q="Who decides to release it?", prio=0.85, about=[s_hold2, s_cm2]),
    "gap_03": dict(kind="unseen_case", desc="Capex invoice without an asset number was never shown.", q="What if there is no asset number?", prio=0.8, about=[s_as1]),
    "gap_04": dict(kind="conflict", desc="Unseen combination: intercompany AND equipment over 5,000 EUR.", q="Brno invoice that is equipment over 5,000?", prio=0.7, about=[s_cc1, s_rt3]),
    "gap_05": dict(kind="low_confidence", desc="Supplier-history search: every invoice, or only some? (rule vs habit)", q="Do you search history on every invoice?", prio=0.6, about=[s_search2]),
})
DEBRIEF = [
    ("gap_01", "You held the Hofmann invoice because they double-bill in December. Is that just Hofmann, or do you do it for other suppliers too?", "scope", [s_hold2], s_hold2,
     "Mostly Hofmann. Oh, and Schreiber Logistik since last year, they did the same thing in 2025. For everyone else, December is normal.",
     "Mostly Hofmann. Oh, and Schreiber Logistik since last year", "December duplicate check applies to Hofmann and Schreiber Logistik only.", 0.85),
    ("gap_02", "Once it's on hold, who decides to release it, and does the amount change that?", "who_decides", [s_hold2], s_hold2,
     "I release it myself once the credit note is there. If it's over ten thousand, the AP lead, Jonas, has to sign off the release.",
     "If it's over ten thousand, the AP lead, Jonas, has to sign off the release.", "Sabine releases held invoices; above 10,000 EUR the AP lead (Jonas) signs off.", 0.8),
    ("gap_03", "On the Krauss invoice you entered an asset number. What would you do if there wasn't one?", "stop_and_ask", [s_as1], s_as1,
     "Then I stop. I ask the controller to create the asset first. I never book capex without an asset number, it breaks the depreciation run.",
     "I never book capex without an asset number, it breaks the depreciation run.", "No asset number: stop and ask the controller to create the asset; never book capex without it.", 0.95),
    ("gap_04", "What if an invoice from Brno is equipment over five thousand euros?", "counterfactual", [s_cc1, s_rt3], s_rt3,
     "Then both. Capex with an asset number, and it still goes to Weber.",
     "Then both. Capex with an asset number, and it still goes to Weber.", "Rules stack: capex + asset number AND controller approval.", 0.7),
    ("gap_05", "You searched Hofmann's history before deciding. Do you do that on every invoice, or only some?", "frequency", [s_search2], s_search2,
     "Only for the December ones from those two, and for new suppliers. Otherwise no, that's just a habit from Hofmann.",
     "Only for the December ones from those two, and for new suppliers.", "History search only for Hofmann/Schreiber in December and new suppliers; otherwise habit.", 0.4),
]
dq, cursor = {}, intro["tEnd"]
for gap, qtext, cat, about, frame_action, ans, qquote, summ, gval in DEBRIEF:
    fa_t = next(e["t"] for e in events if e["id"] == frame_action) / 1000
    qid, qu = ask(cursor + 1.2, qtext, cat, about, fa_t, {"infoGain": 0.8, "screenAlreadyAnswers": 0.0, "guardrailValue": gval}, gapId=gap)
    a = say(qu["tEnd"] + 0.9, "expert", ans, inReplyTo=qid)
    link_answer(qid, [a], qquote, summ)
    ev(a["tEnd"] + 0.9, "gap.status", "map", {"gapId": gap, "status": "resolved"})
    dq[gap] = (qid, a)
    cursor = a["tEnd"] + 1.0
q4, a4 = dq["gap_01"]
q5, a5 = dq["gap_02"]
q6, a6 = dq["gap_03"]
q7, a7 = dq["gap_04"]
q8, a8 = dq["gap_05"]
c3h = correction(a8["tEnd"] + 0.4, "debrief", "habit_not_rule", a8, "Otherwise no, that's just a habit from Hofmann.",
                 {"actionIds": [s_search2]}, "Search supplier history on every invoice",
                 "Search history only for Hofmann/Schreiber in December and new suppliers", source="map")
a9 = say(cursor + 1.2, "expert", "And one thing about earlier. I said I never reject the Hofmann ones. If there's no credit note after thirty days, I do reject it, with a note to purchasing.")
c4 = correction(a9["tEnd"] + 0.4, "speech", "statement_revised", a9, "If there's no credit note after thirty days, I do reject it, with a note to purchasing.",
                {"utteranceIds": [a2["uid"]], "answerEventIds": [al2["id"]], "workMapRefs": [{"kind": "guardrail", "id": "gr_december_hold"}]},
                "Never reject Hofmann December duplicates", "Hold; if no credit note after 30 days, reject with a note to purchasing", source="map")
ack9 = agent_say(a9["tEnd"] + 1.0, "Good catch, I'll update that. I think I have everything. Can I explain the whole process back to you, and you tell me where I'm wrong?", "other")
u_ok = say(ack9["tEnd"] + 0.6, "expert", "Go ahead.")
B["debrief_end"] = u_ok["tEnd"] + 0.5
ev(B["debrief_end"], "phase.changed", "system", {"from": "debrief", "to": "teachback"})

# ── Teach-back ──
TB = [
    ("tb_1", "For each open invoice, you open it from the open-items list and check the supplier, the amount and what was bought.", ["st_open", "st_review"]),
    ("tb_2", "If it's from Hofmann or Schreiber in December, or a new supplier, you search their history for duplicates. A duplicate goes on hold with a comment until there's a credit note. You release it yourself, over ten thousand Jonas signs off, and after thirty days without a credit note you reject it.", ["st_history", "st_decide"]),
    ("tb_3", "Equipment over five thousand euros goes to capex, cost center 0400, and only with an asset number. If there's none, you stop and ask the controller.", ["st_code", "st_asset"]),
    ("tb_4", "Anything from Brno, our Czech subsidiary, goes to the AP lead for a second approval, whatever the amount.", ["st_decide"]),
    ("tb_5", "Then you add a comment that explains it and save.", ["st_comment_save"]),
]
tb_t = B["debrief_end"] + 0.5
tb_utts = {}
for sid, text, _ in TB[:3]:
    tb_utts[sid] = agent_say(tb_t, text, "teachback")
    tb_t = tb_utts[sid]["tEnd"] + 0.6
v1 = say(tb_t + 0.4, "expert", "Yes, that's right so far.")
for sid in ("tb_1", "tb_2", "tb_3"):
    ev(v1["tEnd"] + 0.3, "teachback.verdict", "map", {"segmentId": sid, "verdict": "confirmed", "utteranceIds": [v1["uid"]]}, causedBy=[v1["eid"]])
tb_t = v1["tEnd"] + 1.0
for sid, text, _ in TB[3:]:
    tb_utts[sid] = agent_say(tb_t, text, "teachback")
    tb_t = tb_utts[sid]["tEnd"] + 0.6
v2 = say(tb_t + 0.4, "expert", "Not the AP lead, the controller, Weber. The AP lead is only for releasing the big held invoices.")
ev(v2["tEnd"] + 0.3, "teachback.verdict", "map", {"segmentId": "tb_4", "verdict": "corrected", "utteranceIds": [v2["uid"]],
                                                   "correction": "Brno/intercompany second approval is the controller (M. Weber), not the AP lead."}, causedBy=[v2["eid"]])
c5 = correction(v2["tEnd"] + 0.5, "teachback", "statement_revised", v2, "Not the AP lead, the controller, Weber.",
                {"utteranceIds": [tb_utts["tb_4"]["uid"]], "workMapRefs": [{"kind": "decision", "id": "dec_intercompany"}, {"kind": "guardrail", "id": "gr_intercompany_approval"}]},
                "Second approver for Brno: AP lead", "Second approver for Brno: controller (M. Weber)", source="map")
ag = agent_say(v2["tEnd"] + 1.5, "Thanks. So Brno invoices go to Weber, the controller, and Jonas only signs off releasing big held ones. Is that the whole process?", "teachback")
v3 = say(ag["tEnd"] + 0.6, "expert", "Yes. That's how it works.")
ev(v3["tEnd"] + 0.3, "teachback.verdict", "map", {"segmentId": "tb_5", "verdict": "confirmed", "utteranceIds": [v3["uid"]]}, causedBy=[v3["eid"]])
B["teachback_end"] = v3["tEnd"] + 1.0
ev(B["teachback_end"], "phase.changed", "system", {"from": "teachback", "to": "review"})
END = B["teachback_end"] + 1.0
ev(END, "session.ended", "system", {"reason": "expert_done"})

case("case_4471", "4471", c1_start, c1_end, "booked")
case("case_4472", "4472", c2_start, c2_end, "held")
case("case_4473", "4473", c3_start, c3_end, "sent_for_approval")
SCREEN_SHARE_END = int(B["screen_end"])

# ═════════════════════════ derived streams ═════════════════════════

os.makedirs(os.path.join(OUT, "frames"), exist_ok=True)
for f in os.listdir(os.path.join(OUT, "frames")):
    os.remove(os.path.join(OUT, "frames", f))

prev_st, prev_vis, last_sent, last_obs_frame = None, None, -99, None
for s in range(0, SCREEN_SHARE_END + 1):
    if in_off_record(s):
        continue
    st = state_at(s)
    vis = visible_fields(st)
    if prev_vis is None:
        diff = 1.0
    elif vis.get("view") != prev_vis.get("view"):
        diff = 0.62
    else:
        changed = [k for k in vis if vis[k] != prev_vis.get(k)]
        diff = round(min(0.3, 0.02 * len(changed) + (0.01 if st["typing"] else 0)), 3) if changed else round(0.001 + h(str(s), 3) / 1000, 4)
    fid = f"frm_{s:04d}"
    svg = render_svg(st, s)
    with open(os.path.join(OUT, "frames", f"{fid}.svg"), "w") as fh:
        fh.write(svg)
    send = (diff > 0.015 and s - last_sent >= 2) or (s - last_sent >= 5)
    p = {"frameId": fid, "uri": f"frames/{fid}.svg", "width": 1280, "height": 720,
         "phash": hashlib.sha1(svg.encode()).hexdigest()[:16], "diffFromPrev": diff, "sentToVision": send}
    if not send:
        p["skipReason"] = "no_change" if diff <= 0.015 else "rate_limited"
    fe = ev(s, "frame.captured", "screen", p)
    if st["view"] == "invoice":
        ev(s + 0.05, "redaction.applied", "redactor", {"targetEventId": fe["id"], "entities": [{"type": "IBAN", "replacement": "blur", "bbox": bbox("iban")}]}, causedBy=[fe["id"]])
    if send:
        mc = model_call(s + 0.1, "vision", "claude-sonnet-5-5", [fe["id"]] + ([last_obs_frame[0]] if last_obs_frame else []), 900 + h(fid, 500), prompt="vision-v3")
        changes = []
        if last_obs_frame:
            ov = last_obs_frame[1]
            if vis.get("view") != ov.get("view") or vis.get("inv") != ov.get("inv"):
                changes.append({"kind": "opened" if vis["view"] == "invoice" else "navigated",
                                **({"entity": {"kind": "invoice", "key": vis["inv"]}} if vis.get("inv") else {}), "confidence": 0.95})
            else:
                for k in vis:
                    if vis[k] != ov.get(k) and k not in ("view", "inv", "iban"):
                        c = {"kind": "status_changed" if k.endswith("status") else "field_changed", "field": k,
                             "from": ov.get(k), "to": vis[k], "confidence": 0.7 if st["typing"] else 0.92}
                        if vis["view"] == "invoice":
                            c["entity"] = {"kind": "invoice", "key": vis["inv"]}
                            c["bbox"] = bbox(k)
                        changes.append(c)
        ents = []
        if vis["view"] == "invoice":
            i = st["invoices"][vis["inv"]]
            ents.append({"kind": "invoice", "key": vis["inv"], "fields": {k: v for k, v in i.items() if k != "iban"}})
            ents.append({"kind": "supplier", "label": i["supplier"], "fields": {"group": i["group"]}, "bbox": bbox("supplier")})
            ents.append({"kind": "cost_center", "key": i["costCenter"], "fields": {"label": {"4711": "Opex", "0400": "Capex"}.get(i["costCenter"])}, "bbox": bbox("costCenter")})
        elif vis["view"] == "search" and st["results"]:
            ents += [{"kind": "invoice", "key": k, "fields": {"date": d, "amount": a, "dn": dn, "status": ss}} for k, d, a, dn, ss in SEARCH_RESULTS]
        reading = any(a <= s <= b for a, b in READING)
        obs = {"frameId": fid, "modelCallId": mc,
               "app": {"name": "MiniERP", "view": vis["view"], "url": f"http://localhost:5173/ap/{vis['view']}", "windowTitle": "MiniERP · Accounts Payable"},
               "summary": {"invoice": f"Invoice INV-{vis.get('inv')} detail view" + (f", editing {st['focus']}" if st["typing"] else ""),
                           "search": f"Supplier history search for '{st['query']}'" + (" with 2 results" if st["results"] else ""),
                           "list": "Open-items list, 60 open invoices"}[vis["view"]],
               "visibleEntities": ents, "changes": changes,
               "activityGuess": "typing" if st["typing"] else ("reading" if reading else ("navigating" if diff > 0.5 else "idle")),
               "piiRegions": [{"type": "IBAN", "bbox": bbox("iban")}] if vis["view"] == "invoice" else [], "confidence": 0.9}
        if st["focus"] and vis["view"] == "invoice":
            obs["focus"] = {"field": st["focus"], "bbox": bbox(st["focus"])}
        if last_obs_frame:
            obs["prevFrameId"] = last_obs_frame[2]
        oe = ev(s + 0.1 + (900 + h(fid, 500)) / 1000, "screen.observed", "vision", obs, causedBy=[fe["id"]])
        last_obs_frame = (fe["id"], vis, fid)
        last_sent = s
        # attach vision evidence to semantic actions within the last 3 s
        for e in events:
            if e["type"] == "screen.action" and 0 <= s - e["t"] / 1000 <= 3 and changes:
                e["payload"]["evidence"]["observedIds"].append(oe["id"])
    prev_vis = vis

# input activity, 2 s windows, capture phase only
for w0 in range(0, SCREEN_SHARE_END, 2):
    if in_off_record(w0) or in_off_record(w0 + 1.99):
        continue
    keys = 0
    for a, b, n in TYPING:
        overlap = max(0, min(b, w0 + 2) - max(a, w0))
        keys += int(round(n * overlap / max(0.1, b - a)))
    clicks = sum(1 for c in CLICKS if w0 <= c < w0 + 2)
    reading = any(a <= w0 + 1 <= b for a, b in READING)
    ev(w0 + 2, "input.activity", "input", {"windowMs": 2000, "keystrokes": keys, "clicks": clicks,
                                           "mouseMovePx": 40 + h(str(w0), 300) if (reading or clicks) else h(str(w0), 30),
                                           "scrolls": 2 if reading else 0, "tabVisible": True}, tEnd=None)

# media chunks (10 s), trimmed around off-record
media = {"screenVideo": [], "micAudio": [], "agentAudio": [e["payload"]["audio"]["uri"] for e in AGENT_TURNS]}
for stream, key, until, prefix in (("screen_video", "screenVideo", SCREEN_SHARE_END + 1, "screen"), ("mic", "micAudio", END, "mic")):
    n, t = 0, 0.0
    while t < until:
        end = min(t + 10, until)
        if t < OFF_RECORD[0] < end:
            end = OFF_RECORD[0]
        uri = f"media/{prefix}-{n:03d}.webm"
        media[key].append(uri)
        ev(t, "media.chunk", "system", {"stream": stream, "uri": uri, "mime": "video/webm" if stream == "screen_video" else "audio/webm", "durationMs": ms(end - t)})
        n += 1
        t = OFF_RECORD[1] if end == OFF_RECORD[0] else end
for e in AGENT_TURNS:
    ev(e["t"] / 1000, "media.chunk", "agent", {"stream": "agent_audio", "uri": e["payload"]["audio"]["uri"], "mime": "audio/mpeg",
                                               "durationMs": e["tEnd"] - e["t"]})

# ═════════════════════════ write bundle ═════════════════════════

events.sort(key=lambda e: (e["t"], e["_o"]))
for i, e in enumerate(events, 1):
    e["seq"] = i
    del e["_o"]
    e["phase"] = phase_at(e["t"] / 1000)
    if e.pop("_autocase", False):
        cid = case_at(e["t"] / 1000)
        if cid:
            e["caseId"] = cid
    # keep key order stable: caseId before payload
    e["payload"] = e.pop("payload")

# sanity checks
for a in range(len(UTTS)):
    for b in range(a + 1, len(UTTS)):
        sa, ta0, ta1, xa = UTTS[a]
        sb, tb0, tb1, xb = UTTS[b]
        if ta0 < tb1 and tb0 < ta1:
            raise SystemExit(f"overlapping speech: {sa}@{ta0:.1f}-{ta1:.1f} '{xa[:30]}' / {sb}@{tb0:.1f}-{tb1:.1f} '{xb[:30]}'")
ids = {e["id"] for e in events}
for e in events:
    for r in e.get("causedBy", []):
        assert r in ids, (e["id"], r)
    assert not in_off_record(e["t"] / 1000) or e["type"] == "marker.off_record", e

session = {
    "id": SID, "kind": "capture", "status": "ended", "createdAt": wall(0), "endedAt": wall(END),
    "clock": {"wallAtT0": wall(0), "perfAtT0": 18342.6},
    "participant": {"id": "per_sabine", "displayName": "Sabine K.", "role": "Accounts payable clerk", "language": "en-US", "yearsInRole": 24},
    "task": {"title": "Process open supplier invoices before month-end close", "domain": "accounts_payable",
             "description": "Three invoices in the MiniERP sandbox: capex threshold, December double-biller, intercompany second approval.",
             "onetTaskId": "43-3031.00"},
    "workMapId": WM_ID,
    "consent": {"recordingAccepted": True, "acceptedAt": wall(-30), "retention": "hackathon demo, delete after 2026-12-31"},
    "config": {"frameIntervalMs": 1000, "visionModel": "claude-sonnet-5-5", "agentId": "agent_apprentice_interviewer", "agentLlm": "claude-sonnet-5-5",
               "sttModel": "scribe_v2_realtime",
               "promptVersions": {"vision": "vision-v3", "questionPicker": "v1", "answerLink": "v1", "correctionDetect": "v1"},
               "redaction": {"enabled": True, "engine": "presidio", "entityTypes": ["PERSON", "PHONE_NUMBER", "IBAN", "EMAIL_ADDRESS"]},
               "questionBudgetPer10Min": 4},
    "media": media,
}

# ═════════════════════════ expected Work Map (test oracle for Map) ═════════════════════════

E = {e["id"]: e for e in events}
U = {e["payload"]["utteranceId"]: e for e in events if e["type"] == "utterance"}


def at(action_id):
    return E[action_id]["t"] / 1000 + 1  # first frame after the change


def moment(t, ids, field=None):
    m = {"sessionId": SID, "t": ms(t), "frameId": frame_id_at(t), "eventIds": ids}
    if field:
        m["bbox"] = bbox(field)
    return m


def quote(utt, text, qid=None):
    e = U[utt["uid"]]
    a, b = text_span([utt], text)
    q = {"sessionId": SID, "utteranceIds": [utt["uid"]], "text": text, "t": ms(a), "tEnd": ms(b), "phase": e["phase"]}
    if qid:
        q["questionId"] = qid
    return q


def claim(conf, prov, moments, quotes, history=()):
    return {"confidence": conf, "provenance": prov, "confirmedByExpert": True, "history": list(history),
            "evidence": {"moments": moments, "quotes": quotes}}


def hist(cor_ev):
    p = cor_ev["payload"]
    return {"before": p["before"], "after": p["after"], "correctionEventId": cor_ev["id"], "at": cor_ev["t"], "phase": cor_ev["phase"]}


steps = [
    dict(id="st_open", order=1, title="Open the next invoice from the open-items list", goal="Work the month-end queue one invoice at a time",
         instructions="Open the next open invoice from the list.", screenMoment=moment(at(s_open1), [s_open1]), actionIds=[s_open1, s_open2, s_open3],
         decisionIds=[], guardrailIds=[], appliesToCaseKinds=["invoice"], optional=False, observedInCases=list(CASES), typicalDurationMs=1500,
         **claim(0.95, ["observed"], [moment(at(s_open1), [s_open1]), moment(at(s_open2), [s_open2]), moment(at(s_open3), [s_open3])], [])),
    dict(id="st_review", order=2, title="Check supplier, amount and what was bought", goal="Spot capex, intercompany and known double-billers",
         instructions="Read supplier, supplier group, amount and description before touching any field.", screenMoment=moment(at(s_open1) + 10, [], "amount"),
         actionIds=[], decisionIds=[], guardrailIds=[], appliesToCaseKinds=["invoice"], optional=False, observedInCases=list(CASES), typicalDurationMs=9000,
         **claim(0.8, ["observed", "stated_live"], [moment(at(s_open1) + 10, [], "amount"), moment(at(s_open3) + 8, [], "group")], [])),
    dict(id="st_history", order=3, title="Check supplier history for duplicates (December double-billers, new suppliers)", goal="Catch double billing before payment",
         instructions="For Hofmann or Schreiber Logistik in December, or any new supplier, search the supplier history and compare delivery notes.",
         screenMoment=moment(at(s_search2) + 4, [s_search2]), actionIds=[s_search2], decisionIds=["dec_december_hold"], guardrailIds=["gr_december_hold"],
         appliesToCaseKinds=["invoice"], optional=True, observedInCases=["case_4472"], typicalDurationMs=14000,
         when={"op": "or", "all": [
             {"op": "and", "all": [{"op": "in", "field": "supplier.name", "value": ["Hofmann Industriebedarf", "Schreiber Logistik"]}, {"op": "eq", "field": "invoice.month", "value": 12}]},
             {"op": "eq", "field": "supplier.isNew", "value": True}]},
         whenText="Hofmann or Schreiber Logistik in December, or a new supplier",
         **claim(0.9, ["observed", "stated_debrief"], [moment(at(s_search2) + 4, [s_search2])], [quote(a8, "Only for the December ones from those two, and for new suppliers.", q8)], [hist(E[c3h["id"]])])),
    dict(id="st_code", order=4, title="Code the invoice to a cost center", goal="Opex vs capex", instructions="Equipment over 5,000 EUR: cost center 0400 (capex). Otherwise keep the opex cost center.",
         screenMoment=moment(at(s_cc1), [s_cc1], "costCenter"), actionIds=[s_cc1], decisionIds=["dec_capex"], guardrailIds=["gr_capex_threshold"],
         appliesToCaseKinds=["invoice"], optional=False, observedInCases=["case_4471"], typicalDurationMs=2000,
         **claim(0.95, ["observed", "stated_live"], [moment(at(s_cc1), [s_cc1], "costCenter")], [quote(a1, "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand.", q1)], [hist(E[c1["id"]])])),
    dict(id="st_asset", order=5, title="Enter the asset number for capex invoices", goal="Capex must be linked to an asset",
         instructions="Enter the asset number. If there is none, stop and ask the controller to create the asset.",
         screenMoment=moment(at(s_as1), [s_as1], "assetNo"), actionIds=[s_as1], decisionIds=[], guardrailIds=["gr_asset_number"],
         appliesToCaseKinds=["invoice"], optional=True, observedInCases=["case_4471"], typicalDurationMs=5500,
         when={"op": "eq", "field": "invoice.costCenter", "value": "0400"}, whenText="Coded to capex (cost center 0400)",
         **claim(0.95, ["observed", "stated_live", "stated_debrief"], [moment(at(s_as1), [s_as1], "assetNo")], [quote(a1b, "And no asset number, no capex booking. Ever.", q1)])),
    dict(id="st_decide", order=6, title="Book, hold, or route for second approval", goal="Apply the stop rules before anything is approved",
         instructions="Duplicates: hold. Intercompany (Brno): route to the controller. Otherwise book.",
         screenMoment=moment(at(s_rt3), [s_rt3], "approver"), actionIds=[s_hold2, s_rv3, s_rt3, s_st3], decisionIds=["dec_december_hold", "dec_intercompany"],
         guardrailIds=["gr_december_hold", "gr_intercompany_approval"], appliesToCaseKinds=["invoice"], optional=False, observedInCases=["case_4472", "case_4473"], typicalDurationMs=6000,
         **claim(0.92, ["observed", "stated_live", "teachback_correction"], [moment(at(s_hold2), [s_hold2], "status"), moment(at(s_rt3), [s_rt3], "approver")],
                 [quote(a3, "Anything intercompany goes to the controller for a second approval, because of transfer pricing.", q3)], [hist(E[c5["id"]])])),
    dict(id="st_comment_save", order=7, title="Comment the reason and save", goal="Leave a trail the next person understands",
         instructions="Write why it was held or routed (e.g. 'Possible duplicate of INV-4431'), then save.", screenMoment=moment(at(s_cm2), [s_cm2], "comment"),
         actionIds=[s_cm2, s_cm3, s_sv1, s_sv2, s_sv3], decisionIds=[], guardrailIds=[], appliesToCaseKinds=["invoice"], optional=False,
         observedInCases=list(CASES), typicalDurationMs=8000, **claim(0.85, ["observed"], [moment(at(s_cm2), [s_cm2], "comment"), moment(at(s_cm3), [s_cm3], "comment")], [])),
]
for s_ in steps:
    if s_["id"] == "st_review":
        s_["evidence"]["quotes"] = [quote(a3, "Brno is our Czech subsidiary.", q3)]

decisions = [
    dict(id="dec_capex", stepId="st_code", kind="rule", question="Opex or capex?", observedChoice="Re-coded 4711 (Opex) -> 0400 (Capex)",
         options=[{"option": "0400 Capex", "when": {"op": "and", "all": [{"op": "eq", "field": "invoice.category", "value": "equipment"}, {"op": "gt", "field": "invoice.amount", "value": 5000}]},
                   "whenText": "Equipment over 5,000 EUR"}, {"option": "4711 Opex (keep)", "whenText": "Everything else"}],
         reason=quote(a1, "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand.", q1), reasonSummary="Equipment over 5,000 EUR is always capex (the 3,000 limit is outdated since 2021).",
         **claim(0.95, ["observed", "stated_live"], [moment(at(s_cc1), [s_cc1], "costCenter")], [quote(a1, "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand.", q1)], [hist(E[c1["id"]])])),
    dict(id="dec_december_hold", stepId="st_decide", kind="judgment", question="Is this a December double-bill?", observedChoice="Put INV-4472 on hold with a duplicate comment",
         options=[{"option": "Hold + comment + contact supplier AR", "when": {"op": "and", "all": [{"op": "in", "field": "supplier.name", "value": ["Hofmann Industriebedarf", "Schreiber Logistik"]},
                   {"op": "eq", "field": "invoice.month", "value": 12}, {"op": "eq", "field": "invoice.duplicateDeliveryNote", "value": True}]}, "whenText": "Hofmann/Schreiber, December, same delivery note already paid"},
                  {"option": "Book normally", "whenText": "No duplicate found"}],
         reason=quote(a2, "I never release it until I have their credit note, or they confirm in writing it's not a duplicate.", q2),
         reasonSummary="Hofmann double-bills every December; Schreiber since 2025.",
         **claim(0.92, ["observed", "stated_live", "stated_debrief"], [moment(at(s_search2) + 8, [s_search2]), moment(at(s_hold2), [s_hold2], "status")],
                 [quote(a2, "Hofmann double-bills us every December, every single year.", q2), quote(a4, "Mostly Hofmann. Oh, and Schreiber Logistik since last year", q4)])),
    dict(id="dec_intercompany", stepId="st_decide", kind="rule", question="Can I approve this alone?", observedChoice="Reverted own approval, routed to M. Weber (Controlling)",
         options=[{"option": "Route to controller (M. Weber) as 2nd approver", "when": {"op": "eq", "field": "supplier.group", "value": "Intercompany CZ"}, "whenText": "Any intercompany / Czech subsidiary invoice, any amount"},
                  {"option": "Approve alone", "whenText": "External suppliers within own limits"}],
         reason=quote(a3, "Anything intercompany goes to the controller for a second approval, because of transfer pricing.", q3),
         reasonSummary="Transfer pricing: intercompany needs the controller, regardless of amount.",
         **claim(0.97, ["observed", "stated_live", "teachback_correction"], [moment(at(s_ap3), [s_ap3], "status"), moment(at(s_rt3), [s_rt3], "approver")],
                 [quote(a3, "I'm not allowed to sign those off alone, whatever the amount.", q3), quote(v2, "Not the AP lead, the controller, Weber.")], [hist(E[c5["id"]])])),
]

guardrails = [
    dict(id="gr_capex_threshold", kind="limit", statement="Equipment over 5,000 EUR is always capex (cost center 0400).",
         condition={"op": "and", "all": [{"op": "eq", "field": "invoice.category", "value": "equipment"}, {"op": "gt", "field": "invoice.amount", "value": 5000},
                                         {"op": "neq", "field": "invoice.costCenter", "value": "0400"}]},
         requiredAction="Re-code to 0400 before saving", scope="all suppliers", severity="block", stepIds=["st_code"],
         **claim(0.95, ["stated_live"], [moment(at(s_cc1), [s_cc1], "costCenter")], [quote(a1, "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand.", q1)], [hist(E[c1["id"]])])),
    dict(id="gr_asset_number", kind="stop_and_ask", statement="No asset number, no capex booking.",
         condition={"op": "and", "all": [{"op": "eq", "field": "invoice.costCenter", "value": "0400"}, {"op": "missing", "field": "invoice.assetNo"}]},
         requiredAction="Stop and ask the controller to create the asset first", escalateTo={"role": "Controller", "name": "M. Weber"},
         scope="all capex invoices", severity="block", stepIds=["st_asset"],
         **claim(0.97, ["stated_live", "stated_debrief"], [moment(at(s_as1), [s_as1], "assetNo")],
                 [quote(a1b, "And no asset number, no capex booking. Ever.", q1), quote(a6, "I never book capex without an asset number, it breaks the depreciation run.", q6)])),
    dict(id="gr_december_hold", kind="exception", statement="Hofmann and Schreiber Logistik December invoices that duplicate a paid delivery note: hold, don't pay, don't reject right away.",
         condition={"op": "and", "all": [{"op": "in", "field": "supplier.name", "value": ["Hofmann Industriebedarf", "Schreiber Logistik"]},
                                         {"op": "eq", "field": "invoice.month", "value": 12}, {"op": "eq", "field": "invoice.duplicateDeliveryNote", "value": True},
                                         {"op": "not", "c": {"op": "in", "field": "invoice.status", "value": ["on_hold", "rejected"]}}]},
         requiredAction="Hold with comment; call supplier AR; release only with credit note or written confirmation (over 10,000 EUR: AP lead Jonas signs the release); reject with a note to purchasing after 30 days without a credit note",
         escalateTo={"role": "AP lead", "name": "Jonas"}, scope="Hofmann Industriebedarf, Schreiber Logistik (December only)", severity="block", stepIds=["st_history", "st_decide"],
         **claim(0.9, ["stated_live", "stated_debrief"], [moment(at(s_cm2), [s_cm2], "comment")],
                 [quote(a2, "I never release it until I have their credit note, or they confirm in writing it's not a duplicate.", q2),
                  quote(a5, "If it's over ten thousand, the AP lead, Jonas, has to sign off the release.", q5),
                  quote(a9, "If there's no credit note after thirty days, I do reject it, with a note to purchasing.")], [hist(E[c4["id"]])])),
    dict(id="gr_intercompany_approval", kind="approval_required", statement="Intercompany (Brno, Czech subsidiary) invoices always need the controller as second approver, whatever the amount.",
         condition={"op": "and", "all": [{"op": "eq", "field": "supplier.group", "value": "Intercompany CZ"},
                                         {"op": "or", "all": [{"op": "eq", "field": "invoice.status", "value": "approved"}, {"op": "missing", "field": "invoice.approver"}]}]},
         requiredAction="Do not approve; set M. Weber (Controlling) as 2nd approver", escalateTo={"role": "Controller", "name": "M. Weber"},
         scope="Intercompany CZ", severity="block", stepIds=["st_decide"],
         **claim(0.98, ["observed", "stated_live", "stated_debrief", "teachback_correction"], [moment(at(s_ap3), [s_ap3], "status"), moment(at(s_rt3), [s_rt3], "approver")],
                 [quote(a3, "I'm not allowed to sign those off alone, whatever the amount.", q3), quote(a7, "Then both. Capex with an asset number, and it still goes to Weber.", q7)],
                 [hist(E[c5["id"]])])),
]

workmap = {
    "id": WM_ID, "version": 3, "status": "confirmed", "createdAt": wall(B["capture_end"]), "updatedAt": wall(END),
    "sourceSessionIds": [SID], "expert": session["participant"], "task": session["task"],
    "summary": "Month-end supplier invoice processing in MiniERP: 7 steps, 3 judgment calls/rules, 4 guardrails (capex threshold, asset number, December double-billers, intercompany second approval).",
    "cases": [{"id": cid, "kind": "invoice", "key": cid.split("_")[1], "outcome": {"case_4471": "booked", "case_4472": "held", "case_4473": "sent_for_approval"}[cid],
               "t": ms(a), "tEnd": ms(b), "sessionId": SID} for cid, (a, b) in CASES.items()],
    "steps": steps, "decisions": decisions, "guardrails": guardrails,
    "glossary": [{"term": "4711", "meaning": "Opex cost center (default)"}, {"term": "0400", "meaning": "Capex cost center"},
                 {"term": "Brno / Intercompany CZ", "meaning": "Czech subsidiary; all invoices need controller approval", "quote": quote(a3, "Brno is our Czech subsidiary.", q3)},
                 {"term": "Weber", "meaning": "M. Weber, controller (Controlling)"}, {"term": "Jonas", "meaning": "AP lead; signs off releasing held invoices over 10,000 EUR"}],
    "gaps": [{"id": g, "kind": d["kind"], "description": d["desc"], "about": {"eventIds": d["about"]}, "proposedQuestion": d["q"], "priority": d["prio"],
              "status": "resolved", "resolvedBy": {"questionId": dq[g][0], "answerEventId": next(e["id"] for e in events if e["type"] == "answer.linked" and e["payload"]["questionId"] == dq[g][0])}}
             for g, d in GAPS.items()],
    "teachBack": {"segments": [{"id": sid, "text": text, "stepIds": st, "verdict": "corrected" if sid == "tb_4" else "confirmed",
                                "verdictEventId": next(e["id"] for e in events if e["type"] == "teachback.verdict" and e["payload"]["segmentId"] == sid)} for sid, text, st in TB],
                  "status": "confirmed", "confirmedAt": wall(v3["tEnd"]), "confirmationQuote": quote(v3, "Yes. That's how it works.")},
    "stats": {"liveQuestions": 3, "debriefQuestions": 5, "judgmentCalls": 3, "guardrails": 4},
    "commonMistakes": [{"id": "mis_01", "description": "Approving an intercompany (Brno) invoice directly",
                        "correctBehavior": "Route to the controller (M. Weber) as second approver, whatever the amount",
                        "relatedIds": ["dec_intercompany", "gr_intercompany_approval"], "moment": moment(at(s_ap3), [s_ap3, s_rv3], "status"),
                        "quote": quote(u_oops, "Oh, no, no, that's wrong. That's Brno, that needs Weber first."), "correctionEventId": c2["id"]}],
    "changelog": [{"version": 1, "at": wall(B["capture_end"]), "by": "map", "note": "Draft from capture (3 cases, 3 live answers, 2 corrections applied).", "eventIds": [al1["id"], al2["id"], al3["id"], c1["id"], c2["id"]]},
                  {"version": 2, "at": wall(B["debrief_end"]), "by": "map", "note": "Debrief: 5 gaps resolved; December rule scoped; 30-day rejection added.", "eventIds": [c3h["id"], c4["id"]]},
                  {"version": 3, "at": wall(END), "by": "expert", "note": "Teach-back: 2nd approver corrected to controller; confirmed.", "eventIds": [c5["id"]]}],
}

with open(os.path.join(OUT, "session.json"), "w") as fh:
    json.dump(session, fh, indent=2, ensure_ascii=False)
with open(os.path.join(OUT, "events.jsonl"), "w") as fh:
    for e in events:
        fh.write(json.dumps(e, ensure_ascii=False) + "\n")
with open(os.path.join(OUT, "expected_workmap.json"), "w") as fh:
    json.dump(workmap, fh, indent=2, ensure_ascii=False)

# typecheck harness (run: npx -p typescript tsc --noEmit --strict --target es2022 fixtures/demo-session/.typecheck.ts)
with open(os.path.join(OUT, ".typecheck.ts"), "w") as fh:
    fh.write('import type { Event, Session, WorkMap } from "../../shared/schema";\n')
    fh.write("export const session: Session = " + json.dumps(session, ensure_ascii=False) + ";\n")
    fh.write("export const events: Event[] = " + json.dumps(events, ensure_ascii=False) + ";\n")
    fh.write("export const workmap: WorkMap = " + json.dumps(workmap, ensure_ascii=False) + ";\n")

counts = {}
for e in events:
    counts[e["type"]] = counts.get(e["type"], 0) + 1
print(f"{len(events)} events, {len([f for f in os.listdir(os.path.join(OUT, 'frames'))])} frames, duration {END}s")
for k in sorted(counts):
    print(f"  {k:24s} {counts[k]}")
