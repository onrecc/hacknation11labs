/**
 * Which hub a work tab follows when several hub tabs broadcast `status` in one browser (e.g. the expert's capture
 * hub is still open while a new hire practises). Hubs re-broadcast every 3 s; a status older than STATUS_TTL_MS
 * counts as gone. A live teach session wins: its save holds must never be switched off by a capture hub's
 * broadcast, and a capture hub must not record the learner's work.
 */
import type { BridgeBody } from "./bridge";
import type { Id } from "./schema";

export type HubStatus = Extract<BridgeBody, { kind: "status" }>;
export type HubStatusBook = ReadonlyArray<{ readonly status: HubStatus; readonly at: number }>;

export const STATUS_TTL_MS = 10_000;

const keyOf = (s: HubStatus) => s.sessionId ?? "";

/** New book with `status` as the latest word of its session. */
export function noteStatus(book: HubStatusBook, status: HubStatus, at: number): HubStatusBook {
  return [...book.filter((x) => keyOf(x.status) !== keyOf(status)), { status, at }];
}

/** The status the work tab should follow now: newest live teach status, else newest status overall. */
export function activeStatus(book: HubStatusBook, now: number): HubStatus | null {
  const newest = [...book].sort((a, b) => b.at - a.at);
  const liveTeach = newest.find((x) => x.status.mode === "teach" && now - x.at <= STATUS_TTL_MS);
  return (liveTeach ?? newest[0])?.status ?? null;
}

/** Is a teach session (other than `self`) live in this browser? */
export function teachLive(book: HubStatusBook, now: number, self?: Id): boolean {
  return book.some((x) => x.status.mode === "teach" && keyOf(x.status) !== (self ?? "\0") && now - x.at <= STATUS_TTL_MS);
}
