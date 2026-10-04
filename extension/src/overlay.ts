/**
 * The on-page overlay, docked to the edge of the window: a vertical tab (recording / off the record / tutoring,
 * off-record + bookmark controls) and, sliding out beside it, Ada's live caption and guidance cards (tutor
 * interventions with the expert's quote and screen moment). Hovering the tab reveals a grip to drag it along the
 * edge or over to the other side; the spot is remembered per site.
 * Shadow DOM, so host-page CSS can't break it. Used by the extension content script and the embed script on any site.
 */
import type { BridgeBody, BridgeMsg } from "../../shared/bridge";

export interface Transport {
  send(body: BridgeBody): void;
  listen(fn: (m: BridgeMsg) => void): () => void;
}

export interface OverlayOptions {
  /** Show off-record / bookmark controls (false where the host app has its own). */
  controls: boolean;
}

type Status = Extract<BridgeBody, { kind: "status" }>;
type Side = "left" | "right";

const CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
.pill, .panel { position: fixed; z-index: 2147483647; font: 13px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #f0f0f0;
  -webkit-font-smoothing: antialiased; }
.pill, .caption, .card { background: rgba(18,18,18,.97); border: 1px solid #2a2a2a; box-shadow: 0 16px 40px rgba(0,0,0,.3); }
/* the tab on the window edge: status + controls, label turned sideways */
.pill { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 42px; box-sizing: border-box; padding: 12px 0 6px; font-weight: 500;
  white-space: nowrap; transition: width .15s ease; }
.pill.right { right: 0; border-right: 0; border-radius: 12px 0 0 12px; }
.pill.left { left: 0; border-left: 0; border-radius: 0 12px 12px 0; }
.pill:hover, .pill:focus-within, .pill.dragging { width: 48px; }
.pill.dragging { border: 1px solid #3a3a3a; border-radius: 12px; box-shadow: 0 20px 50px rgba(0,0,0,.45); transition: none; }
.text { writing-mode: vertical-rl; transform: rotate(180deg); }
.pill.off .text { color: #ffb224; }
/* drag grip: hidden until the tab is hovered or focused */
.grip { all: unset; box-sizing: border-box; position: relative; flex: none; width: 30px; height: 0; margin-bottom: -10px; opacity: 0; border-radius: 6px; color: #8a8a8a;
  cursor: grab; touch-action: none; transition: height .15s ease, margin .15s ease, opacity .15s ease; }
.grip::before { content: ""; position: absolute; left: 6px; top: 50%; width: 18px; height: 12px; margin-top: -6px; background: radial-gradient(circle, currentColor 1.2px, transparent 1.7px) 0 0 / 6px 6px; }
.pill:hover .grip, .pill:focus-within .grip, .pill.dragging .grip { height: 20px; margin-bottom: 0; opacity: 1; }
.grip:hover { background: #222; color: #ededed; } .pill.dragging .grip { cursor: grabbing; color: #ededed; }
.grip:focus-visible { outline: 2px solid #ededed; outline-offset: 1px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #ff6166; box-shadow: 0 0 0 3px rgba(255,97,102,.2); animation: pulse 1.6s infinite; flex: none; }
.pill.teach .dot { background: #3dd68c; box-shadow: 0 0 0 3px rgba(61,214,140,.2); animation: none; }
.pill.off .dot { background: #ffb224; box-shadow: 0 0 0 3px rgba(255,178,36,.2); animation: none; }
@keyframes pulse { 50% { opacity: .35; } }
/* while Ada speaks, the dot becomes a small level meter */
.wave { display: none; flex-direction: column; align-items: center; gap: 2px; width: 14px; color: #3dd68c; }
.wave i { width: 100%; height: 2px; border-radius: 2px; background: currentColor; animation: wave 1s ease-in-out infinite; }
.wave i:nth-child(2) { animation-delay: -.25s; } .wave i:nth-child(3) { animation-delay: -.5s; } .wave i:nth-child(4) { animation-delay: -.75s; }
@keyframes wave { 0%, 100% { transform: scaleX(.3); } 50% { transform: scaleX(1); } }
.pill.speaking .dot { display: none; } .pill.speaking .wave { display: flex; }
.sep { width: 18px; height: 1px; background: #2a2a2a; flex: none; }
/* icon buttons + tooltips */
.icon { all: unset; box-sizing: border-box; position: relative; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px;
  color: #9a9a9a; cursor: pointer; flex: none; }
.icon:hover { background: #222; color: #f0f0f0; } .icon:focus-visible { outline: 2px solid #ededed; outline-offset: 1px; }
.icon.on { color: #ffb224; background: rgba(255,178,36,.12); }
.icon svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-tip]:hover::after, [data-tip]:focus-visible::after { content: attr(data-tip); position: absolute; top: 50%; transform: translateY(-50%); white-space: nowrap; background: #ededed;
  color: #0a0a0a; font-size: 12px; font-weight: 500; padding: 4px 8px; border-radius: 6px; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,.25); }
.pill.right [data-tip]::after { right: calc(100% + 14px); } .pill.left [data-tip]::after { left: calc(100% + 14px); }
.pill.dragging [data-tip]::after { display: none; }
.card [data-tip]:hover::after, .card [data-tip]:focus-visible::after { top: calc(100% + 6px); right: 0; transform: none; }
/* beside the tab: caption + guidance */
.panel { display: flex; flex-direction: column; gap: 8px; width: min(360px, calc(100vw - 72px)); pointer-events: none; }
.panel > * { pointer-events: auto; }
.cards:empty { display: none; }
.caption { padding: 8px 12px; border-radius: 12px; box-sizing: border-box; }
.caption .who { font-size: 11px; color: #3dd68c; display: block; font-weight: 600; }
.card { border-radius: 14px; padding: 12px 14px 14px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; max-height: calc(100vh - 110px); overflow-y: auto; }
.card .head { display: flex; align-items: flex-start; gap: 8px; }
.card .tone { width: 7px; height: 7px; margin-top: 7px; border-radius: 2px; background: #52a8ff; flex: none; }
.card.block .tone { background: #ff6166; } .card.nudge .tone { background: #ffb224; } .card.info .tone { background: #3dd68c; }
.card.block { border-color: rgba(255,97,102,.45); }
.card h4 { margin: 0; font-size: 14px; line-height: 1.35; font-weight: 600; flex: 1; } .card p { margin: 0; color: #cfcfcf; }
.card .head .icon { width: 24px; height: 24px; } .card .head .icon svg { width: 13px; height: 13px; }
.card.min > :not(.head) { display: none; }
.quote { padding: 10px 12px; border-radius: 10px; background: #1b1b1b; }
.quote span { display: block; color: #9a9a9a; font-size: 12px; margin-top: 4px; }
.frame { position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a; } .frame img { display: block; width: 100%; }
.bbox { position: absolute; border: 2px solid #ef4444; border-radius: 4px; box-shadow: 0 0 0 2px rgba(239,68,68,.25); }
.label { font-size: 12px; color: #9a9a9a; margin-bottom: -6px; }
@media (prefers-reduced-motion: reduce) { .dot, .wave i { animation: none; } .pill, .grip { transition: none; } }
`;

const SPOT_KEY = "ai-apprentice-dock";
const EDGE_GAP = 8;

export function startOverlay(t: Transport, opts: OverlayOptions): () => void {
  const host = document.createElement("div");
  host.id = "ai-apprentice-overlay";
  const root = host.attachShadow({ mode: "open" });
  // built with DOM calls only (no innerHTML): page text never becomes markup
  const cards = h("div", { class: "cards" });
  const caption = h("div", { class: "caption" });
  const panel = h("div", { class: "panel" }, cards, caption);
  const pill = h("div", { class: "pill" });
  caption.hidden = pill.hidden = true;
  root.append(h("style", {}, CSS), pill, panel);
  document.documentElement.appendChild(host);
  let status: Status | null = null;
  let captionTimer: ReturnType<typeof setTimeout> | undefined;

  // where the tab sits: a window edge + the vertical center as a fraction of the window height
  let spot = loadSpot();
  let drag: { dx: number; dy: number } | null = null;
  // the page element the user last pressed (e.g. the held Save button): the panel never covers it
  let pressed: Element | null = null;

  const place = () => {
    const vh = window.innerHeight;
    const railH = pill.hidden ? 0 : pill.offsetHeight;
    const center = clamp(spot.y * vh, railH / 2 + EDGE_GAP, vh - railH / 2 - EDGE_GAP);
    if (!drag) {
      pill.className = pill.className.replace(/\b(left|right)\b/g, "").trim() + ` ${spot.side}`;
      pill.style.top = `${center - railH / 2}px`;
    }
    const inset = (pill.hidden ? 0 : pill.offsetWidth) + 10;
    panel.style.left = spot.side === "left" ? `${inset}px` : "auto";
    panel.style.right = spot.side === "right" ? `${inset}px` : "auto";
    const panelH = panel.offsetHeight;
    let top = clamp(center - panelH / 2, 12, Math.max(12, vh - panelH - 12));
    if (pressed?.isConnected && panelH > 0) {
      const r = pressed.getBoundingClientRect();
      const left = spot.side === "left" ? inset : window.innerWidth - inset - panel.offsetWidth;
      if (r.right > left && r.left < left + panel.offsetWidth && r.bottom > top && r.top < top + panelH) {
        const fits = [r.top - 12 - panelH, r.bottom + 12].filter((y) => y >= 12 && y + panelH <= vh - 12);
        if (fits.length) top = fits.reduce((a, b) => (Math.abs(b - top) < Math.abs(a - top) ? b : a));
      }
    }
    panel.style.top = `${top}px`;
  };
  let frame = 0;
  const schedulePlace = () => void (frame ||= requestAnimationFrame(() => ((frame = 0), place())));
  const onPress = (e: PointerEvent) => {
    if (e.target instanceof Element && e.target !== host) pressed = e.target;
  };
  const moveTo = (next: typeof spot) => {
    spot = { side: next.side, y: clamp(next.y, 0, 1) };
    saveSpot(spot);
    place();
  };

  const grip = h("button", { class: "grip", type: "button", "aria-label": "Move Ada (drag, or use the arrow keys)", "data-tip": "Drag to move" });
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const r = pill.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    grip.setPointerCapture(e.pointerId);
    pill.classList.add("dragging");
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const top = clamp(e.clientY - drag.dy, EDGE_GAP, window.innerHeight - pill.offsetHeight - EDGE_GAP);
    Object.assign(pill.style, { left: `${clamp(e.clientX - drag.dx, 0, window.innerWidth - pill.offsetWidth)}px`, right: "auto", top: `${top}px` });
    spot = { side: e.clientX < window.innerWidth / 2 ? "left" : "right", y: (top + pill.offsetHeight / 2) / window.innerHeight };
    place();
  });
  const drop = () => {
    if (!drag) return;
    drag = null;
    pill.classList.remove("dragging");
    pill.style.left = pill.style.right = "";
    moveTo(spot); // snap to the nearer edge
  };
  grip.addEventListener("pointerup", drop);
  grip.addEventListener("pointercancel", drop);
  grip.addEventListener("lostpointercapture", drop); // e.g. a status update re-renders the tab mid-drag
  grip.addEventListener("keydown", (e) => {
    const step = { ArrowUp: -0.05, ArrowDown: 0.05 }[e.key];
    if (step) moveTo({ ...spot, y: spot.y + step });
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") moveTo({ ...spot, side: e.key === "ArrowLeft" ? "left" : "right" });
    else return;
    e.preventDefault();
  });

  const renderPill = () => {
    if (!status || status.mode === "off" || status.mode === "free") return void (pill.hidden = true);
    pill.hidden = false;
    const teach = status.mode === "teach";
    pill.classList.toggle("off", !!status.offRecord);
    pill.classList.toggle("teach", teach && !status.offRecord);
    const label = status.offRecord ? "Off the record" : teach ? "Ada is coaching" : `Ada is learning from ${status.expert ?? "you"}`;
    const wave = h("span", { class: "wave", "aria-hidden": "true" }, h("i", {}), h("i", {}), h("i", {}), h("i", {}));
    pill.replaceChildren(grip, h("span", { class: "dot" }), wave, h("span", { class: "text" }, label));
    if (opts.controls && !teach) {
      const offRecord = !!status.offRecord;
      const eye = iconBtn(offRecord ? EYE_OFF : EYE, offRecord ? "Back on the record" : "Go off the record: Ada stops watching and listening", () =>
        t.send({ kind: "marker", marker: status?.offRecord ? "off_record_end" : "off_record_start", at: Date.now() }));
      eye.classList.toggle("on", offRecord);
      const bm = iconBtn(BOOKMARK, "Bookmark this moment", () => t.send({ kind: "marker", marker: "bookmark", at: Date.now() }));
      pill.append(h("span", { class: "sep" }), eye, bm);
    }
  };

  const showCard = (c: Extract<BridgeBody, { kind: "tutorCard" }>) => {
    const el = h("div", { class: `card ${c.tone}` });
    const head = h("div", { class: "head" }, h("span", { class: "tone" }), h("h4", {}, c.title));
    head.append(iconBtn(MINUS, "Minimize", () => el.classList.toggle("min")), iconBtn(CLOSE, "Dismiss", () => el.remove()));
    el.append(head, h("p", {}, c.text));
    if (c.quote) el.append(h("div", { class: "quote" }, `“${c.quote.text}”`, h("span", {}, `${c.quote.who} · ${c.quote.when}`)));
    const src = c.imageUrl && /^(https?:|data:image\/)/.test(c.imageUrl) ? c.imageUrl : "";
    if (src) {
      const frame = h("div", { class: "frame" }, h("img", { src }));
      if (c.bbox) {
        const box = h("div", { class: "bbox" });
        Object.assign(box.style, { left: `${c.bbox.x * 100}%`, top: `${c.bbox.y * 100}%`, width: `${c.bbox.w * 100}%`, height: `${c.bbox.h * 100}%` });
        frame.append(box);
      }
      el.append(h("div", { class: "label" }, `${c.quote?.who ?? "Expert"}'s screen at this moment`), frame);
    }
    cards.replaceChildren(el); // one card at a time: the newest guidance
    if (c.tone === "info") setTimeout(() => el.remove(), 20_000);
  };

  // keep the panel beside the tab whatever changes size (new card, image load, caption, hover)
  const sizes = new ResizeObserver(() => place());
  sizes.observe(pill);
  sizes.observe(panel);
  window.addEventListener("resize", schedulePlace);
  window.addEventListener("scroll", schedulePlace, { capture: true, passive: true });
  document.addEventListener("pointerdown", onPress, true);

  const off = t.listen((m) => {
    if (m.kind === "status") {
      status = m;
      renderPill();
    } else if (m.kind === "tutorCard") showCard(m);
    else if (m.kind === "tutorSay") showCard({ kind: "tutorCard", tone: "info", title: "Ada", text: m.text });
    else if (m.kind === "agentState" && m.caption) {
      caption.hidden = false;
      pill.classList.add("speaking");
      caption.replaceChildren(h("span", { class: "who" }, "Ada"), m.caption);
      clearTimeout(captionTimer);
      captionTimer = setTimeout(() => {
        caption.hidden = true;
        pill.classList.remove("speaking");
      }, Math.max(4000, m.caption.length * 70));
    }
  });
  return () => {
    off();
    sizes.disconnect();
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", schedulePlace);
    window.removeEventListener("scroll", schedulePlace, { capture: true });
    document.removeEventListener("pointerdown", onPress, true);
    clearTimeout(captionTimer);
    host.remove();
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// the host page's storage (the overlay also runs without the extension): best effort, a fresh page starts mid-right
function loadSpot(): { side: Side; y: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SPOT_KEY) ?? "null") as { side?: unknown; y?: unknown } | null;
    if (s && (s.side === "left" || s.side === "right") && typeof s.y === "number") return { side: s.side, y: clamp(s.y, 0, 1) };
  } catch {}
  return { side: "right", y: 0.5 };
}
function saveSpot(s: { side: Side; y: number }) {
  try {
    localStorage.setItem(SPOT_KEY, JSON.stringify(s));
  } catch {}
}

// icons (Lucide, ISC): path data only, built with DOM calls
const EYE = ["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", "M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6"];
const EYE_OFF = ["M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49", "M14.084 14.158a3 3 0 0 1-4.242-4.242",
  "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143", "m2 2 20 20"];
const BOOKMARK = ["m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"];
const CLOSE = ["M18 6 6 18", "m6 6 12 12"];
const MINUS = ["M5 12h14"];
/** Icon-only button: the tooltip (and screen-reader label) says what it does. */
function iconBtn(paths: string[], tip: string, onClick: () => void) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  const b = h("button", { class: "icon", type: "button", "aria-label": tip, "data-tip": tip }, svg);
  b.addEventListener("click", onClick);
  return b;
}

/** Tiny DOM builder: attributes + text/element children (text is always text, never markup). */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string>, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}
