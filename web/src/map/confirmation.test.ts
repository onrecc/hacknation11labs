import { test } from "node:test";
import assert from "node:assert/strict";
import type { Gap } from "../../../shared/schema";
import { blockingGaps, notConfirmedDetail, notConfirmedSentence, type Outcome } from "./confirmation";

const gap = (over: Partial<Gap>): Gap => ({
  id: "gap_1", kind: "low_confidence", description: "what makes a true duplicate", about: { eventIds: [] },
  proposedQuestion: "What makes a true duplicate?", priority: 0.7, status: "asked", ...over,
});
const ok: Outcome = { finalYes: true, partsOpen: 0, gaps: [] };

test("blockingGaps keeps unanswered high-priority gaps, highest priority first", () => {
  // Arrange
  const gaps = [
    gap({ id: "a", priority: 0.6, status: "open" }),
    gap({ id: "b", priority: 0.9, status: "asked" }),
    gap({ id: "c", priority: 0.95, status: "resolved" }),
    gap({ id: "d", priority: 0.3, status: "open" }),
    gap({ id: "e", priority: 0.8, status: "wont_fix" }),
  ];

  // Act
  const out = blockingGaps(gaps);

  // Assert
  assert.deepEqual(out.map((g) => g.id), ["b", "a"]);
});

test("notConfirmedDetail is null when everything is in place", () => {
  assert.equal(notConfirmedDetail(ok), null);
});

test("notConfirmedDetail names the open question count for the panel", () => {
  assert.equal(notConfirmedDetail({ ...ok, gaps: [gap({})] }), "Not confirmed: 1 open question");
  assert.equal(notConfirmedDetail({ finalYes: false, partsOpen: 2, gaps: [gap({}), gap({ id: "x" })] }), "Not confirmed: 2 open questions, 2 parts not confirmed, no final yes");
});

test("notConfirmedSentence tells the expert in plain words which question is still open", () => {
  const s = notConfirmedSentence({ ...ok, gaps: [gap({})] });
  assert.equal(s, "I still don't know what makes a true duplicate, so I can't mark this as confirmed yet.");
});

test("notConfirmedSentence quotes a yes/no question instead of bending its grammar", () => {
  const s = notConfirmedSentence({ ...ok, gaps: [gap({ proposedQuestion: "Is that just Hofmann, or other suppliers too?" }), gap({ id: "x" })] });
  assert.equal(s, "I still have 2 open questions, starting with \"Is that just Hofmann, or other suppliers too?\", so I can't mark this as confirmed yet.");
});

test("notConfirmedSentence covers unclear parts and a missing yes", () => {
  assert.match(notConfirmedSentence({ ...ok, partsOpen: 1 }) ?? "", /still not sure about 1 part/i);
  assert.match(notConfirmedSentence({ ...ok, finalYes: false }) ?? "", /didn't hear a clear yes/i);
  assert.equal(notConfirmedSentence(ok), null);
});
