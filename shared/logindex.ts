/** Read-side helpers over a Session Log. Used by Map, Teach and the tools. */
import type { Event, FrameCaptured, Id, MediaChunk, Ms, Quote, ScreenMoment, Uri, Utterance } from "./schema";

export type EventOf<T extends Event["type"]> = Extract<Event, { type: T }>;

export class LogIndex {
  readonly byId = new Map<Id, Event>();
  readonly byType = new Map<string, Event[]>();
  readonly utterances = new Map<Id, Utterance>();
  readonly frames: FrameCaptured[] = [];
  readonly offRecord: Array<[Ms, Ms]> = [];

  constructor(readonly sessionId: Id, readonly events: Event[]) {
    const sorted = [...events].sort((a, b) => a.seq - b.seq);
    let offStart: Ms | null = null;
    for (const e of sorted) {
      this.byId.set(e.id, e);
      const list = this.byType.get(e.type) ?? [];
      list.push(e);
      this.byType.set(e.type, list);
      if (e.type === "utterance") this.utterances.set(e.payload.utteranceId, e); // later versions win
      if (e.type === "frame.captured") this.frames.push(e);
      if (e.type === "marker.off_record") {
        if (e.payload.state === "start") offStart = e.t;
        else if (offStart !== null) {
          this.offRecord.push([offStart, e.t]);
          offStart = null;
        }
      }
    }
    this.frames.sort((a, b) => a.t - b.t);
  }

  ofType<T extends Event["type"]>(type: T): EventOf<T>[] {
    return (this.byType.get(type) ?? []) as EventOf<T>[];
  }

  /** Latest stored frame at or before t (frames are 1 fps). */
  frameAt(t: Ms): FrameCaptured | undefined {
    let lo = 0, hi = this.frames.length - 1, best: FrameCaptured | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid].t <= t) {
        best = this.frames[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  }

  inOffRecord(t: Ms): boolean {
    return this.offRecord.some(([a, b]) => a <= t && t < b);
  }

  /** Screen moment for an event: first frame after it (the change is visible), optional field highlight. */
  moment(t: Ms, eventIds: Id[], bbox?: ScreenMoment["bbox"]): ScreenMoment | null {
    const f = this.frameAt(t + 1000) ?? this.frameAt(t);
    if (!f) return null;
    return { sessionId: this.sessionId, t, frameId: f.payload.frameId, eventIds, ...(bbox ? { bbox } : {}) };
  }

  /**
   * Build a verified Quote: `text` must be a verbatim substring of one of the utterances.
   * Returns null if it isn't (rule: the LLM proposes, code verifies).
   */
  quote(utteranceIds: Id[], text: string, questionId?: Id): Quote | null {
    for (const uid of utteranceIds) {
      const u = this.utterances.get(uid);
      if (!u) continue;
      const idx = u.payload.text.indexOf(text);
      if (idx < 0) continue;
      const start = u.payload.text.slice(0, idx).split(/\s+/).filter(Boolean).length;
      const n = text.split(/\s+/).filter(Boolean).length;
      const words = u.payload.words;
      const w0 = words[Math.min(start, words.length - 1)];
      const w1 = words[Math.min(start + n, words.length) - 1];
      return {
        sessionId: this.sessionId,
        utteranceIds: [uid],
        text,
        t: w0?.t ?? u.t,
        tEnd: w1?.tEnd ?? u.tEnd ?? u.t,
        phase: u.phase,
        ...(questionId ? { questionId } : {}),
      };
    }
    return null;
  }

  /** Utterances overlapping [t0, t1]. */
  utterancesBetween(t0: Ms, t1: Ms): Utterance[] {
    return [...this.utterances.values()].filter((u) => u.t <= t1 && (u.tEnd ?? u.t) >= t0).sort((a, b) => a.t - b.t);
  }
}

/** A span inside one recorded media chunk; `start`/`end` are ms offsets from the chunk's own start. */
export interface MediaClip { readonly uri: Uri; readonly mime: string; readonly start: Ms; readonly end: Ms }

/**
 * Where to replay [from, to] of a session: the `stream` chunk covering `anchor` (else the one overlapping the window
 * most), with the window clamped to that chunk. Chunks are self-contained recordings (~10 s), so a clip never spans two.
 */
export function mediaClip(events: readonly Event[], stream: MediaChunk["payload"]["stream"], anchor: Ms, from: Ms, to: Ms, sessionId?: Id): MediaClip | null {
  const chunks = events.filter((e): e is MediaChunk => e.type === "media.chunk" && e.payload.stream === stream && (!sessionId || e.sessionId === sessionId));
  const overlap = (c: MediaChunk) => Math.min(to, c.t + c.payload.durationMs) - Math.max(from, c.t);
  const best = chunks.find((c) => c.t <= anchor && anchor < c.t + c.payload.durationMs)
    ?? chunks.filter((c) => overlap(c) > 0).sort((a, b) => overlap(b) - overlap(a) || a.t - b.t)[0];
  if (!best) return null;
  return {
    uri: best.payload.uri,
    mime: best.payload.mime,
    start: Math.max(0, from - best.t),
    end: Math.min(best.payload.durationMs, to - best.t),
  };
}

export const fmtT = (t: Ms) => {
  const s = t / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};
