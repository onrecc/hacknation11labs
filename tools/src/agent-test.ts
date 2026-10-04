/**
 * Talks to the two ElevenAgents over their WebSocket API (no mic needed) and checks the control protocol:
 *   npm run agent-test -w tools
 * Sends user messages as text and prints what the agent says (agent_response) and which client tools it calls.
 */
import { readFileSync } from "node:fs";
import type { WorkMap } from "../../shared/schema";

const KEY = process.env.ELEVENLABS_API_KEY!;
const ids = JSON.parse(readFileSync(new URL("../../web/src/lib/elevenlabs.json", import.meta.url), "utf8")) as { interviewerAgentId: string; tutorAgentId: string };
const wm = JSON.parse(readFileSync(new URL("../../fixtures/demo-session/expected_workmap.json", import.meta.url), "utf8")) as WorkMap;

async function converse(agentId: string, dynamic: Record<string, string>, steps: Array<{ send?: string; context?: string; waitMs: number }>, toolResults: Record<string, (p: Record<string, unknown>) => string>) {
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`, { headers: { "xi-api-key": KEY } });
  const { signed_url } = (await r.json()) as { signed_url: string };
  const ws = new WebSocket(signed_url);
  const log: string[] = [];
  let sentAt = 0; // latency = user message sent → first agent response (what the expert waits for)
  await new Promise<void>((res, rej) => ((ws.onopen = () => res()), (ws.onerror = (e) => rej(e))));
  ws.send(JSON.stringify({ type: "conversation_initiation_client_data", dynamic_variables: dynamic }));
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as Record<string, any>;
    if (m.type === "ping") ws.send(JSON.stringify({ type: "pong", event_id: m.ping_event.event_id }));
    else if (m.type === "agent_response") {
      log.push(`  AGENT${sentAt ? ` (+${((Date.now() - sentAt) / 1000).toFixed(1)}s)` : ""}: ${m.agent_response_event.agent_response}`);
      sentAt = 0;
    }
    else if (m.type === "client_tool_call") {
      const c = m.client_tool_call;
      const out = toolResults[c.tool_name]?.(c.parameters) ?? "ok";
      log.push(`  TOOL ${c.tool_name}(${JSON.stringify(c.parameters)}) → ${out.slice(0, 80)}`);
      ws.send(JSON.stringify({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: out, is_error: false }));
    } else if (m.type === "agent_tool_response") log.push(`  (system tool ${m.agent_tool_response?.tool_name})`);
  };
  for (const s of steps) {
    if (s.context) ws.send(JSON.stringify({ type: "contextual_update", text: s.context }));
    if (s.send) {
      log.push(`USER: ${s.send}`);
      sentAt = Date.now();
      ws.send(JSON.stringify({ type: "user_message", text: s.send }));
    }
    await new Promise((r2) => setTimeout(r2, s.waitMs));
  }
  ws.close();
  return log.join("\n");
}

console.log("── Interviewer ──");
console.log(await converse(ids.interviewerAgentId, { expert_name: "Sabine", task_title: "Process open supplier invoices" }, [
  { send: "[SAY] Hi Sabine, I'm Ada. Work as usual; I'll only ask when you pause.", waitMs: 6000 }, // the hub greets once (no first_message)
  { context: "[screen t=27s] Re-coded INV-4471 cost center 4711 (Opex) -> 0400 (Capex)", waitMs: 1500 },
  { send: "Hmm, Krauss, the spindle again.", waitMs: 6000 }, // thinking aloud: should stay quiet (skip_turn)
  { send: "[ASK] You changed the cost center from 4711 to 0400. What made you do that?", waitMs: 8000 },
  { send: "Equipment over five thousand euros is always capex. And no asset number, no capex booking.", waitMs: 8000 },
  { send: "[SAY] Thanks, that was really helpful.", waitMs: 6000 },
], { get_recent_screen_events: () => "Re-coded INV-4471 cost center 4711 -> 0400" }));

console.log("\n── Tutor ──");
const { workMapForPrompt } = await import("../../web/src/teach/tutor-prompt");
console.log(await converse(ids.tutorAgentId, { learner_name: "Lena", expert_name: "Sabine", work_map: workMapForPrompt(wm) }, [
  { waitMs: 6000 },
  { send: "[INTERVENE] Equipment over 5,000 EUR is always capex (cost center 0400). | Equipment over five thousand euros is always capex.", waitMs: 9000 },
  { send: "Because it's a big machine purchase?", waitMs: 9000 },
  { send: "Who do I ask if a capex invoice has no asset number?", waitMs: 9000 },
], {
  replay_moment: () => "Showing it in the overlay now.",
  lookup_guardrail: () => wm.guardrails.map((g) => `[${g.id}] ${g.statement}`).join("\n"),
  get_case_facts: () => JSON.stringify({ invoice: { key: "4490", amount: 7200, category: "equipment", costCenter: "4711" } }),
  grade_prediction: () => "Correct: Sabine would code it to capex.",
}));
