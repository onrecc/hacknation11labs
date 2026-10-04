/**
 * Voice end-to-end: the real Capture page in Chrome for Testing with a FAKE MICROPHONE playing Sabine's answer
 * (ElevenLabs TTS → WAV). Verifies: ElevenAgents interviewer connects, Scribe transcribes the mic, a pause
 * triggers [ASK], the agent's real words are logged, and the spoken answer gets linked.
 *   npm run e2e:voice -w tools      (needs `npm run dev` + `npm run api`)
 */
import puppeteer, { type Page } from "puppeteer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tts } from "../../functions/src/handlers";

const HUB = "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
};

// fake mic: 25 s silence, the answer, 30 s silence (Chrome loops the file)
const dir = mkdtempSync(join(tmpdir(), "voice-e2e-"));
writeFileSync(join(dir, "answer.mp3"), (await tts("Equipment over five thousand euros is always capex. And no asset number, no capex booking.", "pFZP5JQG7iQjIQuC4Bku")).binary);
const wav = join(dir, "mic.wav");
execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-t", "25", "-i", "anullsrc=r=48000:cl=mono", "-i", join(dir, "answer.mp3"), "-f", "lavfi", "-t", "30", "-i", "anullsrc=r=48000:cl=mono",
  "-filter_complex", "[1:a]aresample=48000,aformat=channel_layouts=mono[a];[0:a][a][2:a]concat=n=3:v=0:a=1", "-ar", "16000", "-ac", "1", wav]);
const wavB64 = readFileSync(wav).toString("base64");

const browser = await puppeteer.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1280, height: 860 },
});
/**
 * Synthetic microphone: macOS blocks real/fake capture devices for Chrome for Testing without a system permission,
 * so getUserMedia is replaced with a Web Audio stream playing the WAV in a loop. Everything downstream is our real code.
 */
async function withSyntheticMic(page: Page) {
  await page.evaluateOnNewDocument((b64: string) => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let shared: Promise<MediaStream> | null = null;
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      if (!c?.audio || c.video) return real(c);
      shared ??= (async () => {
        const ctx = new AudioContext({ sampleRate: 48000 });
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        const buf = await ctx.decodeAudioData(bytes.buffer);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const dest = ctx.createMediaStreamDestination();
        src.connect(dest);
        src.start();
        return dest.stream;
      })();
      const s = await shared;
      return new MediaStream(s.getAudioTracks().map((t) => t.clone()));
    };
  }, wavB64);
}
const feed = (p: Page) => p.$$eval(".feed-row", (rows) => rows.map((r) => r.textContent ?? ""));
const click = (p: Page, text: string) => p.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(t))?.click(), text);

try {
  const hub = await browser.newPage();
  await hub.goto(`${HUB}/login`, { waitUntil: "networkidle2" });
  await hub.evaluate(() => localStorage.setItem("apprentice.user", "u_sabine")); // fake login
  await withSyntheticMic(hub);
  hub.on("console", (m) => ["error", "warn"].includes(m.type()) && console.log(`  [hub ${m.type()}]`, m.text().slice(0, 300)));
  hub.on("response", async (r) => r.status() >= 400 && console.log("  [http]", r.status(), r.url().slice(0, 120), (await r.text().catch(() => "")).slice(0, 200)));
  await hub.goto(`${HUB}/capture`, { waitUntil: "networkidle2" });
  await hub.evaluate(() => (window.open = () => null));
  await click(hub, "Start recording with Ada");
  await sleep(2500);
  for (let i = 0; i < 12; i++) {
    await sleep(1500);
    const st = await hub.evaluate(() => { const h = (window as any).__hub; return h ? `${h.state.voiceStatus} voice=${h.state.voice} stt=${h.state.stt} err=${h.state.error}` : "no hub"; });
    console.log("  state:", st);
    if (st.includes("voice=elevenagents")) break;
  }
  const pills = await hub.$$eval(".pill", (ps) => ps.map((p) => p.textContent ?? "").join(" | "));
  check("ElevenAgents interviewer connected", pills.includes("voice: elevenagents"), pills);
  check("Scribe realtime transcribing the mic", pills.includes("stt: scribe_v2_realtime"));

  // the expert works in MiniERP (same browser, other tab)
  const erp = await browser.newPage();
  await erp.goto(`${HUB}/erp?mode=capture`, { waitUntil: "networkidle2" });
  await erp.evaluate(() => localStorage.removeItem("minierp.v1"));
  await erp.reload({ waitUntil: "networkidle2" });
  await sleep(1500);
  await erp.evaluate(() => [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("INV-4471"))?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await sleep(2000);
  await erp.select("#costCenter", "0400");
  await sleep(1500);
  await erp.type("#assetNo", "AN-2026-118\n");
  await sleep(1000);
  await erp.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Save")?.click());
  await sleep(800);
  await erp.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Open items"))?.click());

  // wait for: pause → question → agent speaks → fake mic answer → Scribe → answer.linked
  let rows: string[] = [];
  for (let i = 0; i < 45 && !(rows = await feed(hub)).some((r) => r.includes("answer.linked")); i++) await sleep(2000);
  const q = rows.find((r) => r.includes("agent.question"));
  const turn = rows.find((r) => r.includes("agent.turn"));
  const expert = rows.filter((r) => r.includes("utterance expert"));
  check("pause triggered a live question", !!q, q?.slice(0, 160));
  check("agent turn logged with ElevenAgents' own words", !!turn, turn?.slice(0, 160));
  check("Scribe transcribed the expert's spoken answer", expert.length > 0, expert[0]?.slice(0, 160));
  check("answer linked to the question", rows.some((r) => r.includes("answer.linked")), rows.find((r) => r.includes("answer.linked"))?.slice(0, 160));
  await click(hub, "End task");
  await sleep(1500);
  await click(hub, "Close session");
  await sleep(3000);
  console.log("session:", await hub.evaluate(() => (window as any).__hub?.session.id));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
