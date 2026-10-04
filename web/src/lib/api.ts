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

export const llm = <T extends LlmTask>(task: T, input: LlmInput<T>) => post<LlmOutput<T>>("/llm", { task, input });
export const voiceToken = (kind: "agent" | "scribe", agentId?: string) => post<{ signedUrl?: string; token?: string }>("/voice-token", { kind, agentId });
/** ElevenLabs TTS (mp3) through the api. */
export async function tts(text: string, voiceId?: string): Promise<Blob> {
  await signedIn;
  const token = await auth.currentUser!.getIdToken();
  const r = await fetch(`${BASE}/tts`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ text, voiceId }) });
  if (!r.ok) throw new Error(`/tts → ${r.status}`);
  return r.blob();
}
export const apiHealth = () => fetch(`${BASE}/health`).then((r) => r.json() as Promise<{ ok: boolean; provider: string; model: string; mock: boolean; voice: boolean; warning?: string }>);
