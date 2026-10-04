/**
 * GOLDEN PATH (the brief's "that's the bar" scenario), end to end on the real stack:
 *   expert logs in → "Start my day" → works 3 invoices in MiniERP, answering Ada's live questions →
 *   "End my day" → "Debrief now" → Map's debrief + teach-back → confirmed Work Map →
 *   a practicer logs in → Training preselects THAT map → new €7,200 equipment invoice on opex → blocked before save.
 *
 *   EXPERT=sabine npm run golden -w tools      (default)  ·  EXPERT=ilse npm run golden -w tools
 *   SKIP_TEACH=1 to stop after the Work Map; TEACH_ONLY=1 to run only Lena's training on the preselected map. Needs `npm run dev` + `npm run api` (real Claude + ElevenLabs).
 * Answers are typed (the hub's typed-utterance path); Ada's voice and Scribe run on a synthetic silent mic.
 * Prints the ids it creates, so cleanup can target exactly those.
 */
import puppeteer, { type Page } from "puppeteer";
import { writeFileSync } from "node:fs";
import { db } from "./admin";

const HUB = "http://localhost:5173";
const EXPERT = (process.env.EXPERT ?? "sabine") as "sabine" | "ilse";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  log(`${ok ? "✔" : "✖"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── how each expert works and what they say (they genuinely differ: that's the "two experts" stretch) ──
const PEOPLE = {
  sabine: {
    userId: "u_sabine",
    hofmann: async (w: Page) => { await w.type("#comment", "Possible duplicate of INV-4431 (DN-88213). Waiting for credit note.\n"); await btn(w, "Hold"); },
    brno: async (w: Page) => { await w.select("#approver", "M. Weber (Controlling)"); await sleep(700); await btn(w, "Send for approval"); },
    answers: [
      [/hold|hofmann|duplicate|december|credit note|releas/i, "Hofmann double-bills us every December. I hold it until I have their credit note, I never pay or reject it straight away. If it's over ten thousand, the AP lead Jonas signs off the release."],
      [/asset|capex|0400|cost cent|threshold|5,?000|five thousand|equipment/i, "Equipment over five thousand euros is always capex, cost center 0400. And no asset number, no capex booking: I ask the controller to create the asset first."],
      [/brno|intercompany|czech|weber|second approv|controll|subsidiar/i, "Brno is our Czech subsidiary. Anything intercompany goes to the controller, Weber, for a second approval, whatever the amount. Transfer pricing."],
    ] as Array<[RegExp, string]>,
  },
  ilse: {
    userId: "u_ilse",
    hofmann: async (w: Page) => { await w.select("#approver", "Jonas (AP lead)"); await sleep(700); await w.type("#comment", "Duplicate DN-88213, Jonas to decide.\n"); await btn(w, "Send for approval"); },
    brno: async (w: Page) => { await w.select("#approver", "Jonas (AP lead)"); await sleep(700); await btn(w, "Send for approval"); },
    answers: [
      [/hold|hofmann|duplicate|december|credit note|releas|jonas/i, "A suspected duplicate goes straight to Jonas, the AP lead, with a comment. I don't park things on hold, held invoices get forgotten at month end."],
      [/asset|capex|0400|cost cent|threshold|5,?000|five thousand|equipment/i, "Anything that's equipment over five thousand euros is capex, 0400, and it needs an asset number before I save it."],
      [/brno|intercompany|czech|weber|second approv|controll|subsidiar/i, "Intercompany from Brno goes to Jonas first. He forwards it to controlling only when it's over ten thousand, otherwise he approves it himself."],
    ] as Array<[RegExp, string]>,
  },
}[EXPERT];

const DEFAULT = "Only in that case. Otherwise I book it normally, and if I'm unsure I ask the controller.";
function answerFor(q: string): string {
  if (/whole process|how it works\?/i.test(q)) return "Yes. That's how it works.";
  if (/is that right/i.test(q)) return "Yes, that's right.";
  if (/anything else|did i miss/i.test(q)) return "No, that's all.";
  return PEOPLE.answers.find(([re]) => re.test(q))?.[1] ?? DEFAULT;
}

async function btn(p: Page, label: string) {
  await p.evaluate((l) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === l)?.click(), label);
  await sleep(900);
}
const click = (p: Page, text: string) => p.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(t))?.click(), text);

/** Answer whenever Ada waits for a reply (live question or debrief), typed like the fallback box does. */
function autoAnswer(hub: Page, until: () => boolean) {
  const answered = new Set<string>();
  return (async () => {
    while (!until()) {
      const q = await hub.evaluate(() => {
        const h = (window as any).__hub;
        if (!h) return null;
        const waiting = (h.replyWaiter && !h.replyWaiter.replies.length) || (h.pending && !h.pending.replies.length);
        if (!waiting || h.state.agentSpeaking) return null;
        const turns = h.events.filter((e: any) => e.type === "agent.turn" || e.type === "agent.question");
        const last = turns[turns.length - 1];
        return last ? { id: last.id as string, text: (last.payload.text as string) ?? "" } : null;
      }).catch(() => null);
      if (q && !answered.has(q.id)) {
        answered.add(q.id);
        const a = answerFor(q.text);
        log(`   Ada: ${q.text.slice(0, 110)}`);
        log(`   ${EXPERT}: ${a.slice(0, 110)}`);
        await sleep(1500);
        await hub.evaluate((txt) => (window as any).__hub.typeUtterance(txt), a);
      }
      await sleep(1000);
    }
  })();
}

// the Chrome extension screenshots the work tab (frames → screen moments: every Work Map step needs one)
const EXT = new URL("../../extension/dist/chrome", import.meta.url).pathname;
const browser = await puppeteer.launch({
  headless: !process.env.HEADFUL, defaultViewport: { width: 1280, height: 900 },
  args: ["--autoplay-policy=no-user-gesture-required", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  ignoreDefaultArgs: ["--disable-extensions"],
});
// silent synthetic mic: lets ElevenAgents + Scribe start in a test browser (answers are typed)
const silentMic = (p: Page) => p.evaluateOnNewDocument(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(dest);
    osc.start();
    return dest.stream;
  };
});

const result: Record<string, unknown> = { expert: EXPERT };
// TEACH_ONLY=1: skip recording; Lena trains on whatever map Training preselects (fast check of the Teach part)
const TEACH_ONLY = !!process.env.TEACH_ONLY;
let wm: { workMapId: string; sid?: string } = { workMapId: "" };
try {
  if (!TEACH_ONLY) {
    // ── 1. expert's day ──
    const hub = await browser.newPage();
    await silentMic(hub);
    hub.on("console", (m) => m.type() === "error" && !/404|favicon/.test(m.text()) && log("   [console]", m.text().slice(0, 160)));
    await hub.goto(`${HUB}/login`, { waitUntil: "networkidle2" });
    await hub.evaluate((u) => { localStorage.setItem("apprentice.user", u); localStorage.removeItem("apprentice.idleMs"); }, PEOPLE.userId);
    await hub.goto(`${HUB}/day`, { waitUntil: "networkidle2" });
    await hub.evaluate(() => (window.open = () => null, [...document.querySelectorAll("input[type=checkbox]")].forEach((c) => (c as HTMLInputElement).checked && (c as HTMLInputElement).click()))); // vision off: keeps the run fast and cheap
    await click(hub, "Start a new day");
    await click(hub, "Start my day");
    for (let i = 0; i < 20 && !(await hub.evaluate(() => (window as any).__hub?.state.voice !== "-" && !!(window as any).__hub)).valueOf(); i++) await sleep(1000);
    const voice = await hub.evaluate(() => `${(window as any).__hub?.state.voice} / ${(window as any).__hub?.state.stt}`);
    check("day started with Ada listening", /elevenagents|elevenlabs/.test(voice), voice);
    result.workdayId = await hub.evaluate(() => (window as any).__rec.workday.id);

    let stop = false;
    const answering = autoAnswer(hub, () => stop);

    const work = await browser.newPage();
    await work.goto(`${HUB}/erp?mode=capture`, { waitUntil: "networkidle2" });
    await work.evaluate(() => localStorage.removeItem("minierp.v1"));
    await work.reload({ waitUntil: "networkidle2" });
    await work.bringToFront(); // the extension captures the active tab
    await sleep(1500);
    const openInv = async (key: string) => {
      await work.evaluate((k) => [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes(`INV-${k}`))?.dispatchEvent(new MouseEvent("click", { bubbles: true })), key);
      await sleep(2500);
    };
    const backToList = async () => {
      await work.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Open items"))?.click());
      await sleep(1000);
    };
    /** wait until Ada has asked about this case and it's been answered (or 75 s) */
    const waitForAnswer = async (label: string) => {
      const start = Date.now();
      const before = await hub.evaluate(() => (window as any).__hub.events.filter((e: any) => e.type === "answer.linked").length);
      while (Date.now() - start < 75_000) {
        await sleep(2000);
        const n = await hub.evaluate(() => (window as any).__hub.events.filter((e: any) => e.type === "answer.linked").length);
        if (n > before) return log(`   ✓ ${label}: answer linked`);
      }
      log(`   (no live question for ${label} within 75 s)`);
    };

    // case 1: Krauss, €7,850 equipment → capex + asset
    await openInv("4471");
    await work.select("#costCenter", "0400");
    await sleep(800);
    await work.type("#assetNo", "AN-2026-118\n");
    await btn(work, "Save");
    await backToList();
    await waitForAnswer("Krauss");
    // case 2: Hofmann December duplicate
    await openInv("4472");
    await work.click(".actions input");
    await work.type(".actions input", "Hofmann");
    await btn(work, "Search history");
    await sleep(2500);
    await work.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Back"))?.click());
    await sleep(1500);
    await PEOPLE.hofmann(work);
    await backToList();
    await waitForAnswer("Hofmann");
    // case 3: Brno intercompany
    await openInv("4473");
    await PEOPLE.brno(work);
    await backToList();
    await waitForAnswer("Brno");

    const live = await hub.evaluate(() => (window as any).__hub.events.filter((e: any) => e.type === "agent.question" && e.phase === "capture").map((e: any) => `[${e.payload.category}] ${e.payload.text}`));
    check("≥3 live questions at pauses", live.length >= 3, `${live.length}: ${live.join(" | ").slice(0, 300)}`);
    check("≥1 live guardrail question", live.some((q: string) => /guardrail_limit|exception|stop_and_ask|never_do|who_decides/.test(q)));

    const frames = await hub.evaluate(() => `${(window as any).__hub.state.frames} frames from ${(window as any).__hub.state.frameSource}`);
    check("screen frames captured by the extension", /^[1-9]\d* frames from extension/.test(frames), frames);

    // ── 2. end of day → debrief task 1 ──
    await click(hub, "End my day");
    await sleep(4000);
    const tasks = await hub.evaluate(() => (window as any).__rec.workday.tasks.filter((t: any) => t.status !== "interruption").map((t: any) => ({ id: t.sessionId, title: t.title, actions: t.actions })));
    log("   tasks:", JSON.stringify(tasks));
    const task = tasks.sort((a: any, b: any) => b.actions - a.actions)[0];
    result.taskSessionId = task.id;
    check("the invoice work is one named task", !!task && task.actions >= 8 && !/Detecting/.test(task.title), `${task?.title} (${task?.actions} actions)`);

    await hub.evaluate((id) => [...document.querySelectorAll(".tasks li")].find((li) => li.querySelector("a")?.getAttribute("href")?.endsWith(id))?.querySelector("button")?.click(), task.id);
    log("   debrief started");
    let stage = "";
    const dStart = Date.now();
    while (Date.now() - dStart < 15 * 60_000) {
      await sleep(5000);
      const s = await hub.$eval(".debrief-panel .kicker", (e) => e.textContent ?? "").catch(() => "");
      if (s !== stage) log(`   debrief: ${(stage = s)}`);
      if (/confirmed|went wrong/i.test(s)) break;
    }
    stop = true;
    await answering;
    wm = await hub.evaluate(async (sid) => {
      const h = (window as any).__hub;
      return { workMapId: h.session.workMapId, sid };
    }, task.id);
    result.workMapId = wm.workMapId;
    check("debrief ended with a confirmed Work Map", /confirmed/i.test(stage), stage);
    const head = (await db.doc(`workmaps/${wm.workMapId}`).get()).data();
    const map = head && JSON.parse((await db.doc(`workmaps/${wm.workMapId}/versions/${String(head.latestVersion).padStart(4, "0")}`).get()).get("json"));
    check(`the Work Map has steps and guardrails in ${EXPERT}'s words`, map?.steps.length >= 3 && map?.guardrails.length >= 2,
      `${map?.steps.length} steps, ${map?.guardrails.length} guardrails: ${map?.guardrails.map((g: any) => g.statement).join(" / ").slice(0, 300)}`);
    const debriefQs = await hub.evaluate(() => (window as any).__hub.events.filter((e: any) => e.type === "agent.question" && e.phase === "debrief").length);
    check("≥3 debrief questions", debriefQs >= 3, String(debriefQs));
    await hub.screenshot({ path: `../docs/brag/golden-${EXPERT}-debrief.png` }).catch(() => {});
  }


  // ── 3. practicer trains on THIS map ──
  if (!process.env.SKIP_TEACH && EXPERT === "sabine") {
    const lena = await browser.newPage();
    await silentMic(lena);
    await lena.goto(`${HUB}/login`, { waitUntil: "networkidle2" });
    await lena.evaluate(() => localStorage.setItem("apprentice.user", "u_lena"));
    await lena.goto(`${HUB}/learn`, { waitUntil: "networkidle2" });
    await lena.waitForFunction(() => (document.querySelector("select") as HTMLSelectElement | null)?.value, { timeout: 30_000 });
    const picked = await lena.$eval("select", (s) => (s as HTMLSelectElement).value);
    if (TEACH_ONLY) log(`   training on preselected map ${picked}`);
    else check("Training preselects the new Work Map", picked === wm.workMapId, `${picked} vs ${wm.workMapId}`);
    await lena.evaluate(() => (window.open = () => null));
    await click(lena, "Start practising with Ada");
    await sleep(3000);
    result.teachSessionId = await lena.evaluate(() => (window as any).__hub?.session.id);
    const erp = await browser.newPage();
    await erp.goto(`${HUB}/erp?mode=teach`, { waitUntil: "networkidle2" });
    await erp.evaluate(() => localStorage.removeItem("minierp.v1"));
    await erp.reload({ waitUntil: "networkidle2" });
    await sleep(2000);
    await erp.evaluate(() => [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("INV-4490"))?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await sleep(3000);
    await btn(erp, "Approve");
    await sleep(12_000);
    const banner = await erp.evaluate(() => document.getElementById("ai-apprentice-overlay")?.shadowRoot?.querySelector(".card h4")?.textContent ?? ""); // the extension overlay's coaching card
    const status = await erp.evaluate(() => [...document.querySelectorAll(".form input")].at(-1)?.getAttribute("value") ?? (document.querySelectorAll(".form input")[document.querySelectorAll(".form input").length - 1] as HTMLInputElement)?.value);
    check("new hire's wrong save (opex on €7,200 equipment) is blocked by Sabine's map", /hold on|held|blocked/i.test(banner) && status !== "approved", `${banner} · status ${status}`);
    const cards = await lena.$$eval(".intervention h3, .intervention p", (els) => els.map((e) => e.textContent ?? "").slice(0, 4));
    log("   tutor:", cards.join(" | ").slice(0, 300));
    await erp.screenshot({ path: "../docs/brag/golden-teach-blocked.png" }).catch(() => {});

    // the truly NEW case: never shown in the recording, a different rule (Czech subsidiary → controller as 2nd approver)
    const card = () => erp.evaluate(() => document.getElementById("ai-apprentice-overlay")?.shadowRoot?.querySelector(".card h4")?.textContent ?? "");
    const statusNow = () => erp.evaluate(() => (document.querySelectorAll(".form input")[document.querySelectorAll(".form input").length - 1] as HTMLInputElement)?.value);
    await btn(erp, "← Open items");
    await sleep(1500);
    await erp.evaluate(() => [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("INV-4494"))?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await sleep(3000);
    await btn(erp, "Approve");
    await sleep(6000);
    const held = await card(), s1 = await statusNow();
    check("new case INV-4494 (Brno spare parts, never shown): Approve without a 2nd approver is held by the intercompany rule",
      /held|hold on|blocked/i.test(held) && /intercompany|weber|second|2nd|brno/i.test(held) && s1 !== "approved", `${held} · status ${s1}`);
    await erp.screenshot({ path: "../docs/brag/golden-teach-new-case.png" }).catch(() => {});
    await erp.select("#approver", "M. Weber (Controlling)");
    await sleep(2000);
    await btn(erp, "Send for approval");
    await sleep(5000);
    const s2 = await statusNow();
    check("…with M. Weber as 2nd approver, Send for approval goes through", s2 === "awaiting_approval", `status ${s2}`);
    await click(lena, "Finish");
    await sleep(4000);
  }
} finally {
  writeFileSync(`golden-${EXPERT}.json`, JSON.stringify(result, null, 2));
  log("created:", JSON.stringify(result));
  await browser.close();
}
log(failures ? `${failures} check(s) failed` : "golden path passed");
process.exit(failures ? 1 : 0);
