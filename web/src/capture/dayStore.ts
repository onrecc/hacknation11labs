/**
 * The running day, kept outside My day's component: opening a Work Map (or any other page) mid-day and coming back
 * finds the same recorder and the same go-over with its progress, instead of a second recorder on top of the first.
 * Its own module so editing DayPage.tsx hot-swaps the page in dev instead of reloading it (and killing the day).
 */
import { useSyncExternalStore } from "react";
import type { Id } from "@shared/schema";
import type { DebriefStatus } from "../map/debrief";
import type { WorkdayRecorder } from "./workday";

/** How going over a task ended: Work Map confirmed, gone over but not every part confirmed, or it broke off. */
export type Result = "confirmed" | "incomplete" | "failed";
/** What is being gone over: one task mid-day, the day's tasks in turn, or one task of an earlier day. */
export interface GoOver { mode: "task" | "day" | "earlier"; queue: Id[]; at: number }

export interface DayState {
  rec: WorkdayRecorder | null;
  debrief: DebriefStatus | null;
  debriefing: Id | null;
  goOver: GoOver | null;
  results: Record<Id, Result>;
  /** Has the expert gone to their work (and come back)? Drives step 2's prompt and the "Welcome back". */
  away: "never" | "away" | "back";
}

const EMPTY: DayState = { rec: null, debrief: null, debriefing: null, goOver: null, results: {}, away: "never" };
let day: DayState = EMPTY;
const listeners = new Set<() => void>();

export function setDay(patch: Partial<DayState> | ((d: DayState) => Partial<DayState>)): void {
  day = { ...day, ...(typeof patch === "function" ? patch(day) : patch) };
  listeners.forEach((l) => l());
}

export const useDay = (): DayState => useSyncExternalStore((fn) => (listeners.add(fn), () => void listeners.delete(fn)), () => day);

/** "Switch user": the running day (mic, recording, overlay) ends with the person. */
export async function stopRunningDay(): Promise<void> {
  const r = day.rec;
  setDay(EMPTY);
  await r?.close().catch(() => {});
}
