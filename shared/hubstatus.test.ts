import { test } from "node:test";
import assert from "node:assert/strict";
import { activeStatus, noteStatus, teachLive, STATUS_TTL_MS, type HubStatusBook, type HubStatus } from "./hubstatus";

const capture: HubStatus = { kind: "status", mode: "capture", sessionId: "ses_sabine", offRecord: false, recording: false, expert: "Sabine" };
const teach: HubStatus = { kind: "status", mode: "teach", sessionId: "ses_lena", offRecord: false, recording: false, expert: "Lena" };
const empty: HubStatusBook = [];

test("activeStatus is null before any hub has spoken", () => {
  assert.equal(activeStatus(empty, 0), null);
});

test("a live teach session wins over a capture session that broadcast more recently", () => {
  // Arrange: both hubs open in one browser, Sabine's capture hub broadcast last
  const book = noteStatus(noteStatus(empty, teach, 1000), capture, 2000);

  // Act
  const s = activeStatus(book, 2500);

  // Assert: the work tab keeps holding saves for the learner
  assert.equal(s?.mode, "teach");
  assert.equal(s?.sessionId, "ses_lena");
});

test("a teach session that stopped broadcasting no longer wins", () => {
  const book = noteStatus(noteStatus(empty, teach, 1000), capture, 2000);
  assert.equal(activeStatus(book, 1000 + STATUS_TTL_MS + 1)?.mode, "capture");
});

test("with nothing live, the most recent status is kept (last known state)", () => {
  const book = noteStatus(noteStatus(empty, capture, 1000), { ...capture, sessionId: "ses_2", offRecord: true }, 2000);
  assert.equal(activeStatus(book, 1_000_000)?.sessionId, "ses_2");
});

test("noteStatus replaces the previous status of the same session without mutating the book", () => {
  const b1 = noteStatus(empty, capture, 1000);
  const b2 = noteStatus(b1, { ...capture, offRecord: true }, 2000);
  assert.equal(b1.length, 1);
  assert.equal(b2.length, 1);
  assert.equal(b2[0].status.offRecord, true);
  assert.equal(b1[0].status.offRecord, false);
});

test("teachLive ignores the asking session itself and stale teach sessions", () => {
  const book = noteStatus(empty, teach, 1000);
  assert.equal(teachLive(book, 2000), true);
  assert.equal(teachLive(book, 2000, "ses_lena"), false);
  assert.equal(teachLive(book, 1000 + STATUS_TTL_MS + 1), false);
});
