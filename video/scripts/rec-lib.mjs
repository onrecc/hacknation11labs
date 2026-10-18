// shared helpers for the clip recorder: hosted app, dark mode, fake cursor, slow human pacing
import puppeteer from "puppeteer";
export const HUB = process.env.HUB || "https://hacknation11labs.web.app";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXT = process.env.EXT; // path to extension/dist/chrome → record with the real extension overlay
export const launch = () => puppeteer.launch({ headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", ...(EXT ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [])],
  ...(EXT ? { ignoreDefaultArgs: ["--disable-extensions"] } : {}),
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 } });
export async function prep(p) {
  await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await p.evaluateOnNewDocument(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const c = document.createElement("div");
      c.id = "__cursor";
      c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
      Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", transform: "translate(720px,520px)", transition: "transform 700ms cubic-bezier(.4,0,.2,1)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,.4))" });
      document.body.appendChild(c);
    });
  });
}
export async function as(p, user, path, wait = 2500) {
  await p.goto(`${HUB}/login`, { waitUntil: "networkidle2" });
  await p.evaluate((u) => localStorage.setItem("apprentice.user", u), user);
  await p.goto(`${HUB}${path}`, { waitUntil: "networkidle2" });
  await sleep(wait);
}
/** element handle by css + optional text */
export async function el(p, sel, text) {
  const h = await p.evaluateHandle((sel, text) => [...document.querySelectorAll(sel)].find((e) => !text || e.textContent?.trim().includes(text)), sel, text);
  const e = h.asElement(); if (!e) throw new Error(`not found: ${sel} ${text ?? ""}`); return e;
}
export async function point(p, e, ms = 750) {
  await e.evaluate((n) => n.scrollIntoView({ block: "nearest" }));
  const b = await e.boundingBox();
  const x = b.x + Math.min(b.width / 2, 60), y = b.y + b.height / 2;
  await p.evaluate((x, y) => { const c = document.getElementById("__cursor"); if (c) c.style.transform = `translate(${x - 4}px,${y - 3}px)`; }, x, y);
  await p.mouse.move(x, y, { steps: 8 });
  await sleep(ms);
  return { x, y };
}
export async function click(p, sel, text, after = 900) {
  const e = await el(p, sel, text); await point(p, e); await e.click(); await sleep(after);
}
export async function pointAt(p, x, y, ms = 750) {
  await p.evaluate((x, y) => { const c = document.getElementById("__cursor"); if (c) c.style.transform = `translate(${x - 4}px,${y - 3}px)`; }, x, y);
  await p.mouse.move(x, y, { steps: 8 });
  await sleep(ms);
}
