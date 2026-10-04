/**
 * Where a tutor intervention comes from, in one line: proves the learner's case is one the expert never showed
 * (or says honestly that it is one they did) and names the case + moment the rule was learned from.
 * Pure: derived from the guardrail's evidence and the Work Map's recorded cases.
 */
import type { Guardrail, ScreenMoment, WorkMap } from "@shared/schema";

type RecordedCase = WorkMap["cases"][number];
type Tone = "block" | "nudge" | "info" | "predict";

/** "INV-4471" for numeric invoice keys, otherwise "<kind> <key>". */
export const caseName = (kind: string, key: string): string => (kind === "invoice" && /^\d+$/.test(key) ? `INV-${key}` : `${kind} ${key}`);

/** mm:ss into the expert's recording. */
const clock = (t: number): string => {
  const s = Math.max(0, Math.floor(t / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** The expert's case a screen moment falls into (same session, inside the case's time span). */
export function sourceCase(wm: WorkMap, m: Pick<ScreenMoment, "sessionId" | "t">): RecordedCase | undefined {
  return wm.cases.find((c) => c.sessionId === m.sessionId && m.t >= c.t && m.t <= c.tEnd);
}

/**
 * "Sabine never worked this invoice. Rule learned from INV-4471 at 00:28."
 * `learnerKey`: the key of the case the learner is working on, when known (structured feed); otherwise only the source is named.
 */
export function provenance(wm: WorkMap, g: Guardrail, learnerKey?: string): string | undefined {
  const m = g.evidence.moments[0] ?? g.evidence.quotes[0];
  if (!m) return undefined;
  const expert = wm.expert.displayName.split(" ")[0] || wm.expert.displayName;
  const src = sourceCase(wm, m);
  const from = src ? `Rule learned from ${caseName(src.kind, src.key)} at ${clock(m.t)}.` : `Rule learned at ${clock(m.t)} in ${expert}'s recording.`;
  if (!learnerKey) return from;
  const noun = src?.kind ?? wm.cases[0]?.kind ?? "case";
  const same = wm.cases.find((c) => c.key === learnerKey);
  if (same) return `${expert} worked this same ${noun} (${caseName(same.kind, same.key)}) while recording. ${from}`;
  return `${expert} never worked this ${noun}. ${from}`;
}

/** Visible severity text, so the card's meaning doesn't rest on colour alone. */
export function severityLabel(tone: Tone): string | undefined {
  return tone === "block" ? "Blocked before save" : tone === "nudge" ? "Heads-up" : undefined;
}

/** Guardrail cards (block / nudge) carry a severity label and where the rule was learned; other cards carry neither. */
export function cardMeta(wm: WorkMap, tone: Tone, g?: Guardrail, learnerKey?: string): { label?: string; provenance?: string } {
  const label = g ? severityLabel(tone) : undefined;
  const prov = label && g ? provenance(wm, g, learnerKey) : undefined;
  return { ...(label ? { label } : {}), ...(prov ? { provenance: prov } : {}) };
}
