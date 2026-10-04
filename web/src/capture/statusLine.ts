/** One human status line for live sessions (Day, Capture, Teach) instead of a row of jargon pills. */
import type { Phase } from "@shared/schema";
import { listenLabel, listenState, type VoiceFlags } from "./adaState";

export interface StatusInput extends VoiceFlags {
  readonly phase: Phase;
  readonly extension: boolean;
  readonly sharing: boolean;
  readonly ended?: boolean;
}

export interface StatusLine {
  readonly tone: "ok" | "off" | "idle";
  readonly text: string;
}

const PHASE_HEAD: Readonly<Record<Phase, string>> = { capture: "Recording", teach: "Practising", debrief: "Debrief", teachback: "Debrief", review: "Review" };

/** "Recording · Ada listening · Extension connected". */
export function statusLine(s: StatusInput): StatusLine {
  if (s.ended) return { tone: "idle", text: "Day ended" };
  const ls = listenState(s);
  const head = s.offRecord ? "Off the record" : PHASE_HEAD[s.phase];
  const voice = ls === "off_record" ? [] : [listenLabel(ls)];
  const source = s.extension ? "Extension connected" : s.sharing ? "Screen shared" : "No extension";
  return { tone: s.offRecord ? "off" : "ok", text: [head, ...voice, source].join(" · ") };
}
