/**
 * "What to ask" (Apprentice Test ②): what a question is aimed at and why the screen alone doesn't answer it.
 * Built only from the `agent.question` payload (scores, rejectedCandidates, gapId); nothing is invented.
 * Pure: tested in questionTarget.test.ts.
 */
import type { AgentQuestion, QuestionCategory } from "@shared/schema";
import { categoryLabel } from "./adaState";

type Payload = AgentQuestion["payload"];

export interface QuestionTarget {
  readonly kind: "gap" | "guardrail" | "exception" | "reasoning";
  readonly category: QuestionCategory;
  /** false for scripted (debrief / teach-back / tutor) questions: their scores are placeholders */
  readonly scored: boolean;
  readonly scores: Payload["scores"];
  readonly rejected: Payload["rejectedCandidates"];
}

export interface QuestionTargetInput {
  readonly category: QuestionCategory;
  readonly gapId?: string;
  readonly scores: Payload["scores"];
  readonly rejectedCandidates: Payload["rejectedCandidates"];
  /** defaults to true unless the question closes a gap */
  readonly scored?: boolean;
}

const GUARDRAIL: ReadonlySet<QuestionCategory> = new Set(["guardrail_limit", "never_do", "stop_and_ask"]);

/** The target of a question, from the same values the hub logs in `agent.question`. */
export function questionTarget(q: QuestionTargetInput): QuestionTarget {
  const kind = q.gapId ? "gap" : GUARDRAIL.has(q.category) ? "guardrail" : q.category === "exception" ? "exception" : "reasoning";
  return { kind, category: q.category, scored: q.scored ?? !q.gapId, scores: q.scores, rejected: q.rejectedCandidates };
}

const pct = (x: number): string => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;

export interface TargetText {
  readonly target: string;
  readonly whyNotScreen: string;
  readonly alsoConsidered: readonly string[];
}

/** In words, for the Ada panel. */
export function describeTarget(t: QuestionTarget): TargetText {
  const cat = categoryLabel(t.category);
  const target = t.kind === "gap" ? `A gap in the Work Map (${cat})`
    : t.kind === "guardrail" ? "A guardrail: a limit Ada must enforce later"
    : t.kind === "exception" ? "An exception to the usual steps"
    : `The reasoning behind a step (${cat})`;
  const whyNotScreen = t.kind === "gap" ? "Your screen and answers so far left this open."
    : !t.scored ? "Not something a screen shows: only you can confirm it."
    : `The screen explains ${pct(t.scores.screenAlreadyAnswers)} of it (Ada only asks below 50%); rule value ${pct(t.scores.guardrailValue)}.`;
  return { target, whyNotScreen, alsoConsidered: t.rejected.map((r) => `“${r.text}”: ${r.reason}`) };
}
