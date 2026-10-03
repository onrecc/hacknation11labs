/**
 * /teach: tutor panel. Pick a confirmed Work Map → start a teach session → Ada (ElevenAgents tutor) watches the
 * new hire in MiniERP (or any site with the extension), predicts, nudges, blocks before save, explains in the
 * expert's words with their screen moment. Logic lives in tutor.ts; this file is UI.
 */
import { useEffect, useRef, useState } from "react";
import type { Event, MasteryReport, WorkMap } from "@shared/schema";
import { createSession, listWorkMaps, loadWorkMap, type WorkMapHead } from "../lib/sessions";
import { signedIn } from "../lib/firebase";
import agents from "../lib/elevenlabs.json";
import { CaptureHub } from "../capture/hub";
import { EventFeed, useStore } from "../components/ui";
import { Tutor, type TutorCard } from "./tutor";

export default function TeachPage() {
  const [maps, setMaps] = useState<WorkMapHead[]>([]);
  const [wm, setWm] = useState<WorkMap | null>(null);
  const [hub, setHub] = useState<CaptureHub | null>(null);
  const [cards, setCards] = useState<TutorCard[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [report, setReport] = useState<MasteryReport | null>(null);
  const [learner, setLearner] = useState("Lena");
  const [err, setErr] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const tutor = useRef<Tutor | null>(null);
  const state = useStore(hub, () => hub?.state ?? null);

  useEffect(() => void signedIn.then(async () => {
    const list = await listWorkMaps();
    setMaps(list);
    // default: the newest confirmed map that actually has guardrails to teach
    for (const m of list.filter((x) => x.status === "confirmed").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const full = await loadWorkMap(m.id);
      if (full?.guardrails.length) return setWm(full);
    }
  }), []);
  useEffect(() => {
    if (!hub) return;
    const t = setInterval(() => setEvents([...hub.events]), 700);
    return () => clearInterval(t);
  }, [hub]);

  async function start() {
    if (!wm) return;
    try {
      const session = await createSession({
        kind: "teach", workMapId: wm.id,
        participant: { id: "per_newhire", displayName: learner, role: "New hire", language: "en-US" },
        task: wm.task,
        consent: { recordingAccepted: true, acceptedAt: new Date().toISOString(), retention: "hackathon demo" },
        config: { frameIntervalMs: 1000, visionModel: "off", agentId: agents.tutorAgentId, agentLlm: agents.llm, sttModel: "scribe_v2_realtime", promptVersions: { tutor: "v1" }, redaction: { enabled: true, engine: "none", entityTypes: ["IBAN"] }, questionBudgetPer10Min: 0 },
      });
      const t = new Tutor(wm, (c) => setCards((cs) => [c, ...cs].slice(0, 6)));
      const h = new CaptureHub(session, { writer: "teach", vision: false, voice: t.voiceOptions(agents.tutorAgentId, learner) });
      t.attach(h);
      tutor.current = t;
      setHub(h);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function finish() {
    if (!hub || !tutor.current) return;
    setReport(await tutor.current.report());
    tutor.current.detach();
    await hub.close();
  }

  if (!hub || !state)
    return (
      <div className="page narrow">
        <h1>Teach</h1>
        <p className="muted">Ada, the ElevenLabs tutor, coaches a new hire on a case the expert never showed, using only the expert's confirmed Work Map.</p>
        <div className="card form">
          <label>New hire<input value={learner} onChange={(e) => setLearner(e.target.value)} /></label>
          <label className="wide">Work Map
            <select value={wm?.id ?? ""} onChange={async (e) => setWm(e.target.value ? await loadWorkMap(e.target.value) : null)}>
              <option value="">Choose…</option>
              {maps.map((m) => <option key={m.id} value={m.id}>{m.title ?? m.id} · v{m.latestVersion} · {m.status}</option>)}
            </select>
          </label>
          {wm && <p className="muted small wide">{wm.steps.length} steps · {wm.guardrails.length} guardrails ({wm.guardrails.filter((g) => g.condition).length} machine-checkable) · expert {wm.expert.displayName} · {wm.status}</p>}
          {wm && wm.status !== "confirmed" && <p className="error small wide">This map isn't confirmed by the expert yet (docs/teach.md rule 1).</p>}
          <button className="primary" disabled={!wm} onClick={start}>Start teach session</button>
        </div>
        {err && <p className="error">{err}</p>}
      </div>
    );

  const s = state;
  return (
    <div className="page split">
      <section>
        <h1>Tutor <span className="muted small mono">{hub.session.id}</span></h1>
        <div className="status-row">
          <span className="pill">voice: {s.voice}{s.voiceStatus ? ` (${s.voiceStatus})` : ""}</span>
          <span className="pill">stt: {s.stt}</span>
          <span className={`pill ${s.extension ? "ok" : ""}`}>extension: {s.extension ? "connected" : "not detected"}</span>
          {s.agentSpeaking && <span className="pill ok">Ada speaking</span>}
          {s.expertSpeaking && <span className="pill ok">{learner} speaking</span>}
        </div>
        <div className="btns">
          <button disabled={s.listening} onClick={() => void hub.startListening().catch((e) => setErr((e as Error).message))}>1 · Start Ada (voice)</button>
          <button onClick={() => window.open("/erp?mode=teach", "minierp")}>2 · Open MiniERP</button>
          <button onClick={finish}>Finish → mastery report</button>
        </div>
        <div className="row">
          <input placeholder={`Type as ${learner} (fallback when there's no mic)`} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && typed && (hub.typeUtterance(typed), setTyped(""))} />
          <button onClick={() => typed && (hub.typeUtterance(typed), setTyped(""))}>Send</button>
        </div>
        <p className="muted small">Try INV-4490 (€7,200 equipment, new supplier): leave cost center 4711 and press Approve. Any other website works too with the extension (Gemini checks the visible form against the guardrails).</p>
        {cards.map((c, i) => <Card key={i} c={c} />)}
        {report && wm && (
          <div className="card">
            <h3>Mastery report · {learner}</h3>
            <ul>{report.perGuardrail.map((g) => <li key={g.guardrailId}>{wm.guardrails.find((x) => x.id === g.guardrailId)?.statement}: <b>{g.status.replaceAll("_", " ")}</b></li>)}</ul>
            <ul>{report.perStep.filter((x) => x.status !== "not_seen").map((x) => <li key={x.stepId}>{wm.steps.find((s2) => s2.id === x.stepId)?.title}: <b>{x.status}</b></li>)}</ul>
            <p>Predictions: {report.predictions.correct}/{report.predictions.asked} correct</p>
            {report.practiceNext.length > 0 && <p>Practice next: {report.practiceNext.join(" · ")}</p>}
          </div>
        )}
        {err && <p className="error">{err}</p>}
      </section>
      <section>
        <h3>Teach session log</h3>
        <EventFeed events={events} />
      </section>
    </div>
  );
}

function Card({ c }: { c: TutorCard }) {
  return (
    <div className={`card intervention ${c.tone}`}>
      <h3>{c.title}</h3>
      <p>{c.text}</p>
      {c.quote && <blockquote className="quote">“{c.quote.text}” <span className="muted">· {c.quote.who} · {c.quote.when}</span></blockquote>}
      {c.imageUrl && (
        <div className="frame">
          <img src={c.imageUrl} alt="expert's screen" />
          {c.bbox && <div className="bbox" style={{ left: `${c.bbox.x * 100}%`, top: `${c.bbox.y * 100}%`, width: `${c.bbox.w * 100}%`, height: `${c.bbox.h * 100}%` }} />}
        </div>
      )}
    </div>
  );
}
