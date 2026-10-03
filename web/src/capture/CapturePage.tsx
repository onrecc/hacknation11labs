/** /capture: the expert's side panel. Start a session, listen, share screen, open MiniERP, then debrief. */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Event } from "@shared/schema";
import { createSession } from "../lib/sessions";
import { signedIn } from "../lib/firebase";
import { CaptureHub, PAUSE } from "./hub";
import { runDebrief, type DebriefStatus } from "../map/debrief";
import { EventFeed, useStore } from "../components/ui";
import agents from "../lib/elevenlabs.json";

export default function CapturePage() {
  const [hub, setHub] = useState<CaptureHub | null>(null);
  const [form, setForm] = useState({ name: "Sabine K.", role: "Accounts payable clerk", task: "Process open supplier invoices before month-end close", vision: true });
  const [events, setEvents] = useState<Event[]>([]);
  const [debrief, setDebrief] = useState<DebriefStatus | null>(null);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const state = useStore(hub, () => hub?.state ?? null);
  const evRef = useRef(0);

  useEffect(() => {
    if (!hub) return;
    const t = setInterval(() => evRef.current !== hub.events.length && ((evRef.current = hub.events.length), setEvents([...hub.events])), 500);
    const unload = () => void hub.log.flush();
    addEventListener("beforeunload", unload);
    return () => (clearInterval(t), removeEventListener("beforeunload", unload));
  }, [hub]);

  async function start() {
    try {
      await signedIn;
      const session = await createSession({
        kind: "capture",
        participant: { id: "per_expert", displayName: form.name, role: form.role, language: "en-US" },
        task: { title: form.task, domain: "accounts_payable" },
        consent: { recordingAccepted: true, acceptedAt: new Date().toISOString(), retention: "hackathon demo" },
        config: {
          frameIntervalMs: 1000, visionModel: form.vision ? "api:vision" : "off", agentId: agents.interviewerAgentId,
          agentLlm: "elevenagents", sttModel: "scribe_v2_realtime|webspeech", promptVersions: { all: "v1" },
          redaction: { enabled: true, engine: "none", entityTypes: ["IBAN"] }, questionBudgetPer10Min: PAUSE.budgetPer10Min,
        },
      });
      const hub: CaptureHub = new CaptureHub(session, {
        writer: "capture", vision: form.vision,
        voice: {
          agentId: agents.interviewerAgentId,
          dynamicVariables: { expert_name: form.name.split(" ")[0], task_title: form.task },
          clientTools: {
            get_recent_screen_events: ({ limit }) =>
              hub.events.filter((e) => e.type === "screen.action").slice(-(Number(limit) || 8)).map((e) => (e.type === "screen.action" ? e.payload.description : "")).join("\n") || "nothing yet",
          },
        },
      });
      setHub(hub);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const run = (fn: () => Promise<unknown> | void) => async () => {
    try {
      setErr(null);
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!hub || !state)
    return (
      <div className="page narrow">
        <h1>Capture</h1>
        <p className="muted">The expert works in MiniERP (or any web app, with the browser extension) while Ada, the ElevenLabs interviewer, listens, watches and asks why at natural pauses.</p>
        <div className="card form">
          <label>Expert<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Role<input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></label>
          <label className="wide">Task<input value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={form.vision} onChange={(e) => setForm({ ...form, vision: e.target.checked })} /> Send changed frames to the vision model</label>
          <button className="primary" onClick={start}>Start session (recording consent given)</button>
        </div>
        {err && <p className="error">{err}</p>}
      </div>
    );

  const s = state;
  return (
    <div className="page split">
      <section>
        <h1>Capture <span className="muted small mono">{hub.session.id}</span></h1>
        <div className="status-row">
          <span className={`pill ${s.phase}`}>{s.phase}</span>
          {s.offRecord && <span className="pill danger">OFF THE RECORD</span>}
          <span className="pill">voice: {s.voice}{s.voiceStatus ? ` (${s.voiceStatus})` : ""}</span>
          <span className={`pill ${s.extension ? "ok" : ""}`}>extension: {s.extension ? "connected" : "not detected"}</span>
          <span className="pill">frames from: {s.frameSource}</span>
          <span className="pill">stt: {s.stt}</span>
          <span className="pill">frames: {s.frames}</span>
          <span className="pill">live questions: {s.liveQuestions}</span>
          {s.agentSpeaking && <span className="pill ok">agent speaking</span>}
          {s.expertSpeaking && <span className="pill ok">expert speaking</span>}
        </div>
        {s.phase === "capture" && (
          <div className="btns">
            <button disabled={s.listening} onClick={run(() => hub.startListening())}>1 · Start listening</button>
            <button disabled={s.sharing} onClick={run(() => hub.shareScreen())} title="Not needed when the extension is installed: it captures the work tab itself">2 · Share screen{s.extension ? " (optional)" : ""}</button>
            <button onClick={() => window.open("/erp?mode=capture", "minierp")}>3 · Open MiniERP</button>
            <button onClick={() => hub.onMarker(s.offRecord ? "off_record_end" : "off_record_start", "button")}>{s.offRecord ? "Back on the record" : "Off the record"}</button>
            <button onClick={() => hub.onMarker("bookmark", "button")}>Bookmark</button>
            <button className="primary" onClick={run(() => hub.endTask())}>End task → debrief</button>
          </div>
        )}
        {s.phase !== "capture" && (
          <div className="card">
            <h3>Debrief & teach-back</h3>
            {!debrief && <button className="primary" onClick={() => void runDebrief(hub, setDebrief)}>Start debrief</button>}
            {debrief && (
              <>
                <p><b>{debrief.stage}</b> · {debrief.detail}</p>
                {debrief.segment && <blockquote className="quote">{debrief.segment.text}</blockquote>}
                {debrief.problems?.length ? <details><summary>{debrief.problems.length} evidence problems (dropped claims)</summary><ul>{debrief.problems.map((p) => <li key={p}>{p}</li>)}</ul></details> : null}
              </>
            )}
            <div className="btns">
              <button onClick={run(() => hub.close())}>Close session</button>
              <Link to={`/map/${hub.session.id}`}>Open Work Map →</Link>
            </div>
          </div>
        )}
        <div className="card">
          <label className="wide">Type instead of speaking (fallback)
            <div className="row">
              <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && typed && (hub.typeUtterance(typed), setTyped(""))} />
              <button onClick={() => typed && (hub.typeUtterance(typed), setTyped(""))}>Send</button>
            </div>
          </label>
          <p className="muted small">Last pause decision: {s.lastPause || "-"}</p>
          <p className="muted small">Written: {hub.log.stats.written}/{hub.log.stats.emitted} events · {hub.log.stats.blobs} blobs · {hub.log.pendingUploads} uploading</p>
        </div>
        {(err || s.error) && <p className="error">{err ?? s.error}</p>}
      </section>
      <section>
        <h3>Live session log</h3>
        <EventFeed events={events} />
      </section>
    </div>
  );
}
