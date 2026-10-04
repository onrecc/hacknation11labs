// Mastery report: step status, chips, prediction score, which case to practice next.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CaseFacts, MasteryReport, WorkMap } from "../../../shared/schema";
import { guardrailChip, masteryRows, practiceCaseFor, predictionScore, stepStatus, type GuardrailStatus, type PracticeCase } from "./mastery";

const wm = JSON.parse(readFileSync(new URL("../../../fixtures/demo-session/expected_workmap.json", import.meta.url), "utf8")) as WorkMap;
const step = (id: string) => wm.steps.find((s) => s.id === id)!;
const rule = (id: string) => wm.guardrails.find((g) => g.id === id)!;

const facts = (key: string, o: Partial<CaseFacts["invoice"]>, supplier: CaseFacts["supplier"]): CaseFacts => ({
  invoice: { key, amount: 0, currency: "EUR", date: "2026-12-03", month: 12, category: "consumables", costCenter: "4711", assetNo: null, status: "open", approver: null, comment: "", duplicateDeliveryNote: false, ...o },
  supplier,
});
const EXT = (name: string, isNew = false) => ({ name, group: "External", isNew });
const CASES: PracticeCase[] = [
  { key: "4490", label: "Gerätebau Schmidt KG", facts: facts("4490", { amount: 7200, category: "equipment" }, EXT("Gerätebau Schmidt KG", true)) },
  { key: "4492", label: "Hofmann", facts: facts("4492", { amount: 1240, duplicateDeliveryNote: true }, EXT("Hofmann Industriebedarf")) },
  { key: "4493", label: "Würth", facts: facts("4493", { amount: 312.4 }, EXT("Würth")) },
  { key: "4494", label: "Brno", facts: facts("4494", { amount: 2400, category: "spare_parts" }, { name: "Brno Precision s.r.o.", group: "Intercompany CZ", isNew: false }) },
];
const none = (): GuardrailStatus => "not_triggered";
const wurthSaved = [{ ...CASES[2]!.facts, invoice: { ...CASES[2]!.facts.invoice, status: "coded" } }];

test("a step with rules is not mastered after an unrelated save", () => {
  assert.equal(stepStatus(step("st_code"), none, wurthSaved), "not_seen");
});

test("a step with rules is mastered once one of them was met and followed", () => {
  assert.equal(stepStatus(step("st_code"), (id) => (id === "gr_capex_threshold" ? "respected" : "not_triggered"), wurthSaved), "mastered");
});

test("a caught rule makes its step assisted", () => {
  assert.equal(stepStatus(step("st_decide"), (id) => (id === "gr_intercompany_approval" ? "caught_by_tutor" : "respected"), wurthSaved), "assisted");
});

test("a step without rules: any save counts, unless `when` excludes it", () => {
  assert.equal(stepStatus(step("st_open"), none, wurthSaved), "mastered");
  assert.equal(stepStatus(step("st_open"), none, []), "not_seen");
  assert.equal(stepStatus({ guardrailIds: [], when: { op: "eq", field: "invoice.costCenter", value: "0400" } }, none, wurthSaved), "not_seen");
});

test("chips carry text, not only colour", () => {
  assert.deepEqual(guardrailChip("respected"), { icon: "✓", text: "Followed", tone: "ok" });
  assert.deepEqual(guardrailChip("caught_by_tutor"), { icon: "⚠", text: "Caught before save", tone: "warn" });
  assert.deepEqual(guardrailChip("not_triggered"), { icon: "–", text: "Not practised", tone: "idle" });
});

test("prediction score", () => {
  assert.equal(predictionScore({ asked: 3, correct: 2 }), "2 of 3 correct (67%)");
  assert.equal(predictionScore({ asked: 0, correct: 0 }), "No predictions asked");
});

test("practice case: retry where it was caught, else the first case that would break the rule", () => {
  assert.equal(practiceCaseFor(rule("gr_asset_number"), CASES, "4490")?.key, "4490");
  assert.equal(practiceCaseFor(rule("gr_december_hold"), CASES)?.key, "4492");
  assert.equal(practiceCaseFor(rule("gr_intercompany_approval"), CASES)?.key, "4494");
  assert.equal(practiceCaseFor(rule("gr_asset_number"), CASES), undefined);
});

test("rows: rules that need practice first, followed rules last without a practice case", () => {
  const report: MasteryReport = {
    sessionId: "s", workMapId: wm.id, learner: wm.expert, perStep: [], predictions: { asked: 0, correct: 0 }, practiceNext: [],
    perGuardrail: [
      { guardrailId: "gr_capex_threshold", status: "respected" },
      { guardrailId: "gr_asset_number", status: "caught_by_tutor" },
      { guardrailId: "gr_december_hold", status: "not_triggered" },
      { guardrailId: "gr_intercompany_approval", status: "not_triggered" },
    ],
  };
  const rows = masteryRows(report, wm, CASES, new Map([["gr_asset_number", "4490"]]));
  assert.deepEqual(rows.map((r) => [r.guardrailId, r.chip.text, r.practice?.key]), [
    ["gr_asset_number", "Caught before save", "4490"],
    ["gr_december_hold", "Not practised", "4492"],
    ["gr_intercompany_approval", "Not practised", "4494"],
    ["gr_capex_threshold", "Followed", undefined],
  ]);
});
