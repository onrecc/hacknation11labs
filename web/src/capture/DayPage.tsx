/**
 * /day: the expert's workday as one guided path.
 *   1. "Start my work day": Ada (ElevenLabs interviewer + Scribe) starts listening.
 *   2. Open your work: the work app (works as is) or install the extension (any website). Ada asks why at pauses.
 *   3. Back on this tab: "End task" goes over that task with Ada right away, then back to work; "End my day" goes
 *      over each task of the day in turn. Going over = Map's debrief + teach-back → the task's Work Map.
 * The day is still split into tasks automatically (app switch, break, new kind of work); each task is its own session.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Event, Id, Workday } from "@shared/schema";
import { signedIn } from "../lib/firebase";
import { listWorkdays, listWorkMaps, type WorkMapHead } from "../lib/sessions";
import { useUser } from "../lib/users";
import { appUrl } from "../lib/workApp";
import { WorkdayRecorder, WORKDAY, taskTitle } from "./workday";
import { runDebrief, type DebriefStatus } from "../map/debrief";
import { DebriefPanel } from "../map/DebriefPanel";
import { EventFeed } from "../components/ui";
import { AdaPanel } from "./AdaPanel";
import { PAUSE } from "./hub";
import { SessionStatus } from "./SessionStatus";
import { WorkSetup, useExtensionPresent } from "./WorkSetup";
import { ExpertQuestions } from "../compare/ExpertQuestions";
import { dayLabel, localDate } from "../lib/dates";
import { JudgeLegend, JudgeMarker } from "../components/JudgeMarker";
import { toast } from "../components/toast";
import { Skeleton } from "../components/Feedback";

type Task = Workday["tasks"][number];
/** How going over a task ended: Work Map confirmed, gone over but not every part confirmed, or it broke off. */
type Result = "confirmed" | "incomplete" | "failed";
/** What is being gone over: one task mid-day, the day's tasks in turn, or one task of an earlier day. */
interface GoOver { mode: "task" | "day" | "earlier"; queue: Id[]; at: number }

const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const fmtDur = (a: string, b?: string) => {
  const m = Math.max(0, Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const BOUNDARY: Record<string, string> = { start: "day start", context_switch: "switched app", idle: "after a break", new_kind_of_work: "new kind of work", manual: "marked by you" };
const RESULT: Record<Result, string> = {
  confirmed: "✓ Ada has got it. The Work Map is confirmed.",
  incomplete: "Gone over. A few points still need your check in the Work Map.",
  failed: "That didn't finish. You can go over it again later.",
};

/** Real work only: no detours, no empty stubs from reopened pages. */
const worked = (t: Task) => t.status !== "interruption" && t.actions > 0;

export default function DayPage() {
  const user = useUser()!;
  const [rec, setRec] = useState<WorkdayRecorder | null>(null);
  const [past, setPast] = useState<Workday[] | null>(null); // null = loading
  const [heads, setHeads] = useState<WorkMapHead[]>([]);
  const [vision, setVision] = useState(true);
  const [debrief, setDebrief] = useState<DebriefStatus | null>(null);
  const [debriefing, setDebriefing] = useState<Id | null>(null);
  const [goOver, setGoOver] = useState<GoOver | null>(null);
  const [results, setResults] = useState<Record<Id, Result>>({});
  /** Has the expert gone to their work (and come back)? Drives step 2's prompt and the "Welcome back". */
  const [away, setAway] = useState<"never" | "away" | "back">("never");
  const [notice, setNotice] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const [typed, setTyped] = useState("");
  const [, tick] = useState(0);
  const extension = useExtensionPresent();
  const snap = useSyncExternalStore((fn) => (rec ? rec.subscribe(fn) : () => {}), () => rec?.snapshot ?? null);
  const hubState = useSyncExternalStore((fn) => (rec?.hub ? rec.hub.subscribe(fn) : () => {}), () => rec?.hub?.state ?? null);
  const evCount = useRef(0);
  /** End task / End day pressed on a work tab's overlay (always the latest handlers, not the first render's). */
  const onOverlayEnd = useRef<(which: "task" | "day") => void>(() => {});

  const loadPast = (): void => void signedIn().then(async () => {
    const [days, maps] = await Promise.all([listWorkdays(user.id), listWorkMaps().catch(() => [])]);
    setPast(days);
    setHeads(maps);
  }).catch((e: unknown) => toast.error(e, loadPast, "Couldn't load your earlier days"));
  useEffect(loadPast, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
  useEffect(() => {
    if (!rec) return;
    const left = () => document.visibilityState === "hidden" && setAway("away");
    const back = () => document.visibilityState === "visible" && setAway((a) => (a === "away" ? "back" : a));
    document.addEventListener("visibilitychange", left);
    document.addEventListener("visibilitychange", back);
    addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", left);
      document.removeEventListener("visibilitychange", back);
      removeEventListener("focus", back);
    };
  }, [rec]);

  /** Gone over already? This page's results first, else the task's Work Map status. */
  const mapStatus = useMemo(() => {
    const m = new Map<Id, Result>();
    for (const h of heads) {
      const r = h.status === "confirmed" ? "confirmed" : h.status === "teachback_pending" ? "incomplete" : null;
      if (r) for (const sid of h.sourceSessionIds ?? []) m.set(sid, r);
    }
    return m;
  }, [heads]);
  const wentOver = (sid: Id): Result | undefined => results[sid] ?? mapStatus.get(sid);

  // ───────────── actions ─────────────
  async function start(existing?: Workday) {
    try {
      await signedIn();
      const r = new WorkdayRecorder(user, { vision });
      await r.start(existing);
      setAway("never");
      setNotice("");
      setGoOver(null);
      setDebrief(null);
      setRec(r);
      // Ada's voice + Scribe (degrades to TTS + typing without a mic); one greeting line only for a fresh day
      const greeting = existing?.tasks.some(worked) ? undefined : `Hi ${user.short}, I'm Ada. Open your work and do it as usual; I'll only ask when you pause.`;
      await r.hub.startListening(greeting).catch((e: unknown) => toast.error(e, () => r.hub.startListening(greeting), "Couldn't start Ada's voice"));
    } catch (e) {
      toast.error(e, () => void start(existing), "Couldn't start your day");
    }
  }

  /** Open the work app in its own tab, or bring that tab forward if it's already open (without reloading it). */
  function openWork() {
    const w = window.open("", "work");
    try {
      if (w && w.location.href === "about:blank") w.location.href = appUrl(user.app, "capture");
    } catch { /* that tab is on another site by now: just bring it forward */ }
    w?.focus();
    setAway("away");
  }

  function shareScreen() {
    if (!rec) return;
    void rec.hub.shareScreen().then(() => setAway("away"), (e: unknown) => toast.error(e, undefined, "Screen sharing failed"));
  }

  /** Go over one task with Ada (debrief + teach-back); the result is kept for the task lists. */
  async function debriefTask(sessionId: Id, r = rec): Promise<void> {
    if (!r) return;
    setDebriefing(sessionId);
    setDebrief({ stage: "planning", detail: "Opening the task…", gapsOpen: 0 });
    let result: Result = "failed";
    try {
      await r.openTaskForDebrief(sessionId);
      const wm = await runDebrief(r.hub, setDebrief);
      result = !wm ? "failed" : wm.status === "confirmed" ? "confirmed" : "incomplete";
    } catch (e) {
      toast.error(e, () => void debriefTask(sessionId, r), "Couldn't go over the task");
    } finally {
      setResults((x) => ({ ...x, [sessionId]: result }));
      setDebriefing(null);
    }
  }

  /** "End task": stop this task here and go over it now; the day keeps going afterwards. */
  async function endTask() {
    if (!rec || goOver || rec.workday.status !== "active") return;
    const cur = rec.current;
    if (!cur || cur.actions === 0) {
      setNotice("Nothing was recorded in this task yet, so there's nothing to go over. Ada keeps listening.");
      return;
    }
    setNotice("");
    setGoOver({ mode: "task", queue: [cur.sessionId], at: 0 });
    setDebrief({ stage: "planning", detail: "Wrapping up the task…", gapsOpen: 0 });
    try {
      const t = await rec.endTask();
      if (t) await debriefTask(t.sessionId, rec);
    } catch (e) {
      toast.error(e, undefined, "Couldn't end the task");
    }
  }

  /** After going over a task mid-day: a fresh task, and back to the work tab. */
  function backToWork() {
    if (!rec) return;
    setGoOver(null);
    setDebrief(null);
    rec.resume();
    openWork();
  }

  /** "End my day": then go over every task of today that hasn't been, one after the other. */
  async function endDay() {
    if (!rec || debriefing || rec.workday.status !== "active") return;
    setNotice("");
    try {
      await rec.endDay();
    } catch (e) {
      toast.error(e, () => void endDay(), "Couldn't end your day");
      return;
    }
    const queue = rec.tasks.filter((t) => worked(t) && !results[t.sessionId]).map((t) => t.sessionId);
    if (!queue.length) return setGoOver(null);
    setGoOver({ mode: "day", queue, at: 0 });
    await debriefTask(queue[0], rec);
  }

  async function goOverNext() {
    if (!rec || !goOver) return;
    const at = goOver.at + 1;
    setGoOver({ ...goOver, at });
    await debriefTask(goOver.queue[at], rec);
  }

  /** One task, from the day summary. */
  async function goOverOne(sessionId: Id) {
    setGoOver({ mode: "day", queue: [sessionId], at: 0 });
    await debriefTask(sessionId, rec);
  }

  /** A task of an earlier day: reopen that day (no recording), then go over it as usual. */
  async function goOverEarlier(day: Workday, sessionId: Id) {
    try {
      await signedIn();
      const r = new WorkdayRecorder(user, { vision: false });
      await r.reopenForDebrief(day, sessionId);
      setGoOver({ mode: "earlier", queue: [sessionId], at: 0 });
      setRec(r);
      await r.hub.startListening();
      await debriefTask(sessionId, r);
    } catch (e) {
      toast.error(e, () => void goOverEarlier(day, sessionId), "Couldn't open that task");
    }
  }

  /** Back to the start screen. */
  async function close() {
    const r = rec;
    setRec(null);
    setGoOver(null);
    setDebrief(null);
    await r?.close().catch(() => {});
    loadPast();
  }

  onOverlayEnd.current = (which) => void (which === "day" ? endDay() : endTask());
  useEffect(() => {
    if (rec) rec.hub.onEnd = (which) => onOverlayEnd.current(which);
  }, [rec]);

  // ───────────── 1. start ─────────────
  if (!rec || !snap?.workday || !hubState) {
    // today's day is still open (page reloaded, extension just installed): carry on with it
    const active = past?.find((d) => d.status === "active" && d.date === localDate());
    const sofar = active?.tasks.filter(worked).length ?? 0;
    const pending = (past ?? []).flatMap((d) => d.tasks.filter((t) => worked(t) && t.status === "done" && wentOver(t.sessionId) !== "confirmed").map((t) => ({ d, t })));
    return (
      <div className="page narrow day">
        <h1>Good {new Date().getHours() < 12 ? "morning" : "day"}, {user.short}</h1>
        <JudgeLegend />
        <DaySteps at={1} />
        <section className="card day-start">
          <p>Press start, then work as usual in {user.app.name} or any web app. Ada listens and only asks <i>why</i> when you pause. When you finish a task or your day, she goes over it with you.</p>
          <div className="btns">
            {active && sofar > 0 ? (
              <>
                <button className="primary big" onClick={() => start(active)}>Continue my work day ({sofar} task{sofar === 1 ? "" : "s"} so far)</button>
                <button className="link" onClick={() => start()}>Start a new day</button>
              </>
            ) : active ? (
              <button className="primary big" onClick={() => start(active)}>Start my work day</button>
            ) : (
              <button className="primary big" onClick={() => start()}>Start my work day</button>
            )}
          </div>
          <label className="check"><input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} /> Let Ada look at changed screens (Claude vision)</label>
          <p className="muted small">Say "off the record" (or press the button) any time and nothing is kept. Passwords, IBANs and card numbers are masked. {extension && <span className="ok-line">✓ Browser extension connected</span>} <JudgeMarker n={5} /></p>
        </section>
        <ExpertQuestions user={user} />
        {past === null && <div className="card"><h3>Waiting to be gone over</h3><Skeleton lines={3} /></div>}
        {pending.length > 0 && (
          <section className="card">
            <h3>Waiting to be gone over <span className="muted small">({pending.length})</span></h3>
            <p className="muted small">Ada builds a task's Work Map when you go over it together. About five minutes each.</p>
            <PendingList items={pending} render={({ d, t }) => (
              <li key={t.sessionId}>
                <div>
                  <Link to={`/map/${t.sessionId}`}><b>{taskTitle(t)}</b></Link>
                  <div className="muted small">{dayLabel(d.date)} {fmtTime(t.startedAt)}–{fmtTime(t.endedAt)} · {t.actions} actions{wentOver(t.sessionId) === "incomplete" ? " · gone over, not confirmed yet" : ""}</div>
                </div>
                <button title="Ada asks what she couldn't work out, builds the Work Map, then explains it back to you" onClick={() => void goOverEarlier(d, t.sessionId)}>Go over it</button>
              </li>
            )} />
          </section>
        )}
        {past && past.some((d) => d.tasks.some(worked)) && (
          <details className="card earlier">
            <summary>Earlier days</summary>
            {past.filter((d) => d.tasks.some(worked)).map((d) => (
              <div key={d.id} className="dayrow">
                <b>{dayLabel(d.date)}</b> <span className="muted small">{d.status} · {d.tasks.filter(worked).length} tasks</span>
                <ul>{d.tasks.filter(worked).map((t) => (
                  <li key={t.sessionId}><Link to={`/map/${t.sessionId}`}>{taskTitle(t)}</Link> <span className="muted small">{fmtTime(t.startedAt)}–{fmtTime(t.endedAt)} · {t.actions} actions{wentOver(t.sessionId) === "confirmed" ? " · ✓ Work Map confirmed" : ""}</span></li>
                ))}</ul>
              </div>
            ))}
          </details>
        )}
      </div>
    );
  }

  const s = hubState;
  const day = snap.workday;
  const cur = snap.current;
  const tasks = day.tasks.filter((t) => t.status === "active" || worked(t)); // no detours, no empty leftovers
  const running = debriefing !== null;
  const noMic = s.stt === "typed only";
  const typing = (
    <div className="card">
      <label className="wide">{noMic ? "No microphone: type your answers to Ada" : "Type instead of speaking"}
        <div className="row">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && typed && (rec.hub.typeUtterance(typed), setTyped(""))} />
          <button onClick={() => typed && (rec.hub.typeUtterance(typed), setTyped(""))}>Send</button>
        </div>
      </label>
    </div>
  );
  const devlog = (
    <details className="devlog">
      <summary>Developer log · {rec.hub.session.id}</summary>
      <EventFeed events={events} />
    </details>
  );
  const lastOfDay = goOver?.mode === "day" && !running && goOver.at >= goOver.queue.length - 1;

  // ───────────── 3b. day done ─────────────
  if (day.status === "ended" && (!goOver || lastOfDay)) {
    return (
      <div className="page narrow day">
        <h1>That's your day, {user.short}</h1>
        <DaySteps at={3} />
        <p className="muted">Thank you. Every task below has its own Work Map; new hires train on the confirmed ones.</p>
        <section className="card">
          <TaskList tasks={tasks.filter(worked)} actions={(t) => {
            const r = wentOver(t.sessionId);
            return (
              <>
                <span className={`badge ${r === "confirmed" ? "ok" : ""}`}>{r === "confirmed" ? "✓ Confirmed" : r === "incomplete" ? "Needs a check" : "Not gone over"}</span>
                <Link to={`/map/${t.sessionId}`}>Work Map</Link>
                {r !== "confirmed" && <button className="small" onClick={() => void goOverOne(t.sessionId)}>Go over it</button>}
              </>
            );
          }} />
          {!tasks.some(worked) && <p className="muted">No work was recorded today.</p>}
        </section>
        <div className="btns"><button className="primary big" onClick={() => void close()}>Close</button></div>
        {devlog}
      </div>
    );
  }

  // ───────────── 3. going over a task with Ada ─────────────
  if (goOver) {
    const sid = goOver.queue[goOver.at];
    const task = day.tasks.find((t) => t.sessionId === sid);
    const n = goOver.queue.length;
    const next = goOver.mode === "day" && goOver.at < n - 1 ? day.tasks.find((t) => t.sessionId === goOver.queue[goOver.at + 1]) : undefined;
    const r = results[sid];
    return (
      <div className="page narrow day">
        <h1>Going over: {task ? taskTitle(task) : "your task"}</h1>
        <DaySteps at={3} />
        <p className="muted">{n > 1 ? `Task ${goOver.at + 1} of ${n}. ` : ""}Ada asks what she couldn't work out from the screen, then explains the task back to you. Answer out loud; say “that's all” when you're done.</p>
        <SessionStatus s={s} />
        {debrief && <DebriefPanel s={debrief} sessionId={sid} />}
        {!running && (
          <section className="card after">
            {r && <p className="after-result">{RESULT[r]}</p>}
            <div className="btns">
              {goOver.mode === "task" && (
                <>
                  <button className="primary big" onClick={backToWork}>Back to work ↗</button>
                  <button className="big" onClick={() => void endDay()}>End my day</button>
                </>
              )}
              {next && (
                <>
                  <button className="primary big" onClick={() => void goOverNext()}>Go over the next task: {taskTitle(next)} ({goOver.at + 2} of {n})</button>
                  <button className="big" onClick={() => setGoOver(null)}>Leave the rest for later</button>
                </>
              )}
              {goOver.mode === "earlier" && <button className="primary big" onClick={() => void close()}>Done</button>}
            </div>
          </section>
        )}
        {(noMic || running) && typing}
        {devlog}
      </div>
    );
  }

  // ───────────── 2. at work ─────────────
  const wentToWork = away !== "never" || (cur?.actions ?? 0) > 0 || s.sharing;
  return (
    <div className="page narrow day">
      <JudgeLegend />
      <DaySteps at={2} />
      <SessionStatus s={s} />
      {!wentToWork ? (
        <WorkSetup app={user.app} extension={s.extension} onOpen={openWork} onShare={shareScreen} />
      ) : (
        <section className="card current-task day-hero">
          <p className="kicker">{away === "back" ? `Welcome back, ${user.short}` : "Ada is following your work"}</p>
          {cur ? (
            <>
              <h2>{snap.rotating ? "Switching task…" : taskTitle(cur)}</h2>
              <p className="muted small">{cur.app} · since {fmtTime(cur.startedAt)} ({fmtDur(cur.startedAt)}) · {cur.actions} actions · {s.liveQuestions} questions</p>
              {cur.summary && <p>{cur.summary}</p>}
            </>
          ) : <h2>Between tasks</h2>}
          <div className="btns">
            <button className="primary big" disabled={!cur} onClick={() => void endTask()}>End task &amp; go over it</button>
            <button className="big" onClick={() => void endDay()}>End my day</button>
          </div>
          {notice && <p className="muted small">{notice}</p>}
          <p className="small"><button className="link" onClick={openWork}>Back to {user.app.name} ↗</button></p>
        </section>
      )}
      <AdaPanel s={s} budget={PAUSE.budgetPer10Min} whyMarker={<JudgeMarker n={1} />} onOffRecord={() => rec.hub.onMarker(s.offRecord ? "off_record_end" : "off_record_start", "button")} />
      {noMic && typing}
      <ExpertQuestions user={user} hub={rec.hub} />
      {tasks.length > 0 && (
        <section className="card">
          <h3>Today</h3>
          <TaskList tasks={tasks} actions={(t) => <Link to={`/map/${t.sessionId}`}>Work Map</Link>} />
          <p className="muted small">Tasks split by themselves when you switch apps, after a {Math.round(WORKDAY.idleMs / 60_000)}-minute break, or when Ada sees a different kind of work.</p>
        </section>
      )}
      <details className="more">
        <summary>More options</summary>
        <div className="btns">
          <button onClick={() => void rec.newTask()} title="Start a new task now and go over both at the end of the day">New task</button>
          <button onClick={() => rec.hub.onMarker("bookmark", "button")}>Bookmark this moment</button>
          <button disabled={s.sharing} onClick={shareScreen} title="Not needed with the extension or in your work app">Share screen</button>
        </div>
        {!noMic && typing}
      </details>
      {s.error && <p className="error">{s.error}</p>}
      {devlog}
    </div>
  );
}

/** Where the expert is: start → work → go over. */
function DaySteps({ at }: { at: 1 | 2 | 3 }) {
  const steps = ["Start your day", "Work as usual", "Go over it with Ada"];
  return (
    <ol className="day-steps" aria-label="Your day">
      {steps.map((label, i) => (
        <li key={label} className={i + 1 === at ? "now" : i + 1 < at ? "done" : ""} aria-current={i + 1 === at ? "step" : undefined}>
          <span>{i + 1 < at ? "✓" : i + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

function TaskList({ tasks, actions }: { tasks: Task[]; actions: (t: Task) => ReactNode }) {
  return (
    <ol className="tasks">
      {tasks.map((t) => (
        <li key={t.sessionId} className={t.status}>
          <div>
            <b>{taskTitle(t)}</b> {t.sameAs && <span className="badge">resumed</span>}
            <div className="muted small">{t.app} · {fmtTime(t.startedAt)}–{t.endedAt ? fmtTime(t.endedAt) : "now"} ({fmtDur(t.startedAt, t.endedAt)}) · {t.actions} actions · {BOUNDARY[t.boundary]}</div>
            {t.summary && <div className="small">{t.summary}</div>}
          </div>
          <div className="btns">{actions(t)}</div>
        </li>
      ))}
    </ol>
  );
}

/** The first few, the rest behind "Show all". */
function PendingList<T>({ items, render }: { items: T[]; render: (x: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 4);
  return (
    <>
      <ul className="tasks">{shown.map(render)}</ul>
      {items.length > shown.length && <button className="link" onClick={() => setAll(true)}>Show all {items.length}</button>}
    </>
  );
}
