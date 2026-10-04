/** cd web && node --import tsx --test src/erp/fix.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldToFix } from "./fix";

test("points at the first editable invoice field", () => {
  assert.equal(fieldToFix(["invoice.category", "invoice.amount", "invoice.costCenter"]), "costCenter");
  assert.equal(fieldToFix(["invoice.assetNo", "invoice.costCenter"]), "assetNo");
  assert.equal(fieldToFix(["invoice.approver", "invoice.status"]), "approver");
});

test("no pointer when nothing editable is involved", () => {
  assert.equal(fieldToFix(["supplier.name", "invoice.month", "invoice.duplicateDeliveryNote"]), null);
  assert.equal(fieldToFix([]), null);
  assert.equal(fieldToFix(undefined), null);
});
