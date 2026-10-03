/**
 * Scribe v2 Realtime check (no mic): synthesizes speech with ElevenLabs TTS, converts to 16 kHz PCM with ffmpeg,
 * streams it in real time and prints committed transcripts with word timestamps.
 *   npm run scribe-test -w tools
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Scribe, AudioFormat, CommitStrategy, RealtimeEvents } from "@elevenlabs/client";
import { tts, voiceToken } from "../../functions/src/handlers";

const dir = mkdtempSync(join(tmpdir(), "scribe-"));
const text = "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand.";
writeFileSync(join(dir, "a.mp3"), (await tts(text)).binary);
execFileSync("ffmpeg", ["-loglevel", "error", "-i", join(dir, "a.mp3"), "-ar", "16000", "-ac", "1", "-f", "s16le", join(dir, "a.pcm")]);
const pcm = readFileSync(join(dir, "a.pcm"));
const silence = Buffer.alloc(16000 * 2 * 2); // 2 s, lets VAD commit

const { token } = await voiceToken("scribe");
const conn = Scribe.connect({ token: token!, modelId: "scribe_v2_realtime", audioFormat: AudioFormat.PCM_16000, sampleRate: 16000, includeTimestamps: true, commitStrategy: CommitStrategy.VAD, languageCode: "en" });
const t0 = Date.now();
conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (m) => process.stdout.write(`\r  partial @${Date.now() - t0}ms: ${m.text.slice(0, 70)}   `));
conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, (m) => {
  console.log(`\n  COMMITTED @${Date.now() - t0}ms: "${m.text}"`);
  console.log("  words:", (m.words ?? []).filter((w) => w.type === "word").map((w) => `${w.text}[${w.start?.toFixed(2)}-${w.end?.toFixed(2)}]`).join(" "));
});
conn.on(RealtimeEvents.ERROR, (e) => console.log("\n  error", e));
await new Promise((r) => conn.on(RealtimeEvents.SESSION_STARTED, () => r(null)));
const audio = Buffer.concat([pcm, silence, pcm, silence]);
const chunk = 16000 * 2 / 10; // 100 ms
for (let i = 0; i < audio.length; i += chunk) {
  conn.send({ audioBase64: audio.subarray(i, i + chunk).toString("base64") });
  await new Promise((r) => setTimeout(r, 100));
}
await new Promise((r) => setTimeout(r, 2500));
conn.close();
console.log(`\n(audio ${(pcm.length / 32000).toFixed(1)} s)`);
