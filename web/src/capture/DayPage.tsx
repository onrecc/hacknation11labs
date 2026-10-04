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
import { AdaPanel } from "./AdaPanel";
import { PAUSE } from "./hub";
import { SessionStatus } from "./SessionStatus";
import { ExpertQuestions } from "../compare/ExpertQuestions";
import { JudgeLegend, JudgeMarker } from "../components/JudgeMarker";

const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const fmtDur = (a: string, b?: string) => {
  const m = Math.max(0, Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const BOUNDARY: Record<string, string> = { start: "day start", context_switch: "switched app", idle: "after a break", new_kind_of_work: "new kind of work", manual: "marked by you" };

/** Earlier days list only real work: no detours, no empty "Detecting the task…" stubs from reopened pages. */
const worked = (t: Workday["tasks"][number]) => t.status !== "interruption" && t.actions > 0;

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

  /** Debrief a task of an earlier day: reopen that day (no recording), then debrief as usual. */
  async function debriefEarlier(day: Workday, sessionId: string) {
    try {
      setErr(null);
      await signedIn;
      const r = new WorkdayRecorder(user, { vision: false });
      await r.reopenForDebrief(day, sessionId);
      setRec(r);
      await r.hub.startListening();
      await debriefTask(sessionId, r);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function debriefTask(sessionId: string, recorder = rec) {
    const rec = recorder;
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
        <JudgeLegend />
        <p className="muted">{user.title} · {user.departmentLabel}. Start your day and work as usual in {user.app.name} or any web app. Ada stays quiet, asks <i>why</i> at natural pauses, and splits your day into tasks. You'll debrief each task afterwards.</p>
        <div className="card">
          <label className="check"><input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} /> Let Ada look at changed screens (Claude vision)</label>
          <p className="muted small">Recording only runs while you're on the record. Say "off the record" (or press the button) any time. Passwords, IBANs and card numbers are masked. <JudgeMarker n={5} /></p>
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
        <ExpertQuestions user={user} />
        {past.length > 0 && (
          <div className="card">
            <h3>Earlier days</h3>
            {past.filter((d) => d.tasks.some(worked)).map((d) => (
              <div key={d.id} className="dayrow">
                <b>{d.date}</b> <span className="muted small">{d.status} · {d.tasks.filter(worked).length} tasks</span>
                <ul>{d.tasks.filter(worked).map((t) => (
                  <li key={t.sessionId}>
                    <Link to={`/map/${t.sessionId}`}>{t.title}</Link> <span className="muted small">{fmtTime(t.startedAt)}–{fmtTime(t.endedAt)} · {t.actions} actions</span>{" "}
                    <button className="small" title="Ada asks what she couldn't work out, builds the Work Map, then explains it back to you" onClick={() => void debriefEarlier(d, t.sessionId)}>Debrief → Work Map</button>
                  </li>
                ))}</ul>
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
        <JudgeLegend />
        <SessionStatus s={s} ended={ended}><p className="muted small mono">{rec.hub.session.id}</p></SessionStatus>

        {!ended && <AdaPanel s={s} budget={PAUSE.budgetPer10Min} whyMarker={<JudgeMarker n={1} />} onOffRecord={() => rec.hub.onMarker(s.offRecord ? "off_record_end" : "off_record_start", "button")} />}

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
              <button onClick={() => rec.hub.onMarker("bookmark", "button")}>Bookmark</button>
              <button className="primary" onClick={() => void rec.endDay()}>End my day</button>
            </div>
            <p className="muted small">Tasks split automatically when you switch apps, after a {Math.round(WORKDAY.idleMs / 60_000)}-minute break, or when Ada sees a different kind of work.</p>
          </div>
        )}

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
        </div>
        {(err || s.error) && <p className="error">{err ?? s.error}</p>}
      </section>
      <section>
        <ExpertQuestions user={user} hub={rec.hub} />

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
                  {t.status === "done" && <button className={ended ? "primary" : ""} disabled={!!debriefing} onClick={() => void debriefTask(t.sessionId)}>{debriefing === t.sessionId ? "Debriefing…" : "Debrief now"}</button>}
                </div>
              </li>
            ))}
          </ol>
          {ended && <p className="next-step"><b>Next: press “Debrief now” on each task.</b> That builds its Work Map: Ada asks what she couldn't work out, then explains the task back to you. Until then the Work Map is only an empty draft.</p>}
        </div>

        <details className="devlog">
          <summary>Developer log · task {rec.hub.session.taskIndex !== undefined ? rec.hub.session.taskIndex + 1 : ""}</summary>
          <EventFeed events={events} />
        </details>
      </section>
    </div>
  );
}
