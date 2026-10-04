// mediaClip: which recorded chunk replays a moment, and where inside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Event, MediaChunk } from "./schema";
import { mediaClip } from "./logindex";

let seq = 0;
const chunk = (stream: MediaChunk["payload"]["stream"], t: number, durationMs: number, uri: string): Event => ({
  id: `evt_${++seq}`, sessionId: "ses_1", seq, t, wall: "2026-10-04T00:00:00Z", phase: "capture", type: "media.chunk", source: "system",
  payload: { stream, uri, mime: stream === "mic" ? "audio/webm" : "video/webm", durationMs },
});

const events: Event[] = [
  chunk("screen_video", 0, 10_000, "media/screen-000.webm"),
  chunk("mic", 0, 10_000, "media/mic-000.webm"),
  chunk("screen_video", 10_000, 10_000, "media/screen-001.webm"),
  chunk("mic", 10_000, 10_000, "media/mic-001.webm"),
  // off the record 20–30 s: nothing recorded
  chunk("screen_video", 30_000, 8_000, "media/screen-002.webm"),
];

test("returns the screen chunk covering the anchor with offsets inside it", () => {
  assert.deepEqual(mediaClip(events, "screen_video", 14_000, 11_000, 19_000), { uri: "media/screen-001.webm", mime: "video/webm", start: 1_000, end: 9_000 });
});

test("clamps the window to the chunk that holds the anchor", () => {
  assert.deepEqual(mediaClip(events, "screen_video", 11_000, 8_000, 16_000), { uri: "media/screen-001.webm", mime: "video/webm", start: 0, end: 6_000 });
});

test("picks the requested stream", () => {
  assert.equal(mediaClip(events, "mic", 4_000, 3_500, 6_000)?.uri, "media/mic-000.webm");
});

test("falls back to the chunk overlapping the window most when the anchor is unrecorded", () => {
  assert.deepEqual(mediaClip(events, "screen_video", 25_000, 22_000, 33_000), { uri: "media/screen-002.webm", mime: "video/webm", start: 0, end: 3_000 });
});

test("returns null without any chunk in the window", () => {
  assert.equal(mediaClip(events, "mic", 25_000, 22_000, 28_000), null);
  assert.equal(mediaClip([], "screen_video", 1_000, 0, 5_000), null);
});

test("ignores chunks of other sessions when a session is given", () => {
  assert.equal(mediaClip(events, "screen_video", 4_000, 1_000, 9_000, "ses_other"), null);
  assert.equal(mediaClip(events, "screen_video", 4_000, 1_000, 9_000, "ses_1")?.uri, "media/screen-000.webm");
});
