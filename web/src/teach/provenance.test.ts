// Provenance line on tutor cards: proves the learner's case is new and names where the rule was learned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { WorkMap } from "../../../shared/schema";
import { cardMeta, caseName, provenance, severityLabel, sourceCase } from "./provenance";

const wm = JSON.parse(readFileSync(new URL("../../../fixtures/demo-session/expected_workmap.json", import.meta.url), "utf8")) as WorkMap;
const rule = (id: string) => wm.guardrails.find((g) => g.id === id)!;

test("finds the expert's case a screen moment belongs to", () => {
  assert.equal(sourceCase(wm, rule("gr_capex_threshold").evidence.moments[0]!)?.key, "4471");
  assert.equal(sourceCase(wm, rule("gr_intercompany_approval").evidence.moments[0]!)?.key, "4473");
  assert.equal(sourceCase(wm, { sessionId: "other", t: 28050 }), undefined);
});

test("says the expert never worked the learner's case when the key is new", () => {
  assert.equal(provenance(wm, rule("gr_capex_threshold"), "4490"), "Sabine never worked this invoice. Rule learned from INV-4471 at 00:28.");
});

test("says so honestly when the learner works a case the expert recorded", () => {
  assert.equal(provenance(wm, rule("gr_capex_threshold"), "4471"), "Sabine worked this same invoice (INV-4471) while recording. Rule learned from INV-4471 at 00:28.");
});

test("without a known learner case only names the source", () => {
  assert.equal(provenance(wm, rule("gr_intercompany_approval")), "Rule learned from INV-4473 at 03:00.");
});

test("falls back to the recording time when no case covers the moment", () => {
  const g = { ...rule("gr_asset_number"), evidence: { quotes: [], moments: [{ sessionId: "x", t: 65_000, frameId: "f", eventIds: [] }] } };
  assert.equal(provenance(wm, g, "4490"), "Sabine never worked this invoice. Rule learned at 01:05 in Sabine's recording.");
});

test("no evidence, no provenance", () => {
  assert.equal(provenance(wm, { ...rule("gr_asset_number"), evidence: { quotes: [], moments: [] } }, "4490"), undefined);
});

test("card meta: only guardrail block/nudge cards get a label and provenance", () => {
  const g = rule("gr_december_hold");
  assert.deepEqual(cardMeta(wm, "block", g, "4492"), { label: "Blocked before save", provenance: "Sabine never worked this invoice. Rule learned from INV-4472 at 01:41." });
  assert.deepEqual(cardMeta(wm, "nudge", g), { label: "Heads-up", provenance: "Rule learned from INV-4472 at 01:41." });
  assert.deepEqual(cardMeta(wm, "info", g, "4492"), {});
  assert.deepEqual(cardMeta(wm, "block", undefined, "4492"), {});
});

test("case names and severity labels", () => {
  assert.equal(caseName("invoice", "4471"), "INV-4471");
  assert.equal(caseName("ticket", "T-9"), "ticket T-9");
  assert.equal(severityLabel("block"), "Blocked before save");
  assert.equal(severityLabel("nudge"), "Heads-up");
  assert.equal(severityLabel("info"), undefined);
});
