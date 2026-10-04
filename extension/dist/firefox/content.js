"use strict";
(() => {
  // src/api.ts
  var ext = globalThis.browser ?? chrome;

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

  // ../shared/hubstatus.ts
  var STATUS_TTL_MS = 1e4;
  var keyOf = (s) => s.sessionId ?? "";
  function noteStatus(book, status, at) {
    return [...book.filter((x) => keyOf(x.status) !== keyOf(status)), { status, at }];
  }
  function activeStatus(book, now) {
    const newest = [...book].sort((a, b) => b.at - a.at);
    const liveTeach = newest.find((x) => x.status.mode === "teach" && now - x.at <= STATUS_TTL_MS);
    return (liveTeach ?? newest[0])?.status ?? null;
  }

  // src/overlay.ts
  var CSS2 = `
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
.quote .meaning { margin-top: 6px; color: #b5b5b5; font-size: 12px; font-style: italic; }
.frame { position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a; } .frame img { display: block; width: 100%; }
.bbox { position: absolute; border: 2px solid #ef4444; border-radius: 4px; box-shadow: 0 0 0 2px rgba(239,68,68,.25); }
.label { font-size: 12px; color: #9a9a9a; margin-bottom: -6px; }
.sev { display: block; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #52a8ff; margin-bottom: 2px; }
.card.block .sev { color: #ff8589; } .card.nudge .sev { color: #ffc34d; }
.prov { font-size: 12px; color: #9a9a9a; border-left: 2px solid #2a2a2a; padding-left: 8px; }
@media (prefers-reduced-motion: reduce) { .dot, .wave i { animation: none; } .pill, .grip { transition: none; } }
`;
  var SPOT_KEY = "ai-apprentice-dock";
  var EDGE_GAP = 8;
  function startOverlay(t, opts) {
    const host = document.createElement("div");
    host.id = "protege-overlay";
    const root = host.attachShadow({ mode: "open" });
    const cards = h("div", { class: "cards" });
    const caption = h("div", { class: "caption" });
    const panel = h("div", { class: "panel" }, cards, caption);
    const pill = h("div", { class: "pill" });
    caption.hidden = pill.hidden = true;
    root.append(h("style", {}, CSS2), pill, panel);
    document.documentElement.appendChild(host);
    let status = null;
    let statuses = [];
    let captionTimer;
    let spot = loadSpot();
    let drag = null;
    let pressed = null;
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
          if (fits.length) top = fits.reduce((a, b) => Math.abs(b - top) < Math.abs(a - top) ? b : a);
        }
      }
      panel.style.top = `${top}px`;
    };
    let frame = 0;
    const schedulePlace = () => void (frame ||= requestAnimationFrame(() => (frame = 0, place())));
    const onPress = (e) => {
      if (e.target instanceof Element && e.target !== host) pressed = e.target;
    };
    const moveTo = (next) => {
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
      moveTo(spot);
    };
    grip.addEventListener("pointerup", drop);
    grip.addEventListener("pointercancel", drop);
    grip.addEventListener("lostpointercapture", drop);
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
        const eye = iconBtn(offRecord ? EYE_OFF : EYE, offRecord ? "Back on the record" : "Go off the record: Ada stops watching and listening", () => t.send({ kind: "marker", marker: status?.offRecord ? "off_record_end" : "off_record_start", at: Date.now() }));
        eye.classList.toggle("on", offRecord);
        const bm = iconBtn(BOOKMARK, "Bookmark this moment", () => t.send({ kind: "marker", marker: "bookmark", at: Date.now() }));
        pill.append(h("span", { class: "sep" }), eye, bm);
      }
    };
    const showCard = (c) => {
      const el = h("div", { class: `card ${c.tone}` });
      const title = h("h4", {}, c.title);
      if (c.label) title.prepend(h("span", { class: "sev" }, c.label));
      const head = h("div", { class: "head" }, h("span", { class: "tone" }), title);
      head.append(iconBtn(MINUS, "Minimize", () => el.classList.toggle("min")), iconBtn(CLOSE, "Dismiss", () => el.remove()));
      if (c.tone === "block") el.setAttribute("role", "alert");
      el.append(head, h("p", {}, c.text));
      if (c.provenance) el.append(h("p", { class: "prov" }, c.provenance));
      if (c.quote) {
        const q = h("div", { class: "quote" }, `\u201C${c.quote.text}\u201D`, h("span", {}, `${c.quote.who} \xB7 ${c.quote.when}`));
        if (c.quote.translation) q.append(h("div", { class: "meaning" }, `Meaning: \u201C${c.quote.translation}\u201D`));
        el.append(q);
      }
      const src = c.imageUrl && /^(https?:|data:image\/)/.test(c.imageUrl) ? c.imageUrl : "";
      if (src) {
        const frame2 = h("div", { class: "frame" }, h("img", { src, alt: `${c.quote?.who ?? "The expert"}'s screen${c.quote ? ` at ${c.quote.when}` : " at this moment"}` }));
        if (c.bbox) {
          const box = h("div", { class: "bbox" });
          Object.assign(box.style, { left: `${c.bbox.x * 100}%`, top: `${c.bbox.y * 100}%`, width: `${c.bbox.w * 100}%`, height: `${c.bbox.h * 100}%` });
          frame2.append(box);
        }
        el.append(h("div", { class: "label" }, `${c.quote?.who ?? "Expert"}'s screen at this moment`), frame2);
      }
      cards.replaceChildren(el);
      if (c.tone === "info") setTimeout(() => el.remove(), 2e4);
    };
    const sizes = new ResizeObserver(() => place());
    sizes.observe(pill);
    sizes.observe(panel);
    window.addEventListener("resize", schedulePlace);
    window.addEventListener("scroll", schedulePlace, { capture: true, passive: true });
    document.addEventListener("pointerdown", onPress, true);
    const off = t.listen((m) => {
      if (m.kind === "status") {
        statuses = noteStatus(statuses, m, Date.now());
        status = activeStatus(statuses, Date.now());
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
        }, Math.max(4e3, m.caption.length * 70));
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
  var clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
  function loadSpot() {
    try {
      const s = JSON.parse(localStorage.getItem(SPOT_KEY) ?? "null");
      if (s && (s.side === "left" || s.side === "right") && typeof s.y === "number") return { side: s.side, y: clamp(s.y, 0, 1) };
    } catch {
    }
    return { side: "right", y: 0.5 };
  }
  function saveSpot(s) {
    try {
      localStorage.setItem(SPOT_KEY, JSON.stringify(s));
    } catch {
    }
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
  var UNVERIFIED = "Couldn't verify this against the expert's rules. Check with the controller before saving.";
  function startDomCapture(t, isActive, opts = { events: true }) {
    const counts = { keystrokes: 0, clicks: 0, scrolls: 0, mouseMovePx: 0 };
    const focusValues = /* @__PURE__ */ new WeakMap();
    let bypass = null;
    let bypassForm = null;
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
        void holdAndCheck(el, text, () => {
          bypass = el;
          el.click();
        });
        return;
      }
      if (bypass === el) setTimeout(() => bypass === el && (bypass = null), 0);
      emit({
        kind: "app",
        at: Date.now(),
        verb: ACTION_RE.test(text) ? "save" : "other",
        page: snapshot(),
        description: `Clicked "${text}" on "${document.title}"`,
        payload: { action: ACTION_RE.test(text) ? "save" : "click", entity: { kind: "page", key: location.pathname }, selector: selectorOf(el), route: location.href }
      });
    };
    const holdAndCheck = async (el, text, proceed) => {
      const reqId = newMsgId();
      const outline = el.dataset.apOutline ??= el.style.outline;
      el.style.outline = "3px solid #3b6fb6";
      const label = el.getAttribute("title");
      el.setAttribute("title", "Ada is checking this against the expert's rules\u2026");
      const res = await new Promise((resolve) => {
        const timer2 = setTimeout(() => (stop(), resolve({ allow: false, timedOut: true })), 15e3);
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
      if (res.timedOut) opts.notify?.({ kind: "tutorCard", tone: "block", title: "Couldn't verify this save", text: `${UNVERIFIED} Ada didn't answer in time; try again in a moment.` });
      if (res.allow) {
        proceed();
        setTimeout(() => el.style.outline = outline, 300);
      }
    };
    const onSubmit = (e) => {
      const f = e.target;
      const search = f.matches("[role=search]") || !!f.querySelector("input[type=search]");
      if (isActive().teach && bypassForm !== f && !search) {
        const submitter = e.submitter;
        if (!(submitter && bypass === submitter)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const text = (submitter?.textContent || submitter?.value || f.getAttribute("name") || "submit form").trim().slice(0, 60);
          void holdAndCheck(submitter ?? f, text, () => {
            bypassForm = f;
            f.requestSubmit(submitter && f.contains(submitter) ? submitter : void 0);
            bypassForm = null;
          });
          return;
        }
      }
      if (bypass && bypass === e.submitter) bypass = null;
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
  var PII_FIELD = /e-?mail|phone|mobile|tel\b|iban|bic|swift|birth|address|passport/i;
  var PII_AUTOCOMPLETE = /^(cc-|email|tel|bday|street-address|address-line|postal-code|current-password|new-password)/;
  function piiRects() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const out = [];
    const els = document.querySelectorAll("input, textarea, select, [contenteditable=true], [data-pii]");
    for (const el of els) {
      const input = el;
      const label = el.matches("[data-pii]") ? "" : labelOf(el);
      const sensitive = el.matches("[data-pii]") || ["password", "email", "tel"].includes(input.type) || PII_AUTOCOMPLETE.test(input.autocomplete ?? "") || SENSITIVE.test(label) || PII_FIELD.test(label) || SENSITIVE.test(input.name ?? "") || PII_FIELD.test(input.name ?? "");
      if (!sensitive) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
      const pad = 4;
      const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
      out.push({ x: x / vw, y: y / vh, w: Math.min(vw - x, r.width + 2 * pad) / vw, h: Math.min(vh - y, r.height + 2 * pad) / vh });
    }
    return out;
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
    let book = [];
    const offStatus = transport.listen((m) => {
      if (m.kind === "status") book = noteStatus(book, m, Date.now());
    });
    const active = () => {
      const s = activeStatus(book, Date.now());
      const mode = s?.mode === "capture" || s?.mode === "teach" ? s.mode : "off";
      return { capture: mode === "capture" && !s?.offRecord, teach: mode === "teach" };
    };
    const local = /* @__PURE__ */ new Set();
    const overlayTransport = {
      send: (b) => transport.send(b),
      listen(fn) {
        const off = transport.listen(fn);
        local.add(fn);
        return () => (off(), local.delete(fn));
      }
    };
    const notify = (b) => local.forEach((fn) => fn({ ...b, id: newMsgId() }));
    const stopOverlay = startOverlay(overlayTransport, { controls: true });
    const stopCapture = startDomCapture(transport, active, { events: !opts.feed, notify });
    transport.send({ kind: "hello", from: "ext", app: location.hostname });
    onStatusRequest?.();
    return () => {
      offStatus();
      stopOverlay();
      stopCapture();
    };
  }

  // src/origins.ts
  var APP_ORIGINS = [
    "https://hacknation11labs.web.app",
    "https://hacknation11labs.firebaseapp.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ];
  function isAppOrigin(url) {
    if (!url) return false;
    try {
      return APP_ORIGINS.includes(new URL(url).origin);
    } catch {
      return false;
    }
  }

  // src/content.ts
  var meta = document.querySelector('meta[name="apprentice-app"]');
  var feed = meta?.content === "feed";
  var appPage = isAppOrigin(location.origin);
  var role = meta && !feed && appPage ? "app" : "site";
  var dedupe = new Dedupe();
  var listeners = /* @__PURE__ */ new Set();
  function deliverLocal(m) {
    if (!dedupe.firstTime(m.id)) return;
    listeners.forEach((fn) => fn(m));
  }
  ext.runtime.onMessage.addListener((x, _sender, reply) => {
    if (x?.type === "piiRects") {
      reply(piiRects());
      return true;
    }
    if (x?.type !== "relay" || !x.msg) return;
    if (role === "site") deliverLocal(x.msg);
    else window.postMessage({ __apprentice: x.msg, fromExt: true }, location.origin);
  });
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin || !e.data?.__apprentice || e.data.fromExt) return;
    void ext.runtime.sendMessage({ type: "relay", msg: e.data.__apprentice }).catch(() => {
    });
  });
  document.documentElement.dataset.apprenticeExt = "1";
  if (role === "site") {
    const transport = {
      send(body) {
        const msg = { ...body, id: newMsgId() };
        dedupe.firstTime(msg.id);
        void ext.runtime.sendMessage({ type: "relay", msg }).catch(() => {
        });
      },
      listen(fn) {
        listeners.add(fn);
        return () => void listeners.delete(fn);
      }
    };
    startSite(transport, () => void ext.runtime.sendMessage({ type: "getStatus" }).then((s) => s && deliverLocal({ ...s, id: newMsgId() })).catch(() => {
    }), { feed });
  }
})();
