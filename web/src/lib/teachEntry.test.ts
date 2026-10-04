/** cd web && node --import tsx --test src/lib/teachEntry.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mayOpen, teachEntry } from "./teachEntry";

test("practicer on a confirmed map: Open in Training, preselecting the map", () => {
  assert.deepEqual(teachEntry({ role: "practicer", status: "confirmed", workMapId: "wm_1" }), { label: "Open in Training", to: "/learn?map=wm_1", primary: true });
});

test("practicer on an unconfirmed map: nothing to open", () => {
  assert.equal(teachEntry({ role: "practicer", status: "draft", workMapId: "wm_1" }), null);
  assert.equal(teachEntry({ role: "practicer", status: "teachback_pending", workMapId: "wm_1" }), null);
});

test("expert on a confirmed map: preview as new hire", () => {
  const e = teachEntry({ role: "expert", status: "confirmed", workMapId: "wm 1" });
  assert.equal(e?.label, "Preview as new hire");
  assert.equal(e?.to, "/learn?map=wm%201&preview=1");
  assert.equal(e?.primary, false);
});

test("expert on an unconfirmed map: debrief it", () => {
  const e = teachEntry({ role: "expert", status: "debrief", workMapId: "wm_1" });
  assert.equal(e?.label, "Debrief");
  assert.equal(e?.to, "/day");
});

test("logged out: confirmed maps lead to login via /learn, others nothing", () => {
  assert.equal(teachEntry({ role: null, status: "confirmed", workMapId: "wm_1" })?.to, "/learn?map=wm_1");
  assert.equal(teachEntry({ role: null, status: "draft", workMapId: "wm_1" }), null);
});

test("route guard: the right role, or an expert previewing /learn", () => {
  assert.equal(mayOpen("practicer", "practicer", ""), true);
  assert.equal(mayOpen("expert", "practicer", ""), false);
  assert.equal(mayOpen("expert", "practicer", "?map=x&preview=1"), true);
  assert.equal(mayOpen("practicer", "expert", "?preview=1"), false);
  assert.equal(mayOpen("expert", undefined, ""), true);
});
