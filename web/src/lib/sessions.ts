/** Session + Work Map persistence and live subscriptions. */
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import type { Event, Id, Session, WorkMap, Workday } from "@shared/schema";
import { eventsFromChunks, type EventChunk } from "@shared/eventlog";
import { col, blobPath, versionDocId } from "@shared/paths";
import { newId } from "@shared/ids";
import { db, storage } from "./firebase";

type NewSession = Omit<Session, "id" | "createdAt" | "status" | "clock" | "media"> & { id?: Id };

/** Build a session locally (sync) so writers can start on it immediately; persist it with persistSession(). */
export function makeSession(s: NewSession): Session {
  const now = new Date().toISOString();
  return {
    ...s, id: s.id ?? newId("ses"), status: "live", createdAt: now,
    clock: { wallAtT0: now, perfAtT0: performance.now() }, media: { screenVideo: [], micAudio: [], agentAudio: [] },
  };
}

/** Merge-write: safe even if an EventLog already reserved seq numbers on this doc (nextSeq stays). */
export async function persistSession(session: Session): Promise<void> {
  await setDoc(doc(db, col.sessions, session.id), JSON.parse(JSON.stringify(session)) as Session, { merge: true });
}

export async function createSession(s: NewSession): Promise<Session> {
  const session = makeSession(s);
  await persistSession(session);
  return session;
}

export const updateSession = (id: Id, patch: Partial<Session>) => updateDoc(doc(db, col.sessions, id), patch);

export async function getSession(id: Id): Promise<Session | null> {
  const d = await getDoc(doc(db, col.sessions, id));
  return d.exists() ? (d.data() as Session) : null;
}

export async function listSessions(n = 30): Promise<Session[]> {
  const q = query(collection(db, col.sessions), orderBy("createdAt", "desc"), limit(n));
  return (await getDocs(q)).docs.map((d) => d.data() as Session);
}

/** Live events of a session (sorted by seq). Calls back with the full list on every new chunk. */
export function subscribeEvents(sessionId: Id, cb: (events: Event[]) => void): () => void {
  const chunks = new Map<string, EventChunk>();
  const q = query(collection(db, col.chunks(sessionId)), orderBy("seqFrom"));
  return onSnapshot(q, (snap) => {
    snap.docChanges().forEach((c) => chunks.set(c.doc.id, c.doc.data() as EventChunk));
    cb(eventsFromChunks([...chunks.values()]));
  });
}

export interface WorkMapHead { id: Id; latestVersion: number; status: WorkMap["status"]; title?: string; updatedAt: string; sourceSessionIds: Id[] }

export async function listWorkMaps(): Promise<WorkMapHead[]> {
  return (await getDocs(collection(db, col.workmaps))).docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkMapHead, "id">) }));
}

export async function loadWorkMap(id: Id, version?: number): Promise<WorkMap | null> {
  const head = await getDoc(doc(db, col.workmaps, id));
  if (!head.exists()) return null;
  const v = version ?? (head.get("latestVersion") as number);
  const vd = await getDoc(doc(db, col.workmapVersions(id), versionDocId(v)));
  return vd.exists() ? (JSON.parse(vd.get("json") as string) as WorkMap) : null;
}

/** Versions are immutable: always write a new one (use shared/workmap.ts nextVersion). */
export async function saveWorkMapVersion(wm: WorkMap): Promise<void> {
  await setDoc(doc(db, col.workmapVersions(wm.id), versionDocId(wm.version)), { json: JSON.stringify(wm), createdAt: new Date().toISOString() });
  await setDoc(doc(db, col.workmaps, wm.id), {
    latestVersion: wm.version, status: wm.status, sourceSessionIds: wm.sourceSessionIds, title: wm.task.title, updatedAt: wm.updatedAt,
  });
}

const urlCache = new Map<string, Promise<string>>();
/** Download URL for a bundle-relative blob (frames/…, media/…). */
export function blobUrl(sessionId: Id, uri: string): Promise<string> {
  const k = `${sessionId}/${uri}`;
  if (!urlCache.has(k)) urlCache.set(k, getDownloadURL(ref(storage, blobPath(sessionId, uri))));
  return urlCache.get(k)!;
}

/** All events of a session, once (e.g. to resume a finished task session for its debrief). */
export async function loadEvents(sessionId: Id): Promise<Event[]> {
  const snap = await getDocs(query(collection(db, col.chunks(sessionId)), orderBy("seqFrom")));
  return eventsFromChunks(snap.docs.map((d) => d.data() as EventChunk));
}

// ───────────── workdays ─────────────
export async function saveWorkday(w: Workday): Promise<void> {
  await setDoc(doc(db, col.workdays, w.id), JSON.parse(JSON.stringify(w)) as Workday);
}

export async function getWorkday(id: Id): Promise<Workday | null> {
  const d = await getDoc(doc(db, col.workdays, id));
  return d.exists() ? (d.data() as Workday) : null;
}

/** A user's workdays, newest first. */
export async function listWorkdays(userId: Id, n = 10): Promise<Workday[]> {
  const snap = await getDocs(query(collection(db, col.workdays), where("userId", "==", userId)));
  return snap.docs.map((d) => d.data() as Workday).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, n);
}
