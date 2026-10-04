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
import { DebriefPanel } from "../map/DebriefPanel";
import { AdaPanel } from "./AdaPanel";
import { SessionStatus } from "./SessionStatus";
import { personOf, useUser } from "../lib/users";
import { REDACTION_CONFIG } from "./redaction";
import { toast } from "../components/toast";

export default function CapturePage() {
  const user = useUser()!;
  const [hub, setHub] = useState<CaptureHub | null>(null);
  const [form, setForm] = useState({ name: user.name, role: user.title, task: "", vision: true });
  const [events, setEvents] = useState<Event[]>([]);
  const [debrief, setDebrief] = useState<DebriefStatus | null>(null);
  const [typed, setTyped] = useState("");
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
      await signedIn();
      const session = await createSession({
        kind: "capture",
        participant: personOf(user),
        task: { title: form.task || `${user.departmentLabel} task`, domain: user.department },
        consent: { recordingAccepted: true, acceptedAt: new Date().toISOString(), retention: "hackathon demo" },
        config: {
          frameIntervalMs: 1000, visionModel: form.vision ? "api:vision" : "off", agentId: agents.interviewerAgentId,
          agentLlm: "elevenagents", sttModel: "scribe_v2_realtime|webspeech", promptVersions: { all: "v1" },
          redaction: REDACTION_CONFIG, questionBudgetPer10Min: PAUSE.budgetPer10Min,
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
      await hub.startListening().catch((e: unknown) => toast.error(e, () => hub.startListening(), "Couldn't start Ada's voice")); // degrades to TTS + typing without a mic
    } catch (e) {
      toast.error(e, () => void start(), "Couldn't start recording");
    }
  }

  const run = (fn: () => Promise<unknown> | void) => async (): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      toast.error(e, run(fn));
    }
  };

  if (!hub || !state)
    return (
      <div className="page narrow">
        <h1>Capture</h1>
        <p className="muted">The expert works in MiniERP (or any web app, with the browser extension) while Ada, the ElevenLabs interviewer, listens, watches and asks why at natural pauses.</p>
        <div className="card form">
          <p className="wide">Recording a single task as <b>{user.name}</b> ({user.title}). For a whole day split into tasks automatically, use <a href="/day">My day</a>.</p>
          <label className="wide">Task (optional)<input placeholder="e.g. Process supplier invoices" value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={form.vision} onChange={(e) => setForm({ ...form, vision: e.target.checked })} /> Send changed frames to the vision model</label>
          <button className="primary" onClick={start}>Start recording with Ada</button>
          <p className="muted small wide">Starting means you consent to recording this task. Say "off the record" any time to pause it.</p>
        </div>
      </div>
    );

  const s = state;
  return (
    <div className="page narrow">
      <section>
        <h1>Capture{hub.session.task.title ? <span className="muted small"> · {hub.session.task.title}</span> : null}</h1>
        <SessionStatus s={s}>
          <p className="muted small mono">{hub.session.id}</p>
          <p className="muted small">Written: {hub.log.stats.written}/{hub.log.stats.emitted} events · {hub.log.stats.blobs} blobs · {hub.log.pendingUploads} uploading</p>
        </SessionStatus>
        <AdaPanel s={s} budget={PAUSE.budgetPer10Min} onOffRecord={() => hub.onMarker(s.offRecord ? "off_record_end" : "off_record_start", "button")} />
        {s.phase === "capture" && (
          <div className="btns">
            <button onClick={() => window.open("/erp?mode=capture", "minierp")}>Open MiniERP</button>
            <button disabled={s.sharing} onClick={run(() => hub.shareScreen())} title="Not needed when the extension is installed: it captures the work tab itself">Share screen{s.extension ? " (optional)" : ""}</button>
            <button onClick={() => hub.onMarker("bookmark", "button")}>Bookmark</button>
            <button className="primary" onClick={run(() => hub.endTask())}>End task → debrief</button>
          </div>
        )}
        {s.phase !== "capture" && (
          <div className="card">
            <h3>Debrief & teach-back</h3>
            {!debrief && <button className="primary" onClick={() => void runDebrief(hub, setDebrief)}>Start debrief</button>}
            {debrief && <DebriefPanel s={debrief} sessionId={hub.session.id} />}
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
        </div>
        {s.error && <p className="error">{s.error}</p>}
        <details className="devlog">
          <summary>Developer log</summary>
          <EventFeed events={events} />
        </details>
      </section>
    </div>
  );
}
