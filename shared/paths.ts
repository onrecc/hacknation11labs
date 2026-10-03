/** Firestore + Storage layout (see ARCHITECTURE.md §6). Keep every path here. */
import type { Id } from "./schema";

export const col = {
  sessions: "sessions",
  chunks: (sessionId: Id) => `sessions/${sessionId}/chunks`,
  report: (sessionId: Id) => `sessions/${sessionId}/report`,
  workmaps: "workmaps",
  workmapVersions: (workMapId: Id) => `workmaps/${workMapId}/versions`,
};

export const chunkDocId = (seqFrom: number) => String(seqFrom).padStart(8, "0");
export const versionDocId = (v: number) => String(v).padStart(4, "0");

/** Storage object path for a bundle-relative uri (frames/..., media/..., model_calls/...). */
export const blobPath = (sessionId: Id, uri: string) => `sessions/${sessionId}/${uri}`;
