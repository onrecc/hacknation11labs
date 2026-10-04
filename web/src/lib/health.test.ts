/** cd web && node --import tsx --test src/lib/health.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { healthView } from "./health";

test("live AI and voice show as two green dots", () => {
  const v = healthView({ ok: true, model: "claude-x", mock: false, voice: true });
  assert.deepEqual(v.ai, { tone: "ok", label: "AI", title: "AI: claude-x" });
  assert.deepEqual(v.voice, { tone: "ok", label: "Voice", title: "Voice: ElevenLabs" });
});

test("mock AI shows a red MOCK label, missing voice key is off, independently", () => {
  const v = healthView({ ok: true, model: "claude-x", mock: true, voice: false, warning: "credit balance empty" });
  assert.equal(v.ai.tone, "mock");
  assert.equal(v.ai.label, "MOCK");
  assert.equal(v.ai.title, "AI: canned answers, not a real model (credit balance empty)");
  assert.equal(v.voice.tone, "off");
});

test("an unreachable api turns both off", () => {
  const v = healthView(null);
  assert.equal(v.ai.tone, "off");
  assert.equal(v.voice.tone, "off");
  assert.match(v.ai.title, /unreachable/);
});

test("before the first check both are pending", () => {
  const v = healthView(undefined);
  assert.equal(v.ai.tone, "pending");
  assert.equal(v.voice.tone, "pending");
});
