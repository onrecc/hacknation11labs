// Mirrors scripts/eval_guardrails.py: Teach's T1–T4 against the fixture's expected Work Map.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CaseFacts, WorkMap } from "./schema";
import { violations } from "./conditions";

const wm = JSON.parse(readFileSync(new URL("../fixtures/demo-session/expected_workmap.json", import.meta.url), "utf8")) as WorkMap;

const inv = (o: Partial<CaseFacts["invoice"]>): CaseFacts["invoice"] => ({
  key: "", amount: 0, currency: "EUR", date: "2026-12-04", month: 12, category: "consumables", costCenter: "4711",
  assetNo: null, status: "open", approver: null, comment: "", duplicateDeliveryNote: false, ...o,
});
const sup = (name: string, group = "External", isNew = false) => ({ name, group, isNew });
const ids = (f: CaseFacts) => violations(wm, f).map((g) => g.id).sort();

const cases: Array<[string, CaseFacts, string[]]> = [
  ["T1a opex on 7,200 equipment", { invoice: inv({ amount: 7200, category: "equipment" }), supplier: sup("Gerätebau Schmidt KG", "External", true) }, ["gr_capex_threshold"]],
  ["T1b capex without asset", { invoice: inv({ amount: 7200, category: "equipment", costCenter: "0400" }), supplier: sup("Gerätebau Schmidt KG", "External", true) }, ["gr_asset_number"]],
  ["T1c capex + asset", { invoice: inv({ amount: 7200, category: "equipment", costCenter: "0400", assetNo: "AN-2026-131" }), supplier: sup("Gerätebau Schmidt KG", "External", true) }, []],
  ["T2a Brno approved on opex", { invoice: inv({ amount: 9800, category: "equipment", status: "approved" }), supplier: sup("Brno Precision s.r.o.", "Intercompany CZ") }, ["gr_capex_threshold", "gr_intercompany_approval"]],
  ["T2b Brno correct", { invoice: inv({ amount: 9800, category: "equipment", costCenter: "0400", assetNo: "AN-1", status: "awaiting_approval", approver: "M. Weber (Controlling)" }), supplier: sup("Brno Precision s.r.o.", "Intercompany CZ") }, []],
  ["T3a Hofmann dup approved", { invoice: inv({ amount: 1240, status: "approved", duplicateDeliveryNote: true }), supplier: sup("Hofmann Industriebedarf") }, ["gr_december_hold"]],
  ["T3b Hofmann dup on hold", { invoice: inv({ amount: 1240, status: "on_hold", duplicateDeliveryNote: true }), supplier: sup("Hofmann Industriebedarf") }, []],
  ["T4 Würth consumables", { invoice: inv({ amount: 312.4, status: "coded" }), supplier: sup("Würth") }, []],
];

for (const [name, facts, expected] of cases) {
  test(name, () => assert.deepEqual(ids(facts), expected.sort()));
}
