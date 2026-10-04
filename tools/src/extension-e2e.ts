/**
 * End-to-end test of the REAL browser extension (Chrome for Testing + dist/chrome, or BROWSER=firefox → Firefox + dist/firefox):
 * hub tab on http://localhost:5173, work tab on http://[::1]:5173 (a different origin, so only the
 * extension's background relay can connect them).
 *   npm run build:extension && npm run e2e:extension -w tools      (needs `npm run dev` + `npm run api`)
 *   BROWSER=firefox npm run e2e:extension -w tools                 (first: npx puppeteer browsers install firefox)
 */
import puppeteer, { type Page } from "puppeteer";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSER = (process.env.BROWSER ?? "chrome") as "chrome" | "firefox";
const EXT = fileURLToPath(new URL(`../../extension/dist/${BROWSER}`, import.meta.url));
const HUB = "http://localhost:5173";
const WORK = "http://[::1]:5173/demo/procurex.html"; // IPv6 literal = a different origin than localhost
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
};

const browser =
  BROWSER === "firefox"
    ? await puppeteer.launch({
        browser: "firefox", headless: !process.env.HEADFUL, defaultViewport: { width: 1280, height: 860 },
        userDataDir: mkdtempSync(join(tmpdir(), "ff-profile-")), // explicit profile dir (the default one isn't always found)
      })
    : await puppeteer.launch({
        headless: process.env.HEADFUL ? false : true,
        args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--window-size=1280,900"],
        ignoreDefaultArgs: ["--disable-extensions"],
        defaultViewport: { width: 1280, height: 860 },
      });
if (BROWSER === "firefox") console.log("installed temporary add-on:", await browser.installExtension(EXT));
console.log(`browser: ${BROWSER} ${await browser.version()}`);

const overlay = (p: Page) =>
  p.evaluate(() => {
    const r = document.getElementById("ai-apprentice-overlay")?.shadowRoot;
    return { exists: !!r, pill: r?.querySelector(".pill")?.textContent ?? "", card: r?.querySelector(".card h4")?.textContent ?? "", ext: document.documentElement.dataset.apprenticeExt ?? "" };
  });
const feed = (p: Page) => p.$$eval(".feed-row", (rows) => rows.map((r) => r.textContent ?? ""));
const clickButton = (p: Page, text: string) =>
  p.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(t))?.click(), text);

try {
  // ── Teach on a foreign-origin app ──
  const hub = await browser.newPage();
  await hub.goto(`${HUB}/login`, { waitUntil: "networkidle2" });
  await hub.evaluate(() => localStorage.setItem("apprentice.user", "u_lena")); // fake login (practicer)
  await hub.goto(`${HUB}/learn`, { waitUntil: "networkidle2" });
  await hub.waitForFunction(() => (document.querySelector("select") as HTMLSelectElement | null)?.value, { timeout: 20_000 });
  await hub.evaluate(() => (window.open = () => null));
  await clickButton(hub, "Start practising with Ada");
  await sleep(2500);
  console.log(`teach session: ${await hub.evaluate(() => (window as any).__hub?.session.id)}`);

  const work = await browser.newPage();
  await work.goto(WORK, { waitUntil: "networkidle2" });
  await sleep(4000);
  let o = await overlay(work);
  check("extension content script runs on the work tab", o.ext === "1");
  check("overlay shows teach status via cross-origin relay", o.pill.includes("Ada is coaching"), o.pill);

  await work.click("#submit");
  await sleep(17000); // the hold waits for the LLM check (up to 15 s under a rate budget)
  const toast = await work.$eval("#toast", (e) => e.textContent ?? "");
  o = await overlay(work);
  check("wrong submit is held (not submitted)", toast === "", `toast="${toast}"`);
  check("guardrail card shown on the work tab", /held|blocked/i.test(o.card), o.card);
  check("hub logged tutor.intervention", (await feed(hub)).some((r) => r.includes("tutor.intervention")));

  await work.select("#gl", "0400");
  await work.type("#asset", "AN-2026-140");
  await work.click("#why");
  await work.click("#submit");
  await sleep(17000);
  check("fixed submit goes through", (await work.$eval("#toast", (e) => e.textContent ?? "")).includes("Submitted"));

  // Enter in a field = implicit form submission (here through an "OK" button the click hold doesn't match):
  // it must be held and checked like a click on Save/Submit
  await work.evaluate(() => {
    const f = document.createElement("form");
    f.id = "quick";
    f.innerHTML = '<input id="po" name="po_number" value="PO-7781"><input id="note" name="note" value="rush order"><button id="ok">OK</button>';
    f.addEventListener("submit", (e) => (e.preventDefault(), (document.getElementById("toast")!.textContent = "Quick form sent")));
    document.querySelector("main")!.append(f);
  });
  await work.focus("#note");
  await work.keyboard.press("Enter");
  await sleep(150);
  const checking = await work.$eval("#ok", (b) => b.getAttribute("title") ?? "");
  check("Enter-key submit is held for the check", /checking this against/i.test(checking), checking || "(no hold)");
  await sleep(16000);
  check("held Enter-key submit goes through once checked", (await work.$eval("#toast", (e) => e.textContent ?? "")) === "Quick form sent", await work.$eval("#toast", (e) => e.textContent ?? ""));

  // ── Capture on a foreign-origin app (DOM events + tab screenshots) ──
  await hub.bringToFront();
  await hub.evaluate(() => localStorage.setItem("apprentice.user", "u_sabine")); // fake login (expert)
  await hub.goto(`${HUB}/capture`, { waitUntil: "networkidle2" });
  await hub.evaluate(() => (window.open = () => null));
  await clickButton(hub, "Start recording with Ada");
  await sleep(3000);
  await work.bringToFront();
  await work.goto(WORK, { waitUntil: "networkidle2" });
  await sleep(4000);
  o = await overlay(work);
  check("overlay shows recording status", o.pill.includes("learning from"), o.pill);
  await work.select("#category", "Consumables");
  await sleep(2500);
  await work.click("#save");
  await sleep(9000);
  const rows = await feed(hub);
  check("hub received labeled field change from the foreign tab", rows.some((r) => r.includes('Set "Category"') && r.includes("Consumables")), rows.find((r) => r.includes("Category")) ?? "");
  const pills = await hub.$$eval(".pill", (ps) => ps.map((p) => p.textContent ?? "").join(" | "));
  check("frames captured from extension screenshots", /frames from: extension/.test(pills) && !/frames: 0\b/.test(pills), pills);
  check("pause detector reacted", rows.some((r) => r.includes("pause.detected")));
  const blurred = await hub.evaluate(() => (window as any).__hub.events.filter((e: any) => e.type === "frame.captured").map((e: any) => e.payload.piiBlurred ?? 0));
  check("IBAN field blurred in frames before upload/vision", blurred.length > 0 && blurred.every((n: number) => n >= 1), `piiBlurred per frame: ${blurred.join(",")}`);
  await clickButton(hub, "End task");
  await sleep(1500);
  await clickButton(hub, "Close session");
  await sleep(3000);
  const sid = await hub.evaluate(() => (window as any).__hub?.session.id);
  console.log(`capture session: ${sid}`);

  // ── no answer from the hub (tab gone): the save stays held, never waved through ──
  await hub.close();
  const hub2 = await browser.newPage();
  await hub2.goto(`${HUB}/login`, { waitUntil: "networkidle2" });
  await hub2.evaluate(() => localStorage.setItem("apprentice.user", "u_lena"));
  await hub2.goto(`${HUB}/learn`, { waitUntil: "networkidle2" });
  await hub2.waitForFunction(() => (document.querySelector("select") as HTMLSelectElement | null)?.value, { timeout: 30_000 });
  await hub2.evaluate(() => (window.open = () => null));
  await clickButton(hub2, "Start practising with Ada");
  await sleep(2500);
  console.log(`teach session (timeout test): ${await hub2.evaluate(() => (window as any).__hub?.session.id)}`);
  await work.bringToFront();
  await work.goto(WORK, { waitUntil: "networkidle2" });
  await sleep(4000);
  await hub2.close();
  await sleep(500);
  await work.click("#submit");
  await sleep(17000);
  const toast2 = await work.$eval("#toast", (e) => e.textContent ?? "");
  o = await overlay(work);
  check("no answer in time = held, not submitted", toast2 === "", `toast="${toast2}"`);
  check("'couldn't verify' card shown", /couldn.t verify/i.test(o.card), o.card || "(no card)");
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
