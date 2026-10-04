/**
 * Whole-workday capture, split into tasks (docs/COORDINATION.md "workday" plan).
 *
 * One Workday (workdays/{id}) holds an ordered list of tasks; every task is its own capture Session, so Map's
 * draft / debrief / Work Map UI work per task unchanged. A task boundary rotates the CaptureHub to a fresh session
 * while voice, mic, Scribe and screen keep running.
 *
 * Boundaries:
 *  - context_switch: work moves to another app/site (MiniERP → ProcureX → mail …)
 *  - idle: nothing happened for IDLE_MS; the next activity starts a new task
 *  - new_kind_of_work: Gemini `label_task` sees different work in the same app (e.g. invoices → supplier master data)
 *  - manual: the expert presses "New task"
 * Tiny detours (< INTERRUPTION_MS and < 3 actions) are kept but marked "interruption" and hidden from the list.
 */
import type { Event, Id, Session, Workday } from "@shared/schema";
import { newId } from "@shared/ids";
import { getWorkday, loadEvents, getSession, makeSession, persistSession, saveWorkday, updateSession } from "../lib/sessions";
import { llm } from "../lib/api";
import type { BridgeMsg } from "../lib/bridge";
import { personOf, type User } from "../lib/users";
import { CaptureHub, PAUSE } from "./hub";
import agents from "../lib/elevenlabs.json";

export const WORKDAY = { idleMs: 3 * 60_000, interruptionMs: 45_000, labelEveryActions: 6, labelEveryMs: 90_000, newWorkConfidence: 0.7 };
/** Break that splits tasks; demos/tests can shorten it: localStorage["apprentice.idleMs"] = "20000" (read on every check). */
function idleMs() {
  try {
    const v = Number(localStorage.getItem("apprentice.idleMs"));
    if (v > 0) return v;
  } catch { /* no storage */ }
  return WORKDAY.idleMs;
}

type Task = Workday["tasks"][number];
type Boundary = Task["boundary"];

export interface WorkdayState {
  workday: Workday;
  current: Task | null;
  rotating: boolean;
  lastLabelAt: number;
}

export class WorkdayRecorder {
  hub!: CaptureHub;
  workday!: Workday;
  private listeners = new Set<() => void>();
  private off: Array<() => void> = [];
  private ctx: string | null = null;
  private ctxApp = "";
  private lastActivityAt = Date.now();
  private idleClosed = false;
  private actionsSinceLabel = 0;
  private lastLabelAt = 0;
  private labeling = false;
  private rotating = false;
  private pendingBoundary: { kind: Boundary; ctx: string | null; app: string } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly user: User, readonly opts: { vision: boolean }) {}

  // ───────────── observable ─────────────
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private changed() {
    this.snapshot = { ...this.snapshot, workday: this.workday, current: this.current, rotating: this.rotating };
    this.listeners.forEach((l) => l());
  }
  snapshot: { workday: Workday | null; current: Task | null; rotating: boolean } = { workday: null, current: null, rotating: false };

  get current(): Task | null {
    return this.workday?.tasks.find((t) => t.status === "active") ?? null;
  }
  /** Tasks worth showing (detours hidden). */
  get tasks(): Task[] {
    return this.workday?.tasks.filter((t) => t.status !== "interruption") ?? [];
  }

  // ───────────── start / continue ─────────────
  /** Start today's workday, or continue it if one is still active (e.g. after a page reload). */
  async start(existing?: Workday): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (existing && existing.status === "active") {
      this.workday = existing;
      for (const t of this.workday.tasks) if (t.status === "active") this.finishTask(t); // the old page's task is over
    } else {
      this.workday = {
        id: newId("day"), userId: this.user.id, userName: this.user.name, department: this.user.department, date: today,
        startedAt: new Date().toISOString(), status: "active", tasks: [],
      };
    }
    const session = this.newTaskSession("start", null, this.user.app.name);
    await persistSession(session);
    this.hub = new CaptureHub(session, {
      writer: "capture", vision: this.opts.vision, workday: true,
      voice: {
        agentId: agents.interviewerAgentId,
        dynamicVariables: { expert_name: this.user.short, task_title: `${this.user.departmentLabel} work` },
        clientTools: {
          get_recent_screen_events: ({ limit }) =>
            this.hub.events.filter((e) => e.type === "screen.action").slice(-(Number(limit) || 8)).map((e) => (e.type === "screen.action" ? e.payload.description : "")).join("\n") || "nothing yet",
        },
      },
    });
    this.hub.beforeBridge = (m) => this.onBridge(m); // decide the task before the hub files the event
    this.off.push(this.hub.onEvent((e) => this.onEvent(e)));
    this.timer = setInterval(() => void this.tick(), 5000);
    if (import.meta.env.DEV) (window as unknown as { __rec?: WorkdayRecorder }).__rec = this; // tests + debugging
    await saveWorkday(this.workday);
    this.changed();
  }

  /** Synchronous: builds the session locally; the caller persists it (in the background). */
  private newTaskSession(boundary: Boundary, ctx: string | null, app: string): Session {
    const index = this.workday.tasks.length;
    const session = makeSession({
      kind: "capture",
      participant: personOf(this.user),
      task: { title: "Detecting the task…", domain: this.user.department, description: `Workday ${this.workday.date}, task ${index + 1}` },
      workdayId: this.workday.id,
      taskIndex: index,
      consent: { recordingAccepted: true, acceptedAt: this.workday.startedAt, retention: "hackathon demo" },
      config: {
        frameIntervalMs: 1000, visionModel: this.opts.vision ? "api:vision (changes only)" : "off", agentId: agents.interviewerAgentId, agentLlm: agents.llm,
        sttModel: "scribe_v2_realtime", promptVersions: { workday: "v1" }, redaction: { enabled: true, engine: "none", entityTypes: ["IBAN"] },
        questionBudgetPer10Min: PAUSE.budgetPer10Min,
      },
    });
    this.workday.tasks.push({
      sessionId: session.id, index, title: "Detecting the task…", domain: this.user.department, summary: "", app,
      startedAt: new Date().toISOString(), status: "active", boundary, actions: 0,
    });
    this.ctx = ctx;
    this.ctxApp = app;
    this.actionsSinceLabel = 0;
    this.lastLabelAt = Date.now();
    this.idleClosed = false;
    return session;
  }

  private finishTask(t: Task) {
    t.endedAt = new Date().toISOString();
    const ms = Date.parse(t.endedAt) - Date.parse(t.startedAt);
    t.status = ms < WORKDAY.interruptionMs && t.actions < 3 ? "interruption" : "done";
  }

  // ───────────── signals ─────────────
  private onBridge(m: BridgeMsg) {
    if (this.hub.state.offRecord || this.workday.status !== "active") return;
    if (m.kind === "activity" || m.kind === "app" || m.kind === "case") {
      const wasIdle = this.idleClosed;
      this.lastActivityAt = Date.now();
      if (wasIdle) return this.boundary("idle", this.contextOf(m), this.appOf(m));
    }
    if (m.kind === "app") {
      const ctx = this.contextOf(m);
      if (this.ctx === null) {
        this.ctx = ctx;
        this.ctxApp = this.appOf(m);
        if (this.current) this.current.app = this.ctxApp;
      } else if (ctx !== this.ctx) {
        this.boundary("context_switch", ctx, this.appOf(m));
      }
    }
  }

  /** Which "place" the work happens in: MiniERP, or host + first path segment of any other site. */
  private contextOf(m: BridgeMsg): string {
    if (m.kind === "app" && m.page) {
      const u = new URL(m.page.url);
      return `${u.host}/${u.pathname.split("/")[1] ?? ""}`;
    }
    return "minierp";
  }
  private appOf(m: BridgeMsg): string {
    if (m.kind === "app" && m.page) return m.page.title.split(/[·|–-]/)[0].trim() || new URL(m.page.url).host;
    return "MiniERP";
  }

  private onEvent(e: Event) {
    const t = this.current;
    if (!t || e.type !== "screen.action" || e.sessionId !== t.sessionId) return;
    t.actions++;
    this.actionsSinceLabel++;
    if (this.actionsSinceLabel >= WORKDAY.labelEveryActions) void this.label();
    this.changed();
  }

  private async tick() {
    if (this.workday.status !== "active") return;
    if (this.pendingBoundary && !this.hub.answering) {
      const b = this.pendingBoundary;
      this.pendingBoundary = null;
      // stale: we're already in that context (another message performed the switch meanwhile)
      if (b.kind === "context_switch" && b.ctx === this.ctx) return;
      return this.boundary(b.kind, b.ctx, b.app);
    }
    const t = this.current;
    if (t && !this.idleClosed && t.actions > 0 && Date.now() - this.lastActivityAt > idleMs()) {
      this.idleClosed = true; // the next activity starts a new task
      void this.label();
    }
    if (t && this.actionsSinceLabel >= 2 && Date.now() - this.lastLabelAt > WORKDAY.labelEveryMs) void this.label();
  }

  // ───────────── labeling (Gemini) ─────────────
  private async label() {
    const t = this.current;
    if (!t || this.labeling) return;
    this.labeling = true;
    this.actionsSinceLabel = 0;
    this.lastLabelAt = Date.now();
    try {
      const actions = this.hub.events.filter((e) => e.type === "screen.action" && e.sessionId === t.sessionId).slice(-15);
      if (!actions.length) return;
      const known = this.workday.tasks.filter((x) => x !== t && x.status === "done").map((x) => x.title);
      const out = await llm("label_task", {
        currentTitle: t.title.startsWith("Detecting") ? "" : t.title, app: t.app, department: this.user.department,
        actions: actions.map((a) => ({ id: a.id, t: a.t, description: a.type === "screen.action" ? a.payload.description : "" })),
        utterances: this.hub.events.filter((e) => e.type === "utterance" && e.payload.speaker === "expert").slice(-5).map((u) => (u.type === "utterance" ? u.payload.text : "")),
        knownTasks: known,
      });
      if (this.current !== t) return;
      const isNew = out.isNewTask && out.confidence >= WORKDAY.newWorkConfidence && !t.title.startsWith("Detecting") && out.title !== t.title;
      if (isNew) return this.boundary("new_kind_of_work", this.ctx, t.app, out);
      t.title = out.title || t.title;
      t.domain = out.domain || t.domain;
      t.summary = out.summary;
      const same = known.length && out.sameAsKnownTask ? this.workday.tasks.find((x) => x.title === out.sameAsKnownTask && x !== t) : undefined;
      if (same) t.sameAs = same.sessionId;
      await updateSession(t.sessionId, { task: { title: t.title, domain: t.domain, description: t.summary } });
      await saveWorkday(this.workday);
      this.changed();
    } catch (err) {
      console.warn("label_task failed", err);
    } finally {
      this.labeling = false;
    }
  }

  // ───────────── boundaries ─────────────
  newTask() {
    this.boundary("manual", this.ctx, this.ctxApp);
  }

  /** Synchronous rotation (so the triggering event already lands in the new task); persistence runs after. */
  private boundary(kind: Boundary, ctx: string | null, app: string, labelOfNew?: { title: string; domain: string; summary: string }) {
    if (this.rotating) return;
    if (this.hub.answering) {
      // never cut an answer in half; a clearer signal (manual) wins over a parked automatic one
      if (!this.pendingBoundary || kind === "manual") this.pendingBoundary = { kind, ctx, app };
      return;
    }
    this.rotating = true;
    this.pendingBoundary = null; // this boundary supersedes anything parked
    const prev = this.current;
    if (prev) this.finishTask(prev);
    const next = this.newTaskSession(kind, ctx, app);
    if (labelOfNew) Object.assign(this.current!, { title: labelOfNew.title, domain: labelOfNew.domain, summary: labelOfNew.summary });
    if (labelOfNew) next.task = { title: labelOfNew.title, domain: labelOfNew.domain, description: labelOfNew.summary };
    const cleanup = this.hub.switchSession(next, { endCurrent: true });
    this.rotating = false;
    this.changed();
    void (async () => {
      await persistSession(next);
      await cleanup;
      await saveWorkday(this.workday);
      // name the task that just ended if it's still unnamed
      if (prev && prev.status === "done" && prev.title.startsWith("Detecting")) await this.labelFinished(prev);
    })().catch((err) => console.warn("task rotation persistence failed", err));
  }

  private async labelFinished(t: Task) {
    try {
      const events = await loadEvents(t.sessionId);
      const actions = events.filter((e) => e.type === "screen.action");
      if (!actions.length) return;
      const out = await llm("label_task", {
        currentTitle: "", app: t.app, department: this.user.department,
        actions: actions.slice(-15).map((a) => ({ id: a.id, t: a.t, description: a.type === "screen.action" ? a.payload.description : "" })),
        utterances: [], knownTasks: this.workday.tasks.filter((x) => x !== t && x.status === "done").map((x) => x.title),
      });
      Object.assign(t, { title: out.title, domain: out.domain || t.domain, summary: out.summary });
      await updateSession(t.sessionId, { task: { title: t.title, domain: t.domain, description: t.summary } });
      await saveWorkday(this.workday);
      this.changed();
    } catch (err) {
      console.warn("label_task (finished) failed", err);
    }
  }

  // ───────────── end of day + per-task debrief ─────────────
  async endDay() {
    const t = this.current;
    if (t) {
      this.finishTask(t);
      await updateSession(t.sessionId, { status: "ended", endedAt: new Date().toISOString() });
      if (t.title.startsWith("Detecting")) await this.labelFinished(t);
    }
    this.workday.status = "ended";
    this.workday.endedAt = new Date().toISOString();
    if (this.timer) clearInterval(this.timer);
    this.hub.stopScreen();
    await saveWorkday(this.workday);
    this.changed();
  }

  /**
   * Reopen a finished task session on the running hub (voice/mic stay on) so Map's runDebrief can work on it:
   * `runDebrief(recorder.hub, …)` right after this resolves.
   */
  async openTaskForDebrief(sessionId: Id): Promise<Session> {
    const [session, events] = await Promise.all([getSession(sessionId), loadEvents(sessionId)]);
    if (!session) throw new Error(`no session ${sessionId}`);
    await this.hub.switchSession(session, { preload: events, phase: "debrief" });
    this.changed();
    return session;
  }

  /** Refresh from Firestore (e.g. titles written by another tab). */
  async reload() {
    const w = await getWorkday(this.workday.id);
    if (w) this.workday = w;
    this.changed();
  }

  async close() {
    this.off.forEach((f) => f());
    if (this.timer) clearInterval(this.timer);
    await this.hub.close();
  }
}
