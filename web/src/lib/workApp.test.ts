/** cd web && node --import tsx --test src/lib/workApp.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MINIERP, PROCUREX, appFor, appUrl, practiceCases, practiceHint } from "./workApp";

test("each department works in its own app", () => {
  assert.equal(appFor("accounts_payable"), MINIERP);
  assert.equal(appFor("procurement"), PROCUREX);
  assert.equal(appFor("unknown_domain"), MINIERP);
});

test("appUrl adds the mode with the right separator", () => {
  assert.equal(appUrl(MINIERP, "capture"), "/erp?mode=capture");
  assert.equal(appUrl({ name: "X", url: "/x?a=1" }, "teach"), "/x?a=1&mode=teach");
  assert.equal(appUrl(PROCUREX, "teach"), "/demo/procurex.html?mode=teach");
});

test("procurement learners get ProcureX guidance, AP learners MiniERP invoices", () => {
  assert.match(practiceHint("procurement"), /ProcureX/);
  assert.match(practiceHint("procurement"), /PR-20931/);
  assert.doesNotMatch(practiceHint("procurement"), /INV-/);
  assert.match(practiceHint("accounts_payable"), /INV-4490/);
  assert.doesNotMatch(practiceHint("accounts_payable"), /ProcureX/);
});

test("MiniERP practice cases only for MiniERP modules", () => {
  const cases = [{ key: "4490" }];
  assert.deepEqual(practiceCases("accounts_payable", cases), cases);
  assert.deepEqual(practiceCases("procurement", cases), []);
});
