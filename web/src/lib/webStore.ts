/** EventStore on the Firebase web SDK (security rules apply). */
import { doc, runTransaction, setDoc } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import type { EventChunk, EventStore } from "@shared/eventlog";
import { col, chunkDocId, blobPath } from "@shared/paths";
import { db, storage } from "./firebase";

export const webStore: EventStore = {
  async reserveSeq(sessionId, n) {
    const sref = doc(db(), col.sessions, sessionId);
    return runTransaction(db(), async (tx) => {
      const next = ((await tx.get(sref)).get("nextSeq") as number | undefined) ?? 1;
      tx.set(sref, { nextSeq: next + n }, { merge: true });
      return next;
    });
  },
  async writeChunk(sessionId, chunk: EventChunk) {
    await setDoc(doc(db(), col.chunks(sessionId), chunkDocId(chunk.seqFrom)), chunk);
  },
  async uploadBlob(sessionId, uri, data, contentType) {
    await uploadBytes(ref(storage(), blobPath(sessionId, uri)), data, { contentType });
  },
};
