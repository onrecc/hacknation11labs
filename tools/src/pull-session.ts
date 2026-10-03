/**
 * Exports a session from Firestore + Storage into the bundle folder layout (same as fixtures/), so the
 * validator and Map can run offline without burning quota.
 *   npm run pull -- <sessionId> [--out data/sessions/<id>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Session, WorkMap } from "../../shared/schema";
import { eventsFromChunks, type EventChunk } from "../../shared/eventlog";
import { col, blobPath } from "../../shared/paths";
import { db, bucket } from "./admin";

const sid = process.argv[2];
if (!sid) throw new Error("usage: npm run pull -- <sessionId> [--out dir]");
const oi = process.argv.indexOf("--out");
const out = resolve(oi > 0 ? process.argv[oi + 1] : new URL(`../../data/sessions/${sid}`, import.meta.url).pathname);

const sdoc = await db.collection(col.sessions).doc(sid).get();
if (!sdoc.exists) throw new Error(`no session ${sid}`);
const { nextSeq: _n, seededFrom: _s, ...session } = sdoc.data() as Session & { nextSeq?: number; seededFrom?: string };
const chunks = (await db.collection(col.chunks(sid)).get()).docs.map((d) => d.data() as EventChunk);
const events = eventsFromChunks(chunks);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "session.json"), JSON.stringify(session, null, 2));
writeFileSync(join(out, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");

const [files] = await bucket.getFiles({ prefix: blobPath(sid, "") });
for (const f of files) {
  const rel = f.name.slice(blobPath(sid, "").length);
  mkdirSync(dirname(join(out, rel)), { recursive: true });
  await f.download({ destination: join(out, rel) });
}
if (session.workMapId) {
  const w = await db.collection(col.workmaps).doc(session.workMapId).get();
  const v = w.get("latestVersion") as number | undefined;
  if (v) {
    const vd = await db.collection(col.workmapVersions(session.workMapId)).doc(String(v).padStart(4, "0")).get();
    writeFileSync(join(out, "workmap.json"), JSON.stringify(JSON.parse(vd.get("json")) as WorkMap, null, 2));
  }
}
console.log(`pulled ${events.length} events, ${files.length} blobs → ${out}`);
console.log(`validate: python3 scripts/validate_bundle.py ${out}${session.workMapId ? ` --workmap ${join(out, "workmap.json")}` : ""}`);
