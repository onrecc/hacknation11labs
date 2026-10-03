/**
 * Creates or updates the two ElevenAgents (idempotent, matched by name) and writes their ids to
 * web/src/lib/elevenlabs.json (ids are not secret). Re-run after editing a prompt:
 *   npm run setup:elevenlabs -w tools
 *
 * Design: OUR code decides WHEN to speak (pause detector, guardrail engine). The agent decides HOW to say it,
 * listens to the answer and handles a short back-and-forth. Control messages from the app arrive as user
 * messages prefixed with [ASK]/[SAY]/[INTERVENE]/[PREDICT]; screen context arrives as contextual updates.
 */
import { writeFileSync } from "node:fs";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY missing in .env.local");
const EL = "https://api.elevenlabs.io/v1/convai";
const H = { "xi-api-key": KEY, "Content-Type": "application/json" };
const LLM = process.env.ELEVENLABS_AGENT_LLM ?? "gemini-3.5-flash";

const CONTROL = `
CONTROL MESSAGES (sent by the app, never by the human; never mention them):
- "[ASK] <question>": ask that question now, naturally, in your own words, max 20 words. Then stop and listen.
- "[SAY] <text>": say exactly that text, nothing else.
- "[QUIET]": say nothing (use skip_turn).
Screen context arrives as contextual updates: use it to understand, never narrate it.`;

const INTERVIEWER = `You are Ada, an AI apprentice sitting next to {{expert_name}}, an experienced colleague doing real work on their screen: "{{task_title}}". You are learning their job so you can teach the next new hire.

How you behave:
- You stay quiet while they work. You only start speaking after a control message.
- When they answer your question: if the answer contains the reason, the limit or who decides, acknowledge in max 6 words ("Got it, five thousand.") and stop. If it is vague, ask ONE short follow-up about the missing reason, limit, exception or who to ask. Never more than one follow-up.
- If they speak but are not talking to you (thinking aloud, reading something out), call skip_turn.
- If they say "off the record", answer only "Okay, not recording." and stay silent until "back on the record".
- Never give advice, never judge, never explain their job to them unless told to with [SAY].
- Tone: calm, curious, respectful of a senior colleague. Brief. No excitement, no flattery.
${CONTROL}`;

const TUTOR = `You are Ada, a patient tutor coaching {{learner_name}}, a new hire, while they work on their screen. Everything you teach comes from {{expert_name}}'s confirmed Work Map below; never invent rules. If something is not covered, say "{{expert_name}} didn't cover that; ask the controller."

WORK MAP (steps, decisions, guardrails, with {{expert_name}}'s own words):
{{work_map}}

How you behave:
- Stay quiet while they work. Answer their questions briefly, using {{expert_name}}'s words ("{{expert_name}} says: ...").
- "[INTERVENE] <guardrail> | <expert quote>": they are about to break a guardrail. First ask "{{expert_name}} would stop here. Why do you think?" and listen. Then confirm or correct using the quote verbatim. Offer to show {{expert_name}}'s screen (call replay_moment with the guardrail id).
- "[PREDICT] <decision question>": ask them to predict what {{expert_name}} would decide, listen, then call grade_prediction with their answer and say the feedback in one sentence.
- Use lookup_guardrail when they ask about a rule; use get_case_facts to see the invoice they have open.
- Encouraging, concrete, max 2 sentences per turn.
${CONTROL}`;

const clientTool = (name: string, description: string, properties: Record<string, { type: string; description: string }>, required: string[]) => ({
  type: "client", name, description, expects_response: true, response_timeout_secs: 10,
  parameters: { type: "object", properties, required },
});

const agents = {
  interviewer: {
    name: "AI Apprentice · Interviewer",
    voice_id: "iP95p4xoKVk53GoZ742B", // Chris: charming, down-to-earth
    prompt: INTERVIEWER,
    first_message: "Hi {{expert_name}}, I'm Ada. Just work as usual. I'll stay quiet and only ask when you pause.",
    tools: [
      clientTool("get_recent_screen_events", "Recent actions the expert took on screen (newest last).", { limit: { type: "number", description: "max events" } }, []),
    ],
    dynamic: { expert_name: "Sabine", task_title: "Process open supplier invoices" },
  },
  tutor: {
    name: "AI Apprentice · Tutor",
    voice_id: "Xb7hH8MSUJpSbSDYk0k2", // Alice: clear, engaging educator
    prompt: TUTOR,
    first_message: "Hi {{learner_name}}, I'm Ada. Work as usual. I'll jump in if something needs {{expert_name}}'s eye.",
    tools: [
      clientTool("lookup_guardrail", "Find the guardrails in the Work Map that match a topic.", { query: { type: "string", description: "topic, e.g. capex, asset number, Brno" } }, ["query"]),
      clientTool("replay_moment", "Show the expert's screen moment for a guardrail or step in the overlay.", { id: { type: "string", description: "guardrail or step id" } }, ["id"]),
      clientTool("get_case_facts", "The facts of the invoice the new hire has open right now.", {}, []),
      clientTool("grade_prediction", "Grade the new hire's predicted decision.", { answer: { type: "string", description: "what the new hire predicted" } }, ["answer"]),
    ],
    dynamic: { learner_name: "Lena", expert_name: "Sabine", work_map: "(loaded at session start)" },
  },
};

function body(a: (typeof agents)[keyof typeof agents]) {
  return {
    name: a.name,
    tags: ["ai-apprentice"],
    conversation_config: {
      agent: {
        first_message: a.first_message,
        language: "en",
        dynamic_variables: { dynamic_variable_placeholders: a.dynamic },
        prompt: {
          prompt: a.prompt,
          llm: LLM,
          temperature: 0.4,
          tools: [...a.tools, { type: "system", name: "skip_turn", description: "Stay silent this turn (the human is thinking aloud or busy).", params: { system_tool_type: "skip_turn" } }],
        },
      },
      tts: { model_id: "eleven_v3_conversational", voice_id: a.voice_id, expressive_mode: true },
      turn: { turn_timeout: 20, turn_eagerness: "patient", silence_end_call_timeout: -1 },
      conversation: { max_duration_seconds: 3600 },
    },
    platform_settings: {
      overrides: { conversation_config_override: { agent: { first_message: true, language: true, prompt: { prompt: true } } } },
    },
  };
}

const existing = ((await (await fetch(`${EL}/agents?page_size=100`, { headers: H })).json()) as { agents: Array<{ agent_id: string; name: string }> }).agents;
const ids: Record<string, string> = {};
for (const [role, a] of Object.entries(agents)) {
  const found = existing.find((x) => x.name === a.name);
  const r = found
    ? await fetch(`${EL}/agents/${found.agent_id}`, { method: "PATCH", headers: H, body: JSON.stringify(body(a)) })
    : await fetch(`${EL}/agents/create`, { method: "POST", headers: H, body: JSON.stringify(body(a)) });
  const j = (await r.json()) as { agent_id?: string; detail?: unknown };
  if (!r.ok) {
    console.error(`${role}: ${r.status}`, JSON.stringify(j.detail ?? j).slice(0, 1500));
    process.exit(1);
  }
  ids[role] = found?.agent_id ?? j.agent_id!;
  console.log(`${found ? "updated" : "created"} ${role}: ${ids[role]}`);
}
writeFileSync(new URL("../../web/src/lib/elevenlabs.json", import.meta.url), JSON.stringify({ interviewerAgentId: ids.interviewer, tutorAgentId: ids.tutor, llm: LLM }, null, 2) + "\n");
console.log("wrote web/src/lib/elevenlabs.json");
