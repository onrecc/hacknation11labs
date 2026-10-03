/**
 * The ONLY way to write events (ARCHITECTURE.md §6a rule 4).
 * Buffers events, reserves a block of `seq` numbers per flush, writes one chunk document per flush,
 * and uploads blobs (frames, media, model-call details). Storage backend is pluggable (web SDK, admin SDK, memory).
 */
import type { Event, Id, Phase } from "./schema";
import type { SessionClock } from "./clock";
import { newId } from "./ids";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What callers pass to `emit`: everything except the fields the log fills in. */
export type EventInput = DistributiveOmit<Event, "id" | "sessionId" | "seq" | "wall" | "phase"> & { id?: Id; phase?: Phase };

export interface EventChunk {
  seqFrom: number;
  seqTo: number;
  tFrom: number;
  tTo: number;
  writer: string;
  count: number;
  types: string[];
  /** JSON-encoded Event[]: avoids Firestore's nested-array and per-field index limits. */
  eventsJson: string;
  createdAt: string;
}

export interface EventStore {
  /** Atomically reserve `n` seq numbers for the session; returns the first one. */
  reserveSeq(sessionId: Id, n: number): Promise<number>;
  writeChunk(sessionId: Id, chunk: EventChunk): Promise<void>;
  uploadBlob(sessionId: Id, uri: string, data: Blob | Uint8Array, contentType: string): Promise<void>;
}

export interface EventLogOptions {
  store: EventStore;
  sessionId: Id;
  clock: SessionClock;
  /** Who writes: "capture" | "erp" | "map" | "teach" | ... (debugging only). */
  writer: string;
  getPhase: () => Phase;
  flushMs?: number;
  maxEvents?: number;
  maxBytes?: number;
  /** Called synchronously for every emitted event (live UI feeds). */
  onEvent?: (e: Event) => void;
  onError?: (err: unknown) => void;
}

export class EventLog {
  private buffer: Event[] = [];
  private bytes = 0;
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private uploads = new Set<Promise<void>>();
  stats = { emitted: 0, written: 0, chunks: 0, blobs: 0, failedFlushes: 0 };

  constructor(private readonly o: EventLogOptions) {
    this.timer = setInterval(() => void this.flush(), o.flushMs ?? 2000);
  }

  get sessionId() {
    return this.o.sessionId;
  }

  /** Current session time in ms. */
  now() {
    return this.o.clock.now();
  }

  /** Append an event. `seq` is assigned at flush time; the returned object is updated in place. */
  emit<T extends EventInput>(input: T): Event {
    const e = {
      ...input,
      id: input.id ?? newId("evt"),
      sessionId: this.o.sessionId,
      seq: 0,
      wall: this.o.clock.wall(input.t),
      phase: input.phase ?? this.o.getPhase(),
    } as unknown as Event;
    this.buffer.push(e);
    this.bytes += JSON.stringify(e).length;
    this.stats.emitted++;
    this.o.onEvent?.(e);
    if (this.buffer.length >= (this.o.maxEvents ?? 200) || this.bytes >= (this.o.maxBytes ?? 500_000)) void this.flush();
    return e;
  }

  /** Upload a blob in the background (retries 3x). `uri` is bundle-relative, e.g. "frames/frm_x.webp". */
  blob(uri: string, data: Blob | Uint8Array, contentType: string): void {
    const p = retry(() => this.o.store.uploadBlob(this.o.sessionId, uri, data, contentType), 3)
      .then(() => void this.stats.blobs++)
      .catch((err) => this.o.onError?.(err))
      .finally(() => this.uploads.delete(p));
    this.uploads.add(p);
  }

  get pendingUploads() {
    return this.uploads.size;
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    this.bytes = 0;
    this.flushing = (async () => {
      try {
        const first = await retry(() => this.o.store.reserveSeq(this.o.sessionId, batch.length), 3);
        batch.forEach((e, i) => ((e as { seq: number }).seq = first + i));
        const ts = batch.map((e) => e.t);
        const chunk: EventChunk = {
          seqFrom: first,
          seqTo: first + batch.length - 1,
          tFrom: Math.min(...ts),
          tTo: Math.max(...ts),
          writer: this.o.writer,
          count: batch.length,
          types: [...new Set(batch.map((e) => e.type))],
          eventsJson: JSON.stringify(batch),
          createdAt: new Date().toISOString(),
        };
        await retry(() => this.o.store.writeChunk(this.o.sessionId, chunk), 3);
        this.stats.written += batch.length;
        this.stats.chunks++;
      } catch (err) {
        // keep the events: put them back in front, they'll go with the next flush
        this.buffer = batch.concat(this.buffer);
        this.stats.failedFlushes++;
        this.o.onError?.(err);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  /** Flush everything and wait for uploads. Call on session end / page unload. */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
    if (this.buffer.length) await this.flush();
    await Promise.allSettled([...this.uploads]);
  }
}

async function retry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
  throw last;
}

/** In-memory store for tests and offline dev. */
export class MemoryStore implements EventStore {
  next = new Map<Id, number>();
  chunks = new Map<Id, EventChunk[]>();
  blobs = new Map<string, { data: Blob | Uint8Array; contentType: string }>();
  async reserveSeq(sessionId: Id, n: number) {
    const first = this.next.get(sessionId) ?? 1;
    this.next.set(sessionId, first + n);
    return first;
  }
  async writeChunk(sessionId: Id, chunk: EventChunk) {
    this.chunks.set(sessionId, [...(this.chunks.get(sessionId) ?? []), chunk]);
  }
  async uploadBlob(sessionId: Id, uri: string, data: Blob | Uint8Array, contentType: string) {
    this.blobs.set(`${sessionId}/${uri}`, { data, contentType });
  }
  events(sessionId: Id): Event[] {
    return (this.chunks.get(sessionId) ?? []).flatMap((c) => JSON.parse(c.eventsJson) as Event[]);
  }
}

/** Decode chunks (any order) into events sorted by seq. */
export function eventsFromChunks(chunks: Pick<EventChunk, "eventsJson">[]): Event[] {
  return chunks.flatMap((c) => JSON.parse(c.eventsJson) as Event[]).sort((a, b) => a.seq - b.seq);
}
