// Map core against the fixture: a perfect proposal must reproduce the oracle, and the verifier must catch bad ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Event, Session, WorkMap } from "./schema";
import { LogIndex } from "./logindex";
import { assemble, buildDraft, findVerbatim, proposalFromWorkMap, stableId, verbatimQuote } from "./workmap";

const dir = new URL("../fixtures/demo-session/", import.meta.url);
const session = JSON.parse(readFileSync(new URL("session.json", dir), "utf8")) as Session;
const events = readFileSync(new URL("events.jsonl", dir), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Event);
const oracle = JSON.parse(readFileSync(new URL("expected_workmap.json", dir), "utf8")) as WorkMap;
const ix = new LogIndex(session.id, events);
const corrections = ix.ofType("knowledge.correction");

function build(proposal = proposalFromWorkMap(oracle, corrections, ix), prev: WorkMap | null = oracle) {
  return assemble(buildDraft(session, events, oracle.id), proposal, ix, { prev });
}

test("findVerbatim: exact, punctuation/case-insensitive, and misses", () => {
  const hay = "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand.";
  assert.equal(findVerbatim(hay, "No, wait, sorry, five thousand."), "No, wait, sorry, five thousand.");
  assert.equal(findVerbatim(hay, "no wait sorry five thousand"), "No, wait, sorry, five thousand.");
  assert.equal(findVerbatim(hay, "five thousand euros is capex"), null);
  assert.equal(findVerbatim(hay, ""), null);
});

test("verbatimQuote: word-accurate timing (oracle values)", () => {
  const q = verbatimQuote(ix, ["utt_0003"], "no wait, sorry, five thousand");
  assert.ok(q);
  assert.equal(q.text, "No, wait, sorry, five thousand.");
  assert.equal(q.t, 51994);
  assert.equal(q.tEnd, 53803);
  const full = verbatimQuote(ix, ["utt_0003"], "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand.");
  assert.equal(full?.t, 48938);
});

test("stableId keeps existing ids and prefixes new keys", () => {
  assert.equal(stableId("dec", "dec_capex"), "dec_capex");
  assert.equal(stableId("gr", "Capex threshold!"), "gr_capex_threshold");
  assert.equal(stableId("st", "st_code"), "st_code");
});

test("perfect proposal reproduces the oracle's structure", () => {
  const { workmap, problems } = build();
  assert.deepEqual(problems, []);
  assert.deepEqual(workmap.steps.map((s) => s.id), oracle.steps.map((s) => s.id));
  assert.deepEqual(workmap.decisions.map((d) => d.id), oracle.decisions.map((d) => d.id));
  assert.deepEqual(workmap.guardrails.map((g) => g.id), oracle.guardrails.map((g) => g.id));
  for (const g of oracle.guardrails) {
    const got = workmap.guardrails.find((x) => x.id === g.id)!;
    assert.deepEqual(got.condition, g.condition, g.id);
    assert.deepEqual(got.evidence.quotes.map((q) => q.text), g.evidence.quotes.map((q) => q.text), g.id);
    assert.deepEqual(got.history.map((h) => h.correctionEventId).sort(), g.history.map((h) => h.correctionEventId).sort(), g.id);
    assert.equal(got.severity, g.severity);
  }
  for (const s of oracle.steps) {
    const got = workmap.steps.find((x) => x.id === s.id)!;
    assert.equal(got.screenMoment.frameId === s.screenMoment.frameId || s.id === "st_review" || s.id === "st_history", true, `${s.id} frame ${got.screenMoment.frameId} vs ${s.screenMoment.frameId}`);
    assert.deepEqual(got.when, s.when, `${s.id} when`);
  }
  assert.equal(workmap.commonMistakes.length, 1);
  assert.deepEqual(workmap.commonMistakes[0].relatedIds, oracle.commonMistakes[0].relatedIds);
  assert.equal(workmap.stats.guardrails, 4);
  assert.equal(workmap.steps.every((s) => s.confirmedByExpert), true);
});

test("assembled Work Map passes validate_bundle.py and eval_guardrails.py", () => {
  const { workmap } = build();
  const out = join(mkdtempSync(join(tmpdir(), "wm-")), "workmap.json");
  writeFileSync(out, JSON.stringify(workmap, null, 1));
  const root = new URL("..", import.meta.url).pathname;
  const v = execFileSync("python3", ["scripts/validate_bundle.py", "fixtures/demo-session", "--part", "map", "--workmap", out], { cwd: root, encoding: "utf8" });
  assert.match(v, / 0 errors · 0 warnings/);
  const g = execFileSync("python3", ["scripts/eval_guardrails.py", out], { cwd: root, encoding: "utf8" });
  assert.doesNotMatch(g, /FAIL/);
});

test("verifier drops invented quotes, unknown fields and unknown actions", () => {
  const p = proposalFromWorkMap(oracle, corrections, ix);
  p.guardrails[0].quotes = [{ utteranceId: "utt_0003", quote: "Everything over a million is capex." }];
  p.guardrails[1].conditionJson = JSON.stringify({ op: "gt", field: "invoice.vibes", value: 3 });
  p.decisions[0].reasonQuote = "I just felt like it.";
  p.steps[0].actionIds = ["evt_nope"];
  p.steps[0].momentActionId = "evt_nope";
  const { workmap, problems } = build(p, null);
  assert.equal(workmap.guardrails.some((g) => g.id === "gr_capex_threshold"), false, "invented quote → guardrail dropped");
  const asset = workmap.guardrails.find((g) => g.id === "gr_asset_number")!;
  assert.equal(asset.condition, undefined);
  assert.equal(asset.severity, "warn", "un-checkable rule can't block");
  assert.equal(workmap.decisions.some((d) => d.id === "dec_capex"), false);
  assert.equal(workmap.steps.some((s) => s.id === "st_open"), false, "step without a moment is dropped");
  assert.ok(problems.length >= 4);
  assert.equal(workmap.steps.some((s) => s.confirmedByExpert), false, "no teach-back yet → nothing confirmed");
});

test("ids survive a rebuild when the LLM reuses existing ids", () => {
  const first = build().workmap;
  const again = build(proposalFromWorkMap(first, corrections, ix), first).workmap;
  assert.deepEqual(again.steps.map((s) => s.id), first.steps.map((s) => s.id));
  assert.deepEqual(again.guardrails.map((g) => g.id), first.guardrails.map((g) => g.id));
});
