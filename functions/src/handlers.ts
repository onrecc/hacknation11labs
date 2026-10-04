/**
 * Server-side handlers shared by Cloud Functions (index.ts) and the local dev server (tools/src/dev-api.ts).
 * Keys live only here: CLAUDE_KEY (or ANTHROPIC_API_KEY), ELEVENLABS_API_KEY. Set LLM_MOCK=1 to run every task without keys.
 * LLM provider: Anthropic Claude (structured outputs via betaZodOutputFormat).
 * Cost: Sonnet for everything live and most offline work; Opus only for the one Work Map extraction per task.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { LlmTask, LlmInput, LlmOutput } from "../../shared/llm";
import { mockOutput } from "./mocks";

const MODEL = process.env.LLM_MODEL ?? "claude-sonnet-5-5";
/** Only extract_workmap (one call per finished task, decides the whole map) runs on Opus. */
const MODEL_MAP = process.env.LLM_MODEL_MAP ?? "claude-opus-5-5";
const apiKey = () => process.env.CLAUDE_KEY ?? process.env.ANTHROPIC_API_KEY;

// ───────────── output schemas (mirror shared/llm.ts; structured-output friendly: no records, no unions) ─────────────
const bbox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const category = z.enum(["why", "guardrail_limit", "exception", "stop_and_ask", "never_do", "counterfactual", "scope", "frequency", "who_decides", "definition"]);

const schemas = {
  vision: z.object({
    summary: z.string(),
    app: z.object({ name: z.string(), view: z.string() }),
    visibleEntities: z.array(z.object({ kind: z.string(), key: z.string(), label: z.string(), fields: z.array(z.object({ name: z.string(), value: z.string() })) })),
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
    summary: z.string(),
    steps: z.array(z.object({
      key: z.string(), title: z.string(), goal: z.string(), instructions: z.string(), actionIds: z.array(z.string()), momentActionId: z.string(),
      decisionKeys: z.array(z.string()), guardrailKeys: z.array(z.string()), optional: z.boolean(), whenJson: z.string(), whenText: z.string(),
    })),
    decisions: z.array(z.object({
      key: z.string(), kind: z.enum(["rule", "judgment", "habit", "mistake", "unknown"]), question: z.string(), observedChoice: z.string(),
      options: z.array(z.object({ option: z.string(), whenText: z.string(), whenJson: z.string() })), reasonUtteranceId: z.string(), reasonQuote: z.string(),
      reasonSummary: z.string(), actionIds: z.array(z.string()),
    })),
    guardrails: z.array(z.object({
      key: z.string(), kind: z.enum(["limit", "exception", "stop_and_ask", "never", "always", "approval_required"]), statement: z.string(),
      conditionJson: z.string(), requiredAction: z.string(), escalateToRole: z.string(), escalateToName: z.string(), scope: z.string(), severity: z.enum(["info", "warn", "block"]),
      quotes: z.array(z.object({ utteranceId: z.string(), quote: z.string() })), actionIds: z.array(z.string()),
    })),
    glossary: z.array(z.object({ term: z.string(), meaning: z.string() })),
    mistakes: z.array(z.object({ correctionEventId: z.string(), description: z.string(), correctBehavior: z.string(), relatedKeys: z.array(z.string()) })),
    correctionTargets: z.array(z.object({ correctionEventId: z.string(), keys: z.array(z.string()) })),
  }),
  plan_debrief: z.object({
    gaps: z.array(z.object({ kind: z.string(), description: z.string(), proposedQuestion: z.string(), priority: z.number(), aboutActionIds: z.array(z.string()) })),
  }),
  teachback: z.object({ segments: z.array(z.object({ text: z.string(), stepIds: z.array(z.string()) })) }),
  label_task: z.object({
    title: z.string(), domain: z.string(), summary: z.string(), isNewTask: z.boolean(),
    newTaskStartsAtActionId: z.string(), sameAsKnownTask: z.string(), confidence: z.number(),
  }),
  compare_workmaps: z.object({
    summary: z.string(),
    items: z.array(z.object({
      topic: z.string(), kind: z.enum(["same", "different", "only_a", "only_b"]), severity: z.enum(["info", "important"]),
      aSays: z.string(), bSays: z.string(), questionForA: z.string(), questionForB: z.string(),
    })),
  }),
  resolve_difference: z.object({ verdict: z.enum(["both_valid", "a_is_the_rule", "b_is_the_rule", "escalate"]), note: z.string(), condition: z.string() }),
  check_guardrails: z.object({ violations: z.array(z.object({ guardrailId: z.string(), reason: z.string(), confidence: z.number() })) }),
  grade_prediction: z.object({ correct: z.boolean(), feedback: z.string() }),
  teachback_verdict: z.object({ verdict: z.enum(["confirmed", "corrected", "unclear"]), correction: z.string(), correctedText: z.string() }),
  tutor_explain: z.object({ spoken: z.string() }),
} satisfies Record<LlmTask, z.ZodType>;

// ───────────── prompts ─────────────
const SYSTEM: Record<LlmTask, string> = {
  vision: `You watch an expert's screen during real desk work. Describe what changed since the previous frame as structured events.
Report only what is visible. Use "" for unknown strings. bbox values are normalized 0..1. List every region showing personal data (names of private persons, IBAN, phone, email) in piiRegions.`,
  pick_question: `You are an apprentice learning an expert's job by watching them. The expert just paused. Decide whether ONE short question (max 20 words) is worth asking now.
Ask about the most recent judgment call visible in the actions: why they did it, the limit behind it, the exception, or when they would stop and ask someone. Prefer questions that reveal a guardrail.
Speak naturally and concretely ("You moved that one to capex. What made you do that?"). Never ask what the screen already shows (score screenAlreadyAnswers high for those and reject them). Never ask about routine navigation (opening an item, going back). Never repeat an asked question.
If the live budget is 0 or the question can wait, set ask=false and deferInstead=true. List the candidates you rejected with reasons.`,
  detect_correction: `Decide whether the expert's latest utterance corrects something they said or did earlier ("no wait", "actually", "that's wrong", "about what I said earlier"...).
quote must be copied verbatim from the utterance. Target the earlier utterances/actions it corrects by id. before/after describe the knowledge, not the words. If it is not a correction, set isCorrection=false, kind="statement_revised", appliesTo="always", confidence=0 and leave the other strings and lists empty.`,
  link_answer: `Link the expert's answer to the question. quote must be a verbatim substring of one utterance: the shortest span that carries the reason or rule.`,
  extract_workmap: `You turn an expert's recorded work session into a Work Map that teaches a new hire to do the same work.
The log lines are tagged with ids: ACTION evt_…, EXPERT utt_…, QUESTION q_…, CORRECTION evt_…. Off-record parts were removed; never mention or guess them.

Produce:
- steps: 5-9 steps, one per KIND of work generalized across cases (not one per click), in work order. key: reuse an id from existingIds when it is the same step, else "st_<short_slug>". actionIds: the ACTION ids that are instances of this step. momentActionId: the single action whose screen best shows the step. optional=true if the step only happens in some cases; then whenJson says WHEN it applies and whenText says it in plain words.
- decisions: the judgment calls and rules the expert applied (2-5). kind: rule (always the same given facts) | judgment (weighs things) | habit (personal routine, not required) | mistake. options: every choice with whenText and, when expressible, whenJson (when this option is right; "" for the fallback "otherwise" option). reasonUtteranceId + reasonQuote: the expert's own words giving the reason.
- guardrails: limits, exceptions, stop-and-ask rules, nevers, required approvals (2-6). conditionJson is a VIOLATION predicate: TRUE when saving the case right now would break the guardrail (so it must become false once the expert's required action is done, e.g. include "costCenter neq 0400" or "status not in [on_hold]"). severity block only if conditionJson is set. quotes: the expert's own words. escalateToRole/escalateToName: who to ask, "" if nobody.
- glossary: codes and names a new hire must know (cost centers, subsidiaries, people).
- mistakes: one entry per CORRECTION of kind action_was_mistake (description = what was done wrong, correctBehavior = what to do instead, relatedKeys = decision/guardrail keys).
- correctionTargets: for every other CORRECTION, the step/decision/guardrail keys whose content it changed.
- summary: one sentence.

Hard rules:
- Every quote is copied CHARACTER FOR CHARACTER from one EXPERT utterance (with its utt id). Prefer the sentence that states the rule; it may include the self-correction ("…three thousand… No, wait, sorry, five thousand."). Never quote the agent. If the expert never said it aloud, do not invent a quote: leave that guardrail out.
- Later CORRECTION lines override earlier statements; use the corrected values everywhere (thresholds, names, scope).
- Actions the expert called a mistake are NOT steps. Habits are NOT guardrails.
- Conditions use only the given fact paths. Condition JSON shape: {"op":"and"|"or","all":[...]} | {"op":"not","c":{...}} | {"op":"eq"|"neq"|"gt"|"gte"|"lt"|"lte"|"in"|"contains"|"missing","field":"invoice.amount","value":5000}. "missing" is true for null/empty. Use "" when not expressible.
- Reference only ids that appear in the log.`,
  plan_debrief: `Plan a short spoken debrief with the expert, right after they finished the task. Find what a new hire STILL could not decide from what was seen and said:
unknown_scope (rule seen on one supplier/case: does it apply to others?), who_decides (who releases/approves/escalates), unseen_case (a guardrail's other branch never seen, e.g. no asset number), conflict (two rules that could both apply to one case), habit_vs_rule (something done once without a stated reason), missing_threshold (a limit without a number).
Rules: never ask anything already answered in the log; deferred questions come first (priority 0.9). Each proposedQuestion is max 20 words, spoken, and names the concrete case ("the Hofmann invoice"). Priority 0..1 = how badly a new hire needs it. 3-6 gaps.`,
  teachback: `Explain the whole process back to the expert, in the second person ("you open…"), in under 90 seconds of speech (max ~220 words), as 3-6 segments in work order. Each segment covers one or more steps (give their ids).
Use ONLY facts from the Work Map you are given, with the expert's thresholds, codes and names exactly. Do not add rules, numbers or names that are not in it. Plain spoken language, no lists.`,
  teachback_verdict: `The apprentice just read one part of its explanation back to the expert and asked "is that right?". Classify the expert's reply.
confirmed: they agree (yes, right, exactly, mm-hm) with no change. corrected: they change or add something (even after a "yes, but…"); write the corrected version of the segment in correctedText, keeping everything else the same. unclear: no answer or off-topic.
correction: the expert's own words that carry the change, copied verbatim from the reply ("" if none).`,
  label_task: `You watch an expert's workday and keep a list of the TASKS they do (a task = one kind of work with one goal, e.g. "Process supplier invoices", "Approve purchase requests", "Answer supplier emails"). Several cases of the same kind of work (invoice after invoice) are ONE task.
Given the current task title (may be empty), the app, the department and the recent actions/utterances:
- title: short verb phrase for the work in these actions (max 6 words), domain: snake_case business domain (e.g. accounts_payable, procurement), summary: one sentence.
- isNewTask: true only if the actions clearly switched to a DIFFERENT kind of work than currentTitle; then newTaskStartsAtActionId = id of the first action of the new work.
- sameAsKnownTask: if this is the same kind of work as one of knownTasks (resumed after a detour), that exact title, else "".`,
  compare_workmaps: `Two experts documented the same kind of work (Work Map A and Work Map B). Align them topic by topic (a decision, a limit, an exception, who approves, when to stop and ask).
For each topic: kind = same | different | only_a | only_b; aSays/bSays = what each expert does or says, in their words where possible ("" if missing).
Where they differ or one is missing a rule, write a short, neutral, curious "why" question for each expert (questionForA / questionForB), naming the other expert and the concrete case, never implying who is right ("Ilse sends suspected duplicates straight to Jonas. You put them on hold. What makes you hold them?"). Use "" when no question is needed.
severity = important when the difference changes money, approvals or compliance, else info. Order: important differences first. summary: 2 sentences.`,
  resolve_difference: `Two experts explained why they handle the same situation differently. Decide the team rule:
both_valid (each is right under a different condition: give that condition), a_is_the_rule / b_is_the_rule (one is the safer/correct practice), or escalate (needs the controller/team lead to decide). note: 1-2 sentences a new hire can follow. condition: when each applies ("" if not both_valid).`,
  check_guardrails: `A new hire is about to perform an action on a web page. Given the expert's guardrails and the visible form fields, list ONLY guardrails that this action would clearly violate. Be conservative: no violation if the fields don't show it. confidence 0..1.`,
  grade_prediction: `Grade whether the new hire's predicted decision matches the expert's decision in substance (wording may differ). Feedback: one short, encouraging sentence that uses the expert's reason.`,
  tutor_explain: `You are a patient tutor coaching a new hire on their screen. The new hire is about to break a guardrail. If socratic=true, ask them why the expert would stop here (one sentence) and wait. Otherwise explain using the expert's quote verbatim, naming the expert. Max 2 sentences.`,
};

const DEEP: ReadonlySet<LlmTask> = new Set<LlmTask>(["extract_workmap", "plan_debrief", "teachback", "compare_workmaps"]);

/** Schemas too large for strict structured outputs: plain JSON + zod validation. */
const LOOSE: ReadonlySet<LlmTask> = new Set<LlmTask>(["extract_workmap"]);

let client: Anthropic | null = null;
const jsonSchemas = new Map<LlmTask, unknown>();
function jsonSchema(task: LlmTask) {
  if (!jsonSchemas.has(task)) {
    const { $schema: _s, ...rest } = z.toJSONSchema(schemas[task], { target: "draft-2020-12" }) as Record<string, unknown>;
    jsonSchemas.set(task, rest);
  }
  return jsonSchemas.get(task);
}

export async function runLlm<T extends LlmTask>(task: T, input: LlmInput<T>): Promise<LlmOutput<T>> {
  if (!(task in schemas)) throw new HttpError(400, `unknown task ${task}`);
  if (llmDown && Date.now() > llmDownUntil) llmDown = null; // re-probe: keys get fixed, credits topped up
  if (process.env.LLM_MOCK === "1" || !apiKey() || llmDown) return mockOutput(task, input);
  await takeBudget(task);
  try {
    return await runClaude(task, input); // the SDK retries 429/5xx/overloaded with backoff itself
  } catch (err) {
    // a revoked key or empty credit balance must not take the whole demo down: canned answers, say so in /health
    const e = err as { status?: number; message: string };
    if (process.env.LLM_STRICT !== "1" && (e.status === 401 || e.status === 403 || /credit balance is too low/i.test(e.message))) {
      llmDown = `Claude unavailable (key or credits, ${e.status ?? "?"}) at ${new Date().toISOString()}: mock answers, retrying in 5 min`;
      llmDownUntil = Date.now() + 5 * 60_000;
      console.error(llmDown);
      return mockOutput(task, input);
    }
    throw err;
  }
}

let llmDown: string | null = null;
let llmDownUntil = 0;

/**
 * Optional request budget per minute (LLM_RPM; unset = unlimited).
 * Interactive tasks wait up to 20 s for a slot; background tasks are skipped when the budget is spent
 * (the app already treats a failed vision/label/correction call as "nothing new").
 */
const BACKGROUND: ReadonlySet<LlmTask> = new Set<LlmTask>(["vision", "label_task", "detect_correction"]);
const recent: number[] = [];
async function takeBudget(task: LlmTask) {
  const rpm = Number(process.env.LLM_RPM ?? 0);
  if (!rpm) return;
  const deadline = Date.now() + (BACKGROUND.has(task) ? 0 : 20_000);
  for (;;) {
    while (recent.length && Date.now() - recent[0] > 60_000) recent.shift();
    if (recent.length < rpm) return void recent.push(Date.now());
    if (Date.now() >= deadline) throw new HttpError(429, `skipped ${task}: LLM budget of ${rpm}/min spent`);
    await new Promise((r) => setTimeout(r, Math.min(2000, 60_000 - (Date.now() - recent[0]) + 50)));
  }
}

async function runClaude<T extends LlmTask>(task: T, input: LlmInput<T>): Promise<LlmOutput<T>> {
  client ??= new Anthropic({ apiKey: apiKey(), maxRetries: 3 });

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (task === "vision") {
    const v = input as LlmInput<"vision">;
    content.push({ type: "image", source: { type: "base64", media_type: v.mediaType as "image/webp", data: v.frameBase64 } });
    content.push({ type: "text", text: JSON.stringify({ prevSummary: v.prevSummary ?? "", recentActions: v.recentActions }) });
  } else {
    content.push({ type: "text", text: JSON.stringify(input) });
  }

  const deep = DEEP.has(task);
  const map = task === "extract_workmap";
  const base = {
    model: map ? MODEL_MAP : MODEL,
    max_tokens: map ? 20000 : deep ? 12000 : 4000, // ≤21k keeps the SDK from demanding streaming
    // live tasks (questions while the expert waits, guardrail checks before save) skip thinking for latency
    ...(deep ? {} : { thinking: { type: "between_tools" as const } }),
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
  };
  let out: Record<string, unknown>;
  if (LOOSE.has(task)) {
    // the Work Map schema compiles to a grammar too large for strict structured outputs:
    // ask for JSON against the schema and validate with zod instead (one retry with the error)
    const system = `${SYSTEM[task]}\n\nRespond with ONLY one JSON object (no prose, no code fence) matching this JSON Schema:\n${JSON.stringify(jsonSchema(task))}`;
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
    for (let attempt = 0; ; attempt++) {
      const res = await client.beta.messages.create({ ...base, system, messages, output_config: { effort: "medium" } });
      if (res.stop_reason === "refusal") throw new HttpError(422, `${task}: model declined`);
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      let problem: string;
      try {
        const parsed = schemas[task].safeParse(JSON.parse(json));
        if (parsed.success) {
          out = parsed.data as Record<string, unknown>;
          break;
        }
        problem = parsed.error.message.slice(0, 1500);
      } catch (e) {
        problem = `invalid JSON (stop: ${res.stop_reason}): ${(e as Error).message}`;
      }
      if (attempt >= 1) throw new HttpError(502, `${task}: output failed schema: ${problem.slice(0, 300)}`);
      messages.push({ role: "assistant", content: text }, { role: "user", content: `That did not validate: ${problem}\nSend the corrected JSON object only.` });
    }
  } else {
    const res = await client.beta.messages.parse({
      ...base,
      system: SYSTEM[task],
      messages: [{ role: "user", content }],
      output_config: { effort: deep ? "medium" : "low", format: betaZodOutputFormat(schemas[task]) },
    });
    if (res.stop_reason === "refusal") throw new HttpError(422, `${task}: model declined`);
    if (!res.parsed_output) throw new HttpError(502, `${task}: no structured output (stop: ${res.stop_reason})`);
    out = res.parsed_output as Record<string, unknown>;
  }
  if (task === "vision") {
    // models sometimes return pixel coordinates: drop boxes that aren't normalized 0..1
    const ok = (b?: { x: number; y: number; w: number; h: number }) => !!b && [b.x, b.y, b.w, b.h].every((n) => n >= 0 && n <= 1);
    out.changes = (out.changes as Array<{ bbox?: { x: number; y: number; w: number; h: number } }>).map(({ bbox, ...c }) => (ok(bbox) ? { ...c, bbox } : c));
    out.piiRegions = (out.piiRegions as Array<{ bbox: { x: number; y: number; w: number; h: number } }>).filter((p) => ok(p.bbox));
    // fields come back as [{name,value}] (schema-friendly); the contract uses a record
    out.visibleEntities = (out.visibleEntities as Array<{ fields: Array<{ name: string; value: string }> }>).map((e) => ({ ...e, fields: Object.fromEntries(e.fields.map((f) => [f.name, f.value])) }));
  }
  return out as LlmOutput<T>;
}

// ───────────── ElevenLabs (keys never reach the browser) ─────────────
const EL = "https://api.elevenlabs.io";
function elKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new HttpError(503, "ELEVENLABS_API_KEY not configured (browser falls back to Web Speech)");
  return key;
}

export async function voiceToken(kind: "agent" | "scribe", agentId?: string): Promise<{ signedUrl?: string; token?: string }> {
  const key = elKey();
  if (kind === "agent") {
    if (!agentId) throw new HttpError(400, "agentId required");
    const r = await fetch(`${EL}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, { headers: { "xi-api-key": key } });
    if (!r.ok) throw new HttpError(r.status, await r.text());
    return { signedUrl: ((await r.json()) as { signed_url: string }).signed_url };
  }
  const r = await fetch(`${EL}/v1/single-use-token/realtime_scribe`, { method: "POST", headers: { "xi-api-key": key } });
  if (!r.ok) throw new HttpError(r.status, await r.text());
  return { token: ((await r.json()) as { token: string }).token };
}

/** ElevenLabs TTS (fallback voice when no agent conversation is running). Returns mp3 bytes. */
export async function tts(text: string, voiceId?: string): Promise<{ binary: Uint8Array; contentType: string }> {
  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const r = await fetch(`${EL}/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": elKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 1000), model_id: "eleven_flash_v2_5" }),
  });
  if (!r.ok) throw new HttpError(r.status, await r.text());
  return { binary: new Uint8Array(await r.arrayBuffer()), contentType: "audio/mpeg" };
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Generic request handler: POST /llm {task,input} · POST /voice-token {kind,agentId} · POST /tts {text,voiceId} · GET /health.
 * Returns JSON, or `{ binary, contentType }` for audio. Auth is checked by the caller.
 */
export async function handle(path: string, body: unknown): Promise<unknown> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (path.endsWith("/llm")) return runLlm(b.task as LlmTask, b.input as never);
  if (path.endsWith("/voice-token")) return voiceToken(b.kind as "agent" | "scribe", b.agentId as string | undefined);
  if (path.endsWith("/tts")) return tts(String(b.text ?? ""), b.voiceId as string | undefined);
  if (path.endsWith("/health")) return { ok: true, provider: "claude", model: MODEL, mapModel: MODEL_MAP, rpm: Number(process.env.LLM_RPM ?? 0) || "unlimited", mock: process.env.LLM_MOCK === "1" || !apiKey() || !!llmDown, warning: llmDown ?? undefined, voice: !!process.env.ELEVENLABS_API_KEY };
  throw new HttpError(404, `no route ${path}`);
}

export const isBinary = (x: unknown): x is { binary: Uint8Array; contentType: string } => !!x && typeof x === "object" && "binary" in x;
