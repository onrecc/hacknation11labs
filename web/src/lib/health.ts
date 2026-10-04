/** Nav status: what the api's /health says about AI and voice, as two separate dots. */

export interface Health {
  readonly ok: boolean;
  readonly model: string;
  readonly mock: boolean;
  readonly voice: boolean;
  readonly warning?: string;
}

export type HealthTone = "ok" | "warn" | "off" | "pending" | "mock";

export interface HealthDot {
  readonly tone: HealthTone;
  readonly label: string;
  readonly title: string;
}

/** How often the nav re-checks /health. */
export const HEALTH_RECHECK_MS = 60_000;

/** `undefined` = not checked yet, `null` = api unreachable. */
export function healthView(h: Health | null | undefined): { readonly ai: HealthDot; readonly voice: HealthDot } {
  if (h === undefined) return { ai: { tone: "pending", label: "AI", title: "Checking…" }, voice: { tone: "pending", label: "Voice", title: "Checking…" } };
  if (h === null) {
    const title = "api unreachable (local: npm run api)";
    return { ai: { tone: "off", label: "AI", title: `AI: ${title}` }, voice: { tone: "off", label: "Voice", title: `Voice: ${title}` } };
  }
  // canned answers must be impossible to miss in a demo: a red MOCK label, not just a dot colour
  const ai: HealthDot = h.mock
    ? { tone: "mock", label: "MOCK", title: `AI: canned answers, not a real model${h.warning ? ` (${h.warning})` : ""}` }
    : { tone: "ok", label: "AI", title: `AI: ${h.model}` };
  const voice: HealthDot = h.voice
    ? { tone: "ok", label: "Voice", title: "Voice: ElevenLabs" }
    : { tone: "off", label: "Voice", title: "Voice: no ElevenLabs key, browser speech only" };
  return { ai, voice };
}
