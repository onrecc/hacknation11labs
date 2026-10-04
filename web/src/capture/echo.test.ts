/** cd web && node --import tsx --test src/capture/echo.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeEcho } from "./echo";

test("a one-word answer is not an echo of words that merely contain it", () => {
  assert.equal(looksLikeEcho("No.", "I know you're busy, but not now, is the invoice approved?"), false);
});

test("a short reply equal to a whole agent sentence is an echo", () => {
  assert.equal(looksLikeEcho("Got it.", "Got it. What happens next?"), true);
});

test("a long utterance mostly made of the agent's words is an echo", () => {
  assert.equal(looksLikeEcho("what happens after the invoice is approved", "What happens after the invoice is approved?"), true);
});

test("a real answer with different words is kept", () => {
  assert.equal(looksLikeEcho("I send it to finance for payment", "What happens after the invoice is approved?"), false);
});
