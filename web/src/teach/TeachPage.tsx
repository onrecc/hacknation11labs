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
import { personOf, useUser } from "../lib/users";

export default function TeachPage() {
  const [maps, setMaps] = useState<WorkMapHead[]>([]);
  const [wm, setWm] = useState<WorkMap | null>(null);
  const [hub, setHub] = useState<CaptureHub | null>(null);
  const [cards, setCards] = useState<TutorCard[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [report, setReport] = useState<MasteryReport | null>(null);
  const user = useUser()!;
  const learner = user.short;
  const [modules, setModules] = useState<Array<WorkMapHead & { expert: string; domain: string; steps: number; guardrails: number }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const tutor = useRef<Tutor | null>(null);
  const state = useStore(hub, () => hub?.state ?? null);

  // modules = confirmed Work Maps; the practicer's own department first, picked automatically
  useEffect(() => void signedIn.then(async () => {
    const list = await listWorkMaps();
    setMaps(list);
    const loaded = (await Promise.all(list.filter((x) => x.status === "confirmed").map(async (m) => ({ head: m, full: await loadWorkMap(m.id) }))))
      .filter((x): x is { head: WorkMapHead; full: WorkMap } => !!x.full && x.full.guardrails.length > 0)
      .sort((a, b) => Number(b.full.task.domain === user.department) - Number(a.full.task.domain === user.department) || b.head.updatedAt.localeCompare(a.head.updatedAt));
    setModules(loaded.map(({ head, full }) => ({ ...head, expert: full.expert.displayName, domain: full.task.domain, steps: full.steps.length, guardrails: full.guardrails.length })));
    if (loaded[0]) setWm(loaded[0].full);
  }), [user.department]);
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
        participant: personOf(user),
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
        <h1>Hi {learner}, ready to practice?</h1>
        <p className="muted">{user.title} · {user.departmentLabel}. Ada, your ElevenLabs tutor, watches you work a real case and coaches you with what the experts taught her: their rules, in their own words.</p>
        <div className="card form">
          <label className="wide">Training module
            <select value={wm?.id ?? ""} onChange={async (e) => setWm(e.target.value ? await loadWorkMap(e.target.value) : null)}>
              <option value="">Choose…</option>
              {modules.map((m) => <option key={m.id} value={m.id}>{m.title ?? m.id} · by {m.expert}{m.domain === user.department ? "" : ` (${m.domain.replace("_", " ")})`}</option>)}
            </select>
          </label>
          {modules.length === 0 && maps.length > 0 && <p className="muted small wide">No confirmed Work Maps with guardrails yet. An expert needs to record and debrief a task first.</p>}
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
