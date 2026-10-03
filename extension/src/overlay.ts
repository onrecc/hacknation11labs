/**
 * The on-page overlay: a status pill (recording / off the record / tutoring + Ada's live caption) and
 * guidance cards (tutor interventions with the expert's quote and screen moment).
 * Shadow DOM, so host-page CSS can't break it. Used by the extension content script on any site and embedded
 * directly in MiniERP (web/src/erp) so the demo also works without the extension.
 */
import type { BridgeBody, BridgeMsg } from "../../shared/bridge";

export interface Transport {
  send(body: BridgeBody): void;
  listen(fn: (m: BridgeMsg) => void): () => void;
}

export interface OverlayOptions {
  /** Show off-record / bookmark controls (false where the host app has its own). */
  controls: boolean;
  /** Dock into this element (in-flow strip, never covers the app). Default: floating bottom-right. */
  mount?: HTMLElement;
}

type Status = Extract<BridgeBody, { kind: "status" }>;

const CSS = `
:host { all: initial; }
.wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
  font: 14px/1.4 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1b1f24; max-width: min(420px, calc(100vw - 32px)); }
.wrap.docked { position: static; max-width: none; flex-direction: row-reverse; align-items: flex-start; flex-wrap: wrap; padding: 8px 16px; }
.wrap.docked .cards { flex: 1 1 420px; } .wrap.docked .card { display: grid; grid-template-columns: 1fr 260px; gap: 4px 16px; } .wrap.docked .card > :not(.frame):not(.label) { grid-column: 1; } .wrap.docked .card .label, .wrap.docked .card .frame { grid-column: 2; grid-row: 1 / span 4; } .wrap.docked .card .label { display: none; }
.wrap:not(.docked) .card.min > :not(h4):not(.x):not(.m) { display: none; }
.card .m { all: unset; cursor: pointer; float: right; font-size: 16px; color: #66707c; margin-right: 10px; }
.pill { display: flex; align-items: center; gap: 8px; background: #1f3a5f; color: #fff; border-radius: 999px; padding: 6px 8px 6px 12px; box-shadow: 0 4px 16px rgba(0,0,0,.2); }
.pill.off { background: #c62828; } .pill.teach { background: #2e5d2e; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #ff5252; animation: pulse 1.4s infinite; } .pill.teach .dot { background: #9be39f; } .pill.off .dot { background: #fff; animation: none; }
@keyframes pulse { 50% { opacity: .35; } }
.pill button { all: unset; cursor: pointer; font-size: 12px; padding: 3px 8px; border-radius: 999px; background: rgba(255,255,255,.15); }
.pill button:hover { background: rgba(255,255,255,.3); }
.caption { background: rgba(20,24,30,.92); color: #fff; padding: 8px 12px; border-radius: 10px; max-width: 100%; box-shadow: 0 4px 16px rgba(0,0,0,.2); }
.caption .who { font-size: 11px; opacity: .7; display: block; }
.card { background: #fff; border-radius: 12px; border: 2px solid #3b6fb6; padding: 12px 14px; box-shadow: 0 8px 28px rgba(0,0,0,.25); width: 100%; box-sizing: border-box; }
.card.block { border-color: #c62828; } .card.nudge { border-color: #b26a00; } .card.info { border-color: #2e7d32; }
.card h4 { margin: 0 24px 6px 0; font-size: 14px; } .card p { margin: 0 0 8px; }
.card .x { position: absolute; right: 22px; margin-top: -4px; all: unset; cursor: pointer; float: right; font-size: 16px; color: #66707c; }
.quote { margin: 0 0 8px; padding: 6px 10px; border-left: 3px solid #3b6fb6; background: #eef2f7; border-radius: 0 6px 6px 0; font-style: italic; }
.quote span { font-style: normal; color: #66707c; font-size: 12px; }
.frame { position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #dde1e6; } .frame img { display: block; width: 100%; }
.bbox { position: absolute; border: 3px solid #e53935; border-radius: 4px; }
.label { font-size: 11px; color: #66707c; margin-bottom: 4px; }
`;

export function startOverlay(t: Transport, opts: OverlayOptions): () => void {
  const host = document.createElement("div");
  host.id = "ai-apprentice-overlay";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CSS}</style><div class="wrap${opts.mount ? " docked" : ""}"><div class="cards"></div><div class="caption" hidden></div><div class="pill" hidden></div></div>`;
  (opts.mount ?? document.documentElement).appendChild(host);
  const pill = root.querySelector<HTMLDivElement>(".pill")!;
  const caption = root.querySelector<HTMLDivElement>(".caption")!;
  const cards = root.querySelector<HTMLDivElement>(".cards")!;
  let status: Status | null = null;
  let captionTimer: ReturnType<typeof setTimeout> | undefined;

  const renderPill = () => {
    if (!status || status.mode === "off" || status.mode === "free") return void (pill.hidden = true);
    pill.hidden = false;
    const teach = status.mode === "teach";
    pill.className = `pill ${status.offRecord ? "off" : teach ? "teach" : ""}`;
    const label = status.offRecord ? "Off the record" : teach ? "Ada is coaching" : `Ada is learning from ${status.expert ?? "you"}`;
    pill.innerHTML = `<span class="dot"></span><span>${esc(label)}</span>`;
    if (opts.controls && !teach) {
      const off = btn(status.offRecord ? "Back on record" : "Off the record", () =>
        t.send({ kind: "marker", marker: status?.offRecord ? "off_record_end" : "off_record_start", at: Date.now() }));
      const bm = btn("Bookmark", () => t.send({ kind: "marker", marker: "bookmark", at: Date.now() }));
      pill.append(off, bm);
    }
  };

  const showCard = (c: Extract<BridgeBody, { kind: "tutorCard" }>) => {
    const el = document.createElement("div");
    el.className = `card ${c.tone}`;
    el.innerHTML = `<button class="x" title="Dismiss">×</button>${opts.mount ? "" : `<button class="m" title="Minimize">–</button>`}<h4>${esc(c.title)}</h4><p>${esc(c.text)}</p>`
      + (c.quote ? `<div class="quote">“${esc(c.quote.text)}” <span>· ${esc(c.quote.who)} · ${esc(c.quote.when)}</span></div>` : "")
      + (c.imageUrl ? `<div class="label">${esc(c.quote?.who ?? "Expert")}'s screen at this moment</div><div class="frame"><img src="${attr(c.imageUrl)}">${c.bbox ? `<div class="bbox" style="left:${c.bbox.x * 100}%;top:${c.bbox.y * 100}%;width:${c.bbox.w * 100}%;height:${c.bbox.h * 100}%"></div>` : ""}</div>` : "");
    el.querySelector(".x")!.addEventListener("click", () => el.remove());
    el.querySelector(".m")?.addEventListener("click", () => el.classList.toggle("min"));
    cards.replaceChildren(el); // one card at a time: the newest guidance
    if (c.tone === "info") setTimeout(() => el.remove(), 20_000);
  };

  const off = t.listen((m) => {
    if (m.kind === "status") {
      status = m;
      renderPill();
    } else if (m.kind === "tutorCard") showCard(m);
    else if (m.kind === "tutorSay") showCard({ kind: "tutorCard", tone: "info", title: "Ada", text: m.text });
    else if (m.kind === "agentState" && m.caption) {
      caption.hidden = false;
      caption.innerHTML = `<span class="who">Ada</span>${esc(m.caption)}`;
      clearTimeout(captionTimer);
      captionTimer = setTimeout(() => (caption.hidden = true), Math.max(4000, m.caption.length * 70));
    }
  });
  return () => {
    off();
    host.remove();
  };
}

function btn(label: string, onClick: () => void) {
  const b = document.createElement("button");
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const attr = (s: string) => (/^(https?:|data:image\/)/.test(s) ? esc(s) : "");
