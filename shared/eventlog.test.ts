import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Event, Session } from "./schema";
import { EventLog, MemoryStore } from "./eventlog";
import { SessionClock } from "./clock";
import { buildDraft } from "./workmap";
import { LogIndex } from "./logindex";

test("two writers share one gap-free seq space", async () => {
  const store = new MemoryStore();
  const clock = new SessionClock();
  const mk = (writer: string) => new EventLog({ store, sessionId: "ses_t", clock, writer, getPhase: () => "capture", flushMs: 60_000 });
  const a = mk("capture"), b = mk("erp");
  for (let i = 0; i < 5; i++) {
    a.emit({ t: clock.now(), type: "marker.bookmark", source: "user", payload: { trigger: "hotkey" } });
    b.emit({ t: clock.now(), type: "speech.vad", source: "stt", payload: { speaker: "expert", state: "start" } });
  }
  await Promise.all([a.close(), b.close()]);
  const seqs = store.events("ses_t").map((e) => e.seq).sort((x, y) => x - y);
  assert.deepEqual(seqs, Array.from({ length: 10 }, (_, i) => i + 1));
});

test("draft from fixture: cases, common mistake, verified quotes", () => {
  const dir = new URL("../fixtures/demo-session/", import.meta.url);
  const session = JSON.parse(readFileSync(new URL("session.json", dir), "utf8")) as Session;
  const events = readFileSync(new URL("events.jsonl", dir), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Event);
  const d = buildDraft(session, events);
  assert.equal(d.cases.length, 3);
  assert.equal(d.commonMistakes.length, 1);
  assert.equal(d.stats.liveQuestions, 3);
  const ix = new LogIndex(session.id, events);
  const utt = ix.ofType("utterance").find((u) => u.payload.text.includes("five thousand"))!;
  assert.ok(ix.quote([utt.payload.utteranceId], "No, wait, sorry, five thousand."));
  assert.equal(ix.quote([utt.payload.utteranceId], "five thousand euros is capex"), null);
});
