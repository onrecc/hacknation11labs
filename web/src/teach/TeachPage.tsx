/**
 * /teach: tutor panel. Loads a confirmed Work Map, starts a teach session, opens MiniERP in teach mode,
 * evaluates guardrails deterministically on every change (nudge) and on save (block), explains in the
 * expert's words and replays the expert's screen moment. Ends with a mastery report.
 */
import { useEffect, useRef, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import type { CaseFacts, Event, Guardrail, MasteryReport, WorkMap } from "@shared/schema";
import { violations } from "@shared/conditions";
import { col } from "@shared/paths";
import { createSession, listWorkMaps, loadWorkMap, type WorkMapHead } from "../lib/sessions";
import { db, signedIn } from "../lib/firebase";
import { llm } from "../lib/api";
import { listen, send } from "../lib/bridge";
import { CaptureHub } from "../capture/hub";
import { EventFeed, FrameImg, Quote } from "../components/ui";

const NUDGE_COOLDOWN_MS = 30_000;

interface Card { g: Guardrail; facts: CaseFacts; text: string; beforeSave: boolean }

export default function TeachPage() {
  const [maps, setMaps] = useState<WorkMapHead[]>([]);
  const [wm, setWm] = useState<WorkMap | null>(null);
  const [hub, setHub] = useState<CaptureHub | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [report, setReport] = useState<MasteryReport | null>(null);
  const [learner, setLearner] = useState("Lena");
  const nudged = useRef(new Map<string, number>());
  const caught = useRef(new Set<string>());

  useEffect(() => void signedIn.then(async () => setMaps(await listWorkMaps())), []);
  useEffect(() => {
    if (!hub) return;
    const t = setInterval(() => setEvents([...hub.events]), 700);
    return () => clearInterval(t);
  }, [hub]);

  // guardrail engine on the bridge
  useEffect(() => {
    if (!hub || !wm) return;
    return listen(async (m) => {
      if (m.kind === "beforeSave") {
        const v = violations(wm, m.facts).filter((g) => g.severity === "block");
        send({ kind: "beforeSaveResult", reqId: m.reqId, allow: v.length === 0, guardrailIds: v.map((g) => g.id), message: v[0] ? `Hold on: ${v[0].statement}` : undefined });
        if (v[0]) void intervene(v[0], m.facts, true);
      } else if (m.kind === "app" && m.facts && m.payload.action === "change") {
        for (const g of violations(wm, m.facts)) {
          const last = nudged.current.get(g.id) ?? -1e12;
          if (Date.now() - last < NUDGE_COOLDOWN_MS) continue;
          nudged.current.set(g.id, Date.now());
          void intervene(g, m.facts, false);
          break;
        }
      }
    });
  }, [hub, wm]);

  async function intervene(g: Guardrail, facts: CaseFacts, beforeSave: boolean) {
    if (!hub || !wm) return;
    caught.current.add(g.id);
    const quote = g.evidence.quotes[0]?.text ?? g.statement;
    const t = hub.now();
    let spoken: string;
    if (beforeSave) {
      // Socratic first, then the expert's words
      const ask = await llm("tutor_explain", { expertName: wm.expert.displayName, guardrail: g, quote, facts, socratic: true });
      setCard({ g, facts, text: ask.spoken, beforeSave });
      send({ kind: "tutorSay", text: ask.spoken });
      await hub.ask(ask.spoken, { intent: "intervention", timeoutMs: 12_000 });
      const ex = await llm("tutor_explain", { expertName: wm.expert.displayName, guardrail: g, quote, facts, socratic: false });
      spoken = ex.spoken;
      setCard({ g, facts, text: spoken, beforeSave });
      send({ kind: "tutorSay", text: spoken });
      await hub.agentSay(spoken, "intervention");
    } else {
      spoken = `Careful: ${g.statement}`;
      setCard({ g, facts, text: spoken, beforeSave });
      send({ kind: "tutorSay", text: spoken });
      void hub.agentSay(spoken, "intervention");
    }
    const trigger = [...hub.events].reverse().find((e) => e.type === "app.event");
    hub.emit({
      t, type: "tutor.intervention", source: "tutor",
      payload: {
        guardrailId: g.id, triggerAppEventId: trigger?.id ?? "", beforeSave, newHireAction: `${facts.invoice.key}: cost center ${facts.invoice.costCenter}, status ${facts.invoice.status}`,
        expectedAction: g.requiredAction, spokenText: spoken, ...(g.evidence.moments[0] ? { replayedScreenMoment: g.evidence.moments[0] } : {}), outcome: "pending",
      },
    });
  }

  async function start() {
    if (!wm) return;
    const session = await createSession({
      kind: "teach", workMapId: wm.id,
      participant: { id: "per_newhire", displayName: learner, role: "New hire", language: "en-US" },
      task: wm.task,
      consent: { recordingAccepted: true, acceptedAt: new Date().toISOString(), retention: "hackathon demo" },
      config: { frameIntervalMs: 1000, visionModel: "off", agentId: import.meta.env.VITE_ELEVENLABS_TUTOR_AGENT_ID ?? "", agentLlm: "elevenagents", sttModel: "scribe_v2_realtime|webspeech", promptVersions: { all: "v1" }, redaction: { enabled: true, engine: "none", entityTypes: ["IBAN"] }, questionBudgetPer10Min: 0 },
    });
    const h = new CaptureHub(session, { writer: "teach", vision: false, agentId: import.meta.env.VITE_ELEVENLABS_TUTOR_AGENT_ID || undefined });
    setHub(h);
    window.open("/erp?mode=teach", "minierp");
  }

  async function finish() {
    if (!hub || !wm) return;
    const iv = hub.events.filter((e) => e.type === "tutor.intervention");
    const rep: MasteryReport = {
      sessionId: hub.session.id, workMapId: wm.id, learner: hub.session.participant,
      perStep: wm.steps.map((s) => ({ stepId: s.id, status: s.guardrailIds.some((g) => caught.current.has(g)) ? "assisted" : "not_seen" })),
      perGuardrail: wm.guardrails.map((g) => ({ guardrailId: g.id, status: caught.current.has(g.id) ? "caught_by_tutor" : "not_triggered" })),
      predictions: { asked: hub.events.filter((e) => e.type === "tutor.prediction").length, correct: 0 },
      practiceNext: wm.guardrails.filter((g) => caught.current.has(g.id)).map((g) => g.statement),
    };
    await setDoc(doc(db, col.report(hub.session.id), "mastery"), rep);
    setReport(rep);
    await hub.close();
    void iv;
  }

  if (!hub)
    return (
      <div className="page narrow">
        <h1>Teach</h1>
        <div className="card form">
          <label>New hire<input value={learner} onChange={(e) => setLearner(e.target.value)} /></label>
          <label className="wide">Work Map
            <select onChange={async (e) => setWm(e.target.value ? await loadWorkMap(e.target.value) : null)} defaultValue="">
              <option value="">Choose…</option>
              {maps.map((m) => <option key={m.id} value={m.id}>{m.title ?? m.id} · v{m.latestVersion} · {m.status}</option>)}
            </select>
          </label>
          {wm && <p className="muted small">{wm.steps.length} steps · {wm.guardrails.length} guardrails ({wm.guardrails.filter((g) => g.condition).length} machine-checkable) · {wm.status}</p>}
          {wm && wm.status !== "confirmed" && <p className="error small">This map isn't confirmed by the expert yet (docs/teach.md rule 1).</p>}
          <button className="primary" disabled={!wm} onClick={start}>Start teach session + open MiniERP</button>
        </div>
      </div>
    );

  return (
    <div className="page split">
      <section>
        <h1>Tutor <span className="muted small mono">{hub.session.id}</span></h1>
        <div className="btns">
          <button onClick={() => void hub.startListening()}>Start listening</button>
          <button onClick={() => window.open("/erp?mode=teach", "minierp")}>Open MiniERP</button>
          <button onClick={finish}>Finish → mastery report</button>
        </div>
        {card && wm && (
          <div className={`card intervention ${card.beforeSave ? "block" : ""}`}>
            <h3>{card.beforeSave ? "Save held" : "Heads-up"}: {card.g.statement}</h3>
            <p>{card.text}</p>
            {card.g.evidence.quotes[0] && <Quote q={card.g.evidence.quotes[0]} who={wm.expert.displayName} />}
            {card.g.evidence.moments[0] && (
              <>
                <p className="muted small">{wm.expert.displayName}'s screen at this moment:</p>
                <FrameImg sessionId={card.g.evidence.moments[0].sessionId} frameId={card.g.evidence.moments[0].frameId} bbox={card.g.evidence.moments[0].bbox} />
              </>
            )}
          </div>
        )}
        {report && (
          <div className="card">
            <h3>Mastery report</h3>
            <ul>{report.perGuardrail.map((g) => <li key={g.guardrailId}>{wm?.guardrails.find((x) => x.id === g.guardrailId)?.statement}: <b>{g.status}</b></li>)}</ul>
            {report.practiceNext.length > 0 && <p>Practice next: {report.practiceNext.join(" · ")}</p>}
          </div>
        )}
      </section>
      <section>
        <h3>Teach session log</h3>
        <EventFeed events={events} />
      </section>
    </div>
  );
}
