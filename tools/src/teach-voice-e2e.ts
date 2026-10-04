/**
 * Teach voice end-to-end: the real Teach page in Chrome for Testing with a FAKE MICROPHONE playing Sabine's answer
 * (ElevenLabs TTS → WAV). Verifies: ElevenAgents interviewer connects, Scribe transcribes the mic, a pause
 * triggers [ASK], the agent's real words are logged, and the spoken answer gets linked.
 *   npm run e2e:teach-voice -w tools      (needs `npm run dev` + `npm run api`)
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
writeFileSync(join(dir, "answer.mp3"), (await tts("Because it is equipment over five thousand euros, so it has to be capex?", "cgSgspJ2msm6clMCkdW9")).binary);
const wav = join(dir, "mic.wav");
execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-t", "25", "-i", "anullsrc=r=48000:cl=mono", "-i", join(dir, "answer.mp3"), "-f", "lavfi", "-t", "30", "-i", "anullsrc=r=48000:cl=mono",
  "-filter_complex", "[1:a]aresample=48000,aformat=channel_layouts=mono[a];[0:a][a][2:a]concat=n=3:v=0:a=1", "-ar", "16000", "-ac", "1", wav]);
const wavB64 = readFileSync(wav).toString("base64");

// coaching runs in the browser extension (overlay + save hold), like on any site
const EXT = new URL("../../extension/dist/chrome", import.meta.url).pathname;
const browser = await puppeteer.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  ignoreDefaultArgs: ["--disable-extensions"],
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
  await hub.evaluate(() => localStorage.setItem("apprentice.user", "u_lena")); // fake login
  await withSyntheticMic(hub);
  hub.on("console", (m) => m.type() === "error" && !m.text().includes("404") && console.log("  [hub error]", m.text().slice(0, 200)));
  await hub.goto(`${HUB}/learn`, { waitUntil: "networkidle2" });
  await hub.waitForFunction(() => (document.querySelector("select") as HTMLSelectElement | null)?.value, { timeout: 20_000 });
  await hub.evaluate(() => (window.open = () => null));
  await click(hub, "Start practising with Ada");
  await sleep(2500);
  for (let i = 0; i < 12; i++) {
    await sleep(1500);
    const st = await hub.evaluate(() => (window as any).__hub?.state.voice);
    if (st === "elevenagents") break;
  }
  const pills = await hub.$$eval(".pill", (ps) => ps.map((p) => p.textContent ?? "").join(" | "));
  check("ElevenAgents tutor connected", pills.includes("voice: elevenagents"), pills);

  const erp = await browser.newPage();
  await erp.goto(`${HUB}/erp?mode=teach`, { waitUntil: "networkidle2" });
  await erp.evaluate(() => localStorage.removeItem("minierp.v1"));
  await erp.reload({ waitUntil: "networkidle2" });
  await sleep(1500);
  await erp.evaluate(() => [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("INV-4490"))?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await sleep(1500);
  await erp.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Approve")?.click());
  await sleep(3000);
  const banner = await erp.evaluate(() => document.getElementById("protege-overlay")?.shadowRoot?.querySelector(".card h4")?.textContent ?? "");
  check("save held before it happened (extension overlay)", /hold on|held|blocked/i.test(banner), banner);

  let rows: string[] = [];
  if (process.env.TRACE) for (let i = 0; i < 16; i++) {
    console.log("  trace", await hub.evaluate(() => { const h = (window as any).__hub; return `t=${(h.now() / 1000).toFixed(1)} waiter=${!!h.replyWaiter} timer=${!!h.replyWaiter?.timer} replies=${h.replyWaiter?.replies.length ?? "-"} listening=${h.listening} speaking=${h.state.agentSpeaking} `; }));
    await sleep(2000);
  }
  for (let i = 0; i < 30; i++) {
    rows = await feed(hub);
    if (rows.some((r) => r.includes("agent.turn") && /sabine/i.test(r) && /capex|five thousand|5,000|zero four/i.test(r) && !/stop here/i.test(r))) break;
    await sleep(2000);
  }
  const turns = rows.filter((r) => r.includes("agent.turn")).reverse();
  console.log(turns.map((t) => "   " + t.slice(0, 220)).join("\n"));
  check("tutor asked Socratically", turns.some((t) => /why/i.test(t) && /stop/i.test(t)));
  check("new hire's spoken answer transcribed by Scribe", rows.some((r) => r.includes("utterance newhire")), rows.find((r) => r.includes("utterance newhire"))?.slice(0, 160));
  check("tutor explained in the expert's words", turns.some((t) => /sabine|\[PERSON\]/i.test(t) && /capex|five thousand|5,000/i.test(t) && !/stop here/i.test(t)));
  check("intervention logged", rows.some((r) => r.includes("tutor.intervention")));
  await click(hub, "Finish");
  await sleep(4000);
  console.log("session:", await hub.evaluate(() => (window as any).__hub?.session.id));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
