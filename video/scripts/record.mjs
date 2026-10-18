/** Records the three product clips into video/public/ (needs `npm run dev` + `npm run api`, or HUB=<hosted url>).
 *   node video/scripts/record.mjs [capture|map|teach]   (run from tools/ so puppeteer resolves) */
import { execFileSync } from "node:child_process";
import { launch, prep, as, sleep, click, el, point, pointAt, HUB } from "./rec-lib.mjs";
const PUB = new URL("../public/", import.meta.url).pathname;
const which = process.argv[2] ?? "all";
let T0 = 0; Object.defineProperty(globalThis, "T0", { set: (v) => (T0 = v), get: () => T0 });
const b = await launch();
const created = [];
async function rec(page, name, fn) {
  const raw = `${PUB}${name}.webm`;
  const r = await page.screencast({ path: raw }); globalThis.T0 = Date.now();
  try { await fn(); } finally { await r.stop(); }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-vf", "scale=1920:1200:flags=lanczos,fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", `${PUB}${name}.mp4`]);
  execFileSync("rm", [raw]);
  console.log("✔", name);
}
const setSelect = async (p, id, v) => { const e = await el(p, `#${id}`); await point(p, e, 600); await p.select(`#${id}`, v); await sleep(900); };
try {
  if (which === "all" || which === "capture") {
    const hub = await b.newPage(); await prep(hub);
    await as(hub, "u_sabine", "/day", 2500);
    await hub.evaluate(() => (window.open = () => null));
    await click(hub, "button", "Start a new day", 4000).catch(() => click(hub, "button", "Start my work day", 4000)).catch(() => click(hub, "button", "Start my day", 4000));
    created.push(await hub.evaluate(() => window.__hub?.session?.id));
    const erp = await b.newPage(); await prep(erp);
    await erp.goto(`${HUB}/erp?mode=capture`, { waitUntil: "networkidle2" });
    await erp.evaluate(() => localStorage.removeItem("minierp.v1")); await erp.reload({ waitUntil: "networkidle2" });
    await sleep(2500);
    await rec(erp, "02-erp-capture", async () => {
      await sleep(1200);
      await click(erp, "tr", "INV-4471", 2200);
      await setSelect(erp, "costCenter", "0400");
      const a = await el(erp, "#assetNo"); await point(erp, a, 400); await a.click(); await erp.keyboard.type("AN-2026-118", { delay: 110 }); await erp.keyboard.press("Tab"); await sleep(900);
      await click(erp, "button", "Save", 2500);
      await sleep(9000); // pause: Ada may ask
    });
    await hub.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("End my day"))?.click());
    await sleep(2000); await hub.close(); await erp.close();
  }
  if (which === "all" || which === "map") {
    const p = await b.newPage(); await prep(p);
    await as(p, "u_sabine", "/map/demo", 3500);
    await rec(p, "03-workmap", async () => {
      await sleep(1200);
      await pointAt(p, 790, 340, 3200);   // struck-through self-correction
      await pointAt(p, 1000, 560, 3200);  // the real screenshot behind the rule
      await pointAt(p, 640, 857, 2600);   // the decision
      await pointAt(p, 300, 135, 4200);   // "Confirmed · 5 corrections · v3": approved by Sabine
    });
    await p.close();
  }
  if (which === "all" || which === "teach") {
    const hub = await b.newPage(); await prep(hub);
    await as(hub, process.env.LEARNER ?? "u_lena", "/learn", 4000); // LEARNER=u_olena once the Ukrainian tutor lands
    await hub.evaluate(() => (window.open = () => null));
    await hub.select("select", process.env.WM ?? "wm_ap_invoices_01"); await sleep(1500); // the demo map (with Sabine's self-correction)
    await click(hub, "button", "Start practising", 3500).catch(() => click(hub, "button", "Start teach session", 3500));
    created.push(await hub.evaluate(() => window.__hub?.session?.id));
    const erp = await b.newPage(); await prep(erp);
    await erp.goto(`${HUB}/erp?mode=teach`, { waitUntil: "networkidle2" });
    await erp.evaluate(() => localStorage.removeItem("minierp.v1")); await erp.reload({ waitUntil: "networkidle2" });
    await sleep(2500);
    // the voice agent still answers in English (only the cards are localized), so hide its live caption bubble in this shot
    if (process.env.HIDE_CAPTION !== "0") globalThis.__nocap = setInterval(() => void erp.evaluate(() => { for (const n of document.querySelectorAll("*")) { const r = n.shadowRoot; if (r && !r.getElementById("__nocap")) { const st = document.createElement("style"); st.id = "__nocap"; st.textContent = ".caption{display:none!important}"; r.appendChild(st); } } }).catch(() => {}), 300);
    await rec(erp, "04-teach-held", async () => {
      await sleep(1000);
      await click(erp, "tr", "INV-4490", 2000);
      await setSelect(erp, "costCenter", "4720");
      const t0 = Date.now(); await click(erp, "button", process.env.BTN ?? "Save", 200);
      console.log("save clicked at", ((Date.now() - T0) / 1000).toFixed(1), "s");
      // the extension holds the save until the guardrail check returns; log when the card lands so the edit can trim the wait
      for (let i = 0; i < 90; i++) {
        const card = await erp.evaluate(() => [...document.querySelectorAll("*")].map((n) => n.shadowRoot?.textContent ?? "").join(" "));
        if (/blocked before save|save held/i.test(card)) { console.log("held card at", ((Date.now() - T0) / 1000).toFixed(1), "s, after", ((Date.now() - t0) / 1000).toFixed(1), "s"); break; }
        await sleep(500);
      }
      await sleep(7000);
    });
    clearInterval(globalThis.__nocap);
    await erp.screenshot({ path: `${PUB}04-teach-held-end.png` });
    await hub.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Finish"))?.click());
    await sleep(2000);
  }
} finally {
  await b.close();
  console.log("sessions created:", created.filter(Boolean).join(", "));
}
