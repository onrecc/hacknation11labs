/** cd web && node --import tsx --test src/capture/questionTarget.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTarget, questionTarget } from "./questionTarget";

const scores = (screenAlreadyAnswers: number, guardrailValue = 0.2, infoGain = 0.7) => ({ infoGain, screenAlreadyAnswers, guardrailValue });

test("live guardrail question: names the guardrail and how little the screen explains", () => {
  const t = questionTarget({ category: "guardrail_limit", scores: scores(0.1, 0.9), rejectedCandidates: [] });
  const d = describeTarget(t);
  assert.equal(d.target, "A guardrail: a limit Ada must enforce later");
  assert.equal(d.whyNotScreen, "The screen explains 10% of it (Ada only asks below 50%); rule value 90%.");
  assert.deepEqual(d.alsoConsidered, []);
});

test("live why question targets the reasoning behind a step", () => {
  const d = describeTarget(questionTarget({ category: "why", scores: scores(0.3), rejectedCandidates: [] }));
  assert.equal(d.target, "The reasoning behind a step (Why)");
  assert.match(d.whyNotScreen, /^The screen explains 30%/);
});

test("exceptions and stop/never rules are named", () => {
  assert.match(describeTarget(questionTarget({ category: "exception", scores: scores(0.2), rejectedCandidates: [] })).target, /^An exception/);
  assert.match(describeTarget(questionTarget({ category: "never_do", scores: scores(0.2), rejectedCandidates: [] })).target, /^A guardrail/);
  assert.match(describeTarget(questionTarget({ category: "stop_and_ask", scores: scores(0.2), rejectedCandidates: [] })).target, /^A guardrail/);
});

test("rejected candidates are listed with their reason", () => {
  const t = questionTarget({ category: "why", scores: scores(0.2), rejectedCandidates: [{ text: "Why on hold?", category: "why", reason: "comment already says it" }] });
  assert.deepEqual(describeTarget(t).alsoConsidered, ["“Why on hold?”: comment already says it"]);
});

test("debrief question points at the gap it closes, without invented scores", () => {
  const t = questionTarget({ category: "exception", gapId: "gap_1", scores: scores(0, 0, 0), rejectedCandidates: [] });
  assert.equal(t.kind, "gap");
  assert.equal(t.scored, false);
  const d = describeTarget(t);
  assert.equal(d.target, "A gap in the Work Map (Exception)");
  assert.equal(d.whyNotScreen, "Your screen and answers so far left this open.");
});

test("scripted question without a gap says only the person can confirm it", () => {
  const t = questionTarget({ category: "why", scores: scores(0, 0, 0), rejectedCandidates: [], scored: false });
  assert.equal(describeTarget(t).whyNotScreen, "Not something a screen shows: only you can confirm it.");
});
