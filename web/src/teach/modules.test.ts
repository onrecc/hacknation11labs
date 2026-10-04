// Module selection on /teach: featured maps stay the default even when a newer map is confirmed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankModules, recency } from "./modules";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const mod = (id: string, updatedAt: string, domain = "accounts_payable", featured?: boolean) => ({
  id, head: { updatedAt, ...(featured === undefined ? {} : { featured }) }, full: { task: { domain } },
});
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

test("newest first without a featured map", () => {
  assert.deepEqual(ids(rankModules([mod("old", "2026-10-01T00:00:00Z"), mod("new", "2026-10-03T00:00:00Z")], "accounts_payable", NOW)), ["new", "old"]);
});

test("a featured map stays first after a newer map is confirmed", () => {
  const out = rankModules([mod("newer", "2026-10-04T10:00:00Z"), mod("demo", "2026-12-04T00:00:00Z", "accounts_payable", true)], "accounts_payable", NOW);
  assert.deepEqual(ids(out), ["demo", "newer"]);
});

test("the learner's department still comes before a featured map elsewhere", () => {
  const out = rankModules([mod("proc", "2026-10-04T10:00:00Z", "procurement", true), mod("ap", "2026-10-01T00:00:00Z")], "accounts_payable", NOW);
  assert.deepEqual(ids(out), ["ap", "proc"]);
});

test("does not mutate the input", () => {
  const input = [mod("a", "2026-10-01T00:00:00Z"), mod("b", "2026-10-02T00:00:00Z")];
  rankModules(input, "accounts_payable", NOW);
  assert.deepEqual(ids(input), ["a", "b"]);
});

test("future-dated fixtures and bad dates rank as oldest", () => {
  assert.equal(recency({ updatedAt: "2026-12-04T00:00:00Z" }, NOW), 0);
  assert.equal(recency({ updatedAt: "not a date" }, NOW), 0);
});
