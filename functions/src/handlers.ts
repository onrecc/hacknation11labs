/**
 * Server-side handlers shared by Cloud Functions (index.ts) and the local dev server (tools/src/dev-api.ts).
 * Keys live only here: ANTHROPIC_API_KEY, ELEVENLABS_API_KEY. Set LLM_MOCK=1 to run every task without keys.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { LlmTask, LlmInput, LlmOutput } from "../../shared/llm";
import { mockOutput } from "./mocks";

const MODEL = process.env.LLM_MODEL ?? "claude-opus-5-5";

// ───────────── output schemas (mirror shared/llm.ts) ─────────────
const bbox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const category = z.enum(["why", "guardrail_limit", "exception", "stop_and_ask", "never_do", "counterfactual", "scope", "frequency", "who_decides", "definition"]);

const schemas = {
  vision: z.object({
    summary: z.string(),
    app: z.object({ name: z.string(), view: z.string() }),
    visibleEntities: z.array(z.object({ kind: z.string(), key: z.string(), label: z.string(), fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])) })),
    changes: z.array(z.object({ kind: z.string(), entityKind: z.string(), entityKey: z.string(), field: z.string(), from: z.string(), to: z.string(), bbox, confidence: z.number() })),
    activityGuess: z.enum(["typing", "reading", "navigating", "idle", "unknown"]),
    piiRegions: z.array(z.object({ type: z.string(), bbox })),
    confidence: z.number(),
  }),
  pick_question: z.object({
    ask: z.boolean(),
    question: z.string(),
    category,
    aboutActionIds: z.array(z.string()),
    scores: z.object({ infoGain: z.number(), screenAlreadyAnswers: z.number(), guardrailValue: z.number() }),
    rejected: z.array(z.object({ text: z.string(), category, reason: z.string() })),
    deferInstead: z.boolean(),
  }),
  detect_correction: z.object({
    isCorrection: z.boolean(),
    kind: z.enum(["action_was_mistake", "statement_revised", "scope_changed", "habit_not_rule", "special_case", "retracted"]),
    quote: z.string(),
    targetActionIds: z.array(z.string()),
    targetUtteranceIds: z.array(z.string()),
    before: z.string(),
    after: z.string(),
    appliesTo: z.enum(["always", "this_case_only"]),
    confidence: z.number(),
  }),
  link_answer: z.object({
    quote: z.string(),
    summary: z.string(),
    completeness: z.enum(["full", "partial", "deflected", "contradicts_earlier"]),
    needsFollowUp: z.boolean(),
  }),
  extract_workmap: z.object({
    steps: z.array(z.object({ title: z.string(), goal: z.string(), instructions: z.string(), actionIds: z.array(z.string()), decisionKeys: z.array(z.string()), guardrailKeys: z.array(z.string()), optional: z.boolean() })),
    decisions: z.array(z.object({
      key: z.string(), kind: z.enum(["rule", "judgment", "habit", "mistake", "unknown"]), question: z.string(), observedChoice: z.string(),
      options: z.array(z.object({ option: z.string(), whenText: z.string() })), reasonUtteranceId: z.string(), reasonQuote: z.string(),
      reasonSummary: z.string(), actionIds: z.array(z.string()),
    })),
    guardrails: z.array(z.object({
      key: z.string(), kind: z.enum(["limit", "exception", "stop_and_ask", "never", "always", "approval_required"]), statement: z.string(),
      conditionJson: z.string(), requiredAction: z.string(), escalateToRole: z.string(), scope: z.string(), severity: z.enum(["info", "warn", "block"]),
      quotes: z.array(z.object({ utteranceId: z.string(), quote: z.string() })), actionIds: z.array(z.string()),
    })),
    glossary: z.array(z.object({ term: z.string(), meaning: z.string() })),
  }),
  plan_debrief: z.object({
    gaps: z.array(z.object({ kind: z.string(), description: z.string(), proposedQuestion: z.string(), priority: z.number(), aboutActionIds: z.array(z.string()) })),
  }),
  teachback: z.object({ segments: z.array(z.object({ text: z.string(), stepIds: z.array(z.string()) })) }),
  tutor_explain: z.object({ spoken: z.string() }),
} satisfies Record<LlmTask, z.ZodType>;

// ───────────── prompts ─────────────
const SYSTEM: Record<LlmTask, string> = {
  vision: `You watch an expert's screen during real desk work. Describe what changed since the previous frame as structured events.
Report only what is visible. Use "" for unknown strings. bbox values are normalized 0..1. List every region showing personal data (names of private persons, IBAN, phone, email) in piiRegions.`,
  pick_question: `You are an apprentice learning an expert's job by watching them. The expert just paused. Decide whether ONE short question (max 25 words) is worth asking now.
Ask about the most recent judgment call visible in the actions: why they did it, the limit behind it, the exception, or when they would stop and ask someone. Prefer questions that reveal a guardrail.
Never ask what the screen already shows (score screenAlreadyAnswers high for those and reject them). Never repeat an asked question. If the live budget is 0 or the question can wait, set ask=false and deferInstead=true.
List the candidates you rejected with reasons.`,
  detect_correction: `Decide whether the expert's latest utterance corrects something they said or did earlier ("no wait", "actually", "that's wrong", "about what I said earlier"...).
quote must be copied verbatim from the utterance. Target the earlier utterances/actions it corrects by id. before/after describe the knowledge, not the words. If it is not a correction, set isCorrection=false and leave other fields empty.`,
  link_answer: `Link the expert's answer to the question. quote must be a verbatim substring of one utterance: the shortest span that carries the reason or rule.`,
  extract_workmap: `You turn an expert's recorded work session into a Work Map that teaches a new hire.
Steps generalize across cases (5-9 steps, one per kind of work, not per click). Decisions are judgment calls with their reason in the expert's words. Guardrails are limits, exceptions, stop-and-ask rules, nevers and approvals.
Rules:
- Every quote MUST be copied verbatim from an utterance in the log, with its utterance id. Prefer the corrected version when the expert corrected themselves; CORRECTION lines override earlier statements.
- Actions the expert called a mistake are NOT steps.
- Habits are not guardrails.
- conditionJson: a JSON Condition that is TRUE WHEN SAVING NOW WOULD VIOLATE the guardrail, using only the given fact paths. Shape: {"op":"and"|"or","all":[...]} | {"op":"not","c":{...}} | {"op":"eq"|"neq"|"gt"|"gte"|"lt"|"lte"|"in"|"contains"|"missing","field":"invoice.amount","value":5000}. Use "" if the rule can't be expressed.
- Reference actions by their ACTION ids.`,
  plan_debrief: `Plan a short spoken debrief with the expert. Find what a new hire still could not decide from the Work Map: unexplained actions, unknown scope, missing thresholds, unseen cases, rule conflicts, rule-vs-habit, who decides.
Never repeat a question that was already answered in the session. Questions are short and name the concrete case. Priority 0..1.`,
  teachback: `Explain the whole process back to the expert in under 90 seconds of speech, in plain words, as 3-6 segments. Each segment covers one or more steps (give their ids). Use the expert's thresholds and names exactly.`,
  tutor_explain: `You are a patient tutor coaching a new hire on their screen. The new hire is about to break a guardrail. If socratic=true, ask them why the expert would stop here (one sentence) and wait. Otherwise explain using the expert's quote verbatim, naming the expert. Max 2 sentences.`,
};

const EFFORT: Record<LlmTask, "low" | "medium" | "high"> = {
  vision: "low", pick_question: "low", detect_correction: "low", link_answer: "low", tutor_explain: "low",
  extract_workmap: "high", plan_debrief: "medium", teachback: "medium",
};

let client: Anthropic | null = null;

export async function runLlm<T extends LlmTask>(task: T, input: LlmInput<T>): Promise<LlmOutput<T>> {
  if (!(task in schemas)) throw new HttpError(400, `unknown task ${task}`);
  if (process.env.LLM_MOCK === "1" || !process.env.ANTHROPIC_API_KEY) return mockOutput(task, input);
  client ??= new Anthropic();

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (task === "vision") {
    const v = input as LlmInput<"vision">;
    content.push({ type: "image", source: { type: "base64", media_type: v.mediaType, data: v.frameBase64 } });
    content.push({ type: "text", text: JSON.stringify({ prevSummary: v.prevSummary ?? "", recentActions: v.recentActions }) });
  } else {
    content.push({ type: "text", text: JSON.stringify(input) });
  }

  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: task === "extract_workmap" ? 32000 : 4000,
    system: SYSTEM[task],
    messages: [{ role: "user", content }],
    output_config: { effort: EFFORT[task], format: betaZodOutputFormat(schemas[task]) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (res.stop_reason === "refusal") throw new HttpError(422, `model declined (${res.stop_details?.category ?? "unknown"})`);
  if (!res.parsed_output) throw new HttpError(502, `no parsed output (stop_reason ${res.stop_reason})`);
  return res.parsed_output as LlmOutput<T>;
}

// ───────────── ElevenLabs tokens (keys never reach the browser) ─────────────
export async function voiceToken(kind: "agent" | "scribe", agentId?: string): Promise<{ signedUrl?: string; token?: string }> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new HttpError(503, "ELEVENLABS_API_KEY not configured (browser falls back to Web Speech)");
  // ⚠️ Verify these endpoints against the current ElevenLabs API reference.
  if (kind === "agent") {
    const id = agentId ?? process.env.ELEVENLABS_AGENT_ID;
    if (!id) throw new HttpError(400, "agentId required");
    const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(id)}`, { headers: { "xi-api-key": key } });
    if (!r.ok) throw new HttpError(r.status, await r.text());
    return { signedUrl: ((await r.json()) as { signed_url: string }).signed_url };
  }
  const r = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", { method: "POST", headers: { "xi-api-key": key } });
  if (!r.ok) throw new HttpError(r.status, await r.text());
  return { token: ((await r.json()) as { token: string }).token };
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Generic request handler: POST /llm {task,input} · POST /voice-token {kind,agentId}. Auth is checked by the caller. */
export async function handle(path: string, body: unknown): Promise<unknown> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (path.endsWith("/llm")) return runLlm(b.task as LlmTask, b.input as never);
  if (path.endsWith("/voice-token")) return voiceToken(b.kind as "agent" | "scribe", b.agentId as string | undefined);
  if (path.endsWith("/health")) return { ok: true, model: MODEL, mock: process.env.LLM_MOCK === "1" || !process.env.ANTHROPIC_API_KEY, voice: !!process.env.ELEVENLABS_API_KEY };
  throw new HttpError(404, `no route ${path}`);
}
