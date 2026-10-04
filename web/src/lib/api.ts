/** Calls the `api` function (or the local dev server) with the user's Firebase ID token. */
import type { LlmInput, LlmOutput, LlmTask } from "@shared/llm";
import { auth, signedIn } from "./firebase";

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

async function post<T>(path: string, body: unknown): Promise<T> {
  await signedIn;
  const token = await auth.currentUser!.getIdToken();
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `${path} → ${r.status}`);
  return j;
}

const served = new WeakMap<object, string>();
/** Which model answered this llm() result ("mock" for canned answers): for the model.call log. */
export const servedBy = (out: unknown): string => (out && typeof out === "object" ? served.get(out) : undefined) ?? "unknown";

export async function llm<T extends LlmTask>(task: T, input: LlmInput<T>): Promise<LlmOutput<T>> {
  const { _model, ...out } = await post<LlmOutput<T> & { _model?: string }>("/llm", { task, input });
  if (_model) served.set(out, _model);
  return out as LlmOutput<T>;
}
export const voiceToken = (kind: "agent" | "scribe", agentId?: string) => post<{ signedUrl?: string; token?: string }>("/voice-token", { kind, agentId });
/** ElevenLabs TTS (mp3) through the api. */
export async function tts(text: string, voiceId?: string): Promise<Blob> {
  await signedIn;
  const token = await auth.currentUser!.getIdToken();
  const r = await fetch(`${BASE}/tts`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ text, voiceId }) });
  if (!r.ok) throw new Error(`/tts → ${r.status}`);
  return r.blob();
}
export const apiHealth = () => fetch(`${BASE}/health`).then((r) => r.json() as Promise<{ ok: boolean; provider: string; model: string; mock: boolean; warning?: string; voice: boolean }>);
