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
.wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
  font: 14px/1.4 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1b1f24; max-width: min(420px, calc(100vw - 32px)); }
/* floating: cards top-right (bottom-right is where apps put their primary buttons), pill + caption bottom-right */
.wrap:not(.docked) .cards { position: fixed; top: 72px; right: 16px; width: min(400px, calc(100vw - 32px)); }
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
  function startOverlay(t, opts) {
    const host = document.createElement("div");
    host.id = "ai-apprentice-overlay";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS2}</style><div class="wrap${opts.mount ? " docked" : ""}"><div class="cards"></div><div class="caption" hidden></div><div class="pill" hidden></div></div>`;
    (opts.mount ?? document.documentElement).appendChild(host);
    const pill = root.querySelector(".pill");
    const caption = root.querySelector(".caption");
    const cards = root.querySelector(".cards");
    let status = null;
    let captionTimer;
    const renderPill = () => {
      if (!status || status.mode === "off" || status.mode === "free") return void (pill.hidden = true);
      pill.hidden = false;
      const teach = status.mode === "teach";
      pill.className = `pill ${status.offRecord ? "off" : teach ? "teach" : ""}`;
      const label = status.offRecord ? "Off the record" : teach ? "Ada is coaching" : `Ada is learning from ${status.expert ?? "you"}`;
      pill.innerHTML = `<span class="dot"></span><span>${esc(label)}</span>`;
      if (opts.controls && !teach) {
        const off2 = btn(status.offRecord ? "Back on record" : "Off the record", () => t.send({ kind: "marker", marker: status?.offRecord ? "off_record_end" : "off_record_start", at: Date.now() }));
        const bm = btn("Bookmark", () => t.send({ kind: "marker", marker: "bookmark", at: Date.now() }));
        pill.append(off2, bm);
      }
    };
    const showCard = (c) => {
      const el = document.createElement("div");
      el.className = `card ${c.tone}`;
      el.innerHTML = `<button class="x" title="Dismiss">\xD7</button>${opts.mount ? "" : `<button class="m" title="Minimize">\u2013</button>`}<h4>${esc(c.title)}</h4><p>${esc(c.text)}</p>` + (c.quote ? `<div class="quote">\u201C${esc(c.quote.text)}\u201D <span>\xB7 ${esc(c.quote.who)} \xB7 ${esc(c.quote.when)}</span></div>` : "") + (c.imageUrl ? `<div class="label">${esc(c.quote?.who ?? "Expert")}'s screen at this moment</div><div class="frame"><img src="${attr(c.imageUrl)}">${c.bbox ? `<div class="bbox" style="left:${c.bbox.x * 100}%;top:${c.bbox.y * 100}%;width:${c.bbox.w * 100}%;height:${c.bbox.h * 100}%"></div>` : ""}</div>` : "");
      el.querySelector(".x").addEventListener("click", () => el.remove());
      el.querySelector(".m")?.addEventListener("click", () => el.classList.toggle("min"));
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
        caption.innerHTML = `<span class="who">Ada</span>${esc(m.caption)}`;
        clearTimeout(captionTimer);
        captionTimer = setTimeout(() => caption.hidden = true, Math.max(4e3, m.caption.length * 70));
      }
    });
    return () => {
      off();
      host.remove();
    };
  }
  function btn(label, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
  var esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var attr = (s) => /^(https?:|data:image\/)/.test(s) ? esc(s) : "";

  // src/capture-dom.ts
  var ACTION_RE = /\b(save|submit|approve|confirm|book|post|send|pay|release|finish|complete|create|update)\b/i;
  var MAX_FIELDS = 60;
  function startDomCapture(t, isActive) {
    const counts = { keystrokes: 0, clicks: 0, scrolls: 0, mouseMovePx: 0 };
    const focusValues = /* @__PURE__ */ new WeakMap();
    let bypass = null;
    let last = null;
    const on = () => isActive().capture || isActive().teach;
    const emit = (b) => on() && t.send(b);
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
      const res = await new Promise((resolve) => {
        const timer2 = setTimeout(() => (stop(), resolve({ allow: true })), 6e3);
        const stop = t.listen((m) => {
          if (m.kind === "beforeActionResult" && m.reqId === reqId) {
            clearTimeout(timer2);
            stop();
            resolve(m);
          }
        });
        t.send({ kind: "beforeAction", reqId, action: `click "${text}"`, page: snapshot() });
      });
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
  function startSite(transport, onStatusRequest) {
    let mode = "off";
    let offRecord = false;
    const offStatus = transport.listen((m) => {
      if (m.kind === "status") {
        mode = m.mode === "capture" || m.mode === "teach" ? m.mode : "off";
        offRecord = m.offRecord;
      }
    });
    const stopOverlay = startOverlay(transport, { controls: true });
    const stopCapture = startDomCapture(transport, () => ({ capture: mode === "capture" && !offRecord, teach: mode === "teach" }));
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
    startSite(transport);
  }, 400);
})();
