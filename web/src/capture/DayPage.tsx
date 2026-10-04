/**
 * /day: the expert's workday. Ada (ElevenLabs interviewer) listens all day, asks why at natural pauses, and the
 * day is split into tasks automatically. Each task becomes its own session → its own Work Map (debrief per task).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import type { Event, Workday } from "@shared/schema";
import { signedIn } from "../lib/firebase";
import { listWorkdays } from "../lib/sessions";
import { useUser } from "../lib/users";
import { WorkdayRecorder, WORKDAY } from "./workday";
import { runDebrief, type DebriefStatus } from "../map/debrief";
import { DebriefPanel } from "../map/DebriefPanel";
import { EventFeed } from "../components/ui";

const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const fmtDur = (a: string, b?: string) => {
  const m = Math.max(0, Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const BOUNDARY: Record<string, string> = { start: "day start", context_switch: "switched app", idle: "after a break", new_kind_of_work: "new kind of work", manual: "marked by you" };

export default function DayPage() {
  const user = useUser()!;
  const [rec, setRec] = useState<WorkdayRecorder | null>(null);
  const [past, setPast] = useState<Workday[]>([]);
  const [vision, setVision] = useState(true);
  const [debrief, setDebrief] = useState<DebriefStatus | null>(null);
  const [debriefing, setDebriefing] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  const snap = useSyncExternalStore((fn) => (rec ? rec.subscribe(fn) : () => {}), () => rec?.snapshot ?? null);
  const hubState = useSyncExternalStore((fn) => (rec?.hub ? rec.hub.subscribe(fn) : () => {}), () => rec?.hub?.state ?? null);
  const evCount = useRef(0);

  useEffect(() => void signedIn.then(async () => setPast(await listWorkdays(user.id))), [user.id]);
  useEffect(() => {
    const t = setInterval(() => {
      tick((x) => x + 1); // durations
      const h = rec?.hub;
      if (h && evCount.current !== h.events.length) {
        evCount.current = h.events.length;
        setEvents([...h.events]);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [rec]);
  useEffect(() => {
    const flush = () => void rec?.hub.log.flush();
    addEventListener("beforeunload", flush);
    return () => removeEventListener("beforeunload", flush);
  }, [rec]);

  const active = past.find((d) => d.status === "active" && d.date === new Date().toISOString().slice(0, 10));

  async function start(existing?: Workday) {
    try {
      setErr(null);
      await signedIn;
      const r = new WorkdayRecorder(user, { vision });
      await r.start(existing);
      setRec(r);
      await r.hub.startListening(); // Ada's voice + Scribe; degrades to TTS + typing without a mic
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function debriefTask(sessionId: string) {
    if (!rec) return;
    setDebriefing(sessionId);
    setDebrief({ stage: "planning", detail: "Opening the task…", gapsOpen: 0 } as DebriefStatus);
    try {
      await rec.openTaskForDebrief(sessionId);
      await runDebrief(rec.hub, setDebrief);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDebriefing(null);
    }
  }

  const tasks = useMemo(() => snap?.workday?.tasks ?? [], [snap]);
  const visible = tasks.filter((t) => t.status !== "interruption");
  const detours = tasks.length - visible.length;

  // ───────────── not started ─────────────
  if (!rec || !snap?.workday || !hubState) {
    return (
      <div className="page narrow">
        <h1>Good {new Date().getHours() < 12 ? "morning" : "day"}, {user.short}</h1>
        <p className="muted">{user.title} · {user.departmentLabel}. Start your day and work as usual in {user.app.name} or any web app. Ada stays quiet, asks <i>why</i> at natural pauses, and splits your day into tasks. You'll debrief each task afterwards.</p>
        <div className="card">
          <label className="check"><input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} /> Let Ada look at changed screens (Gemini vision)</label>
          <p className="muted small">Recording only runs while you're on the record. Say "off the record" (or press the button) any time. Passwords, IBANs and card numbers are masked.</p>
          <div className="btns">
            {active ? (
              <>
                <button className="primary" onClick={() => start(active)}>Continue my day ({active.tasks.filter((t) => t.status !== "interruption").length} tasks so far)</button>
                <button onClick={() => start()}>Start a new day</button>
              </>
            ) : (
              <button className="primary" onClick={() => start()}>Start my day</button>
            )}
          </div>
        </div>
        {err && <p className="error">{err}</p>}
        {past.length > 0 && (
          <div className="card">
            <h3>Earlier days</h3>
            {past.map((d) => (
              <div key={d.id} className="dayrow">
                <b>{d.date}</b> <span className="muted small">{d.status} · {d.tasks.filter((t) => t.status !== "interruption").length} tasks</span>
                <ul>{d.tasks.filter((t) => t.status !== "interruption").map((t) => <li key={t.sessionId}><Link to={`/map/${t.sessionId}`}>{t.title}</Link> <span className="muted small">{fmtTime(t.startedAt)}–{fmtTime(t.endedAt)} · {t.actions} actions</span></li>)}</ul>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ───────────── recording ─────────────
  const s = hubState;
  const day = snap.workday;
  const cur = snap.current;
  const ended = day.status === "ended";
  return (
    <div className="page split">
      <section>
        <h1>{user.short}'s day <span className="muted small">{day.date}</span></h1>
        <div className="status-row">
          <span className={`pill ${ended ? "" : "ok"}`}>{ended ? "day ended" : s.offRecord ? "off the record" : "recording"}</span>
          {s.offRecord && <span className="pill danger">OFF THE RECORD</span>}
          <span className="pill">voice: {s.voice}{s.voiceStatus ? ` (${s.voiceStatus})` : ""}</span>
          <span className="pill">stt: {s.stt}</span>
          <span className={`pill ${s.extension ? "ok" : ""}`}>extension: {s.extension ? "connected" : "not detected"}</span>
          <span className="pill">frames: {s.frameSource}</span>
          {s.agentSpeaking && <span className="pill ok">Ada speaking</span>}
        </div>

        {!ended && cur && (
          <div className="card current-task">
            <div className="muted small">Now · task {cur.index + 1} · {BOUNDARY[cur.boundary]}</div>
            <h2>{snap.rotating ? "Switching task…" : cur.title}</h2>
            <p className="muted small">{cur.app} · since {fmtTime(cur.startedAt)} ({fmtDur(cur.startedAt)}) · {cur.actions} actions · {s.liveQuestions} questions</p>
            {cur.summary && <p>{cur.summary}</p>}
            <div className="btns">
              <button onClick={() => window.open(user.app.url + (user.app.url.includes("?") ? "&" : "?") + "mode=capture", "work")}>Open {user.app.name}</button>
              <button disabled={s.sharing} onClick={() => void rec.hub.shareScreen().catch((e) => setErr((e as Error).message))} title="Optional when the extension is installed">Share screen{s.extension ? " (optional)" : ""}</button>
              <button onClick={() => void rec.newTask()} title="Tell Ada you're starting something different">New task</button>
              <button onClick={() => rec.hub.onMarker(s.offRecord ? "off_record_end" : "off_record_start", "button")}>{s.offRecord ? "Back on the record" : "Off the record"}</button>
              <button onClick={() => rec.hub.onMarker("bookmark", "button")}>Bookmark</button>
              <button className="primary" onClick={() => void rec.endDay()}>End my day</button>
            </div>
            <p className="muted small">Tasks split automatically when you switch apps, after a {Math.round(WORKDAY.idleMs / 60_000)}-minute break, or when Ada sees a different kind of work.</p>
          </div>
        )}

        <div className="card">
          <h3>Today's tasks {detours > 0 && <span className="muted small">({detours} short detours hidden)</span>}</h3>
          {visible.length === 0 && <p className="muted">Nothing yet. Work as usual.</p>}
          <ol className="tasks">
            {visible.map((t) => (
              <li key={t.sessionId} className={t.status}>
                <div>
                  <b>{t.title}</b> {t.sameAs && <span className="badge">resumed</span>}
                  <div className="muted small">{t.app} · {fmtTime(t.startedAt)}–{t.endedAt ? fmtTime(t.endedAt) : "now"} ({fmtDur(t.startedAt, t.endedAt)}) · {t.actions} actions · {BOUNDARY[t.boundary]}</div>
                  {t.summary && <div className="small">{t.summary}</div>}
                </div>
                <div className="btns">
                  <Link to={`/map/${t.sessionId}`}>Work Map</Link>
                  {t.status === "done" && <button disabled={!!debriefing} onClick={() => void debriefTask(t.sessionId)}>{debriefing === t.sessionId ? "Debriefing…" : "Debrief now"}</button>}
                </div>
              </li>
            ))}
          </ol>
          {ended && <p className="muted small">Day ended. Debrief each task while it's fresh: Ada asks what she couldn't work out, then explains the task back to you.</p>}
        </div>

        {debrief && (
          <div className="card">
            <h3>Debrief: {tasks.find((t) => t.sessionId === rec.hub.session.id)?.title ?? ""}</h3>
            <DebriefPanel s={debrief} sessionId={rec.hub.session.id} />
          </div>
        )}

        <div className="card">
          <label className="wide">Type instead of speaking (fallback)
            <div className="row">
              <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && typed && (rec.hub.typeUtterance(typed), setTyped(""))} />
              <button onClick={() => typed && (rec.hub.typeUtterance(typed), setTyped(""))}>Send</button>
            </div>
          </label>
          <p className="muted small">Last pause decision: {s.lastPause || "-"}</p>
        </div>
        {(err || s.error) && <p className="error">{err ?? s.error}</p>}
      </section>
      <section>
        <h3>Live log · task {rec.hub.session.taskIndex !== undefined ? rec.hub.session.taskIndex + 1 : ""}</h3>
        <EventFeed events={events} />
      </section>
    </div>
  );
}
