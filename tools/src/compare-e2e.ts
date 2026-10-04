/**
 * Plumbing test for "two experts, one task": compare → each expert sees Ada's "why?" on My day → both answer →
 * team rule appears on /compare. Uses a TEMPORARY copy of the demo map attributed to Ilse (deleted afterwards),
 * so it runs without a second real recording; with Gemini down it exercises the mock answers.
 *   npm run e2e:compare -w tools   (needs `npm run dev` + `npm run api`)
 */
import puppeteer, { type Page } from "puppeteer";
import type { WorkMap } from "../../shared/schema";
import { db } from "./admin";

const HUB = "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
};

// temporary second expert map (copy of the demo map, attributed to Ilse)
const src = await db.doc("workmaps/wm_ap_invoices_01").get();
const v = src.get("latestVersion") as number;
const wm = JSON.parse((await db.doc(`workmaps/wm_ap_invoices_01/versions/${String(v).padStart(4, "0")}`).get()).get("json")) as WorkMap;
const TMP = "wm_tmp_compare_e2e";
const ilse: WorkMap = { ...wm, id: TMP, expert: { ...wm.expert, id: "u_ilse", displayName: "Ilse Wagner" }, updatedAt: new Date().toISOString() };
await db.doc(`workmaps/${TMP}`).set({ latestVersion: 1, status: "confirmed", sourceSessionIds: wm.sourceSessionIds, title: wm.task.title, updatedAt: ilse.updatedAt });
await db.doc(`workmaps/${TMP}/versions/0001`).set({ json: JSON.stringify({ ...ilse, version: 1 }), createdAt: ilse.updatedAt });
const sabineMapId = "wm_ap_invoices_01";
const createdComparisons: string[] = [];

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 900 } });
const as = async (p: Page, user: string, path: string) => {
  await p.goto(`${HUB}/login`, { waitUntil: "networkidle2" });
  await p.evaluate((u) => localStorage.setItem("apprentice.user", u), user);
  await p.goto(`${HUB}${path}`, { waitUntil: "networkidle2" });
  await sleep(2500);
};
try {
  const p = await browser.newPage();
  await as(p, "u_sabine", "/compare");
  await p.evaluate((a, b) => {
    const sels = [...document.querySelectorAll("select")] as HTMLSelectElement[];
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    [a, b].forEach((v, i) => { setter.call(sels[i], v); sels[i].dispatchEvent(new Event("change", { bubbles: true })); });
  }, sabineMapId, TMP);
  await sleep(500);
  await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Compare"))?.click());
  await p.waitForSelector(".compare table", { timeout: 120_000 });
  const rows = await p.$$eval(".compare tbody tr", (rs) => rs.length);
  check("comparison table rendered", rows > 0, `${rows} topics`);
  createdComparisons.push(...(await db.collection("comparisons").where("workMapIds", "array-contains", TMP).get()).docs.map((d) => d.id));

  for (const [user, answer] of [["u_sabine", "I hold suspected duplicates until the credit note arrives, so nothing is paid twice."], ["u_ilse", "I send them to Jonas because held invoices get forgotten at month end."]] as const) {
    await as(p, user, "/day");
    const card = await p.$eval(".expert-questions", (e) => e.textContent ?? "").catch(() => "");
    check(`${user} sees Ada's question on My day`, /question/i.test(card), card.slice(0, 120));
    await p.type(".expert-questions input", answer);
    await p.evaluate(() => ([...document.querySelectorAll(".expert-questions button")] as HTMLButtonElement[]).find((b) => b.textContent === "Answer")?.click());
    await sleep(8000);
  }
  await as(p, "u_sabine", "/compare");
  const outcome = await p.$$eval(".compare tbody tr td:last-child", (tds) => tds.map((t) => t.textContent ?? "").join(" | "));
  check("both answers turned into a team rule", !/Waiting for answers/.test(outcome) && outcome.length > 0, outcome.slice(0, 200));
  await p.screenshot({ path: "../docs/brag/compare.png" }).catch(() => {});
} finally {
  await browser.close();
  await db.recursiveDelete(db.doc(`workmaps/${TMP}`));
  for (const id of createdComparisons) await db.doc(`comparisons/${id}`).delete();
  console.log(`cleaned up ${TMP} and ${createdComparisons.length} comparison(s)`);
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
