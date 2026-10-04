/**
 * CaptureHub: owns one live session (capture or teach). Wires screen, mic, transcript, MiniERP bridge,
 * pause detector, question picker, answer linking, correction detection and off-record into the EventLog.
 * React only renders hub.state; all logic lives here so it can be tested and reused by Teach/debrief.
 */
import type { Event, Id, Phase, QuestionCategory, Session, Utterance } from "@shared/schema";
import { EventLog, type EventInput } from "@shared/eventlog";
import { SessionClock } from "@shared/clock";
import { newId } from "@shared/ids";
import { webStore } from "../lib/webStore";
import { updateSession } from "../lib/sessions";
import { llm } from "../lib/api";
import { listen, send, type BridgeMsg } from "../lib/bridge";
import { ChunkRecorder, FrameSampler, type SampledFrame } from "./screen";
import { createTranscriber, interpolateWords, type Transcriber, type TranscribedUtterance } from "./transcriber";
import { sttLanguage } from "@shared/i18n";
import { createVoice, type AgentOptions, type SpokenTurn, type Voice } from "../voice/voice";
import { redactUtterance, type RedactedUtterance } from "./redaction";
import { budgetLeft, describeDeferral, describePause, QUIET_INFO, scriptedWhy, type CurrentQuestion, type PauseInfo } from "./adaState";
import { questionTarget } from "./questionTarget";

/** Tunables (docs/capture.md hard constraints 9–12). */
export const PAUSE = { keyMs: 1500, speechMs: 1200, staticMs: 1000, saveWindowMs: 3000, longStaticMs: 8000, budgetPer10Min: 5, replySilenceMs: 3500 };

export interface HubState {
  phase: Phase;
  offRecord: boolean;
  sharing: boolean;
  listening: boolean;
  agentSpeaking: boolean;
  expertSpeaking: boolean;
  voice: string;
  voiceStatus: string;
  stt: string;
  extension: boolean;
  frameSource: "none" | "screen" | "extension";
  lastPause: string;
  liveQuestions: number;
  frames: number;
  /** PII items replaced in transcripts so far (shared/redact via ./redaction). */
  redactedCount: number;
  error: string | null;
  /** Ada panel: the question Ada asked last and why (null until she asks). */
  currentQuestion: CurrentQuestion | null;
  /** Ada panel: the pause detector's / picker's latest decision, in words. */
  lastPauseInfo: PauseInfo | null;
  /** live questions still allowed in the rolling 10-minute window */
  questionBudgetLeft: number;
  /** questions held back for the debrief in this task */
  deferredQuestions: number;
}

type Listener = () => void;

export class CaptureHub {
  clock: SessionClock;
  log: EventLog;
  /** Every event this hub emitted (local mirror, for debrief/teach logic without re-reading Firestore). */
  events: Event[] = [];
  /** The session events currently go to. Changes on switchSession() (workday task rotation, per-task debrief). */
  session: Session;
  private eventListeners = new Set<(e: Event) => void>();
  private lastStoredFrameAt = -1e9;
  state: HubState;

  private listeners = new Set<Listener>();
  private unlisten: (() => void) | null = null;
  private sampler: FrameSampler | null = null;
  private screenRec: ChunkRecorder | null = null;
  private micRec: ChunkRecorder | null = null;
  private display: MediaStream | null = null;
  private mic: MediaStream | null = null;
  private transcriber: Transcriber | null = null;
  voice: Voice | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];

  // pause-detector signals (session ms)
  private lastKeyAt = 0;
  private lastSpeechAt = 0;
  private lastSaveAt = -1e9;
  private lastBoundaryAt = -1e9;
  private staticSince = 0;
  private pauseOpen = false;
  private unasked: Id[] = [];
  private asking = false;
  private lastFrameId: Id | null = null;
  private lastVisionAt = -1e9;
  private visionBusy = false;
  private lastObserved: { summary: string; frameId: Id } | null = null;
  /** Ada panel: the app field touched last, and the plain-language reason of the pause that led to an ask */
  private lastField: string | undefined;
  private lastAskWhy = "";
  private pending: { questionId: Id; endedAt: number; replies: Utterance[]; timer?: ReturnType<typeof setTimeout> } | null = null;
  private replyWaiter: { resolve: (u: Utterance[]) => void; replies: Utterance[]; timer?: ReturnType<typeof setTimeout> } | null = null;

  /** what the next agent turn is (set right before we make the agent speak) */
  private turnMeta: { intent: "question" | "follow_up" | "ack" | "clarify" | "teachback" | "intervention" | "other"; questionId?: Id } | null = null;
  private agentSpokeAt: Array<{ t: number; text: string }> = [];
  private extFrameBusy = false;
  private lastExtFrameAt = -1e9;

  constructor(session: Session, readonly opts: { writer: string; vision: boolean; voice: AgentOptions; workday?: boolean }) {
    this.session = session;
    this.clock = SessionClock.fromWall(session.clock.wallAtT0);
    this.state = {
      phase: session.kind === "teach" ? "teach" : "capture", offRecord: false, sharing: false, listening: false, agentSpeaking: false,
      expertSpeaking: false, voice: "-", voiceStatus: "", stt: "-", extension: false, frameSource: "none", lastPause: "", liveQuestions: 0, frames: 0, redactedCount: 0, error: null,
      currentQuestion: null, lastPauseInfo: null, questionBudgetLeft: PAUSE.budgetPer10Min, deferredQuestions: 0,
    };
    this.log = this.makeLog(session);
    this.unlisten = listen((m) => this.onBridge(m));
    send({ kind: "hello", from: "hub", mode: session.kind === "teach" ? "teach" : "capture" });
    this.timers.push(setInterval(() => this.tickPause(), 300));
    this.timers.push(setInterval(() => this.broadcastStatus(), 3000));
    // the extension's content script marks every page it runs on, the hub included (before any work tab says hello)
    const extMark = () => !this.state.extension && document.documentElement.dataset.apprenticeExt && this.set({ extension: true });
    extMark();
    this.timers.push(setInterval(extMark, 1500));
    if (import.meta.env.DEV) (window as unknown as { __hub?: CaptureHub }).__hub = this; // tests + debugging
  }

  private makeLog(session: Session) {
    return new EventLog({
      store: webStore, sessionId: session.id, clock: this.clock, writer: this.opts.writer, getPhase: () => this.state.phase,
      onEvent: (e) => {
        this.events.push(e);
        this.eventListeners.forEach((fn) => fn(e));
      },
      onError: (err) => this.set({ error: String((err as Error).message ?? err) }),
    });
  }

  /** Observe every event written to the current session (workday segmenter, UIs). */
  onEvent(fn: (e: Event) => void) {
    this.eventListeners.add(fn);
    return () => void this.eventListeners.delete(fn);
  }

  /**
   * Is a question/answer exchange in progress? (Don't switch sessions in the middle of one.)
   * An unanswered live question doesn't count: if the expert moved on, it stays in the log as an open question
   * (Map's draft turns it into a debrief gap).
   */
  get busy() {
    return this.asking || this.answering || this.state.agentSpeaking;
  }

  /** The human is answering right now (an answer must not be split across two sessions). */
  get answering() {
    return !!this.pending?.replies.length || !!this.replyWaiter?.replies.length || this.state.expertSpeaking;
  }

  /**
   * Continue on another session while voice, mic, Scribe and screen keep running.
   * Workday: rotate to the next task session (endCurrent). Debrief: reopen a finished task session (preload its events).
   */
  switchSession(next: Session, o: { preload?: Event[]; endCurrent?: boolean; phase?: Phase } = {}): Promise<void> {
    // ── synchronous swap: from the next line on, every event goes to `next` (nothing lost or misfiled) ──
    const w = this.replyWaiter;
    if (w) {
      clearTimeout(w.timer);
      this.replyWaiter = null;
      w.resolve(w.replies);
    }
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    const old = this.session;
    const oldLog = this.log;
    if (o.endCurrent) this.emit({ t: this.now(), type: "session.ended", source: "system", payload: { reason: "expert_done" } });
    this.session = next;
    this.clock = SessionClock.fromWall(next.clock.wallAtT0);
    this.events = o.preload ? [...o.preload] : [];
    this.log = this.makeLog(next);
    const now = this.now();
    this.lastKeyAt = this.lastSpeechAt = this.staticSince = now;
    this.lastSaveAt = this.lastBoundaryAt = this.lastVisionAt = this.lastExtFrameAt = this.lastStoredFrameAt = -1e9;
    this.windowClosedAt = 0;
    this.pauseOpen = false;
    this.unasked = [];
    this.lastObserved = null;
    this.lastFrameId = null;
    this.lastField = undefined;
    this.lastAskWhy = "";
    this.set({
      phase: o.phase ?? (next.kind === "teach" ? "teach" : "capture"),
      liveQuestions: this.events.filter((e) => e.type === "agent.question" && e.phase === "capture").length,
      frames: this.events.filter((e) => e.type === "frame.captured").length,
      currentQuestion: null, lastPauseInfo: null, questionBudgetLeft: this.budgetNow(),
      deferredQuestions: this.events.filter((e) => e.type === "question.deferred").length,
    });
    this.broadcastStatus();
    // ── async cleanup of the previous session ──
    return (async () => {
      await oldLog.close();
      if (o.endCurrent) await updateSession(old.id, { status: "ended", endedAt: new Date().toISOString() });
    })();
  }

  /** Called with every bridge message BEFORE the hub files it (workday recorder: rotate first, then log). */
  beforeBridge: ((m: BridgeMsg) => void) | null = null;

  /** Tell overlays (MiniERP, extension) what's going on. */
  broadcastStatus() {
    send({ kind: "status", mode: this.session.kind === "teach" ? "teach" : "capture", sessionId: this.session.id, offRecord: this.state.offRecord, recording: this.state.phase === "capture" && !this.state.offRecord, expert: this.session.participant.displayName });
  }

  // ───────────── observable state ─────────────
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  set(patch: Partial<HubState>) {
    const prev = this.state;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
    if (prev.offRecord !== this.state.offRecord || prev.phase !== this.state.phase) this.broadcastStatus();
    if (prev.agentSpeaking !== this.state.agentSpeaking) send({ kind: "agentState", speaking: this.state.agentSpeaking, listening: this.listening });
  }
  now() {
    return this.clock.now();
  }
  emit<T extends EventInput>(e: T) {
    return this.log.emit(e);
  }

  // ───────────── inputs ─────────────
  /**
   * Start Ada: voice (ElevenAgents → ElevenLabs TTS → browser) and the always-on transcript (Scribe → Web Speech).
   * Each part degrades on its own: no mic still gives a speaking agent (TTS) and typed answers.
   */
  async startListening() {
    let micOk = true;
    try {
      this.set({ voiceStatus: "mic…" });
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.micRec = new ChunkRecorder(this.mic, "audio/webm;codecs=opus", (blob, i, dur, startedAt) => this.onMediaChunk("mic", blob, i, dur, startedAt));
      this.micRec.start();
      this.transcriber = await createTranscriber(() => this.now(), {
        onSpeechStart: (t) => {
          this.lastSpeechAt = t;
          this.set({ expertSpeaking: true });
          this.holdReplyWindow();
          this.emit({ t, type: "speech.vad", source: "stt", payload: { speaker: this.humanSpeaker(), state: "start" } });
        },
        onUtterance: (u) => this.onExpertUtterance(u),
        onError: (e) => console.warn("stt", e),
      }, sttLanguage(this.session.participant.language));
      this.set({ voiceStatus: "stt…" });
      await this.transcriber.start();
    } catch (e) {
      micOk = false;
      this.set({ error: `Microphone unavailable (${(e as Error).message}); Ada will speak, answer by typing.` });
    }
    // the ElevenAgents conversation needs the mic; without it, speak through ElevenLabs TTS
    this.set({ voiceStatus: "voice…", stt: this.transcriber?.name ?? "typed only" });
    this.voice = await createVoice(micOk ? this.opts.voice : { ...this.opts.voice, agentId: undefined }, {
      onSpeaking: (s) => this.set({ agentSpeaking: s }),
      onAgentTurn: (turn) => this.onAgentTurn(turn),
      onStatus: (st) => this.set({ voiceStatus: st }),
    });
    this.set({ listening: true, stt: this.transcriber?.name ?? "typed only", voice: this.voice.name });
    if (this.session.kind === "teach") this.agentListen(true);
  }

  async shareScreen() {
    this.display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    this.sampler = new FrameSampler(this.display);
    if (!this.opts.workday) {
      // continuous video only for single-task sessions; a whole day would be GBs (frames cover the moments)
      this.screenRec = new ChunkRecorder(this.display, "video/webm;codecs=vp9", (blob, i, dur, startedAt) => this.onMediaChunk("screen_video", blob, i, dur, startedAt));
      this.screenRec.start();
    }
    this.display.getVideoTracks()[0].addEventListener("ended", () => this.stopScreen());
    this.timers.push(setInterval(() => void this.sampleFrame(), 1000));
    this.set({ sharing: true, frameSource: "screen" });
  }

  stopScreen() {
    this.screenRec?.stop();
    this.display?.getTracks().forEach((t) => t.stop());
    this.sampler?.stop();
    this.sampler = null;
    this.display = null;
    this.set({ sharing: false, frameSource: "none" });
  }

  private humanSpeaker() {
    return this.session.kind === "teach" ? ("newhire" as const) : ("expert" as const);
  }

  private onMediaChunk(stream: "screen_video" | "mic", blob: Blob, i: number, durationMs: number, startedAtPerf: number) {
    const uri = `media/${stream === "mic" ? "mic" : "screen"}-${String(i).padStart(3, "0")}.webm`;
    this.log.blob(uri, blob, blob.type || "video/webm");
    this.emit({ t: Math.max(0, Math.round(startedAtPerf - this.clock.perfAtT0)), type: "media.chunk", source: "system", payload: { stream, uri, mime: blob.type, durationMs } });
  }

  private async sampleFrame() {
    if (!this.sampler || !this.display || this.state.offRecord) return;
    const f = await this.sampler.grab();
    if (f) await this.storeFrame(f);
  }

  private async storeFrame(f: SampledFrame) {
    const t = this.now();
    const changed = f.diff > 0.015;
    if (changed) this.staticSince = t;
    // whole-day recording: keep frames that show something new, plus a heartbeat (storage stays ~MBs per hour)
    if (this.opts.workday && !changed && t - this.lastStoredFrameAt < 30_000) return;
    this.lastStoredFrameAt = t;
    const frameId = newId("frm");
    const uri = `frames/${frameId}.webp`;
    const [minGap, heartbeat] = this.opts.workday ? [5000, 30_000] : [2000, 5000];
    const send = this.opts.vision && !this.visionBusy && ((changed && t - this.lastVisionAt >= minGap) || t - this.lastVisionAt >= heartbeat);
    this.log.blob(uri, f.blob, "image/webp");
    const fe = this.emit({
      t, type: "frame.captured", source: "screen",
      payload: { frameId, uri, width: f.width, height: f.height, phash: f.phash, diffFromPrev: f.diff, sentToVision: send, ...(send ? {} : { skipReason: f.diff <= 0.015 ? "no_change" : "rate_limited" }) },
    });
    this.lastFrameId = frameId;
    this.set({ frames: this.state.frames + 1 });
    if (send) void this.observe(fe.id, frameId, t, await f.base64());
  }

  private async observe(frameEventId: Id, frameId: Id, t: number, b64: string) {
    this.visionBusy = true;
    this.lastVisionAt = t;
    const t0 = performance.now();
    try {
      const recent = this.events.filter((e) => e.type === "screen.action").slice(-5).map((e) => (e.type === "screen.action" ? e.payload.description : ""));
      const out = await llm("vision", { frameBase64: b64, mediaType: "image/webp", prevSummary: this.lastObserved?.summary, recentActions: recent });
      const mc = this.modelCall("vision", [frameEventId], Math.round(performance.now() - t0));
      this.sampler && (this.sampler.piiRegions = out.piiRegions.map((p) => p.bbox));
      this.emit({
        t: this.now(), type: "screen.observed", source: "vision", causedBy: [frameEventId],
        payload: {
          frameId, prevFrameId: this.lastObserved?.frameId, modelCallId: mc, app: out.app, summary: out.summary, visibleEntities: out.visibleEntities,
          changes: out.changes.map((c) => ({
            kind: (["opened", "closed", "field_changed", "status_changed", "navigated", "selected", "scrolled"].includes(c.kind) ? c.kind : "other") as "other",
            ...(c.entityKind ? { entity: { kind: c.entityKind, key: c.entityKey } } : {}), ...(c.field ? { field: c.field, from: c.from, to: c.to } : {}),
            ...(c.bbox ? { bbox: c.bbox } : {}), confidence: c.confidence,
          })),
          activityGuess: out.activityGuess, piiRegions: out.piiRegions, confidence: out.confidence,
        },
      });
      this.lastObserved = { summary: out.summary, frameId };
    } catch (err) {
      this.modelCall("vision", [frameEventId], Math.round(performance.now() - t0), (err as Error).message);
    } finally {
      this.visionBusy = false;
    }
  }

  private modelCall(purpose: "vision" | "question_pick" | "answer_link" | "correction_detect" | "extract" | "gap_find" | "teachback" | "tutor_eval" | "other", inputRefs: Id[], latencyMs: number, error?: string) {
    const modelCallId = newId("mc");
    this.emit({ t: this.now(), type: "model.call", source: "system", payload: { modelCallId, purpose, model: "see api /health", promptVersion: "v1", inputRefs, latencyMs, ...(error ? { error } : {}) } });
    return modelCallId;
  }

  // ───────────── MiniERP bridge ─────────────
  private onBridge(m: BridgeMsg) {
    this.beforeBridge?.(m);
    if (m.kind === "hello" && (m.from === "erp" || m.from === "ext")) {
      send({ kind: "hello", from: "hub", mode: this.session.kind === "teach" ? "teach" : "capture" });
      this.broadcastStatus();
      if (m.from === "ext") this.set({ extension: true });
    }
    if (m.kind === "frame") return void this.onExtensionFrame(m.dataUrl);
    if (m.kind === "marker") return this.onMarker(m.marker, "button");
    if (this.state.offRecord) return;
    const t = this.now();
    if (m.kind === "activity") {
      if (m.keystrokes > 0 || m.clicks > 0) this.lastKeyAt = t; // any hands-on activity ends a pause
      this.emit({ t, type: "input.activity", source: "input", payload: { windowMs: m.windowMs, keystrokes: m.keystrokes, clicks: m.clicks, mouseMovePx: m.mouseMovePx, scrolls: m.scrolls, tabVisible: true } });
    } else if (m.kind === "case") {
      if (m.state === "end") this.lastBoundaryAt = t; // finishing a case is a natural moment to ask; opening one is not
      this.emit({ t, type: "marker.case_boundary", source: "app", caseId: m.case.id, payload: { state: m.state, case: m.case, ...(m.outcome ? { outcome: m.outcome } : {}), detectedBy: "app" } });
    } else if (m.kind === "app") {
      if (m.payload.action === "save") this.lastSaveAt = t;
      if (m.payload.field) this.lastField = m.payload.field;
      this.staticSince = t; // the app UI changed, even without a screen share
      this.lastKeyAt = t;
      const ae = this.emit({ t, type: "app.event", source: "app", payload: m.payload });
      if (m.description) {
        const sa = this.emit({
          t, type: "screen.action", source: "app", causedBy: [ae.id],
          payload: {
            verb: (m.verb ?? "other") as "other", entity: m.payload.entity ?? { kind: "unknown" }, ...(m.payload.field ? { field: m.payload.field, from: m.payload.oldValue as string, to: m.payload.newValue as string } : {}),
            description: m.description, evidence: { frameIds: this.lastFrameId ? [this.lastFrameId] : [], observedIds: [], appEventIds: [ae.id] },
            sourceAgreement: "app_only", confidence: 0.97,
          },
        });
        this.unasked.push(sa.id);
        const text = `[screen t=${Math.round(t / 1000)}s] ${m.description}`;
        this.voice?.context(text);
        this.emit({ t, type: "agent.context_pushed", source: "agent", causedBy: [sa.id], payload: { text, eventIds: [sa.id] } });
      }
    }
  }

  onMarker(marker: "off_record_start" | "off_record_end" | "bookmark" | "end_task", trigger: "button" | "voice" | "hotkey") {
    const t = this.now();
    if (marker === "off_record_start" && !this.state.offRecord) {
      this.emit({ t, type: "marker.off_record", source: "user", payload: { state: "start", trigger } });
      void this.log.flush();
      this.screenRec?.pause();
      // voice trigger: drop the in-progress mic slice, it contains the spoken command (a slice that already
      // closed before the transcript arrived is not recalled)
      this.micRec?.pause(trigger === "voice");
      if (this.transcriber) this.transcriber.muted = true;
      this.set({ offRecord: true });
      void this.voice?.say("Okay, not recording.");
    } else if (marker === "off_record_end" && this.state.offRecord) {
      this.screenRec?.resume();
      this.micRec?.resume();
      if (this.transcriber) this.transcriber.muted = false;
      this.set({ offRecord: false });
      this.emit({ t, type: "marker.off_record", source: "user", payload: { state: "end", trigger } });
      void this.voice?.say("Back on the record.");
    } else if (marker === "bookmark") {
      this.emit({ t, type: "marker.bookmark", source: "user", payload: { trigger: trigger === "button" ? "hotkey" : trigger } });
    } else if (marker === "end_task") {
      void this.endTask();
    }
  }

  /** Screenshot of the work tab from the extension: used as the frame source when nobody shares a screen. */
  private async onExtensionFrame(dataUrl: string) {
    if (this.display || this.state.offRecord || this.extFrameBusy || this.state.phase !== (this.session.kind === "teach" ? "teach" : "capture")) return;
    const t = this.now();
    if (t - this.lastExtFrameAt < 900) return;
    this.extFrameBusy = true;
    this.lastExtFrameAt = t;
    try {
      this.sampler ??= new FrameSampler(null);
      const f = await this.sampler.grabImage(dataUrl);
      if (f) await this.storeFrame(f);
      if (this.state.frameSource !== "extension") this.set({ frameSource: "extension" });
    } finally {
      this.extFrameBusy = false;
    }
  }

  /** Log what the agent actually said (ElevenAgents rephrases [ASK] messages). */
  private onAgentTurn(turn: SpokenTurn) {
    if (!/[a-z0-9]/i.test(turn.text)) return; // "..." fillers / skipped turns are not speech
    const t = this.now();
    // unprompted speech is a follow-up only while we wait for an answer; otherwise it's a greeting / small talk
    const meta = turn.spontaneous ? { intent: this.pending || this.replyWaiter ? ("follow_up" as const) : ("other" as const) } : this.turnMeta ?? { intent: "other" as const };
    if (!turn.spontaneous) this.turnMeta = null;
    const tEnd = t + Math.round((turn.text.split(/\s+/).length / 2.6) * 1000);
    const utteranceId = newId("utt");
    const r = redactUtterance(turn.text, interpolateWords(turn.text, t, tEnd)); // the agent may repeat a name or number back
    const u = this.emit({ t, tEnd, type: "utterance", source: "agent", payload: { utteranceId, speaker: this.session.kind === "teach" ? "tutor" : "agent", text: r.text, words: r.words, language: "en", transcriptVersion: 1, sttModel: this.voice?.name ?? "tts", addressedTo: "other_person" } });
    this.noteRedaction(u.id, r);
    this.emit({ t, tEnd, type: "agent.turn", source: "agent", causedBy: [u.id], payload: { text: r.text, intent: meta.intent, interrupted: false, utteranceId, ...(meta.questionId ? { questionId: meta.questionId } : {}) } });
    this.agentSpokeAt.push({ t, text: turn.text.toLowerCase() });
    if (this.agentSpokeAt.length > 20) this.agentSpokeAt.shift();
    send({ kind: "agentState", speaking: true, listening: this.listening, caption: turn.text });
    // agent spoke on its own while we wait for an answer: a follow-up QUESTION keeps the window open for more
    // replies; an acknowledgment means the answer is complete, so link it now
    const p = this.pending;
    if (turn.spontaneous && p) {
      clearTimeout(p.timer);
      p.endedAt = this.now();
      if (p.replies.length) p.timer = setTimeout(() => void this.linkAnswer(p.questionId, p.replies), /\?\s*$/.test(turn.text) ? 15_000 : 500);
    }
  }

  private listening = false;
  private windowClosedAt = 0;
  /** Agent mic on/off (Scribe keeps transcribing regardless). */
  private agentListen(on: boolean) {
    if (this.session.kind === "teach") on = true; // the tutor always listens: new hires answer late and ask questions anytime
    this.listening = on;
    this.voice?.listen(on);
    send({ kind: "agentState", speaking: this.state.agentSpeaking, listening: on });
  }

  /** The mic hears the agent's own voice; drop utterances that are just an echo of what the agent said. */
  private isEcho(u: TranscribedUtterance) {
    const words = u.text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
    if (!words.length) return true;
    return this.agentSpokeAt.some((a) => {
      if (u.t - a.t > 15_000 || a.t - u.tEnd > 2000) return false;
      const hit = words.filter((w) => a.text.includes(w)).length;
      return hit / words.length > 0.7;
    });
  }

  // ───────────── speech ─────────────
  private onExpertUtterance(u: TranscribedUtterance) {
    this.lastSpeechAt = u.tEnd;
    this.set({ expertSpeaking: false });
    if (u.sttModel !== "typed" && this.isEcho(u)) return;
    const lower = u.text.toLowerCase();
    if (/\boff the record\b/.test(lower)) return this.onMarker("off_record_start", "voice"); // the command itself is not persisted
    if (/\b(back on (the )?record|on the record again)\b/.test(lower)) return this.onMarker("off_record_end", "voice");
    if (this.state.offRecord) return;

    const replyTo = this.replyWaiter ? undefined : this.pending && u.t - this.pending.endedAt < 30_000 ? this.pending.questionId : undefined;
    // started speaking inside a window that closed before the transcript arrived (STT latency): still a reply
    const lateReply = !this.replyWaiter && this.windowClosedAt > 0 && u.t <= this.windowClosedAt + 500 && this.now() - this.windowClosedAt < 20_000;
    const addressedTo = this.replyWaiter || replyTo || lateReply ? "agent" : "self";
    this.emit({ t: u.tEnd, type: "speech.vad", source: "stt", payload: { speaker: this.humanSpeaker(), state: "end" } });
    // redact before the utterance is logged: everything downstream (answer linking, corrections, question picking,
    // Map, storage) only ever sees the placeholders
    const r = redactUtterance(u.text, u.words);
    const ev = this.emit({
      t: u.t, tEnd: u.tEnd, type: "utterance", source: "stt",
      payload: { utteranceId: newId("utt"), speaker: this.humanSpeaker(), text: r.text, words: r.words, language: u.language, transcriptVersion: 1, sttModel: u.sttModel, addressedTo, ...(replyTo ? { inReplyToQuestionId: replyTo } : {}) },
    }) as Utterance;
    this.noteRedaction(ev.id, r);

    if (this.replyWaiter) {
      const w = this.replyWaiter;
      w.replies.push(ev);
      clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        if (this.replyWaiter === w) this.replyWaiter = null;
        w.resolve(w.replies);
      }, PAUSE.replySilenceMs);
    } else if (replyTo && this.pending) {
      const p = this.pending;
      p.replies.push(ev);
      clearTimeout(p.timer);
      p.timer = setTimeout(() => void this.linkAnswer(p.questionId, p.replies), PAUSE.replySilenceMs);
    }
    if (this.session.kind === "capture") void this.detectCorrection(ev);
  }

  /** Log what was redacted from an utterance (types + placeholder spans, never the original text). */
  private noteRedaction(targetEventId: Id, r: RedactedUtterance) {
    if (!r.entities.length) return;
    this.emit({ t: this.now(), type: "redaction.applied", source: "redactor", causedBy: [targetEventId], payload: { targetEventId, entities: r.entities.map((e) => ({ ...e, charSpan: [...e.charSpan] as [number, number] })) } });
    this.set({ redactedCount: this.state.redactedCount + r.entities.length });
  }

  /**
   * Someone started speaking while we wait for an answer: keep the window open until the transcript arrives
   * (Scribe commits only after the speaker stops, which can be after the nominal timeout).
   */
  private holdReplyWindow() {
    const w = this.replyWaiter;
    if (!w || w.replies.length || !w.timer) return;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      if (this.replyWaiter === w) this.replyWaiter = null;
      w.resolve(w.replies);
    }, 20_000);
  }

  /** Typed fallback for when the mic/STT fails: becomes an utterance like any other. */
  typeUtterance(text: string) {
    const t = this.now();
    this.onExpertUtterance({ text, t: t - 1500, tEnd: t, words: interpolateWords(text, t - 1500, t), language: "en", sttModel: "typed" });
  }

  private async linkAnswer(questionId: Id, replies: Utterance[]) {
    if (this.pending?.questionId === questionId) {
      this.pending = null;
      this.agentListen(false);
    }
    const q = this.events.find((e) => e.type === "agent.question" && e.payload.questionId === questionId);
    if (!q || q.type !== "agent.question") return;
    const t0 = performance.now();
    try {
      const out = await llm("link_answer", { question: q.payload.text, utterances: replies.map((r) => ({ id: r.payload.utteranceId, text: r.payload.text })) });
      this.modelCall("answer_link", replies.map((r) => r.id), Math.round(performance.now() - t0));
      const hit = replies.find((r) => r.payload.text.includes(out.quote));
      const quote = hit ? out.quote : replies[0].payload.text; // code verifies: never store a non-verbatim quote
      const cq = this.state.currentQuestion;
      if (cq?.questionId === questionId) this.set({ currentQuestion: { ...cq, answered: true } });
      this.emit({
        t: this.now(), type: "answer.linked", source: "agent", causedBy: [q.id, ...replies.map((r) => r.id)],
        payload: { questionId, utteranceIds: replies.map((r) => r.payload.utteranceId), quote, quoteSpan: { t: replies[0].t, tEnd: replies.at(-1)!.tEnd ?? replies.at(-1)!.t }, summary: out.summary, completeness: out.completeness, needsFollowUp: out.needsFollowUp },
      });
    } catch (err) {
      this.modelCall("answer_link", [], Math.round(performance.now() - t0), (err as Error).message);
    }
  }

  private async detectCorrection(u: Utterance) {
    const recentU = this.events.filter((e): e is Utterance => e.type === "utterance" && e.id !== u.id).slice(-8);
    const recentA = this.events.filter((e) => e.type === "screen.action").slice(-8);
    const t0 = performance.now();
    try {
      const out = await llm("detect_correction", {
        utterance: { id: u.payload.utteranceId, text: u.payload.text },
        recentUtterances: recentU.map((r) => ({ id: r.payload.utteranceId, text: r.payload.text, speaker: r.payload.speaker })),
        recentActions: recentA.map((a) => ({ id: a.id, description: a.type === "screen.action" ? a.payload.description : "" })),
      });
      this.modelCall("correction_detect", [u.id], Math.round(performance.now() - t0));
      if (!out.isCorrection || out.confidence < 0.6) return;
      const quote = u.payload.text.includes(out.quote) ? out.quote : u.payload.text;
      this.emit({
        t: this.now(), type: "knowledge.correction", source: "agent", causedBy: [u.id],
        payload: {
          correctionId: newId("cor"), detectedBy: "speech", kind: out.kind, utteranceIds: [u.payload.utteranceId], quote,
          targets: { actionIds: out.targetActionIds.filter((id) => this.events.some((e) => e.id === id)), utteranceIds: out.targetUtteranceIds.filter((id) => recentU.some((r) => r.payload.utteranceId === id) || id === u.payload.utteranceId) },
          before: out.before, after: out.after, appliesTo: out.appliesTo, confidence: out.confidence,
        },
      });
      void this.agentSay(`Got it: ${out.after}`, "ack");
    } catch (err) {
      this.modelCall("correction_detect", [u.id], Math.round(performance.now() - t0), (err as Error).message);
    }
  }

  // ───────────── pause detector + question picker ─────────────
  private tickPause() {
    if (this.state.phase !== "capture" || this.state.offRecord || this.asking || this.replyWaiter) return;
    const t = this.now();
    const sinceKey = t - this.lastKeyAt, sinceSpeech = t - this.lastSpeechAt, staticFor = t - this.staticSince;
    const busy = this.state.agentSpeaking || this.state.expertSpeaking || !!this.pending;
    const paused = !busy && sinceKey >= PAUSE.keyMs && sinceSpeech >= PAUSE.speechMs && staticFor >= PAUSE.staticMs;
    if (!paused) {
      this.pauseOpen = false;
      return;
    }
    if (this.pauseOpen) return;
    this.pauseOpen = true;
    const saveRecent = t - this.lastSaveAt < PAUSE.saveWindowMs + PAUSE.keyMs;
    const boundaryRecent = t - this.lastBoundaryAt < PAUSE.saveWindowMs + PAUSE.keyMs;
    const kind = saveRecent ? "save_completed" : boundaryRecent ? "case_boundary" : sinceSpeech < sinceKey ? "speech_ended" : "typing_stopped";
    const decision: "ask" | "hold" | "skip" = !this.unasked.length ? "skip" : saveRecent || boundaryRecent || staticFor >= PAUSE.longStaticMs ? "ask" : "hold";
    const reason = decision === "skip" ? "nothing new on screen since the last question"
      : decision === "hold" ? "mid-case pause; waiting for a save, case boundary or a longer pause"
      : `${kind}: ${Math.round(sinceKey / 100) / 10}s no typing, ${Math.round(sinceSpeech / 100) / 10}s no speech`;
    const pe = this.emit({ t, type: "pause.detected", source: "pause_detector", payload: { kind, durationMs: Math.min(sinceKey, sinceSpeech), signals: { msSinceKeystroke: sinceKey, msSinceSpeech: sinceSpeech, screenDiff: 0, expertSpeaking: false }, decision, reason } });
    const info = describePause({ decision, kind, sinceKeyMs: sinceKey, sinceSpeechMs: sinceSpeech, staticMs: staticFor, longStaticMs: PAUSE.longStaticMs, field: this.lastField });
    if (decision === "ask") this.lastAskWhy = info.reason;
    this.set({ lastPause: `${decision}: ${reason}`, lastPauseInfo: info, questionBudgetLeft: this.budgetNow() });
    if (decision === "ask") void this.pickQuestion(pe.id);
  }

  /** Live questions left in the rolling 10-minute window. */
  private budgetNow() {
    const askedAt = this.events.filter((e) => e.type === "agent.question" && e.phase === "capture" && !e.payload.gapId).map((e) => e.t);
    return budgetLeft(askedAt, this.now(), PAUSE.budgetPer10Min);
  }

  private async pickQuestion(pauseId: Id) {
    this.asking = true;
    const t0 = performance.now();
    try {
      const t = this.now();
      const asked = this.events.filter((e) => e.type === "agent.question");
      const inWindow = asked.filter((e) => t - e.t < 600_000 && e.phase === "capture").length;
      const actions = this.events.filter((e) => this.unasked.includes(e.id)).slice(-8);
      const out = await llm("pick_question", {
        recentActions: actions.map((a) => ({ id: a.id, t: a.t, description: a.type === "screen.action" ? a.payload.description : "" })),
        recentUtterances: this.events.filter((e): e is Utterance => e.type === "utterance").slice(-6).map((u) => ({ id: u.payload.utteranceId, t: u.t, speaker: u.payload.speaker, text: u.payload.text })),
        askedQuestions: asked.map((q) => (q.type === "agent.question" ? q.payload.text : "")),
        liveBudgetLeft: Math.max(0, PAUSE.budgetPer10Min - inWindow),
      });
      this.modelCall("question_pick", [pauseId, ...actions.map((a) => a.id)], Math.round(performance.now() - t0));
      const about = out.aboutActionIds.filter((id) => actions.some((a) => a.id === id));
      if (out.ask && out.question && about.length && out.scores.screenAlreadyAnswers < 0.5 && this.now() - this.lastKeyAt >= PAUSE.keyMs && !this.state.expertSpeaking) {
        this.unasked = [];
        await this.askLive(out.question, out.category, about, pauseId, out.scores, out.rejected);
      } else if (out.deferInstead && out.question) {
        const reason = inWindow >= PAUSE.budgetPer10Min ? "budget" : "low_priority";
        this.emit({ t: this.now(), type: "question.deferred", source: "question_picker", payload: { text: out.question, category: out.category, about: { actionIds: about }, reason } });
        this.unasked = [];
        this.set({ lastPauseInfo: describeDeferral(reason), deferredQuestions: this.state.deferredQuestions + 1 });
      } else {
        this.set({ lastPauseInfo: QUIET_INFO });
      }
    } catch (err) {
      this.modelCall("question_pick", [pauseId], Math.round(performance.now() - t0), (err as Error).message);
    } finally {
      this.asking = false;
    }
  }

  private async askLive(text: string, category: QuestionCategory, actionIds: Id[], pauseId: Id, scores: { infoGain: number; screenAlreadyAnswers: number; guardrailValue: number }, rejected: Array<{ text: string; category: QuestionCategory; reason: string }>) {
    const questionId = newId("q");
    const qe = this.emit({ t: this.now(), type: "agent.question", source: "question_picker", causedBy: [pauseId], payload: { questionId, text, category, about: { actionIds, ...(this.lastFrameId ? { frameId: this.lastFrameId } : {}) }, triggerPauseId: pauseId, scores, rejectedCandidates: rejected } });
    const aboutAction = this.events.find((e) => e.id === actionIds[0]);
    const aboutScreen = aboutAction?.type === "screen.action" ? aboutAction.payload.description : undefined;
    this.set({
      liveQuestions: this.state.liveQuestions + 1, questionBudgetLeft: this.budgetNow(),
      currentQuestion: { questionId, text, category, t: qe.t, ...(aboutScreen ? { aboutScreen } : {}), why: this.lastAskWhy || "You paused.", answered: false, target: questionTarget({ category, scores, rejectedCandidates: rejected }) },
    });
    this.pending = { questionId, endedAt: this.now(), replies: [] }; // answers may start before the agent has finished
    this.agentListen(true);
    await this.agentSay(text, "question", questionId);
    if (this.pending?.questionId === questionId) this.pending.endedAt = this.now();
    // nobody answered: close the window
    setTimeout(() => {
      if (this.pending?.questionId === questionId && !this.pending.replies.length) {
        this.pending = null;
        this.agentListen(false);
      }
    }, 30_000);
  }

  /** Make the agent speak; the real spoken text is logged by onAgentTurn. Returns what was said. */
  async agentSay(text: string, intent: "question" | "follow_up" | "ack" | "clarify" | "teachback" | "intervention" | "other", questionId?: Id, control?: string): Promise<string> {
    if (!this.voice) return text;
    this.turnMeta = { intent, ...(questionId ? { questionId } : {}) };
    if (control) return this.voice.control(control, text);
    return intent === "question" || intent === "follow_up" ? this.voice.ask(text) : this.voice.say(text);
  }

  /**
   * Ask something and collect the human's reply (debrief, teach-back, tutor prompts).
   * Resolves after `PAUSE.replySilenceMs` of silence following the first reply, or after `timeoutMs`.
   */
  async ask(text: string, opts: { category?: QuestionCategory; gapId?: Id; actionIds?: Id[]; intent?: "question" | "follow_up" | "teachback" | "intervention"; timeoutMs?: number; control?: string } = {}): Promise<{ questionId: Id; replies: Utterance[] }> {
    const questionId = newId("q");
    if (opts.category) {
      const qe = this.emit({ t: this.now(), type: "agent.question", source: "question_picker", payload: { questionId, text, category: opts.category, about: { actionIds: opts.actionIds ?? [] }, ...(opts.gapId ? { gapId: opts.gapId } : {}), scores: { infoGain: 0, screenAlreadyAnswers: 0, guardrailValue: 0 }, rejectedCandidates: [] } });
      this.set({ currentQuestion: { questionId, text, category: opts.category, t: qe.t, why: scriptedWhy(this.state.phase, !!opts.gapId), answered: false, target: questionTarget({ category: opts.category, ...(opts.gapId ? { gapId: opts.gapId } : {}), scores: { infoGain: 0, screenAlreadyAnswers: 0, guardrailValue: 0 }, rejectedCandidates: [], scored: false }) } });
    }
    // open the reply window BEFORE the agent speaks: answers can start while it's still finishing its turn
    const prev = this.replyWaiter; // a newer ask preempts an older one (e.g. an intervention interrupts a pending prediction)
    if (prev) {
      clearTimeout(prev.timer);
      this.replyWaiter = null;
      prev.resolve(prev.replies);
    }
    let resolveReplies!: (u: Utterance[]) => void;
    const done = new Promise<Utterance[]>((r) => (resolveReplies = r));
    const w: { resolve: (u: Utterance[]) => void; replies: Utterance[]; timer?: ReturnType<typeof setTimeout> } = { resolve: resolveReplies, replies: [] };
    this.replyWaiter = w;
    this.agentListen(true);
    await this.agentSay(text, opts.intent ?? (opts.gapId ? "follow_up" : "question"), opts.category ? questionId : undefined, opts.control);
    if (!w.replies.length && this.replyWaiter === w) {
      w.timer = setTimeout(() => {
        if (this.replyWaiter === w) this.replyWaiter = null;
        this.windowClosedAt = this.now();
        resolveReplies(w.replies);
      }, opts.timeoutMs ?? 30_000);
    }
    const replies = await done;
    this.agentListen(false);
    // tag the replies (already emitted) by emitting answer links where a question was logged
    if (opts.category && replies.length) await this.linkAnswer(questionId, replies);
    return { questionId, replies };
  }

  // ───────────── phases ─────────────
  setPhase(to: Phase) {
    const from = this.state.phase;
    if (from === to) return;
    this.emit({ t: this.now(), type: "phase.changed", source: "system", phase: to, payload: { from, to } });
    this.set({ phase: to });
  }

  async endTask() {
    this.stopScreen();
    this.setPhase("debrief");
    await updateSession(this.session.id, { status: "debrief" });
  }

  async close(reason: "expert_done" | "timeout" | "error" = "expert_done") {
    this.emit({ t: this.now(), type: "session.ended", source: "system", payload: { reason } });
    this.stopScreen();
    this.micRec?.stop();
    this.transcriber?.stop();
    this.mic?.getTracks().forEach((t) => t.stop());
    await this.voice?.stop();
    this.timers.forEach(clearInterval);
    this.unlisten?.();
    await this.log.close();
    await updateSession(this.session.id, { status: "ended", endedAt: new Date().toISOString() });
  }
}
