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
      /** What vision last saw on screen (when vision is on): context for a concrete question. */
      screenSummary?: string;
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
    input: { log: string; factPaths: string[]; existingIds?: Array<{ id: Id; kind: "step" | "decision" | "guardrail"; title: string }> };
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
  /** Capture (workday): name the work being done and notice when a new kind of work starts. */
  label_task: {
    input: {
      currentTitle: string;
      app: string;
      department: string;
      actions: Array<{ id: Id; t: number; description: string }>;
      utterances: string[];
      knownTasks: string[];
    };
    output: {
      title: string;
      domain: string;
      summary: string;
      isNewTask: boolean;
      newTaskStartsAtActionId: Id;
      sameAsKnownTask: string;
      confidence: number;
    };
  };
  /** Two experts, one task: align two Work Maps and say where they differ. */
  compare_workmaps: {
    input: { a: { expert: string; map: string }; b: { expert: string; map: string } };
    output: {
      summary: string;
      items: Array<{
        topic: string;
        kind: "same" | "different" | "only_a" | "only_b";
        severity: "info" | "important";
        aSays: string;
        bSays: string;
        questionForA: string;
        questionForB: string;
      }>;
    };
  };
  /** Two experts, one task: both explained why; what should the team rule be? */
  resolve_difference: {
    input: { topic: string; a: { expert: string; says: string; why: string }; b: { expert: string; says: string; why: string } };
    output: { verdict: "both_valid" | "a_is_the_rule" | "b_is_the_rule" | "escalate"; note: string; condition: string };
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
  /** Map: classify the expert's reply to one teach-back segment. */
  teachback_verdict: {
    input: { segment: string; reply: string; workmapContext: string };
    output: { verdict: "confirmed" | "corrected" | "unclear"; correction: string; correctedText: string };
  };
  /**
   * Map: the expert corrected a teach-back part; rewrite the claims it speaks for. Code verifies the result like an
   * extraction (shared/workmap.ts `applyClaimPatch`): quotes verbatim from the reply, conditions on FACT_PATHS only.
   */
  patch_claim: {
    input: {
      segment: string;
      reply: string;
      correction: string;
      replyUtterances: Array<{ id: Id; text: string }>;
      claims: Array<{ kind: "step" | "decision" | "guardrail"; id: Id; fields: Array<{ field: string; value: string }> }>;
      factPaths: string[];
    };
    /** patches: full new value per changed field ("" = leave it). quotes: the expert's words carrying the change. */
    output: { patches: Array<{ id: Id; field: string; value: string }>; quotes: Array<{ utteranceId: Id; quote: string }> };
  };
  /** Teach: phrase an intervention in the expert's words. */
  tutor_explain: {
    input: {
      expertName: string; guardrail: Pick<Guardrail, "statement" | "requiredAction">; quote: string; facts: CaseFacts; socratic: boolean;
      /** Set when the expert spoke another language: the English meaning of `quote`, and the quote's BCP-47 language. */
      quoteTranslation?: string; quoteLanguage?: string;
    };
    output: { spoken: string };
  };
  /** Map/Teach: English meaning of the expert's words (shown and spoken next to the verbatim quote, never instead of it). */
  translate: {
    input: { text: string; from: string; to: string };
    output: { text: string };
  };
}

export type LlmTask = keyof LlmTasks;
export type LlmInput<T extends LlmTask> = LlmTasks[T]["input"];
export type LlmOutput<T extends LlmTask> = LlmTasks[T]["output"];

/**
 * What the LLM proposes for a Work Map. Code (shared/workmap.ts `assemble`) verifies every quote, action id,
 * condition field and correction id before anything becomes a claim. Keys are stable slugs: reuse the
 * `existingIds` from the previous version so links (gaps, teach-back, Teach) survive rebuilds.
 * Empty string = "none" for every *Json / optional string field (structured outputs have no optionals).
 */
export interface ExtractionProposal {
  summary: string;
  steps: Array<{
    key: string; // "st_code" (reuse existing ids)
    title: string;
    goal: string;
    instructions: string;
    actionIds: Id[];
    /** The one action whose screen moment best shows this step ("" = first of actionIds). */
    momentActionId: Id;
    decisionKeys: string[];
    guardrailKeys: string[];
    optional: boolean;
    /** JSON Condition over CaseFacts: when an optional step applies. "" for always-on steps. */
    whenJson: string;
    whenText: string;
  }>;
  decisions: Array<{
    key: string; // "dec_capex"
    kind: Decision["kind"];
    question: string;
    observedChoice: string;
    /** whenJson: JSON Condition when this option is right ("" for the fallback option). */
    options: Array<{ option: string; whenText: string; whenJson: string }>;
    reasonUtteranceId: Id;
    reasonQuote: string;
    reasonSummary: string;
    actionIds: Id[];
  }>;
  guardrails: Array<{
    key: string; // "gr_capex_threshold"
    kind: Guardrail["kind"];
    statement: string;
    /** JSON-encoded Condition (violation predicate over CaseFacts), "" if not expressible. */
    conditionJson: string;
    requiredAction: string;
    escalateToRole: string;
    escalateToName: string;
    scope: string;
    severity: Guardrail["severity"];
    quotes: Array<{ utteranceId: Id; quote: string }>;
    actionIds: Id[];
  }>;
  glossary: Array<{ term: string; meaning: string }>;
  /** For CORRECTION lines of kind action_was_mistake: how to teach it. */
  mistakes: Array<{ correctionEventId: Id; description: string; correctBehavior: string; relatedKeys: string[] }>;
  /** For every other CORRECTION line: which steps/decisions/guardrails it changed. */
  correctionTargets: Array<{ correctionEventId: Id; keys: string[] }>;
}

/** Field paths Work Map conditions may use (keep in sync with CaseFacts). */
export const FACT_PATHS = [
  "invoice.key", "invoice.amount", "invoice.currency", "invoice.date", "invoice.month", "invoice.category",
  "invoice.costCenter", "invoice.assetNo", "invoice.status", "invoice.approver", "invoice.comment",
  "invoice.duplicateDeliveryNote", "supplier.name", "supplier.group", "supplier.isNew",
] as const;
