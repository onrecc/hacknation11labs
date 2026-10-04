/**
 * Workday e2e: fake login → "Start my work day" → "Open MiniERP" → work in MiniERP, then ProcureX, press "New task",
 * take a break, "End my day" → the day is split into the expected tasks and Ada starts going over the first one.
 * Then a practicer logs in and lands on Training.
 *   npm run e2e:workday -w tools      (needs `npm run dev` + `npm run api`)
 */
import puppeteer, { type Page } from "puppeteer";

const HUB = "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
};
const IDLE_MS = 20_000;

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 900 } });
const click = (p: Page, text: string) => p.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(t))?.click(), text);
const tasks = (p: Page) => p.$$eval(".tasks li", (ls) => ls.map((l) => (l.querySelector("b")?.textContent ?? "") + " | " + (l.querySelector(".muted")?.textContent ?? "")));

const hub = await browser.newPage(); // outside try: the finally block reads its ids for cleanup
try {
  // ── fake login ──
  await hub.goto(`${HUB}/`, { waitUntil: "networkidle2" });
  check("unauthenticated → login page", hub.url().endsWith("/login"), hub.url());
  await hub.evaluate((ms) => localStorage.setItem("apprentice.idleMs", String(ms)), IDLE_MS);
  await hub.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button.person")].find((b) => b.textContent?.includes("Sabine Keller"))?.click());
  await sleep(1500);
  check("expert lands on My day", hub.url().endsWith("/day"), hub.url());

  await hub.evaluate(() => (window.open = () => null));
  await click(hub, "Start a new day").then(() => click(hub, "Start my work day"));
  await sleep(4000);
  check("day started: step 2 asks to open the work app", !!(await hub.$(".setup")));
  await click(hub, "Open MiniERP"); // window.open is stubbed: the work tab is opened below
  await sleep(500);
  check("then End task / End my day are right there", !!(await hub.$(".current-task")));

  // ── task 1: invoices in MiniERP ──
  const work = await browser.newPage();
  await work.goto(`${HUB}/erp?mode=capture`, { waitUntil: "networkidle2" });
  await work.evaluate(() => localStorage.removeItem("minierp.v1"));
  await work.reload({ waitUntil: "networkidle2" });
  await sleep(1000);
  const erp = async (key: string, fn: () => Promise<void>) => {
    await work.evaluate((k) => [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes(`INV-${k}`))?.dispatchEvent(new MouseEvent("click", { bubbles: true })), key);
    await sleep(1500);
    await fn();
    await work.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Open items"))?.click());
    await sleep(1500);
  };
  await erp("4471", async () => {
    await work.select("#costCenter", "0400");
    await sleep(800);
    await work.type("#assetNo", "AN-2026-118\n");
    await work.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Save")?.click());
    await sleep(800);
  });
  await erp("4472", async () => {
    await work.type("#comment", "Possible duplicate of INV-4431\n");
    await work.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Hold")?.click());
    await sleep(800);
  });

  // ── task 2: purchase request in ProcureX (another app → automatic split) ──
  await work.goto(`${HUB}/demo/procurex.html`, { waitUntil: "networkidle2" });
  await sleep(2000);
  await work.select("#gl", "0400");
  await work.type("#asset", "AN-2026-140");
  await work.click("#why");
  await work.click("#submit");
  await sleep(6000);
  let list = await tasks(hub);
  check("switching app started a new task", list.length === 2 && /switched app/.test(list[1]), list.join(" // "));

  // ── task 3: manual "New task" ──
  const formWork = async (category: string, item: string) => {
    await work.select("#category", category);
    await sleep(700);
    await work.click("#item", { count: 3 });
    await work.type("#item", item);
    await work.click("#why");
    await sleep(700);
    await work.click("#save");
    await sleep(1500);
  };
  await click(hub, "New task");
  await sleep(3000);
  await formWork("Services", "Annual maintenance contract press line 3");
  await sleep(2000);
  list = await tasks(hub);
  check("manual New task", list.length === 3 && /marked by you/.test(list[2]), list.join(" // "));

  // ── task 4: after a break ──
  await sleep(IDLE_MS + 7000);
  await formWork("Consumables", "Hydraulic oil, 200 l");
  await sleep(3000);
  list = await tasks(hub);
  check("a break splits the task", list.length === 4 && /after a break/.test(list[3]), list.join(" // "));

  // ── end of day ──
  await click(hub, "End my day");
  const wdIds = await hub.evaluate(() => { const r = (window as any).__rec; return `${r.workday.id} · tasks: ${r.workday.tasks.map((t: any) => t.sessionId).join(", ")}`; });
  await sleep(4000);
  const done = await hub.evaluate(() => (window as any).__rec.workday.tasks.filter((t: any) => t.status !== "interruption").map((t: any) => `${t.title} | ${t.status}`) as string[]);
  check("day ended with 4 tasks, all done, no spurious detours", done.length === 4 && done.every((t) => t.endsWith("| done")), done.join(" // "));
  check("the overlay is told the day is over", await hub.evaluate(() => !(window as any).__hub.recording));

  // ── End my day goes straight into going over the first task (its session, Map's debrief) ──
  const firstTask = await hub.evaluate(() => (window as any).__rec.workday.tasks.find((t: any) => t.status === "done").sessionId as string);
  await sleep(6000);
  const onTask = await hub.evaluate(() => (window as any).__hub.session.id as string);
  const panel = await hub.$eval(".debrief-panel .kicker", (e) => e.textContent ?? "").catch(() => "");
  check("End my day starts going over task 1", onTask === firstTask, `${onTask} vs ${firstTask}`);
  check("Map's debrief panel is running", panel.length > 0, panel);
  const preloaded = await hub.evaluate(() => (window as any).__hub.events.filter((e: any) => e.type === "screen.action").length);
  check("the task's earlier events are loaded for the debrief", preloaded >= 5, `${preloaded} actions`);

  // ── practicer ──
  await hub.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Switch user"))?.click());
  await sleep(1000);
  await hub.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("button.person")].find((b) => b.textContent?.includes("Olena"))?.click());
  await sleep(4000);
  check("practicer lands on Training", hub.url().endsWith("/learn"), hub.url());
  const mod = await hub.$eval("select", (s) => (s as HTMLSelectElement).selectedOptions[0]?.textContent ?? "").catch(() => "");
  check("their department's module is preselected", /by Sabine/.test(mod), mod);
  await hub.goto(`${HUB}/day`, { waitUntil: "networkidle2" });
  check("practicer can't open My day", hub.url().endsWith("/learn"), hub.url());
  // ids for cleanup by id (this test records a real day for Sabine)
  console.log(`workday: ${wdIds}`);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
