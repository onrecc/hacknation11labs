/** cd web && node --import tsx --test src/capture/statusLine.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusLine } from "./statusLine";

const voice = { listening: true, agentSpeaking: false, expertSpeaking: false, offRecord: false };

test("recording with the extension reads as one sentence", () => {
  assert.deepEqual(statusLine({ ...voice, phase: "capture", extension: true, sharing: false }), { tone: "ok", text: "Recording · Ada listening · Extension connected" });
});

test("off the record drops the voice state and changes tone", () => {
  assert.deepEqual(statusLine({ ...voice, offRecord: true, phase: "capture", extension: false, sharing: true }), { tone: "off", text: "Off the record · Screen shared" });
});

test("teach and debrief phases have their own head", () => {
  assert.equal(statusLine({ ...voice, phase: "teach", extension: false, sharing: false }).text, "Practising · Ada listening · No extension");
  assert.equal(statusLine({ ...voice, agentSpeaking: true, phase: "debrief", extension: true, sharing: false }).text, "Debrief · Ada speaking · Extension connected");
  assert.equal(statusLine({ ...voice, listening: false, phase: "capture", extension: true, sharing: false }).text, "Recording · Ada not started · Extension connected");
});

test("an ended day says so", () => {
  assert.deepEqual(statusLine({ ...voice, phase: "capture", extension: true, sharing: false, ended: true }), { tone: "idle", text: "Day ended" });
});
