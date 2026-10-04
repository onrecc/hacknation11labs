/**
 * What the expert actually waits for: control message sent → FIRST AUDIO from Ada, per ElevenAgents setting.
 * Runs on a temporary copy of the interviewer agent (the live agents are never touched) and deletes it after.
 *   npx tsx --env-file=../.env.local src/agent-latency.ts          (from tools/)
 */
import ids from "../../web/src/lib/elevenlabs.json" with { type: "json" };

const KEY = process.env.ELEVENLABS_API_KEY!;
const EL = "https://api.elevenlabs.io/v1/convai";
const H = { "xi-api-key": KEY, "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Cfg = Record<string, any>;
// "lean" = no get_recent_screen_events tool (screen events already arrive as contextual updates) and [ASK] spoken as
// written: no tool round trip and no second LLM call before Ada speaks
const LEAN_ASK = `- "[ASK] <question>": say that question right away, as written (you may smooth the wording, max 20 words). Never call a tool first. Then stop and listen.`;
const VARIANTS: Array<{ name: string; tts?: Cfg; lean?: boolean }> = (process.env.VARIANTS ? JSON.parse(process.env.VARIANTS) : null) ?? [
  { name: "v3 conversational 44.1k, screen tool", tts: { agent_output_audio_format: "pcm_44100" } },
  { name: "v3 conversational 44.1k, lean", tts: { agent_output_audio_format: "pcm_44100" }, lean: true },
  { name: "flash v2 44.1k, lean", tts: { model_id: "eleven_flash_v2", expressive_mode: false, agent_output_audio_format: "pcm_44100" }, lean: true },
  { name: "turbo v2 44.1k, lean", tts: { model_id: "eleven_turbo_v2", expressive_mode: false, agent_output_audio_format: "pcm_44100" }, lean: true },
];
const STEPS = [
  { label: "[ASK]", text: "[ASK] Why did you click Refresh Version and then Publish so many times after the Play for Work apps?" },
  { label: "[SAY]", text: "[SAY] Thanks, that was really helpful. I have a few things I couldn't work out from the screen." },
  { label: "answer→ack", text: "Because the new version only shows up for the devices after a refresh, so I always refresh first and then publish." },
];
const TRIALS = Number(process.env.TRIALS ?? 3);
const TOOL_RESULT = 'Clicked "Refresh Version" then "Publish" on Scalefusion';

/** fetch with retries: a transient network error must not leave the temp agent behind */
async function fetchRetry(url: string, init?: RequestInit): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (i >= 3) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

const base = (await (await fetchRetry(`${EL}/agents/${ids.interviewerAgentId}`, { headers: H })).json()) as Cfg;
delete base.conversation_config.agent.prompt.tool_ids; // the API returns both tools and their ids, but accepts only one
const created = await fetchRetry(`${EL}/agents/create`, {
  method: "POST", headers: H,
  body: JSON.stringify({ name: "AI Apprentice · latency test (temp)", tags: ["temp"], conversation_config: base.conversation_config }),
});
const { agent_id: tmp } = (await created.json()) as { agent_id: string };
if (!created.ok || !tmp) throw new Error(`could not create temp agent: ${created.status}`);
console.log(`temp agent ${tmp} (deleted at the end)`);

type Result = Record<string, { firstAudio: number; tools: number }>;

async function trial(): Promise<Result> {
  const { signed_url } = (await (await fetchRetry(`${EL}/conversation/get-signed-url?agent_id=${tmp}`, { headers: H })).json()) as { signed_url: string };
  const ws = new WebSocket(signed_url);
  await new Promise<void>((res, rej) => ((ws.onopen = () => res()), (ws.onerror = (e) => rej(e))));
  let lastAudio = 0, firstAudio = 0, ready = false, toolCalls = 0;
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as Cfg;
    if (m.type === "ping") ws.send(JSON.stringify({ type: "pong", event_id: m.ping_event.event_id }));
    else if (m.type === "conversation_initiation_metadata") ready = true;
    else if (m.type === "audio") {
      lastAudio = performance.now();
      firstAudio ||= lastAudio;
    } else if (m.type === "client_tool_call") {
      toolCalls++; // answered instantly, like the hub does
      ws.send(JSON.stringify({ type: "client_tool_result", tool_call_id: m.client_tool_call.tool_call_id, result: TOOL_RESULT, is_error: false }));
    }
  };
  ws.send(JSON.stringify({ type: "conversation_initiation_client_data", dynamic_variables: { expert_name: "Sabine", task_title: "Publish and refresh app versions" } }));
  for (let i = 0; i < 50 && !ready; i++) await sleep(100);
  const out: Result = {};
  for (const s of STEPS) {
    firstAudio = toolCalls = 0;
    const t0 = performance.now();
    ws.send(JSON.stringify({ type: "user_message", text: s.text }));
    for (let i = 0; i < 150 && !firstAudio; i++) await sleep(100); // up to 15 s
    // let the turn finish (no audio for 1.5 s) before the next step
    for (let i = 0; i < 300 && (performance.now() - lastAudio < 1500 || !firstAudio); i++) await sleep(100);
    out[s.label] = { firstAudio: firstAudio ? Math.round(firstAudio - t0) : NaN, tools: toolCalls };
  }
  ws.close();
  return out;
}

const median = (xs: number[]) => {
  const ok = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return ok.length ? ok[Math.floor(ok.length / 2)] : NaN;
};

try {
  for (const v of VARIANTS) {
    const cc = structuredClone(base.conversation_config);
    Object.assign(cc.tts, v.tts ?? {});
    if (v.lean) {
      cc.agent.prompt.tools = cc.agent.prompt.tools.filter((t: Cfg) => t.name !== "get_recent_screen_events");
      cc.agent.prompt.prompt = cc.agent.prompt.prompt.replace(/- "\[ASK\] <question>":[^\n]*/, LEAN_ASK);
    }
    const r = await fetchRetry(`${EL}/agents/${tmp}`, { method: "PATCH", headers: H, body: JSON.stringify({ conversation_config: cc }) });
    if (!r.ok) {
      console.log(`${v.name}: config rejected ${r.status} ${(await r.text()).slice(0, 200)}`);
      continue;
    }
    const runs: Result[] = [];
    for (let i = 0; i < TRIALS; i++) runs.push(await trial());
    const cells = STEPS.map((s) => {
      const tools = runs.map((x) => x[s.label].tools);
      return `${s.label} ${(median(runs.map((x) => x[s.label].firstAudio)) / 1000).toFixed(2)}s${tools.some(Boolean) ? ` (tool calls ${tools.join("/")})` : ""}`;
    });
    console.log(`${v.name.padEnd(38)} first audio, median of ${TRIALS}: ${cells.join(" · ")}`);
  }
} finally {
  await fetchRetry(`${EL}/agents/${tmp}`, { method: "DELETE", headers: H });
  console.log(`deleted temp agent ${tmp}`);
}
