/**
 * Captures the product screenshots used by docs/BRAG.md (launch video / pitch). 1440×900 @2x into docs/brag/.
 *   npm run brag:shots -w tools      (needs `npm run dev` + `npm run api`)
 * Shots that need live LLM (Claude) output (task names, comparisons) come from the golden-path run instead.
 */
import puppeteer, { type Page } from "puppeteer";

const HUB = "http://localhost:5173";
const OUT = new URL("../../docs/brag/", import.meta.url).pathname;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// coaching runs in the browser extension (overlay + save hold), like on any site
const EXT = new URL("../../extension/dist/chrome", import.meta.url).pathname;
const browser = await puppeteer.launch({
  headless: true, defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], ignoreDefaultArgs: ["--disable-extensions"],
});
const shot = async (p: Page, name: string, full = false) => {
  await p.screenshot({ path: `${OUT}${name}.png`, fullPage: full });
  console.log("✔", name);
};
const as = async (p: Page, user: string, path: string, wait = 2500) => {
  await p.goto(`${HUB}/login`, { waitUntil: "networkidle2" });
  await p.evaluate((u) => (u ? localStorage.setItem("apprentice.user", u) : localStorage.removeItem("apprentice.user")), user);
  await p.goto(`${HUB}${path}`, { waitUntil: "networkidle2" });
  await sleep(wait);
};
const created: string[] = [];
try {
  const p = await browser.newPage();
  // 1. login
  await as(p, "", "/login");
  await shot(p, "01-login");
  // 2. expert's day, before starting
  await as(p, "u_sabine", "/day");
  await shot(p, "02-my-day");
  // 3. Work Map (bundled demo, no Firebase needed)
  await as(p, "u_sabine", "/map/demo", 4000);
  await shot(p, "03-work-map");
  await shot(p, "03-work-map-full", true);
  // 4. tutor blocks a wrong save in MiniERP (deterministic guardrail check)
  await as(p, "u_lena", "/learn", 4000);
  await p.evaluate(() => (window.open = () => null));
  await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Start teach session"))?.click());
  await sleep(3000);
  created.push(await p.evaluate(() => (window as any).__hub?.session.id));
  const erp = await browser.newPage();
  await erp.goto(`${HUB}/erp?mode=teach`, { waitUntil: "networkidle2" });
  await erp.evaluate(() => localStorage.removeItem("minierp.v1"));
  await erp.reload({ waitUntil: "networkidle2" });
  await sleep(1500);
  await erp.evaluate(() => [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("INV-4490"))?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await sleep(2500);
  await erp.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Approve")?.click());
  await sleep(6000);
  await shot(erp, "04-teach-save-held");
  await shot(p, "05-tutor-panel");
  // 6. any web app: the overlay on a third-party form
  await erp.goto(`${HUB}/demo/procurex.html`, { waitUntil: "networkidle2" });
  await sleep(3000);
  await shot(erp, "06-any-web-app-overlay");
  await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Finish"))?.click());
  await sleep(3000);
} finally {
  await browser.close();
  console.log("sessions created (delete after):", created.filter(Boolean).join(", "));
}
