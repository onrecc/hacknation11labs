/** Nav status: what the api's /health says about AI and voice, as two separate dots. */

export interface Health {
  readonly ok: boolean;
  readonly model: string;
  readonly mock: boolean;
  readonly voice: boolean;
  readonly warning?: string;
}

export type HealthTone = "ok" | "warn" | "off" | "pending";

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
  const ai: HealthDot = h.mock
    ? { tone: "warn", label: "AI", title: `AI: canned answers${h.warning ? ` (${h.warning})` : ""}` }
    : { tone: "ok", label: "AI", title: `AI: ${h.model}` };
  const voice: HealthDot = h.voice
    ? { tone: "ok", label: "Voice", title: "Voice: ElevenLabs" }
    : { tone: "off", label: "Voice", title: "Voice: no ElevenLabs key, browser speech only" };
  return { ai, voice };
}
