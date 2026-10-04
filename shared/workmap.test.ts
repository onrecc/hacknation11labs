// Map core against the fixture: a perfect proposal must reproduce the oracle, and the verifier must catch bad ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Event, Session, WorkMap } from "./schema";
import { LogIndex } from "./logindex";
import { applyClaimPatch, assemble, buildDraft, findVerbatim, proposalFromWorkMap, stableId, verbatimQuote } from "./workmap";

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

test("verifier rejects unknown guardrail operators, also nested in and/or/not", () => {
  const p = proposalFromWorkMap(oracle, corrections, ix);
  p.guardrails[1].conditionJson = JSON.stringify({ op: "and", all: [{ op: "not", c: { op: "greater", field: "invoice.amount", value: 3 } }] });
  const { workmap, problems } = build(p, null);
  const asset = workmap.guardrails.find((g) => g.id === "gr_asset_number")!;
  assert.equal(asset.condition, undefined, "unknown op → no condition that silently never fires");
  assert.equal(asset.severity, "warn", "un-checkable rule can't block");
  assert.ok(JSON.stringify(problems).includes("unknown operator greater"), JSON.stringify(problems));
});

test("ids survive a rebuild when the LLM reuses existing ids", () => {
  const first = build().workmap;
  const again = build(proposalFromWorkMap(first, corrections, ix), first).workmap;
  assert.deepEqual(again.steps.map((s) => s.id), first.steps.map((s) => s.id));
  assert.deepEqual(again.guardrails.map((g) => g.id), first.guardrails.map((g) => g.id));
});

// ── teach-back corrections rewrite the claim (code verifies the LLM's patch like an extraction)
const GR = "gr_intercompany_approval";
const NEW = "Brno invoices always need the controller, Weber, as second approver, whatever the amount.";
const QUOTE = [{ utteranceId: "utt_0004", quote: "no asset number, no capex booking" }];
const statementOf = (wm: WorkMap, id: string) => wm.guardrails.find((g) => g.id === id)!.statement;

test("applyClaimPatch rewrites the claim text from a verified correction, without mutating the input", () => {
  const before = statementOf(oracle, GR);
  const r = applyClaimPatch(oracle, { patches: [{ id: GR, field: "statement", value: NEW }, { id: GR, field: "escalateToName", value: "Weber" }], quotes: QUOTE }, ix, [GR]);
  assert.deepEqual(r.problems, []);
  const g = r.workmap.guardrails.find((x) => x.id === GR)!;
  assert.equal(g.statement, NEW);
  assert.equal(g.escalateTo?.name, "Weber");
  assert.equal(statementOf(oracle, GR), before, "input not mutated");
  assert.equal(r.changes.length, 1);
  assert.deepEqual(r.changes[0].ref, { kind: "guardrail", id: GR });
  assert.ok(r.changes[0].before.includes(before) && r.changes[0].after.includes(NEW));
  assert.equal(r.quote?.text, "no asset number, no capex booking");
});

test("applyClaimPatch drops unverifiable parts: invented quotes, unknown fields, foreign claims", () => {
  const none = applyClaimPatch(oracle, { patches: [{ id: GR, field: "statement", value: NEW }], quotes: [{ utteranceId: "utt_0004", quote: "Weber signs everything." }] }, ix, [GR]);
  assert.equal(none.changes.length, 0, "no verbatim quote → nothing changes");
  assert.equal(statementOf(none.workmap, GR), statementOf(oracle, GR));
  assert.ok(none.problems.length >= 1);

  const some = applyClaimPatch(oracle, {
    patches: [
      { id: GR, field: "statement", value: NEW },
      { id: GR, field: "conditionJson", value: JSON.stringify({ op: "eq", field: "invoice.vibes", value: 1 }) },
      { id: GR, field: "severity", value: "info" },
      { id: "gr_capex_threshold", field: "statement", value: "Everything is capex." },
    ],
    quotes: QUOTE,
  }, ix, [GR]);
  const g = some.workmap.guardrails.find((x) => x.id === GR)!;
  assert.equal(g.statement, NEW);
  assert.deepEqual(g.condition, oracle.guardrails.find((x) => x.id === GR)!.condition, "condition on an unknown field is dropped");
  assert.equal(g.severity, oracle.guardrails.find((x) => x.id === GR)!.severity, "fields outside the patchable set are dropped");
  assert.equal(statementOf(some.workmap, "gr_capex_threshold"), statementOf(oracle, "gr_capex_threshold"), "claims outside the segment are untouched");
  assert.equal(some.problems.length, 3);
});

test("a patched claim survives the replay: new text, old text in history, teach-back provenance", () => {
  const before = statementOf(oracle, GR);
  const { workmap: patched, changes } = applyClaimPatch(oracle, { patches: [{ id: GR, field: "statement", value: NEW }], quotes: QUOTE }, ix, [GR]);
  const last = events.at(-1)!;
  const corr = {
    id: "evt_tbfix", sessionId: session.id, seq: last.seq + 1, t: last.t + 1000, wall: last.wall, phase: "teachback", type: "knowledge.correction", source: "map",
    payload: { correctionId: "cor_x", detectedBy: "teachback", kind: "statement_revised", utteranceIds: ["utt_0004"], quote: QUOTE[0].quote, targets: { workMapRefs: [changes[0].ref] }, before: changes[0].before, after: changes[0].after, appliesTo: "always", confidence: 0.85 },
  } as Event;
  const all = [...events, corr];
  const ix2 = new LogIndex(session.id, all);
  const { workmap } = assemble(buildDraft(session, all, oracle.id), proposalFromWorkMap(patched, ix2.ofType("knowledge.correction"), ix2), ix2, { prev: patched });
  const g = workmap.guardrails.find((x) => x.id === GR)!;
  assert.equal(g.statement, NEW);
  const h = g.history.find((x) => x.correctionEventId === "evt_tbfix");
  assert.ok(h && h.before.includes(before) && h.after.includes(NEW), JSON.stringify(g.history));
  assert.ok(g.provenance.includes("teachback_correction"));
});
