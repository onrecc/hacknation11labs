/** cd web && node --import tsx --test src/lib/judge.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JUDGE_KEY, JUDGE_QUESTIONS, judgeLabel, resolveJudgeFlag, type KeyValueStore } from "./judge";

function memoryStore(init: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: KeyValueStore = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

test("off by default", () => {
  assert.equal(resolveJudgeFlag("", memoryStore()), false);
  assert.equal(resolveJudgeFlag("?foo=1", memoryStore()), false);
});

test("?judge=1 turns it on and remembers it", () => {
  const store = memoryStore();
  assert.equal(resolveJudgeFlag("?judge=1", store), true);
  assert.equal(store.data.get(JUDGE_KEY), "1");
  assert.equal(resolveJudgeFlag("", store), true);
});

test("?judge=0 turns it off and forgets it", () => {
  const store = memoryStore({ [JUDGE_KEY]: "1" });
  assert.equal(resolveJudgeFlag("?judge=0", store), false);
  assert.equal(store.data.has(JUDGE_KEY), false);
  assert.equal(resolveJudgeFlag("", store), false);
});

test("query flag wins even when storage is blocked or missing", () => {
  assert.equal(resolveJudgeFlag("?judge=1", throwing), true);
  assert.equal(resolveJudgeFlag("?judge=0", throwing), false);
  assert.equal(resolveJudgeFlag("", throwing), false);
  assert.equal(resolveJudgeFlag("?judge=1", null), true);
  assert.equal(resolveJudgeFlag("", null), false);
});

test("other values of judge are ignored", () => {
  const store = memoryStore({ [JUDGE_KEY]: "1" });
  assert.equal(resolveJudgeFlag("?judge=yes", store), true);
  assert.equal(store.data.get(JUDGE_KEY), "1");
});

test("five Apprentice Test questions, numbered ①–⑤", () => {
  assert.deepEqual(Object.keys(JUDGE_QUESTIONS).map(Number), [1, 2, 3, 4, 5]);
  assert.equal(judgeLabel(1), "① When to ask");
  assert.equal(judgeLabel(5), "⑤ Trust");
  for (const q of Object.values(JUDGE_QUESTIONS)) assert.ok(q.hint.length > 10);
});
