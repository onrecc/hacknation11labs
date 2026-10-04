/**
 * The final teach-back check (docs/map.md rule 18), as pure functions: what still blocks "confirmed", and how Ada
 * and the debrief panel say so. The rule stays strict: no confirmation while a high-priority gap is unanswered.
 */
import type { Gap } from "../../../shared/schema";

/** Gaps at or above this priority must be answered before a Work Map can be confirmed. */
export const BLOCKING_PRIORITY = 0.5;

export interface Outcome {
  /** The expert said yes to "Is that how it works?". */
  finalYes: boolean;
  /** Teach-back parts not confirmed last. */
  partsOpen: number;
  /** Unanswered high-priority gaps (blockingGaps). */
  gaps: readonly Gap[];
}

/** High-priority gaps nobody answered yet (open, or asked without an answer), highest priority first. */
export function blockingGaps(gaps: readonly Gap[], threshold = BLOCKING_PRIORITY): Gap[] {
  return gaps.filter((g) => (g.status === "open" || g.status === "asked") && g.priority >= threshold).sort((a, b) => b.priority - a.priority);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Panel line for a map that could not be confirmed ("Not confirmed: 1 open question"); null when it can be. */
export function notConfirmedDetail(o: Outcome): string | null {
  const reasons = [
    o.gaps.length ? plural(o.gaps.length, "open question", "open questions") : "",
    o.partsOpen ? plural(o.partsOpen, "part not confirmed", "parts not confirmed") : "",
    o.finalYes ? "" : "no final yes",
  ].filter(Boolean);
  return reasons.length ? `Not confirmed: ${reasons.join(", ")}` : null;
}

const WH = /^(what|who|which|when|where|why|how)\b/i;
const CANT = "so I can't mark this as confirmed yet.";

/** "what makes a true duplicate" from "What makes a true duplicate?"; null when it doesn't read as an indirect question. */
function indirect(q: string): string | null {
  const bare = q.trim().replace(/[?.!\s]+$/, "");
  if (!WH.test(bare) || /\b(you|your)\b/i.test(bare) || /[?]/.test(bare)) return null;
  return bare.charAt(0).toLowerCase() + bare.slice(1);
}

/** One short sentence Ada says when the map can't be confirmed; null when it can. */
export function notConfirmedSentence(o: Outcome): string | null {
  const [first] = o.gaps;
  if (first) {
    const q = indirect(first.proposedQuestion);
    if (o.gaps.length === 1 && q) return `I still don't know ${q}, ${CANT}`;
    if (o.gaps.length === 1) return `I still don't have an answer to "${first.proposedQuestion.trim()}", ${CANT}`;
    return `I still have ${o.gaps.length} open questions, starting with "${first.proposedQuestion.trim()}", ${CANT}`;
  }
  if (o.partsOpen) return `I'm still not sure about ${plural(o.partsOpen, "part", "parts")} of the process, ${CANT}`;
  if (!o.finalYes) return `I didn't hear a clear yes, ${CANT}`;
  return null;
}
