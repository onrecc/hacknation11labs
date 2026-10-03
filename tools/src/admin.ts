/** Admin SDK bootstrap + EventStore backed by Firestore/Storage (bypasses security rules). */
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { EventChunk, EventStore } from "../../shared/eventlog";
import { col, chunkDocId, blobPath } from "../../shared/paths";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "hacknation11labs";
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId, storageBucket: `${projectId}.firebasestorage.app` });

export const db = getFirestore();
export const bucket = getStorage().bucket();

export const adminStore: EventStore = {
  async reserveSeq(sessionId, n) {
    const ref = db.collection(col.sessions).doc(sessionId);
    return db.runTransaction(async (tx) => {
      const next = ((await tx.get(ref)).get("nextSeq") as number | undefined) ?? 1;
      tx.set(ref, { nextSeq: next + n }, { merge: true });
      return next;
    });
  },
  async writeChunk(sessionId, chunk: EventChunk) {
    await db.collection(col.chunks(sessionId)).doc(chunkDocId(chunk.seqFrom)).create(chunk);
  },
  async uploadBlob(sessionId, uri, data, contentType) {
    const buf = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(await data.arrayBuffer());
    await bucket.file(blobPath(sessionId, uri)).save(buf, { contentType, resumable: false });
  },
};

export { FieldValue };
