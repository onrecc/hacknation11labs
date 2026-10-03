/**
 * Replays a local bundle (default: fixtures/demo-session) into Firestore + Storage, and stores its
 * expected_workmap.json as a Work Map version. Gives Map/Teach live data from hour one.
 *   npm run seed:fixture                         # fixture as-is (same session id)
 *   npm run seed:fixture -- --dir <bundle> --as <newSessionId> --force
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Event, Session, WorkMap } from "../../shared/schema";
import { col, chunkDocId, versionDocId, blobPath } from "../../shared/paths";
import type { EventChunk } from "../../shared/eventlog";
import { db, bucket } from "./admin";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const dir = resolve(arg("--dir") ?? new URL("../../fixtures/demo-session", import.meta.url).pathname);
const session = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as Session;
const sid = arg("--as") ?? session.id;
const events = readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => ({ ...(JSON.parse(l) as Event), sessionId: sid }));

const sref = db.collection(col.sessions).doc(sid);
if ((await sref.get()).exists && !process.argv.includes("--force")) {
  console.log(`session ${sid} already exists (use --force to overwrite)`);
  process.exit(0);
}
if (process.argv.includes("--force")) await db.recursiveDelete(sref);

// session doc (nextSeq continues after the fixture so new writers can append)
await sref.set({ ...session, id: sid, nextSeq: events.length + 1, seededFrom: dir.split("/").slice(-2).join("/") });

// chunks of 200 events
for (let i = 0; i < events.length; i += 200) {
  const batch = events.slice(i, i + 200);
  const chunk: EventChunk = {
    seqFrom: batch[0].seq, seqTo: batch.at(-1)!.seq, tFrom: Math.min(...batch.map((e) => e.t)), tTo: Math.max(...batch.map((e) => e.t)),
    writer: "seed", count: batch.length, types: [...new Set(batch.map((e) => e.type))], eventsJson: JSON.stringify(batch), createdAt: new Date().toISOString(),
  };
  await sref.collection("chunks").doc(chunkDocId(chunk.seqFrom)).set(chunk);
}
console.log(`events: ${events.length} in ${Math.ceil(events.length / 200)} chunks`);

// frames
const fdir = join(dir, "frames");
if (existsSync(fdir)) {
  const files = readdirSync(fdir);
  for (let i = 0; i < files.length; i += 25) {
    await Promise.all(files.slice(i, i + 25).map((f) =>
      bucket.file(blobPath(sid, `frames/${f}`)).save(readFileSync(join(fdir, f)), { contentType: f.endsWith(".svg") ? "image/svg+xml" : "image/webp", resumable: false })));
  }
  console.log(`frames: ${files.length}`);
}

// expected work map → workmaps/{id}/versions/{v}
const wmPath = join(dir, "expected_workmap.json");
if (existsSync(wmPath)) {
  const wm = JSON.parse(readFileSync(wmPath, "utf8")) as WorkMap;
  const fixed = JSON.parse(JSON.stringify(wm).replaceAll(session.id, sid)) as WorkMap;
  const wref = db.collection(col.workmaps).doc(fixed.id);
  await wref.set({ latestVersion: fixed.version, status: fixed.status, sourceSessionIds: fixed.sourceSessionIds, title: fixed.task.title, updatedAt: fixed.updatedAt });
  await wref.collection("versions").doc(versionDocId(fixed.version)).set({ json: JSON.stringify(fixed), createdAt: new Date().toISOString() });
  await sref.update({ workMapId: fixed.id });
  console.log(`workmap: ${fixed.id} v${fixed.version}`);
}
console.log(`seeded session ${sid}`);
