"use strict";
(() => {
  // ../shared/bridge.ts
  var newMsgId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  var Dedupe = class {
    seen = /* @__PURE__ */ new Set();
    order = [];
    firstTime(id) {
      if (this.seen.has(id)) return false;
      this.seen.add(id);
      this.order.push(id);
      if (this.order.length > 500) this.seen.delete(this.order.shift());
      return true;
    }
  };
  var SENSITIVE = /pass|iban|card|cvv|cvc|ssn|social|tax.?id|account.?(no|number)|token|secret|pin\b/i;

  // src/overlay.ts
  var CSS2 = `
:host { all: initial; }
[hidden] { display: none !important; }
.wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  font: 13px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #ededed; max-width: min(400px, calc(100vw - 32px));
  -webkit-font-smoothing: antialiased; }
/* floating: cards top-right (bottom-right is where apps put their primary buttons), pill + caption bottom-right */
.wrap:not(.docked) .cards { position: fixed; top: 72px; right: 16px; width: min(380px, calc(100vw - 32px)); }
.wrap.docked { position: static; max-width: none; flex-direction: row-reverse; align-items: flex-start; flex-wrap: wrap; padding: 8px 16px; }
.wrap.docked .cards { flex: 1 1 420px; } .wrap.docked .card { display: grid; grid-template-columns: 1fr 260px; gap: 4px 16px; } .wrap.docked .card > :not(.frame):not(.label) { grid-column: 1; } .wrap.docked .card .label, .wrap.docked .card .frame { grid-column: 2; grid-row: 1 / span 4; } .wrap.docked .card .label { display: none; }
.wrap:not(.docked) .card.min > :not(.head) { display: none; }
.surface, .pill, .caption, .card { background: rgba(10,10,10,.94); border: 1px solid #262626; box-shadow: 0 8px 30px rgba(0,0,0,.35); backdrop-filter: blur(8px); }
/* status pill */
.pill { display: flex; align-items: center; gap: 8px; border-radius: 999px; height: 34px; box-sizing: border-box; padding: 0 4px 0 12px; font-weight: 500; white-space: nowrap; }
.pill.bare { padding-right: 12px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.18); animation: pulse 1.6s infinite; flex: none; }
.pill.teach .dot { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.18); animation: none; }
.pill.off .dot { background: #f5a524; box-shadow: 0 0 0 3px rgba(245,165,36,.18); animation: none; }
.pill.off .text { color: #f5a524; }
@keyframes pulse { 50% { opacity: .35; } }
.sep { width: 1px; height: 16px; background: #262626; margin: 0 2px; }
/* icon buttons + tooltips */
.icon { all: unset; box-sizing: border-box; position: relative; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 999px; color: #a1a1a1; cursor: pointer; flex: none; }
.icon:hover { background: #1f1f1f; color: #ededed; } .icon:focus-visible { outline: 2px solid #ededed; outline-offset: 1px; }
.icon.on { color: #f5a524; background: rgba(245,165,36,.12); }
.icon svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-tip]:hover::after, [data-tip]:focus-visible::after { content: attr(data-tip); position: absolute; right: 0; bottom: calc(100% + 8px); white-space: nowrap; background: #ededed; color: #0a0a0a;
  font-size: 12px; font-weight: 500; padding: 4px 8px; border-radius: 6px; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,.25); }
.card [data-tip]:hover::after, .card [data-tip]:focus-visible::after { bottom: auto; top: calc(100% + 6px); }
/* Ada's live caption */
.caption { padding: 8px 12px; border-radius: 12px; max-width: 100%; box-sizing: border-box; }
.caption .who { font-size: 11px; color: #a1a1a1; display: block; font-weight: 500; }
/* guidance cards: neutral surface, tone = small colored dot */
.card { border-radius: 12px; padding: 12px 14px; width: 100%; box-sizing: border-box; }
.card .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.card .tone { width: 7px; height: 7px; border-radius: 50%; background: #3b82f6; flex: none; }
.card.block .tone { background: #ef4444; } .card.nudge .tone { background: #f5a524; } .card.info .tone { background: #22c55e; }
.card.block { border-color: rgba(239,68,68,.45); }
.card h4 { margin: 0; font-size: 13px; font-weight: 600; flex: 1; } .card p { margin: 0 0 10px; color: #d4d4d4; }
.card .head .icon { width: 22px; height: 22px; } .card .head .icon svg { width: 13px; height: 13px; }
.quote { margin: 0 0 10px; padding: 6px 10px; border-left: 2px solid #3a3a3a; background: #141414; border-radius: 0 6px 6px 0; }
.quote span { color: #8f8f8f; font-size: 12px; }
.frame { position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #262626; } .frame img { display: block; width: 100%; }
.bbox { position: absolute; border: 2px solid #ef4444; border-radius: 4px; box-shadow: 0 0 0 2px rgba(239,68,68,.25); }
.label { font-size: 11px; color: #8f8f8f; margin-bottom: 4px; }
`;
  function startOverlay(t, opts) {
    const host = document.createElement("div");
    host.id = "ai-apprentice-overlay";
    const root = host.attachShadow({ mode: "open" });
    const cards = h("div", { class: "cards" });
    const caption = h("div", { class: "caption" });
    const pill = h("div", { class: "pill" });
    caption.hidden = pill.hidden = true;
    root.append(h("style", {}, CSS2), h("div", { class: `wrap${opts.mount ? " docked" : ""}` }, cards, caption, pill));
    (opts.mount ?? document.documentElement).appendChild(host);
    let status = null;
    let captionTimer;
    const renderPill = () => {
      if (!status || status.mode === "off" || status.mode === "free") return void (pill.hidden = true);
      pill.hidden = false;
      const teach = status.mode === "teach";
      pill.className = `pill ${status.offRecord ? "off" : teach ? "teach" : ""}`;
      const label = status.offRecord ? "Off the record" : teach ? "Ada is coaching" : `Ada is learning from ${status.expert ?? "you"}`;
      pill.replaceChildren(h("span", { class: "dot" }), h("span", { class: "text" }, label));
      pill.classList.toggle("bare", !(opts.controls && !teach));
      if (opts.controls && !teach) {
        const offRecord = !!status.offRecord;
        const eye = iconBtn(offRecord ? EYE_OFF : EYE, offRecord ? "Back on the record" : "Go off the record: Ada stops watching and listening", () => t.send({ kind: "marker", marker: status?.offRecord ? "off_record_end" : "off_record_start", at: Date.now() }));
        eye.classList.toggle("on", offRecord);
        const bm = iconBtn(BOOKMARK, "Bookmark this moment", () => t.send({ kind: "marker", marker: "bookmark", at: Date.now() }));
        pill.append(h("span", { class: "sep" }), eye, bm);
      }
    };
    const showCard = (c) => {
      const el = h("div", { class: `card ${c.tone}` });
      const head = h("div", { class: "head" }, h("span", { class: "tone" }), h("h4", {}, c.title));
      if (!opts.mount) head.append(iconBtn(MINUS, "Minimize", () => el.classList.toggle("min")));
      head.append(iconBtn(CLOSE, "Dismiss", () => el.remove()));
      el.append(head, h("p", {}, c.text));
      if (c.quote) el.append(h("div", { class: "quote" }, `\u201C${c.quote.text}\u201D `, h("span", {}, `\xB7 ${c.quote.who} \xB7 ${c.quote.when}`)));
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
      cards.replaceChildren(el);
      if (c.tone === "info") setTimeout(() => el.remove(), 2e4);
    };
    const off = t.listen((m) => {
      if (m.kind === "status") {
        status = m;
        renderPill();
      } else if (m.kind === "tutorCard") showCard(m);
      else if (m.kind === "tutorSay") showCard({ kind: "tutorCard", tone: "info", title: "Ada", text: m.text });
      else if (m.kind === "agentState" && m.caption) {
        caption.hidden = false;
        caption.replaceChildren(h("span", { class: "who" }, "Ada"), m.caption);
        clearTimeout(captionTimer);
        captionTimer = setTimeout(() => caption.hidden = true, Math.max(4e3, m.caption.length * 70));
      }
    });
    return () => {
      off();
      host.remove();
    };
  }
  var EYE = ["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", "M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6"];
  var EYE_OFF = [
    "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
    "M14.084 14.158a3 3 0 0 1-4.242-4.242",
    "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
    "m2 2 20 20"
  ];
  var BOOKMARK = ["m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"];
  var CLOSE = ["M18 6 6 18", "m6 6 12 12"];
  var MINUS = ["M5 12h14"];
  function iconBtn(paths, tip, onClick) {
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
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.append(...children);
    return el;
  }

  // src/capture-dom.ts
  var ACTION_RE = /\b(save|submit|approve|confirm|book|post|send|pay|release|finish|complete|create|update)\b/i;
  var MAX_FIELDS = 60;
  function startDomCapture(t, isActive, opts = { events: true }) {
    const counts = { keystrokes: 0, clicks: 0, scrolls: 0, mouseMovePx: 0 };
    const focusValues = /* @__PURE__ */ new WeakMap();
    let bypass = null;
    let last = null;
    const on = () => isActive().capture || isActive().teach;
    const emit = (b) => opts.events && on() && t.send(b);
    const onFocus = (e) => {
      const el = e.target;
      if (isField(el)) focusValues.set(el, valueOf(el));
    };
    const onChange = (e) => {
      const el = e.target;
      if (!isField(el)) return;
      const label = labelOf(el);
      const before = focusValues.get(el) ?? "";
      const after = valueOf(el);
      focusValues.set(el, after);
      if (before === after) return;
      emit({
        kind: "app",
        at: Date.now(),
        verb: "edit",
        page: snapshot(),
        description: `Set "${label}" from "${before || "-"}" to "${after || "-"}" on "${document.title}"`,
        payload: { action: "change", entity: { kind: "page", key: location.pathname }, field: label, oldValue: before, newValue: after, selector: selectorOf(el), route: location.href }
      });
    };
    const onClick = (e) => {
      counts.clicks++;
      const el = e.target?.closest?.("button, a, [role=button], input[type=submit], input[type=button]");
      if (!el) return;
      const text = (el.textContent || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 60);
      if (!text) return;
      if (isActive().teach && ACTION_RE.test(text) && bypass !== el) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void holdAndCheck(el, text);
        return;
      }
      if (bypass === el) bypass = null;
      emit({
        kind: "app",
        at: Date.now(),
        verb: ACTION_RE.test(text) ? "save" : "other",
        page: snapshot(),
        description: `Clicked "${text}" on "${document.title}"`,
        payload: { action: ACTION_RE.test(text) ? "save" : "click", entity: { kind: "page", key: location.pathname }, selector: selectorOf(el), route: location.href }
      });
    };
    const holdAndCheck = async (el, text) => {
      const reqId = newMsgId();
      const outline = el.dataset.apOutline ??= el.style.outline;
      el.style.outline = "3px solid #3b6fb6";
      const label = el.getAttribute("title");
      el.setAttribute("title", "Ada is checking this against the expert's rules\u2026");
      const res = await new Promise((resolve) => {
        const timer2 = setTimeout(() => (stop(), resolve({ allow: true })), 15e3);
        const stop = t.listen((m) => {
          if (m.kind === "beforeActionResult" && m.reqId === reqId) {
            clearTimeout(timer2);
            stop();
            resolve(m);
          }
        });
        t.send({ kind: "beforeAction", reqId, action: `click "${text}"`, page: snapshot(), feed: !opts.events });
      });
      if (label === null) el.removeAttribute("title");
      else el.setAttribute("title", label);
      el.style.outline = res.allow ? outline : "3px solid #c62828";
      if (res.allow) {
        bypass = el;
        el.click();
        setTimeout(() => el.style.outline = outline, 300);
      }
    };
    const onSubmit = (e) => {
      const f = e.target;
      emit({ kind: "app", at: Date.now(), verb: "save", page: snapshot(), description: `Submitted form "${f.getAttribute("name") || f.id || "form"}" on "${document.title}"`, payload: { action: "submit", entity: { kind: "page", key: location.pathname }, route: location.href } });
    };
    const onKey = () => counts.keystrokes++;
    const onWheel = () => counts.scrolls++;
    const onMove = (e) => {
      if (last) counts.mouseMovePx += Math.abs(e.clientX - last[0]) + Math.abs(e.clientY - last[1]);
      last = [e.clientX, e.clientY];
    };
    let lastUrl = "";
    const navCheck = () => {
      seedBaseline();
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      emit({ kind: "app", at: Date.now(), verb: "navigate", page: snapshot(), description: `Opened "${document.title}" (${location.hostname}${location.pathname})`, payload: { action: "navigate", route: location.href } });
    };
    const seedBaseline = () => document.querySelectorAll("input, select, textarea").forEach((el) => isField(el) && !focusValues.has(el) && focusValues.set(el, valueOf(el)));
    seedBaseline();
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("change", onChange, true);
    window.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("mousemove", onMove, { passive: true });
    const timer = setInterval(() => {
      navCheck();
      if (counts.keystrokes || counts.clicks || counts.scrolls || counts.mouseMovePx) {
        emit({ kind: "activity", ...counts, mouseMovePx: Math.round(counts.mouseMovePx), windowMs: 2e3, at: Date.now() });
      }
      counts.keystrokes = counts.clicks = counts.scrolls = counts.mouseMovePx = 0;
    }, 2e3);
    return () => {
      clearInterval(timer);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("change", onChange, true);
      window.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousemove", onMove);
    };
  }
  function snapshot() {
    const fields = {};
    const els = [...document.querySelectorAll("input, select, textarea")].filter((el) => isField(el) && visible(el));
    for (const el of els.slice(0, MAX_FIELDS)) fields[labelOf(el)] = valueOf(el);
    return { url: location.href, title: document.title, fields };
  }
  function isField(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el instanceof HTMLInputElement) return !["hidden", "button", "submit", "image", "reset", "file"].includes(el.type);
    return el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
  }
  function valueOf(el) {
    const input = el;
    const label = labelOf(el);
    if (input.type === "password" || SENSITIVE.test(label) || SENSITIVE.test(input.name ?? "") || SENSITIVE.test(input.autocomplete ?? "")) return "\u2022\u2022\u2022";
    if (input.type === "checkbox" || input.type === "radio") return input.checked ? "checked" : "unchecked";
    if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.textContent?.trim() ?? el.value;
    return (input.value ?? "").slice(0, 200);
  }
  function labelOf(el) {
    const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null;
    const wrapping = el.closest("label")?.childNodes[0]?.textContent;
    const raw = el.getAttribute("aria-label") || byFor || wrapping || el.placeholder || el.getAttribute("name") || el.id || el.tagName.toLowerCase();
    return raw.replace(/\s+/g, " ").trim().slice(0, 60);
  }
  function selectorOf(el) {
    if (el.id) return `#${el.id}`;
    const name = el.getAttribute("name");
    return name ? `${el.tagName.toLowerCase()}[name="${name}"]` : el.tagName.toLowerCase();
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // src/site.ts
  function startSite(transport, onStatusRequest, opts = {}) {
    let mode = "off";
    let offRecord = false;
    const offStatus = transport.listen((m) => {
      if (m.kind === "status") {
        mode = m.mode === "capture" || m.mode === "teach" ? m.mode : "off";
        offRecord = m.offRecord;
      }
    });
    const stopOverlay = startOverlay(transport, { controls: true });
    const stopCapture = startDomCapture(transport, () => ({ capture: mode === "capture" && !offRecord, teach: mode === "teach" }), { events: !opts.feed });
    transport.send({ kind: "hello", from: "ext", app: location.hostname });
    onStatusRequest?.();
    return () => {
      offStatus();
      stopOverlay();
      stopCapture();
    };
  }

  // src/embed.ts
  setTimeout(() => {
    if (document.documentElement.dataset.apprenticeExt) return;
    const ch = new BroadcastChannel("apprentice");
    const dedupe = new Dedupe();
    const listeners = /* @__PURE__ */ new Set();
    ch.addEventListener("message", (e) => {
      if (e.data?.id && dedupe.firstTime(e.data.id)) listeners.forEach((fn) => fn(e.data));
    });
    const transport = {
      send(body) {
        const msg = { ...body, id: newMsgId() };
        dedupe.firstTime(msg.id);
        ch.postMessage(msg);
      },
      listen(fn) {
        listeners.add(fn);
        return () => void listeners.delete(fn);
      }
    };
    const feed = document.querySelector('meta[name="apprentice-app"]')?.getAttribute("content") === "feed";
    startSite(transport, void 0, { feed });
  }, 1200);
})();
