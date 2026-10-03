/**
 * Contract for the `llm` endpoint (functions/src/handlers.ts). One POST /llm {task, input} → output.
 * Inputs/outputs are plain JSON; the server validates outputs with Zod schemas that mirror these types.
 */
import type { CaseFacts, Id, QuestionCategory, ScreenEntity, BBox, Guardrail, Decision, WorkMap } from "./schema";

export interface LlmTasks {
  /** Capture: describe what changed between two frames. */
  vision: {
    input: { frameBase64: string; mediaType: "image/webp" | "image/png" | "image/jpeg"; prevSummary?: string; recentActions: string[] };
    output: {
      summary: string;
      app: { name: string; view?: string };
      visibleEntities: ScreenEntity[];
      changes: Array<{ kind: string; entityKind?: string; entityKey?: string; field?: string; from?: string; to?: string; bbox?: BBox; confidence: number }>;
      activityGuess: "typing" | "reading" | "navigating" | "idle" | "unknown";
      piiRegions: Array<{ type: string; bbox: BBox }>;
      confidence: number;
    };
  };
  /** Capture: at a pause, pick the one question worth asking (or none). */
  pick_question: {
    input: {
      recentActions: Array<{ id: Id; t: number; description: string }>;
      recentUtterances: Array<{ id: Id; t: number; speaker: string; text: string }>;
      askedQuestions: string[];
      liveBudgetLeft: number;
    };
    output: {
      ask: boolean;
      question: string;
      category: QuestionCategory;
      aboutActionIds: Id[];
      scores: { infoGain: number; screenAlreadyAnswers: number; guardrailValue: number };
      rejected: Array<{ text: string; category: QuestionCategory; reason: string }>;
      deferInstead: boolean;
    };
  };
  /** Capture/Map: is this utterance a self-correction, and of what? */
  detect_correction: {
    input: {
      utterance: { id: Id; text: string };
      recentUtterances: Array<{ id: Id; text: string; speaker: string }>;
      recentActions: Array<{ id: Id; description: string }>;
    };
    output: {
      isCorrection: boolean;
      kind: "action_was_mistake" | "statement_revised" | "scope_changed" | "habit_not_rule" | "special_case" | "retracted";
      quote: string;
      targetActionIds: Id[];
      targetUtteranceIds: Id[];
      before: string;
      after: string;
      appliesTo: "always" | "this_case_only";
      confidence: number;
    };
  };
  /** Capture/Map: link an answer to a question with a verbatim quote. */
  link_answer: {
    input: { question: string; utterances: Array<{ id: Id; text: string }> };
    output: { quote: string; summary: string; completeness: "full" | "partial" | "deflected" | "contradicts_earlier"; needsFollowUp: boolean };
  };
  /** Map: propose steps / decisions / guardrails from the condensed log. Code verifies everything. */
  extract_workmap: {
    input: { log: string; factPaths: string[] };
    output: ExtractionProposal;
  };
  /** Map: rank gaps and phrase debrief questions. */
  plan_debrief: {
    input: { log: string; workmapSummary: string; deferredQuestions: string[] };
    output: { gaps: Array<{ kind: string; description: string; proposedQuestion: string; priority: number; aboutActionIds: Id[] }> };
  };
  /** Map: teach-back script split into segments. */
  teachback: {
    input: { workmap: Pick<WorkMap, "steps" | "decisions" | "guardrails" | "glossary"> };
    output: { segments: Array<{ text: string; stepIds: Id[] }> };
  };
  /** Teach (generic websites without CaseFacts): which guardrails would this action break? */
  check_guardrails: {
    input: {
      guardrails: Array<{ id: Id; statement: string; requiredAction: string; scope: string }>;
      page: { url: string; title: string };
      fields: Record<string, string>;
      action: string;
    };
    output: { violations: Array<{ guardrailId: Id; reason: string; confidence: number }> };
  };
  /** Teach: grade a new hire's predicted decision against the expert's. */
  grade_prediction: {
    input: { question: string; expected: string; reason: string; answer: string };
    output: { correct: boolean; feedback: string };
  };
  /** Teach: phrase an intervention in the expert's words. */
  tutor_explain: {
    input: { expertName: string; guardrail: Pick<Guardrail, "statement" | "requiredAction">; quote: string; facts: CaseFacts; socratic: boolean };
    output: { spoken: string };
  };
}

export type LlmTask = keyof LlmTasks;
export type LlmInput<T extends LlmTask> = LlmTasks[T]["input"];
export type LlmOutput<T extends LlmTask> = LlmTasks[T]["output"];

export interface ExtractionProposal {
  steps: Array<{ title: string; goal: string; instructions: string; actionIds: Id[]; decisionKeys: string[]; guardrailKeys: string[]; optional: boolean }>;
  decisions: Array<{
    key: string;
    kind: Decision["kind"];
    question: string;
    observedChoice: string;
    options: Array<{ option: string; whenText: string }>;
    reasonUtteranceId: Id;
    reasonQuote: string;
    reasonSummary: string;
    actionIds: Id[];
  }>;
  guardrails: Array<{
    key: string;
    kind: Guardrail["kind"];
    statement: string;
    /** JSON-encoded Condition (violation predicate over CaseFacts), "" if not expressible. */
    conditionJson: string;
    requiredAction: string;
    escalateToRole: string;
    scope: string;
    severity: Guardrail["severity"];
    quotes: Array<{ utteranceId: Id; quote: string }>;
    actionIds: Id[];
  }>;
  glossary: Array<{ term: string; meaning: string }>;
}

/** Field paths Work Map conditions may use (keep in sync with CaseFacts). */
export const FACT_PATHS = [
  "invoice.key", "invoice.amount", "invoice.currency", "invoice.date", "invoice.month", "invoice.category",
  "invoice.costCenter", "invoice.assetNo", "invoice.status", "invoice.approver", "invoice.comment",
  "invoice.duplicateDeliveryNote", "supplier.name", "supplier.group", "supplier.isNew",
] as const;
