/**
 * Vision drives questions: a change that NO app/extension event reports (the page changes by itself, like a
 * desktop app or a canvas) is seen by Claude vision on the extension's screenshot and becomes a screen.action
 * (source vision) that the question picker and the agent get, like any other action.
 *   npm run e2e:vision -w tools   (needs `npm run dev` + `npm run api`, the built extension, a real LLM)
 */
import puppeteer, { type Page } from "puppeteer";

const HUB = "http://localhost:5173";
const WORK = "http://[::1]:5173/demo/procurex.html";
const EXT = new URL("../../extension/dist/chrome", import.meta.url).pathname;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
};
const clickButton = (p: Page, text: string) => p.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(t))?.click(), text);

const browser = await puppeteer.launch({
  headless: true, defaultViewport: { width: 1280, height: 860 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], ignoreDefaultArgs: ["--disable-extensions"],
});
try {
  const hub = await browser.newPage();
  await hub.goto(`${HUB}/login`, { waitUntil: "networkidle2" });
  await hub.evaluate(() => localStorage.setItem("apprentice.user", "u_sabine"));
  await hub.goto(`${HUB}/capture`, { waitUntil: "networkidle2" });
  await hub.evaluate(() => (window.open = () => null));
  await clickButton(hub, "Start session"); // vision is on by default
  await sleep(3000);
  console.log(`capture session: ${await hub.evaluate(() => (window as any).__hub?.session.id)}`);

  const work = await browser.newPage();
  await work.goto(WORK, { waitUntil: "networkidle2" });
  await sleep(8000); // first frames + first vision pass (baseline)

  // the page changes WITHOUT any input/click event: only the screenshot shows it
  await work.evaluate(() => {
    document.querySelector("h1")!.textContent = "Purchase request PR-20931 · STATUS: APPROVED";
    (document.getElementById("approver") as HTMLSelectElement).selectedIndex = 1; // M. Weber (Controlling), no change event
    (document.getElementById("gl") as HTMLSelectElement).value = "0400"; // capex, no change event
  });
  let actions: Array<{ source: string; agreement: string; description: string }> = [];
  for (let i = 0; i < 30 && !actions.length; i++) {
    await sleep(1000);
    actions = await hub.evaluate(() => (window as any).__hub.events.filter((e: any) => e.type === "screen.action" && e.source === "vision")
      .map((e: any) => ({ source: e.source, agreement: e.payload.sourceAgreement, description: e.payload.description })));
  }
  check("vision turned an unreported change into screen.action (source vision)", actions.length > 0, actions.map((a) => a.description).join(" | ").slice(0, 300));
  check("marked vision_only", actions.every((a) => a.agreement === "vision_only"));
  const state = await hub.evaluate(() => {
    const h = (window as any).__hub;
    const ids = h.events.filter((e: any) => e.type === "screen.action" && e.source === "vision").map((e: any) => e.id);
    return {
      unasked: ids.filter((id: string) => h.unasked.includes(id)).length,
      pushed: h.events.filter((e: any) => e.type === "agent.context_pushed" && e.payload.eventIds.some((x: string) => ids.includes(x))).length,
      asked: h.events.filter((e: any) => e.type === "agent.question" && e.payload.about.actionIds.some((x: string) => ids.includes(x))).length,
      models: [...new Set(h.events.filter((e: any) => e.type === "model.call").map((e: any) => e.payload.model))],
    };
  });
  check("queued for the question picker (or already asked about)", state.unasked + state.asked > 0, `unasked ${state.unasked}, asked ${state.asked}`);
  check("pushed to the agent as screen context", state.pushed > 0, `${state.pushed}`);
  check("model.call names the real model", state.models.length > 0 && !state.models.includes("see api /health") && !state.models.includes("unknown"), state.models.join(", "));
  await hub.bringToFront();
  await clickButton(hub, "End task");
  await sleep(1500);
  await clickButton(hub, "Close session");
  await sleep(2000);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
