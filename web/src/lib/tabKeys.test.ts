/** cd web && node --import tsx --test src/lib/tabKeys.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTabIndex, activatesRow } from "./tabKeys";

test("arrow keys move between tabs and wrap", () => {
  assert.equal(nextTabIndex(4, 0, "ArrowRight"), 1);
  assert.equal(nextTabIndex(4, 3, "ArrowRight"), 0);
  assert.equal(nextTabIndex(4, 0, "ArrowLeft"), 3);
  assert.equal(nextTabIndex(4, 2, "Home"), 0);
  assert.equal(nextTabIndex(4, 1, "End"), 3);
});

test("other keys leave the tab alone", () => {
  assert.equal(nextTabIndex(4, 2, "Tab"), null);
  assert.equal(nextTabIndex(4, 2, "a"), null);
  assert.equal(nextTabIndex(0, 0, "ArrowRight"), null);
});

test("Enter and Space open a clickable row", () => {
  assert.equal(activatesRow("Enter"), true);
  assert.equal(activatesRow(" "), true);
  assert.equal(activatesRow("ArrowDown"), false);
});
