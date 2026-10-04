/**
 * Smoke test: every LLM task against the real provider with fixture-based inputs.
 *   npm run smoke -w tools [-- task1 task2]
 */
import { readFileSync } from "node:fs";
import type { Event, Session, WorkMap } from "../../shared/schema";
import { LogIndex } from "../../shared/logindex";
import { condenseLog, buildDraft, assemble } from "../../shared/workmap";
import { FACT_PATHS, type LlmTask } from "../../shared/llm";
import { runLlm } from "../../functions/src/handlers";

const dir = new URL("../../fixtures/demo-session/", import.meta.url);
const session = JSON.parse(readFileSync(new URL("session.json", dir), "utf8")) as Session;
const events = readFileSync(new URL("events.jsonl", dir), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Event);
const wm = JSON.parse(readFileSync(new URL("expected_workmap.json", dir), "utf8")) as WorkMap;
const ix = new LogIndex(session.id, events.filter((e) => e.phase === "capture"));
const actions = ix.ofType("screen.action");
const frame = readFileSync(new URL("../../web/public/smoke-frame.png", import.meta.url), { encoding: "base64" });

const cases: { [K in LlmTask]?: () => Promise<unknown> } = {
  vision: () => runLlm("vision", { frameBase64: frame, mediaType: "image/png", recentActions: [actions[1].payload.description] }),
  pick_question: () => runLlm("pick_question", {
    recentActions: actions.slice(0, 4).map((a) => ({ id: a.id, t: a.t, description: a.payload.description })),
    recentUtterances: [], askedQuestions: [], liveBudgetLeft: 4,
  }),
  detect_correction: () => {
    const u = ix.ofType("utterance").find((x) => x.payload.text.includes("five thousand"))!;
    return runLlm("detect_correction", { utterance: { id: u.payload.utteranceId, text: u.payload.text }, recentUtterances: [], recentActions: actions.slice(0, 3).map((a) => ({ id: a.id, description: a.payload.description })) });
  },
  link_answer: () => runLlm("link_answer", { question: "You put it on hold rather than rejecting it. What has to happen before it can be released?", utterances: ix.ofType("utterance").filter((u) => u.payload.text.startsWith("Hofmann double")).map((u) => ({ id: u.payload.utteranceId, text: u.payload.text })) }),
  label_task: async () => {
    const acts = [
      "Opened invoice INV-4471 (Krauss Maschinenteile GmbH, 7,850.00 EUR, equipment)",
      "Set costCenter on INV-4471: \"4711\" -> \"0400\"",
      "Saved INV-4471: status open -> coded",
      "Opened invoice INV-4472 (Hofmann Industriebedarf, 1,240.00 EUR, consumables)",
      "Saved INV-4472: status open -> on_hold",
      "Opened \"ProcureX · Purchase request\" (localhost/demo/procurex.html)",
      "Set \"GL account\" from \"6100 · Opex maintenance\" to \"0400 · Capex machinery\" on \"ProcureX · Purchase request\"",
      "Clicked \"Submit for approval\" on \"ProcureX · Purchase request\"",
    ].map((d, i) => ({ id: `a${i}`, t: i * 20000, description: d }));
    const first = await runLlm("label_task", { currentTitle: "", app: "MiniERP", department: "accounts_payable", actions: acts.slice(0, 5), utterances: ["Hofmann. December. Of course."], knownTasks: [] });
    const switched = await runLlm("label_task", { currentTitle: first.title, app: "ProcureX", department: "accounts_payable", actions: acts, utterances: [], knownTasks: [first.title] });
    return { first, switched };
  },
  check_guardrails: () => runLlm("check_guardrails", {
    guardrails: wm.guardrails.map((g) => ({ id: g.id, statement: g.statement, requiredAction: g.requiredAction, scope: g.scope })),
    page: { url: "https://erp.example/invoices/4490", title: "Invoice 4490" },
    fields: { Supplier: "Gerätebau Schmidt KG", Amount: "7,200.00 EUR", Category: "equipment", "Cost center": "4711 Opex", "Asset no.": "" },
    action: "click Approve",
  }),
  grade_prediction: () => runLlm("grade_prediction", { question: "What cost center for a 7,200 EUR equipment invoice?", expected: "0400 capex", reason: "Equipment over 5,000 EUR is always capex", answer: "I'd book it to capex because it's machinery over five grand" }),
  tutor_explain: () => runLlm("tutor_explain", { expertName: "Sabine", guardrail: wm.guardrails[0], quote: "Equipment over five thousand euros is always capex.", facts: { invoice: { key: "4490", amount: 7200, currency: "EUR", date: "2026-12-02", month: 12, category: "equipment", costCenter: "4711", assetNo: null, status: "open", approver: null, comment: "", duplicateDeliveryNote: false }, supplier: { name: "Gerätebau Schmidt KG", group: "External", isNew: true } }, socratic: false }),
  extract_workmap: async () => {
    const full = new LogIndex(session.id, events);
    const p = await runLlm("extract_workmap", { log: condenseLog(full), factPaths: [...FACT_PATHS] });
    const { workmap, problems } = assemble(buildDraft(session, events), p, full);
    return { steps: workmap.steps.map((s) => s.title), decisions: workmap.decisions.length, guardrails: workmap.guardrails.map((g) => `${g.statement} [${g.condition ? "checkable" : "no condition"}]`), problems };
  },
};

const only = process.argv.slice(2) as LlmTask[];
for (const [task, run] of Object.entries(cases) as [LlmTask, () => Promise<unknown>][]) {
  if (only.length && !only.includes(task)) continue;
  const t0 = Date.now();
  try {
    const out = await run();
    console.log(`✔ ${task} ${Date.now() - t0}ms\n${JSON.stringify(out).slice(0, 700)}\n`);
  } catch (e) {
    console.log(`✖ ${task} ${Date.now() - t0}ms ${(e as Error).message}\n`);
  }
}
