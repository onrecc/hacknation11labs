/**
 * Ada panel state: turns the hub's raw pause/question signals into what a person reads on screen
 * ("You stopped typing for 2.4 s on Cost center"). Pure functions, no DOM, no Firebase: tested in adaState.test.ts.
 */
import type { PauseDetected, Phase, QuestionCategory } from "@shared/schema";

export type PauseKind = PauseDetected["payload"]["kind"];
export type HubPauseDecision = PauseDetected["payload"]["decision"];

/** The question Ada asked last (live or in the debrief), as the panel shows it. */
export interface CurrentQuestion {
  readonly questionId: string;
  readonly text: string;
  readonly category: QuestionCategory;
  /** session ms */
  readonly t: number;
  /** what on screen the question is about ("Set costCenter on INV-4471 …") */
  readonly aboutScreen?: string;
  /** plain-language reason it was asked at this moment */
  readonly why: string;
  readonly answered: boolean;
}

/** The pause detector's latest decision, in words. */
export interface PauseInfo {
  readonly decision: "ask" | "wait" | "defer";
  readonly reason: string;
  readonly quietMs?: number;
  readonly field?: string;
}

const CATEGORY_LABEL: Readonly<Record<QuestionCategory, string>> = {
  why: "Why", guardrail_limit: "Guardrail", exception: "Exception", stop_and_ask: "When to stop", never_do: "Never do",
  counterfactual: "What if", scope: "Scope", frequency: "How often", who_decides: "Who decides", definition: "Definition",
};

export function categoryLabel(c: QuestionCategory): string {
  return CATEGORY_LABEL[c] ?? c;
}

/** "costCenter" / "cost_center" / "#costCenter" → "Cost center". */
export function humanizeField(field: string | undefined): string | undefined {
  if (!field) return undefined;
  const words = field.replace(/^[#.]/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : undefined;
}

const secs = (ms: number): string => `${(Math.round(ms / 100) / 10).toFixed(1)} s`;

export interface PauseInput {
  readonly decision: HubPauseDecision;
  readonly kind: PauseKind;
  readonly sinceKeyMs: number;
  readonly sinceSpeechMs: number;
  readonly staticMs?: number;
  readonly longStaticMs?: number;
  /** the field the person touched last (raw id from the app) */
  readonly field?: string;
}

/** Why the detector thinks this is (or isn't) a good moment, in the person's terms. */
export function describePause(p: PauseInput): PauseInfo {
  const field = humanizeField(p.field);
  const on = field ? ` on ${field}` : "";
  const quietMs = Math.min(p.sinceKeyMs, p.sinceSpeechMs);
  if (p.decision === "skip") return { decision: "wait", reason: "Nothing new on screen since my last question.", quietMs, ...(field ? { field } : {}) };
  if (p.decision === "hold") return { decision: "wait", reason: `You paused for ${secs(quietMs)}${on}, mid-case. Waiting for a save or the end of the case so I don't interrupt.`, quietMs, ...(field ? { field } : {}) };
  return { decision: "ask", reason: askReason(p, on), quietMs, ...(field ? { field } : {}) };
}

function askReason(p: PauseInput, on: string): string {
  switch (p.kind) {
    case "save_completed": return `You just saved${on} and stopped typing for ${secs(p.sinceKeyMs)}: a natural break.`;
    case "case_boundary": return `You just finished a case and stopped for ${secs(p.sinceKeyMs)}.`;
    case "speech_ended": return `You stopped talking for ${secs(p.sinceSpeechMs)} and weren't typing.`;
    default:
      if (p.longStaticMs !== undefined && (p.staticMs ?? 0) >= p.longStaticMs) return `The screen has been still for ${secs(p.staticMs ?? 0)}${on}.`;
      return `You stopped typing for ${secs(p.sinceKeyMs)}${on}.`;
  }
}

/** A question the picker wanted but held back for the debrief. */
export function describeDeferral(reason: "budget" | "expert_busy" | "low_priority"): PauseInfo {
  const text = reason === "budget" ? "Question budget for these 10 minutes is used up; saved for the debrief."
    : reason === "expert_busy" ? "You were busy; saved for the debrief."
    : "Not worth interrupting you for; saved for the debrief.";
  return { decision: "defer", reason: text };
}

/** The picker looked and decided the screen already answers it. */
export const QUIET_INFO: PauseInfo = { decision: "wait", reason: "Nothing worth interrupting you for: the screen already shows it." };

/** Why a scripted (debrief / teach-back / tutor) question is asked now. */
export function scriptedWhy(phase: Phase, hasGap: boolean): string {
  if (hasGap) return "Debrief: closing a gap your screen didn't explain.";
  if (phase === "teachback") return "Teach-back: checking I understood you.";
  if (phase === "teach") return "Checking how you'd handle this case.";
  return "Follow-up on what you just did.";
}

/** Live questions still allowed in the rolling window (docs/capture.md: max N per 10 min). */
export function budgetLeft(askedAt: readonly number[], now: number, budget: number, windowMs = 600_000): number {
  return Math.max(0, budget - askedAt.filter((t) => now - t < windowMs).length);
}

export interface VoiceFlags {
  readonly listening: boolean;
  readonly agentSpeaking: boolean;
  readonly expertSpeaking: boolean;
  readonly offRecord: boolean;
}

export type ListenState = "off_record" | "ada_speaking" | "you_speaking" | "listening" | "not_started";

export function listenState(s: VoiceFlags): ListenState {
  if (s.offRecord) return "off_record";
  if (s.agentSpeaking) return "ada_speaking";
  if (s.expertSpeaking) return "you_speaking";
  return s.listening ? "listening" : "not_started";
}

const LISTEN_LABEL: Readonly<Record<ListenState, string>> = {
  off_record: "Off the record", ada_speaking: "Ada speaking", you_speaking: "You're speaking", listening: "Ada listening", not_started: "Ada not started",
};

export function listenLabel(s: ListenState): string {
  return LISTEN_LABEL[s];
}
