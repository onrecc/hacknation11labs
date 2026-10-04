/**
 * AI Apprentice — shared data contract between Capture, Map and Teach.
 * Capture WRITES Events. Map READS Events (+ writes debrief/teach-back Events) and WRITES WorkMaps.
 * Teach READS WorkMaps and WRITES Events in its own session.
 *
 * Rules: append-only, ids are prefixed ULIDs (e.g. "evt_01J..."), `t` is ms since session start.
 */

// ───────────────────────── primitives ─────────────────────────

export type Id = string;
export type Ms = number; // ms since session start (performance.now() based)
export type ISO = string; // wall-clock ISO-8601
export type Uri = string; // relative to the session dir, e.g. "frames/frm_01J.webp"
export type Confidence = number; // 0..1
export type BBox = { x: number; y: number; w: number; h: number }; // normalized 0..1

export type Speaker = "expert" | "agent" | "newhire" | "tutor";
export type Phase = "capture" | "debrief" | "teachback" | "teach" | "review";

/** Where a piece of knowledge came from. Every derived claim must carry one. */
export type Provenance =
  | "observed" // seen on screen / app event
  | "stated_live" // expert said it during the task
  | "stated_debrief" // expert said it in the debrief
  | "teachback_correction" // expert corrected the teach-back
  | "inferred"; // model guessed — must be confirmed before Teach relies on it

// ───────────────────────── session ─────────────────────────

export interface Person {
  id: Id;
  displayName: string; // pseudonym allowed
  role: string; // "AP clerk", "new hire"
  language: string; // BCP-47, "de-DE"
  yearsInRole?: number;
  /** Matches `Session.task.domain` / `WorkMap.task.domain` (e.g. "accounts_payable"). */
  department?: string;
}

export interface Session {
  id: Id;
  kind: "capture" | "teach";
  status: "live" | "debrief" | "teachback" | "ended" | "processed";
  createdAt: ISO;
  endedAt?: ISO;
  clock: { wallAtT0: ISO; perfAtT0: number };
  participant: Person;
  task: {
    title: string; // "Process open supplier invoices before month-end"
    domain: string; // "accounts_payable"
    description?: string;
    onetTaskId?: string;
  };
  workMapId?: Id; // teach sessions: map being taught; capture: map produced
  /** Workday capture: the day this task session belongs to, and its position in the day. */
  workdayId?: Id;
  taskIndex?: number;
  consent: { recordingAccepted: boolean; acceptedAt: ISO; retention: string };
  config: {
    frameIntervalMs: number;
    visionModel: string;
    agentId: string;
    agentLlm: string;
    sttModel: string;
    promptVersions: Record<string, string>; // { vision: "v3", questionPicker: "v2", ... }
    redaction: { enabled: boolean; engine: "presidio" | "none"; entityTypes: string[] };
    questionBudgetPer10Min: number;
  };
  media: { screenVideo: Uri[]; micAudio: Uri[]; agentAudio: Uri[] };
}

/**
 * A whole recorded workday of one expert, split into task sessions (one capture Session per detected task).
 * Firestore: workdays/{id}. The task sessions are ordinary capture sessions (Map works on them as is).
 */
export interface Workday {
  id: Id;
  userId: Id;
  userName: string;
  department: string;
  date: string; // YYYY-MM-DD
  startedAt: ISO;
  endedAt?: ISO;
  status: "active" | "ended";
  tasks: Array<{
    sessionId: Id;
    index: number;
    title: string;
    domain: string;
    summary: string;
    app: string;
    startedAt: ISO;
    endedAt?: ISO;
    /** active → done; tiny detours become "interruption" (hidden from the task list). */
    status: "active" | "done" | "interruption";
    boundary: "start" | "context_switch" | "idle" | "new_kind_of_work" | "manual";
    actions: number;
    /** Same kind of work as an earlier task today (resumed after a detour). */
    sameAs?: Id;
  }>;
}

/**
 * Two experts, one task (brief stretch goal): where two confirmed Work Maps for the same kind of work differ,
 * and each expert's answer to "why?". Firestore: comparisons/{id}.
 */
export interface Comparison {
  id: Id;
  domain: string;
  workMapIds: [Id, Id];
  experts: [{ userId?: Id; name: string }, { userId?: Id; name: string }];
  createdAt: ISO;
  updatedAt: ISO;
  summary: string;
  items: Array<{
    id: Id;
    topic: string;
    kind: "same" | "different" | "only_a" | "only_b";
    severity: "info" | "important";
    a?: { says: string; refIds: Id[] };
    b?: { says: string; refIds: Id[] };
    /** "Why?" questions for the experts (only where they differ or one is missing a rule). */
    questions: { a?: string; b?: string };
    answers: { a?: { text: string; at: ISO }; b?: { text: string; at: ISO } };
    /** Team note once both answered: both valid under different conditions, one is the rule, or escalate. */
    resolution?: { verdict: "both_valid" | "a_is_the_rule" | "b_is_the_rule" | "escalate"; note: string; condition: string };
  }>;
}

// ───────────────────────── event envelope ─────────────────────────

export interface EventBase<T extends string, P> {
  id: Id;
  sessionId: Id;
  seq: number; // strictly increasing per session (ordering tie-breaker)
  t: Ms; // when it happened
  tEnd?: Ms; // for spans (utterances, pauses, off-record)
  wall: ISO;
  phase: Phase;
  type: T;
  source: "screen" | "vision" | "app" | "input" | "mic" | "stt" | "agent" | "pause_detector"
    | "question_picker" | "user" | "redactor" | "map" | "tutor" | "system";
  caseId?: Id; // which work item (invoice) this belongs to, if known
  causedBy?: Id[]; // upstream event ids (raw -> derived chain)
  supersedes?: Id; // this event corrects an earlier one
  payload: P;
}

// ───────────────────────── screen & app ─────────────────────────

export type FrameCaptured = EventBase<"frame.captured", {
  frameId: Id;
  uri: Uri; // redacted image
  width: number;
  height: number;
  phash: string;
  diffFromPrev: number; // 0..1
  sentToVision: boolean;
  skipReason?: "no_change" | "rate_limited" | "off_record";
}>;

export interface ScreenEntity {
  kind: string; // "invoice" | "supplier" | "cost_center" | "approval" | ...
  key?: string; // "4471"
  label?: string;
  fields: Record<string, string | number | null>; // { amount: 7200, currency: "EUR", supplier: "Bosch" }
  bbox?: BBox;
}

export type ScreenObserved = EventBase<"screen.observed", {
  frameId: Id;
  prevFrameId?: Id;
  modelCallId: Id;
  app: { name: string; view?: string; url?: string; windowTitle?: string };
  summary: string; // "Invoice 4471 detail view, cost center field focused"
  visibleEntities: ScreenEntity[];
  changes: Array<{
    kind: "opened" | "closed" | "field_changed" | "status_changed" | "navigated" | "selected" | "scrolled" | "other";
    entity?: { kind: string; key?: string };
    field?: string;
    from?: string | number | null;
    to?: string | number | null;
    bbox?: BBox;
    confidence: Confidence;
  }>;
  focus?: { field?: string; bbox?: BBox };
  activityGuess: "typing" | "reading" | "navigating" | "idle" | "unknown";
  piiRegions: Array<{ type: string; bbox: BBox }>; // used by redactor to blur frames
  confidence: Confidence;
}>;

/** Normalized, semantic action, built from vision and/or app events. This is what Map segments into steps. */
export type ScreenAction = EventBase<"screen.action", {
  verb: "open" | "edit" | "approve" | "reject" | "hold" | "route" | "search" | "compare"
    | "navigate" | "copy" | "attach" | "comment" | "save" | "other";
  entity: { kind: string; key?: string };
  field?: string;
  from?: string | number | null;
  to?: string | number | null;
  description: string; // "Re-coded invoice 4471 cost center 4711 -> 0400"
  evidence: { frameIds: Id[]; observedIds: Id[]; appEventIds: Id[] };
  sourceAgreement: "app_only" | "vision_only" | "both_agree" | "conflict";
  confidence: Confidence;
}>;

/** Ground truth from our instrumented sandbox app. */
export type AppEvent = EventBase<"app.event", {
  action: "view" | "click" | "input" | "change" | "submit" | "save" | "navigate" | "validation_error";
  entity?: { kind: string; key?: string };
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  selector?: string;
  route?: string;
  snapshot?: Record<string, unknown>; // full record state after the change
}>;

/** Activity counts only — never key content. Emitted every 2 s window while capturing. */
export type InputActivity = EventBase<"input.activity", {
  windowMs: number;
  keystrokes: number;
  clicks: number;
  mouseMovePx: number;
  scrolls: number;
  tabVisible: boolean;
}>;

// ───────────────────────── audio & speech ─────────────────────────

export type MediaChunk = EventBase<"media.chunk", {
  stream: "screen_video" | "mic" | "agent_audio";
  uri: Uri;
  mime: string;
  durationMs: number; // chunk covers [t, t+durationMs]
}>;

export type SpeechVad = EventBase<"speech.vad", { speaker: Speaker; state: "start" | "end" }>;

export interface Word { w: string; t: Ms; tEnd: Ms; conf?: Confidence }

/**
 * The mic is ALWAYS transcribed, independent of the agent's turn state: thinking aloud,
 * answers, asides, self-corrections. `t`/`tEnd` = utterance span, `words` = per-word timing.
 */
export type Utterance = EventBase<"utterance", {
  utteranceId: Id; // stable across transcript versions
  speaker: Speaker;
  text: string; // redacted
  words: Word[];
  language: string;
  transcriptVersion: number; // 1 = realtime, 2 = post-session batch
  sttModel: string;
  addressedTo: "agent" | "self" | "other_person" | "unknown"; // answering vs thinking aloud
  inReplyToQuestionId?: Id;
}>;

// ───────────────────────── agent ─────────────────────────

export type AgentContextPushed = EventBase<"agent.context_pushed", {
  text: string; // exactly what was sent via sendContextualUpdate
  eventIds: Id[];
}>;

export type AgentTurn = EventBase<"agent.turn", {
  text: string;
  audio?: { uri: Uri; offsetMs: number };
  intent: "question" | "follow_up" | "ack" | "clarify" | "teachback" | "intervention" | "smalltalk" | "other";
  questionId?: Id;
  interrupted: boolean; // did the human talk over it?
  utteranceId?: Id; // the agent's own words, word-timed, as an Utterance with speaker "agent"
}>;

export type AgentToolCall = EventBase<"agent.tool_call", {
  tool: string;
  args: unknown;
  result?: unknown;
  latencyMs?: number;
}>;

export type AgentSkippedTurn = EventBase<"agent.skipped_turn", { reason: string }>;

export type PauseDetected = EventBase<"pause.detected", {
  kind: "typing_stopped" | "speech_ended" | "screen_static" | "case_boundary" | "save_completed";
  durationMs: number;
  signals: { msSinceKeystroke?: number; msSinceSpeech?: number; screenDiff?: number; expertSpeaking: boolean };
  decision: "ask" | "hold" | "skip";
  reason: string; // "expert still reading (scroll activity)"
}>;

export type QuestionCategory =
  | "why" | "guardrail_limit" | "exception" | "stop_and_ask" | "never_do"
  | "counterfactual" | "scope" | "frequency" | "who_decides" | "definition";

export type AgentQuestion = EventBase<"agent.question", {
  questionId: Id;
  text: string;
  category: QuestionCategory;
  about: { actionIds: Id[]; frameId?: Id; entity?: { kind: string; key?: string } };
  triggerPauseId?: Id;
  gapId?: Id; // debrief questions point at the gap they close
  scores: { infoGain: number; screenAlreadyAnswers: number; guardrailValue: number };
  rejectedCandidates: Array<{ text: string; category: QuestionCategory; reason: string }>;
}>;

export type QuestionDeferred = EventBase<"question.deferred", {
  text: string;
  category: QuestionCategory;
  about: { actionIds: Id[]; frameId?: Id };
  reason: "budget" | "expert_busy" | "low_priority";
}>;

export type AnswerLinked = EventBase<"answer.linked", {
  questionId: Id;
  utteranceIds: Id[];
  quote: string; // verbatim, redacted
  quoteSpan: { t: Ms; tEnd: Ms };
  summary: string;
  completeness: "full" | "partial" | "deflected" | "contradicts_earlier";
  needsFollowUp: boolean;
}>;

// ───────────────────────── expert markers & privacy ─────────────────────────

export type OffRecord = EventBase<"marker.off_record", {
  state: "start" | "end";
  trigger: "hotkey" | "voice" | "button";
  // nothing between start and end is persisted — no frames, audio, transcript
}>;

export type Bookmark = EventBase<"marker.bookmark", { note?: string; trigger: "hotkey" | "voice" }>;

/**
 * The expert revises something — detected from speech context ("no wait, five thousand, not three"),
 * a hotkey, a debrief answer or a teach-back correction. Can target screen actions (a mistake they undid),
 * earlier statements, or Work Map claims. Map applies corrections in `seq` order: latest wins,
 * the old version moves to the claim's `history`. Mistaken actions become `commonMistakes`, not steps.
 * Emitted live by Capture's correction detector AND by Map's post-session re-scan (source "map").
 */
export type KnowledgeCorrection = EventBase<"knowledge.correction", {
  correctionId: Id;
  detectedBy: "speech" | "hotkey" | "button" | "debrief" | "teachback";
  kind: "action_was_mistake" | "statement_revised" | "scope_changed" | "habit_not_rule" | "special_case" | "retracted";
  utteranceIds: Id[]; // where the expert said it
  quote: string; // verbatim
  targets: {
    actionIds?: Id[];
    utteranceIds?: Id[];
    answerEventIds?: Id[];
    workMapRefs?: Array<{ kind: "step" | "decision" | "guardrail" | "glossary"; id: Id }>;
  };
  before?: string; // what was believed / done
  after?: string; // the corrected version
  undoneBy?: Id[]; // screen.action ids that reverted the mistake on screen
  appliesTo: "always" | "this_case_only";
  confidence: Confidence;
}>

export type CaseBoundary = EventBase<"marker.case_boundary", {
  state: "start" | "end";
  case: { id: Id; kind: string; key: string; label?: string };
  outcome?: string; // "booked" | "held" | "sent_for_approval"
  detectedBy: "app" | "vision" | "voice" | "manual";
}>;

export type RedactionApplied = EventBase<"redaction.applied", {
  targetEventId: Id;
  entities: Array<{ type: string; replacement: string; bbox?: BBox; charSpan?: [number, number] }>;
}>;

// ───────────────────────── system / model calls ─────────────────────────

export type ModelCall = EventBase<"model.call", {
  modelCallId: Id;
  purpose: "vision" | "question_pick" | "answer_link" | "correction_detect" | "pii_detect" | "extract" | "gap_find" | "teachback" | "tutor_eval" | "other";
  model: string;
  promptVersion: string;
  inputRefs: Id[];
  detailUri?: Uri; // full prompt + raw response JSON
  latencyMs: number;
  tokens?: { input: number; output: number };
  error?: string;
}>;

export type PhaseChanged = EventBase<"phase.changed", { from: Phase; to: Phase }>;
export type SessionEnded = EventBase<"session.ended", { reason: "expert_done" | "timeout" | "error" }>;

// ───────────────────────── debrief / teach-back (written by Map) ─────────────────────────

export type GapStatusChanged = EventBase<"gap.status", { gapId: Id; status: Gap["status"]; note?: string }>;

export type TeachbackVerdict = EventBase<"teachback.verdict", {
  segmentId: Id;
  verdict: "confirmed" | "corrected" | "unclear";
  utteranceIds: Id[];
  correction?: string;
}>;

// ───────────────────────── teach (written by Teach) ─────────────────────────

export type TutorIntervention = EventBase<"tutor.intervention", {
  guardrailId?: Id;
  decisionId?: Id;
  triggerAppEventId: Id;
  beforeSave: boolean;
  newHireAction: string;
  expectedAction: string;
  spokenText: string;
  replayedScreenMoment?: ScreenMoment;
  outcome: "fixed" | "argued" | "ignored" | "pending";
}>;

export type PredictionAsked = EventBase<"tutor.prediction", {
  decisionId: Id;
  question: string;
  answerUtteranceIds: Id[];
  correct?: boolean;
}>;

export type Event =
  | FrameCaptured | ScreenObserved | ScreenAction | AppEvent | InputActivity
  | MediaChunk | SpeechVad | Utterance
  | AgentContextPushed | AgentTurn | AgentToolCall | AgentSkippedTurn
  | PauseDetected | AgentQuestion | QuestionDeferred | AnswerLinked
  | OffRecord | Bookmark | KnowledgeCorrection | CaseBoundary | RedactionApplied
  | ModelCall | PhaseChanged | SessionEnded
  | GapStatusChanged | TeachbackVerdict
  | TutorIntervention | PredictionAsked;

export type EventType = Event["type"];

// ═════════════════════════ WORK MAP (Map output) ═════════════════════════

/** Pointer into a session: the "screen moment". */
export interface ScreenMoment {
  sessionId: Id;
  t: Ms;
  tEnd?: Ms;
  frameId: Id; // thumbnail
  bbox?: BBox; // highlight the field
  eventIds: Id[];
}

/** The expert's own words, verbatim. */
export interface Quote {
  sessionId: Id;
  utteranceIds: Id[];
  text: string;
  t: Ms;
  tEnd: Ms;
  questionId?: Id;
  phase: Phase;
}

/** Machine-checkable condition, so Teach can evaluate guardrails against live app events. */
export type Condition =
  | { op: "and" | "or"; all: Condition[] }
  | { op: "not"; c: Condition }
  | { op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "missing";
      field: string; // "invoice.amount", "supplier.country", "invoice.month"
      value?: unknown };

/**
 * Facts a `Condition` is evaluated against. Teach builds this from the MiniERP `app.event` snapshot
 * (+ supplier history lookups). `Condition.field` paths refer to it, e.g. "invoice.amount", "supplier.group".
 * Demo domain = accounts payable; extend per domain, but keep paths stable once a Work Map uses them.
 */
export interface CaseFacts {
  invoice: {
    key: string;
    amount: number;
    currency: string;
    date: string; // YYYY-MM-DD
    month: number; // 1..12
    category: "equipment" | "consumables" | "spare_parts" | "services" | string;
    costCenter: string;
    assetNo: string | null;
    status: string;
    approver: string | null;
    comment: string;
    duplicateDeliveryNote: boolean; // same delivery note already paid
  };
  supplier: { name: string; group: string; isNew: boolean };
}

/**
 * Bridge the MiniERP exposes on `window.apprentice`. In capture mode `beforeSave` resolves `allow` immediately;
 * in teach mode the tutor evaluates guardrails and may hold the save (the brief: catch it BEFORE it is saved).
 */
export interface ApprenticeBridge {
  emit(event: Omit<AppEvent, "id" | "sessionId" | "seq" | "wall" | "phase">): void;
  beforeSave(facts: CaseFacts): Promise<{ allow: boolean; guardrailIds?: Id[]; message?: string }>;
}

export interface Claim {
  confidence: Confidence;
  /** Earlier versions replaced by corrections, oldest first. */
  history: Array<{ before: string; after: string; correctionEventId: Id; at: Ms; phase: Phase }>;
  provenance: Provenance[];
  confirmedByExpert: boolean;
  evidence: { moments: ScreenMoment[]; quotes: Quote[] };
}

export interface Step extends Claim {
  id: Id;
  order: number;
  title: string; // "Code the invoice to a cost center"
  goal: string;
  instructions: string; // how-to for a new hire, in the expert's framing
  screenMoment: ScreenMoment; // the canonical one shown in the UI
  actionIds: Id[];
  decisionIds: Id[];
  guardrailIds: Id[];
  appliesToCaseKinds: string[];
  optional: boolean;
  /** Optional steps: the step applies when this is true (drives the Work Map flowchart's yes/no diamond and Teach's "not_seen"). */
  when?: Condition;
  /** Plain-language version of `when`, e.g. "Hofmann or Schreiber in December, or a new supplier". */
  whenText?: string;
  observedInCases: Id[];
  typicalDurationMs?: number;
}

export interface Decision extends Claim {
  id: Id;
  stepId: Id;
  kind: "rule" | "judgment" | "habit" | "mistake" | "unknown";
  question: string; // "Opex or capex?"
  observedChoice: string; // "Re-coded 4711 -> 0400 (capex)"
  options: Array<{ option: string; when?: Condition; whenText?: string }>;
  reason: Quote; // the "why" in the expert's words
  reasonSummary: string;
}

export interface Guardrail extends Claim {
  id: Id;
  kind: "limit" | "exception" | "stop_and_ask" | "never" | "always" | "approval_required";
  statement: string; // "No asset number, no capex booking."
  /**
   * VIOLATION predicate over CaseFacts: true = saving now would break this guardrail.
   * (Not "when does it apply": the intercompany rule must not fire once Weber is set as approver.)
   * "missing" is true for null, undefined and "". Teach evaluates this deterministically; never via an LLM.
   */
  condition?: Condition;
  requiredAction: string; // "Stop and ask the controller"
  escalateTo?: { role: string; name?: string };
  scope: string; // "all suppliers" | "Czech subsidiary only"
  severity: "info" | "warn" | "block";
  stepIds: Id[];
}

export interface GlossaryTerm {
  term: string; // "4711"
  meaning: string; // "Opex cost center"
  quote?: Quote;
}

export interface Gap {
  id: Id;
  kind: "unexplained_action" | "unknown_scope" | "missing_threshold" | "unseen_case"
    | "conflict" | "low_confidence" | "deferred_question" | "who_decides";
  description: string;
  about: { stepId?: Id; decisionId?: Id; guardrailId?: Id; eventIds: Id[] };
  proposedQuestion: string;
  priority: number; // 0..1
  status: "open" | "asked" | "resolved" | "wont_fix";
  resolvedBy?: { questionId: Id; answerEventId: Id };
}

export interface TeachBack {
  segments: Array<{ id: Id; text: string; stepIds: Id[]; verdict?: "confirmed" | "corrected" | "unclear"; verdictEventId?: Id }>;
  audioUri?: Uri;
  status: "pending" | "in_progress" | "confirmed";
  confirmedAt?: ISO;
  confirmationQuote?: Quote; // "Yes, that's how it works."
}

export interface WorkMap {
  id: Id;
  version: number; // every change = new version file
  status: "draft" | "debrief" | "teachback_pending" | "confirmed";
  createdAt: ISO;
  updatedAt: ISO;
  sourceSessionIds: Id[]; // supports "two experts, one task" later
  expert: Person;
  task: Session["task"];
  summary: string;
  cases: Array<{ id: Id; kind: string; key: string; outcome?: string; t: Ms; tEnd: Ms; sessionId: Id }>;
  steps: Step[];
  decisions: Decision[];
  guardrails: Guardrail[];
  glossary: GlossaryTerm[];
  gaps: Gap[];
  teachBack: TeachBack;
  stats: { liveQuestions: number; debriefQuestions: number; judgmentCalls: number; guardrails: number };
  /** Things the expert did and then called wrong — great teaching material for Teach. */
  commonMistakes: Array<{
    id: Id;
    description: string;
    correctBehavior: string;
    relatedIds: Id[]; // steps / decisions / guardrails
    moment: ScreenMoment;
    quote: Quote;
    correctionEventId: Id;
  }>;
  changelog: Array<{ version: number; at: ISO; by: "map" | "expert"; note: string; eventIds: Id[] }>;
}

// ───────────────────────── Teach output ─────────────────────────

export interface MasteryReport {
  sessionId: Id;
  workMapId: Id;
  learner: Person;
  perStep: Array<{ stepId: Id; status: "mastered" | "assisted" | "failed" | "not_seen" }>;
  perGuardrail: Array<{ guardrailId: Id; status: "respected" | "caught_by_tutor" | "violated" | "not_triggered" }>;
  predictions: { asked: number; correct: number };
  practiceNext: string[];
}
