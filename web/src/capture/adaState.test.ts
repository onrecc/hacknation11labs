/** cd web && node --import tsx --test src/capture/adaState.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetLeft, categoryLabel, describeDeferral, describePause, humanizeField, listenLabel, listenState, scriptedWhy } from "./adaState";

const voice = { listening: true, agentSpeaking: false, expertSpeaking: false, offRecord: false };

test("humanizeField turns app field ids into labels", () => {
  assert.equal(humanizeField("costCenter"), "Cost center");
  assert.equal(humanizeField("#cost_center"), "Cost center");
  assert.equal(humanizeField("dn"), "Dn");
  assert.equal(humanizeField(""), undefined);
  assert.equal(humanizeField(undefined), undefined);
});

test("ask after typing stopped names the time and the field", () => {
  const p = describePause({ decision: "ask", kind: "typing_stopped", sinceKeyMs: 2380, sinceSpeechMs: 9000, field: "costCenter" });
  assert.equal(p.decision, "ask");
  assert.equal(p.reason, "You stopped typing for 2.4 s on Cost center.");
  assert.equal(p.quietMs, 2380);
  assert.equal(p.field, "Cost center");
});

test("ask after a save or a case boundary says so", () => {
  assert.match(describePause({ decision: "ask", kind: "save_completed", sinceKeyMs: 1600, sinceSpeechMs: 5000 }).reason, /^You just saved and stopped typing for 1\.6 s/);
  assert.match(describePause({ decision: "ask", kind: "case_boundary", sinceKeyMs: 2000, sinceSpeechMs: 5000 }).reason, /finished a case/);
  assert.match(describePause({ decision: "ask", kind: "speech_ended", sinceKeyMs: 9000, sinceSpeechMs: 1300 }).reason, /stopped talking for 1\.3 s/);
});

test("long static screen is reported as such", () => {
  const p = describePause({ decision: "ask", kind: "typing_stopped", sinceKeyMs: 9000, sinceSpeechMs: 9000, staticMs: 8200, longStaticMs: 8000 });
  assert.equal(p.reason, "The screen has been still for 8.2 s.");
});

test("hold and skip become a plain 'wait'", () => {
  const hold = describePause({ decision: "hold", kind: "typing_stopped", sinceKeyMs: 1700, sinceSpeechMs: 4000, field: "amount" });
  assert.equal(hold.decision, "wait");
  assert.match(hold.reason, /^You paused for 1\.7 s on Amount, mid-case/);
  const skip = describePause({ decision: "skip", kind: "typing_stopped", sinceKeyMs: 1700, sinceSpeechMs: 4000 });
  assert.equal(skip.decision, "wait");
  assert.match(skip.reason, /Nothing new/);
});

test("deferrals explain where the question went", () => {
  assert.equal(describeDeferral("budget").decision, "defer");
  assert.match(describeDeferral("budget").reason, /budget/);
  assert.match(describeDeferral("low_priority").reason, /debrief/);
});

test("budgetLeft counts only questions inside the window", () => {
  assert.equal(budgetLeft([], 1_000_000, 5), 5);
  assert.equal(budgetLeft([10_000, 500_000, 900_000], 1_000_000, 5), 3); // 10 s is outside the 10-min window
  assert.equal(budgetLeft([1, 2, 3, 4, 5, 6], 10, 5), 0);
});

test("listen state prefers off-record, then who is speaking", () => {
  assert.equal(listenState({ ...voice, offRecord: true, agentSpeaking: true }), "off_record");
  assert.equal(listenState({ ...voice, agentSpeaking: true }), "ada_speaking");
  assert.equal(listenState({ ...voice, expertSpeaking: true }), "you_speaking");
  assert.equal(listenState(voice), "listening");
  assert.equal(listenState({ ...voice, listening: false }), "not_started");
  assert.equal(listenLabel("you_speaking"), "You're speaking");
});

test("scripted questions explain themselves", () => {
  assert.match(scriptedWhy("debrief", true), /gap/);
  assert.match(scriptedWhy("teachback", false), /understood/);
  assert.match(scriptedWhy("teach", false), /handle/);
});

test("category labels", () => {
  assert.equal(categoryLabel("guardrail_limit"), "Guardrail");
  assert.equal(categoryLabel("why"), "Why");
});
