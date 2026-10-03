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
    const outline = el.style.outline;
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
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    emit({ kind: "app", at: Date.now(), verb: "navigate", page: snapshot(), description: `Opened "${document.title}" (${location.hostname}${location.pathname})`, payload: { action: "navigate", route: location.href } });
  };
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

// src/content.ts
var role = document.querySelector('meta[name="apprentice-app"]') ? "app" : "site";
var dedupe = new Dedupe();
var listeners = /* @__PURE__ */ new Set();
function deliverLocal(m) {
  if (!dedupe.firstTime(m.id)) return;
  listeners.forEach((fn) => fn(m));
}
chrome.runtime.onMessage.addListener((x) => {
  if (x?.type !== "relay" || !x.msg) return;
  if (role === "site") deliverLocal(x.msg);
  else window.postMessage({ __apprentice: x.msg, fromExt: true }, "*");
});
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data?.__apprentice || e.data.fromExt) return;
  void chrome.runtime.sendMessage({ type: "relay", msg: e.data.__apprentice }).catch(() => {
  });
});
if (role === "site") {
  const transport = {
    send(body) {
      const msg = { ...body, id: newMsgId() };
      dedupe.firstTime(msg.id);
      void chrome.runtime.sendMessage({ type: "relay", msg }).catch(() => {
      });
    },
    listen(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    }
  };
  let mode = "off";
  let offRecord = false;
  transport.listen((m) => {
    if (m.kind === "status") {
      mode = m.mode === "capture" || m.mode === "teach" ? m.mode : "off";
      offRecord = m.offRecord;
    }
  });
  startOverlay(transport, { controls: true });
  startDomCapture(transport, () => ({ capture: mode === "capture" && !offRecord, teach: mode === "teach" }));
  transport.send({ kind: "hello", from: "ext", app: location.hostname });
  void chrome.runtime.sendMessage({ type: "getStatus" }).then((s) => s && deliverLocal({ ...s, id: newMsgId() })).catch(() => {
  });
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc2hhcmVkL2JyaWRnZS50cyIsICIuLi9zcmMvb3ZlcmxheS50cyIsICIuLi9zcmMvY2FwdHVyZS1kb20udHMiLCAiLi4vc3JjL2NvbnRlbnQudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8qKlxuICogQ3Jvc3MtdGFiIHByb3RvY29sIGJldHdlZW4gdGhlIHdvcmsgdGFiIChNaW5pRVJQIG9yIEFOWSB3ZWJzaXRlIHZpYSB0aGUgZXh0ZW5zaW9uKSBhbmQgdGhlIGh1YiB0YWJcbiAqICgvY2FwdHVyZSBvciAvdGVhY2gpIHRoYXQgb3ducyB0aGUgc2Vzc2lvbiwgc2NyZWVuIGNhcHR1cmUgYW5kIHRoZSB2b2ljZSBhZ2VudC5cbiAqXG4gKiBUcmFuc3BvcnRzIChhbGwgY2FycnkgdGhlIHNhbWUgbWVzc2FnZXMsIGRlZHVwbGljYXRlZCBieSBgaWRgKTpcbiAqICAtIEJyb2FkY2FzdENoYW5uZWwoXCJhcHByZW50aWNlXCIpOiBzYW1lLW9yaWdpbiB0YWJzIChodWIgXHUyMUM0IE1pbmlFUlApLlxuICogIC0gd2luZG93LnBvc3RNZXNzYWdlKHtfX2FwcHJlbnRpY2U6IG1zZ30pIFx1MjFDNCBleHRlbnNpb24gY29udGVudCBzY3JpcHQgXHUyMUM0IGJhY2tncm91bmQgd29ya2VyIFx1MjFDNCBvdGhlciB0YWJzIChhbnkgb3JpZ2luKS5cbiAqL1xuaW1wb3J0IHR5cGUgeyBBcHBFdmVudCwgQ2FzZUZhY3RzLCBJZCB9IGZyb20gXCIuL3NjaGVtYVwiO1xuXG5leHBvcnQgdHlwZSBFcnBNb2RlID0gXCJjYXB0dXJlXCIgfCBcInRlYWNoXCIgfCBcImZyZWVcIjtcblxuLyoqIFZpc2libGUgZm9ybSBzdGF0ZSBvZiBhIGdlbmVyaWMgcGFnZSAobGFiZWxzIFx1MjE5MiB2YWx1ZXMsIHNlbnNpdGl2ZSB2YWx1ZXMgbWFza2VkKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFnZVNuYXBzaG90IHtcbiAgdXJsOiBzdHJpbmc7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIGZpZWxkczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbn1cblxuZXhwb3J0IHR5cGUgQnJpZGdlQm9keSA9XG4gIHwgeyBraW5kOiBcImhlbGxvXCI7IGZyb206IFwiZXJwXCIgfCBcImh1YlwiIHwgXCJleHRcIjsgbW9kZT86IEVycE1vZGU7IGFwcD86IHN0cmluZyB9XG4gIHwgeyBraW5kOiBcInN0YXR1c1wiOyBtb2RlOiBFcnBNb2RlIHwgXCJvZmZcIjsgc2Vzc2lvbklkPzogSWQ7IG9mZlJlY29yZDogYm9vbGVhbjsgcmVjb3JkaW5nOiBib29sZWFuOyBleHBlcnQ/OiBzdHJpbmcgfVxuICB8IHsga2luZDogXCJhcHBcIjsgcGF5bG9hZDogQXBwRXZlbnRbXCJwYXlsb2FkXCJdOyBkZXNjcmlwdGlvbj86IHN0cmluZzsgdmVyYj86IHN0cmluZzsgZmFjdHM/OiBDYXNlRmFjdHM7IHBhZ2U/OiBQYWdlU25hcHNob3Q7IGF0OiBudW1iZXIgfVxuICB8IHsga2luZDogXCJhY3Rpdml0eVwiOyBrZXlzdHJva2VzOiBudW1iZXI7IGNsaWNrczogbnVtYmVyOyBzY3JvbGxzOiBudW1iZXI7IG1vdXNlTW92ZVB4OiBudW1iZXI7IHdpbmRvd01zOiBudW1iZXI7IGF0OiBudW1iZXIgfVxuICB8IHsga2luZDogXCJjYXNlXCI7IHN0YXRlOiBcInN0YXJ0XCIgfCBcImVuZFwiOyBjYXNlOiB7IGlkOiBJZDsga2luZDogc3RyaW5nOyBrZXk6IHN0cmluZzsgbGFiZWw/OiBzdHJpbmcgfTsgb3V0Y29tZT86IHN0cmluZzsgZmFjdHM/OiBDYXNlRmFjdHM7IGF0OiBudW1iZXIgfVxuICB8IHsga2luZDogXCJtYXJrZXJcIjsgbWFya2VyOiBcIm9mZl9yZWNvcmRfc3RhcnRcIiB8IFwib2ZmX3JlY29yZF9lbmRcIiB8IFwiYm9va21hcmtcIiB8IFwiZW5kX3Rhc2tcIjsgYXQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiBcImJlZm9yZVNhdmVcIjsgcmVxSWQ6IHN0cmluZzsgZmFjdHM6IENhc2VGYWN0cyB9XG4gIHwgeyBraW5kOiBcImJlZm9yZVNhdmVSZXN1bHRcIjsgcmVxSWQ6IHN0cmluZzsgYWxsb3c6IGJvb2xlYW47IGd1YXJkcmFpbElkcz86IElkW107IG1lc3NhZ2U/OiBzdHJpbmcgfVxuICAvKiogR2VuZXJpYyB3ZWJzaXRlczogYW4gYWN0aW9uIChTYXZlL1N1Ym1pdC9BcHByb3ZlXHUyMDI2KSBpcyBhYm91dCB0byBoYXBwZW47IHRoZSBodWIgbWF5IGhvbGQgaXQuICovXG4gIHwgeyBraW5kOiBcImJlZm9yZUFjdGlvblwiOyByZXFJZDogc3RyaW5nOyBhY3Rpb246IHN0cmluZzsgcGFnZTogUGFnZVNuYXBzaG90IH1cbiAgfCB7IGtpbmQ6IFwiYmVmb3JlQWN0aW9uUmVzdWx0XCI7IHJlcUlkOiBzdHJpbmc7IGFsbG93OiBib29sZWFuOyBndWFyZHJhaWxJZHM/OiBJZFtdOyBtZXNzYWdlPzogc3RyaW5nIH1cbiAgLyoqIEV4dGVuc2lvbi1jYXB0dXJlZCBzY3JlZW5zaG90IG9mIHRoZSB3b3JrIHRhYiAoSlBFRyBkYXRhIFVSTCkgXHUyMDE0IGNhcHR1cmUgd2l0aG91dCB0aGUgc2hhcmUgZGlhbG9nLiAqL1xuICB8IHsga2luZDogXCJmcmFtZVwiOyBkYXRhVXJsOiBzdHJpbmc7IGF0OiBudW1iZXI7IHVybDogc3RyaW5nIH1cbiAgLyoqIE92ZXJsYXkgY29udGVudCBvbiB0aGUgd29yayB0YWIuICovXG4gIHwgeyBraW5kOiBcInR1dG9yU2F5XCI7IHRleHQ6IHN0cmluZyB9XG4gIHwgeyBraW5kOiBcInR1dG9yQ2FyZFwiOyB0b25lOiBcImJsb2NrXCIgfCBcIm51ZGdlXCIgfCBcImluZm9cIiB8IFwicHJlZGljdFwiOyB0aXRsZTogc3RyaW5nOyB0ZXh0OiBzdHJpbmc7IHF1b3RlPzogeyB0ZXh0OiBzdHJpbmc7IHdobzogc3RyaW5nOyB3aGVuOiBzdHJpbmcgfTsgaW1hZ2VVcmw/OiBzdHJpbmc7IGJib3g/OiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyB3OiBudW1iZXI7IGg6IG51bWJlciB9IH1cbiAgfCB7IGtpbmQ6IFwiYWdlbnRTdGF0ZVwiOyBzcGVha2luZzogYm9vbGVhbjsgbGlzdGVuaW5nOiBib29sZWFuOyBjYXB0aW9uPzogc3RyaW5nIH07XG5cbmV4cG9ydCB0eXBlIEJyaWRnZU1zZyA9IEJyaWRnZUJvZHkgJiB7IGlkOiBzdHJpbmcgfTtcblxuZXhwb3J0IGNvbnN0IG5ld01zZ0lkID0gKCkgPT4gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMikgKyBEYXRlLm5vdygpLnRvU3RyaW5nKDM2KTtcblxuLyoqIFJlbWVtYmVycyByZWNlbnRseSBzZWVuIGlkcyBzbyBhIG1lc3NhZ2UgZGVsaXZlcmVkIGJ5IHR3byB0cmFuc3BvcnRzIGlzIGhhbmRsZWQgb25jZS4gKi9cbmV4cG9ydCBjbGFzcyBEZWR1cGUge1xuICBwcml2YXRlIHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSBvcmRlcjogc3RyaW5nW10gPSBbXTtcbiAgZmlyc3RUaW1lKGlkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBpZiAodGhpcy5zZWVuLmhhcyhpZCkpIHJldHVybiBmYWxzZTtcbiAgICB0aGlzLnNlZW4uYWRkKGlkKTtcbiAgICB0aGlzLm9yZGVyLnB1c2goaWQpO1xuICAgIGlmICh0aGlzLm9yZGVyLmxlbmd0aCA+IDUwMCkgdGhpcy5zZWVuLmRlbGV0ZSh0aGlzLm9yZGVyLnNoaWZ0KCkhKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG4vKiogS2V5cyB3aG9zZSB2YWx1ZXMgbXVzdCBuZXZlciBsZWF2ZSB0aGUgcGFnZSAobWFza2VkIGluIFBhZ2VTbmFwc2hvdCkuICovXG5leHBvcnQgY29uc3QgU0VOU0lUSVZFID0gL3Bhc3N8aWJhbnxjYXJkfGN2dnxjdmN8c3NufHNvY2lhbHx0YXguP2lkfGFjY291bnQuPyhub3xudW1iZXIpfHRva2VufHNlY3JldHxwaW5cXGIvaTtcbiIsICIvKipcbiAqIFRoZSBvbi1wYWdlIG92ZXJsYXk6IGEgc3RhdHVzIHBpbGwgKHJlY29yZGluZyAvIG9mZiB0aGUgcmVjb3JkIC8gdHV0b3JpbmcgKyBBZGEncyBsaXZlIGNhcHRpb24pIGFuZFxuICogZ3VpZGFuY2UgY2FyZHMgKHR1dG9yIGludGVydmVudGlvbnMgd2l0aCB0aGUgZXhwZXJ0J3MgcXVvdGUgYW5kIHNjcmVlbiBtb21lbnQpLlxuICogU2hhZG93IERPTSwgc28gaG9zdC1wYWdlIENTUyBjYW4ndCBicmVhayBpdC4gVXNlZCBieSB0aGUgZXh0ZW5zaW9uIGNvbnRlbnQgc2NyaXB0IG9uIGFueSBzaXRlIGFuZCBlbWJlZGRlZFxuICogZGlyZWN0bHkgaW4gTWluaUVSUCAod2ViL3NyYy9lcnApIHNvIHRoZSBkZW1vIGFsc28gd29ya3Mgd2l0aG91dCB0aGUgZXh0ZW5zaW9uLlxuICovXG5pbXBvcnQgdHlwZSB7IEJyaWRnZUJvZHksIEJyaWRnZU1zZyB9IGZyb20gXCIuLi8uLi9zaGFyZWQvYnJpZGdlXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVHJhbnNwb3J0IHtcbiAgc2VuZChib2R5OiBCcmlkZ2VCb2R5KTogdm9pZDtcbiAgbGlzdGVuKGZuOiAobTogQnJpZGdlTXNnKSA9PiB2b2lkKTogKCkgPT4gdm9pZDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBPdmVybGF5T3B0aW9ucyB7XG4gIC8qKiBTaG93IG9mZi1yZWNvcmQgLyBib29rbWFyayBjb250cm9scyAoZmFsc2Ugd2hlcmUgdGhlIGhvc3QgYXBwIGhhcyBpdHMgb3duKS4gKi9cbiAgY29udHJvbHM6IGJvb2xlYW47XG4gIC8qKiBEb2NrIGludG8gdGhpcyBlbGVtZW50IChpbi1mbG93IHN0cmlwLCBuZXZlciBjb3ZlcnMgdGhlIGFwcCkuIERlZmF1bHQ6IGZsb2F0aW5nIGJvdHRvbS1yaWdodC4gKi9cbiAgbW91bnQ/OiBIVE1MRWxlbWVudDtcbn1cblxudHlwZSBTdGF0dXMgPSBFeHRyYWN0PEJyaWRnZUJvZHksIHsga2luZDogXCJzdGF0dXNcIiB9PjtcblxuY29uc3QgQ1NTID0gYFxuOmhvc3QgeyBhbGw6IGluaXRpYWw7IH1cbi53cmFwIHsgcG9zaXRpb246IGZpeGVkOyByaWdodDogMTZweDsgYm90dG9tOiAxNnB4OyB6LWluZGV4OiAyMTQ3NDgzNjQ3OyBkaXNwbGF5OiBmbGV4OyBmbGV4LWRpcmVjdGlvbjogY29sdW1uOyBhbGlnbi1pdGVtczogZmxleC1lbmQ7IGdhcDogMTBweDtcbiAgZm9udDogMTRweC8xLjQgSW50ZXIsIHN5c3RlbS11aSwgLWFwcGxlLXN5c3RlbSwgXCJTZWdvZSBVSVwiLCBzYW5zLXNlcmlmOyBjb2xvcjogIzFiMWYyNDsgbWF4LXdpZHRoOiBtaW4oNDIwcHgsIGNhbGMoMTAwdncgLSAzMnB4KSk7IH1cbi53cmFwLmRvY2tlZCB7IHBvc2l0aW9uOiBzdGF0aWM7IG1heC13aWR0aDogbm9uZTsgZmxleC1kaXJlY3Rpb246IHJvdy1yZXZlcnNlOyBhbGlnbi1pdGVtczogZmxleC1zdGFydDsgZmxleC13cmFwOiB3cmFwOyBwYWRkaW5nOiA4cHggMTZweDsgfVxuLndyYXAuZG9ja2VkIC5jYXJkcyB7IGZsZXg6IDEgMSA0MjBweDsgfSAud3JhcC5kb2NrZWQgLmNhcmQgeyBkaXNwbGF5OiBncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmciAyNjBweDsgZ2FwOiA0cHggMTZweDsgfSAud3JhcC5kb2NrZWQgLmNhcmQgPiA6bm90KC5mcmFtZSk6bm90KC5sYWJlbCkgeyBncmlkLWNvbHVtbjogMTsgfSAud3JhcC5kb2NrZWQgLmNhcmQgLmxhYmVsLCAud3JhcC5kb2NrZWQgLmNhcmQgLmZyYW1lIHsgZ3JpZC1jb2x1bW46IDI7IGdyaWQtcm93OiAxIC8gc3BhbiA0OyB9IC53cmFwLmRvY2tlZCAuY2FyZCAubGFiZWwgeyBkaXNwbGF5OiBub25lOyB9XG4ud3JhcDpub3QoLmRvY2tlZCkgLmNhcmQubWluID4gOm5vdChoNCk6bm90KC54KTpub3QoLm0pIHsgZGlzcGxheTogbm9uZTsgfVxuLmNhcmQgLm0geyBhbGw6IHVuc2V0OyBjdXJzb3I6IHBvaW50ZXI7IGZsb2F0OiByaWdodDsgZm9udC1zaXplOiAxNnB4OyBjb2xvcjogIzY2NzA3YzsgbWFyZ2luLXJpZ2h0OiAxMHB4OyB9XG4ucGlsbCB7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogOHB4OyBiYWNrZ3JvdW5kOiAjMWYzYTVmOyBjb2xvcjogI2ZmZjsgYm9yZGVyLXJhZGl1czogOTk5cHg7IHBhZGRpbmc6IDZweCA4cHggNnB4IDEycHg7IGJveC1zaGFkb3c6IDAgNHB4IDE2cHggcmdiYSgwLDAsMCwuMik7IH1cbi5waWxsLm9mZiB7IGJhY2tncm91bmQ6ICNjNjI4Mjg7IH0gLnBpbGwudGVhY2ggeyBiYWNrZ3JvdW5kOiAjMmU1ZDJlOyB9XG4uZG90IHsgd2lkdGg6IDhweDsgaGVpZ2h0OiA4cHg7IGJvcmRlci1yYWRpdXM6IDUwJTsgYmFja2dyb3VuZDogI2ZmNTI1MjsgYW5pbWF0aW9uOiBwdWxzZSAxLjRzIGluZmluaXRlOyB9IC5waWxsLnRlYWNoIC5kb3QgeyBiYWNrZ3JvdW5kOiAjOWJlMzlmOyB9IC5waWxsLm9mZiAuZG90IHsgYmFja2dyb3VuZDogI2ZmZjsgYW5pbWF0aW9uOiBub25lOyB9XG5Aa2V5ZnJhbWVzIHB1bHNlIHsgNTAlIHsgb3BhY2l0eTogLjM1OyB9IH1cbi5waWxsIGJ1dHRvbiB7IGFsbDogdW5zZXQ7IGN1cnNvcjogcG9pbnRlcjsgZm9udC1zaXplOiAxMnB4OyBwYWRkaW5nOiAzcHggOHB4OyBib3JkZXItcmFkaXVzOiA5OTlweDsgYmFja2dyb3VuZDogcmdiYSgyNTUsMjU1LDI1NSwuMTUpOyB9XG4ucGlsbCBidXR0b246aG92ZXIgeyBiYWNrZ3JvdW5kOiByZ2JhKDI1NSwyNTUsMjU1LC4zKTsgfVxuLmNhcHRpb24geyBiYWNrZ3JvdW5kOiByZ2JhKDIwLDI0LDMwLC45Mik7IGNvbG9yOiAjZmZmOyBwYWRkaW5nOiA4cHggMTJweDsgYm9yZGVyLXJhZGl1czogMTBweDsgbWF4LXdpZHRoOiAxMDAlOyBib3gtc2hhZG93OiAwIDRweCAxNnB4IHJnYmEoMCwwLDAsLjIpOyB9XG4uY2FwdGlvbiAud2hvIHsgZm9udC1zaXplOiAxMXB4OyBvcGFjaXR5OiAuNzsgZGlzcGxheTogYmxvY2s7IH1cbi5jYXJkIHsgYmFja2dyb3VuZDogI2ZmZjsgYm9yZGVyLXJhZGl1czogMTJweDsgYm9yZGVyOiAycHggc29saWQgIzNiNmZiNjsgcGFkZGluZzogMTJweCAxNHB4OyBib3gtc2hhZG93OiAwIDhweCAyOHB4IHJnYmEoMCwwLDAsLjI1KTsgd2lkdGg6IDEwMCU7IGJveC1zaXppbmc6IGJvcmRlci1ib3g7IH1cbi5jYXJkLmJsb2NrIHsgYm9yZGVyLWNvbG9yOiAjYzYyODI4OyB9IC5jYXJkLm51ZGdlIHsgYm9yZGVyLWNvbG9yOiAjYjI2YTAwOyB9IC5jYXJkLmluZm8geyBib3JkZXItY29sb3I6ICMyZTdkMzI7IH1cbi5jYXJkIGg0IHsgbWFyZ2luOiAwIDI0cHggNnB4IDA7IGZvbnQtc2l6ZTogMTRweDsgfSAuY2FyZCBwIHsgbWFyZ2luOiAwIDAgOHB4OyB9XG4uY2FyZCAueCB7IHBvc2l0aW9uOiBhYnNvbHV0ZTsgcmlnaHQ6IDIycHg7IG1hcmdpbi10b3A6IC00cHg7IGFsbDogdW5zZXQ7IGN1cnNvcjogcG9pbnRlcjsgZmxvYXQ6IHJpZ2h0OyBmb250LXNpemU6IDE2cHg7IGNvbG9yOiAjNjY3MDdjOyB9XG4ucXVvdGUgeyBtYXJnaW46IDAgMCA4cHg7IHBhZGRpbmc6IDZweCAxMHB4OyBib3JkZXItbGVmdDogM3B4IHNvbGlkICMzYjZmYjY7IGJhY2tncm91bmQ6ICNlZWYyZjc7IGJvcmRlci1yYWRpdXM6IDAgNnB4IDZweCAwOyBmb250LXN0eWxlOiBpdGFsaWM7IH1cbi5xdW90ZSBzcGFuIHsgZm9udC1zdHlsZTogbm9ybWFsOyBjb2xvcjogIzY2NzA3YzsgZm9udC1zaXplOiAxMnB4OyB9XG4uZnJhbWUgeyBwb3NpdGlvbjogcmVsYXRpdmU7IGJvcmRlci1yYWRpdXM6IDhweDsgb3ZlcmZsb3c6IGhpZGRlbjsgYm9yZGVyOiAxcHggc29saWQgI2RkZTFlNjsgfSAuZnJhbWUgaW1nIHsgZGlzcGxheTogYmxvY2s7IHdpZHRoOiAxMDAlOyB9XG4uYmJveCB7IHBvc2l0aW9uOiBhYnNvbHV0ZTsgYm9yZGVyOiAzcHggc29saWQgI2U1MzkzNTsgYm9yZGVyLXJhZGl1czogNHB4OyB9XG4ubGFiZWwgeyBmb250LXNpemU6IDExcHg7IGNvbG9yOiAjNjY3MDdjOyBtYXJnaW4tYm90dG9tOiA0cHg7IH1cbmA7XG5cbmV4cG9ydCBmdW5jdGlvbiBzdGFydE92ZXJsYXkodDogVHJhbnNwb3J0LCBvcHRzOiBPdmVybGF5T3B0aW9ucyk6ICgpID0+IHZvaWQge1xuICBjb25zdCBob3N0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgaG9zdC5pZCA9IFwiYWktYXBwcmVudGljZS1vdmVybGF5XCI7XG4gIGNvbnN0IHJvb3QgPSBob3N0LmF0dGFjaFNoYWRvdyh7IG1vZGU6IFwib3BlblwiIH0pO1xuICByb290LmlubmVySFRNTCA9IGA8c3R5bGU+JHtDU1N9PC9zdHlsZT48ZGl2IGNsYXNzPVwid3JhcCR7b3B0cy5tb3VudCA/IFwiIGRvY2tlZFwiIDogXCJcIn1cIj48ZGl2IGNsYXNzPVwiY2FyZHNcIj48L2Rpdj48ZGl2IGNsYXNzPVwiY2FwdGlvblwiIGhpZGRlbj48L2Rpdj48ZGl2IGNsYXNzPVwicGlsbFwiIGhpZGRlbj48L2Rpdj48L2Rpdj5gO1xuICAob3B0cy5tb3VudCA/PyBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQpLmFwcGVuZENoaWxkKGhvc3QpO1xuICBjb25zdCBwaWxsID0gcm9vdC5xdWVyeVNlbGVjdG9yPEhUTUxEaXZFbGVtZW50PihcIi5waWxsXCIpITtcbiAgY29uc3QgY2FwdGlvbiA9IHJvb3QucXVlcnlTZWxlY3RvcjxIVE1MRGl2RWxlbWVudD4oXCIuY2FwdGlvblwiKSE7XG4gIGNvbnN0IGNhcmRzID0gcm9vdC5xdWVyeVNlbGVjdG9yPEhUTUxEaXZFbGVtZW50PihcIi5jYXJkc1wiKSE7XG4gIGxldCBzdGF0dXM6IFN0YXR1cyB8IG51bGwgPSBudWxsO1xuICBsZXQgY2FwdGlvblRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZDtcblxuICBjb25zdCByZW5kZXJQaWxsID0gKCkgPT4ge1xuICAgIGlmICghc3RhdHVzIHx8IHN0YXR1cy5tb2RlID09PSBcIm9mZlwiIHx8IHN0YXR1cy5tb2RlID09PSBcImZyZWVcIikgcmV0dXJuIHZvaWQgKHBpbGwuaGlkZGVuID0gdHJ1ZSk7XG4gICAgcGlsbC5oaWRkZW4gPSBmYWxzZTtcbiAgICBjb25zdCB0ZWFjaCA9IHN0YXR1cy5tb2RlID09PSBcInRlYWNoXCI7XG4gICAgcGlsbC5jbGFzc05hbWUgPSBgcGlsbCAke3N0YXR1cy5vZmZSZWNvcmQgPyBcIm9mZlwiIDogdGVhY2ggPyBcInRlYWNoXCIgOiBcIlwifWA7XG4gICAgY29uc3QgbGFiZWwgPSBzdGF0dXMub2ZmUmVjb3JkID8gXCJPZmYgdGhlIHJlY29yZFwiIDogdGVhY2ggPyBcIkFkYSBpcyBjb2FjaGluZ1wiIDogYEFkYSBpcyBsZWFybmluZyBmcm9tICR7c3RhdHVzLmV4cGVydCA/PyBcInlvdVwifWA7XG4gICAgcGlsbC5pbm5lckhUTUwgPSBgPHNwYW4gY2xhc3M9XCJkb3RcIj48L3NwYW4+PHNwYW4+JHtlc2MobGFiZWwpfTwvc3Bhbj5gO1xuICAgIGlmIChvcHRzLmNvbnRyb2xzICYmICF0ZWFjaCkge1xuICAgICAgY29uc3Qgb2ZmID0gYnRuKHN0YXR1cy5vZmZSZWNvcmQgPyBcIkJhY2sgb24gcmVjb3JkXCIgOiBcIk9mZiB0aGUgcmVjb3JkXCIsICgpID0+XG4gICAgICAgIHQuc2VuZCh7IGtpbmQ6IFwibWFya2VyXCIsIG1hcmtlcjogc3RhdHVzPy5vZmZSZWNvcmQgPyBcIm9mZl9yZWNvcmRfZW5kXCIgOiBcIm9mZl9yZWNvcmRfc3RhcnRcIiwgYXQ6IERhdGUubm93KCkgfSkpO1xuICAgICAgY29uc3QgYm0gPSBidG4oXCJCb29rbWFya1wiLCAoKSA9PiB0LnNlbmQoeyBraW5kOiBcIm1hcmtlclwiLCBtYXJrZXI6IFwiYm9va21hcmtcIiwgYXQ6IERhdGUubm93KCkgfSkpO1xuICAgICAgcGlsbC5hcHBlbmQob2ZmLCBibSk7XG4gICAgfVxuICB9O1xuXG4gIGNvbnN0IHNob3dDYXJkID0gKGM6IEV4dHJhY3Q8QnJpZGdlQm9keSwgeyBraW5kOiBcInR1dG9yQ2FyZFwiIH0+KSA9PiB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGVsLmNsYXNzTmFtZSA9IGBjYXJkICR7Yy50b25lfWA7XG4gICAgZWwuaW5uZXJIVE1MID0gYDxidXR0b24gY2xhc3M9XCJ4XCIgdGl0bGU9XCJEaXNtaXNzXCI+XHUwMEQ3PC9idXR0b24+JHtvcHRzLm1vdW50ID8gXCJcIiA6IGA8YnV0dG9uIGNsYXNzPVwibVwiIHRpdGxlPVwiTWluaW1pemVcIj5cdTIwMTM8L2J1dHRvbj5gfTxoND4ke2VzYyhjLnRpdGxlKX08L2g0PjxwPiR7ZXNjKGMudGV4dCl9PC9wPmBcbiAgICAgICsgKGMucXVvdGUgPyBgPGRpdiBjbGFzcz1cInF1b3RlXCI+XHUyMDFDJHtlc2MoYy5xdW90ZS50ZXh0KX1cdTIwMUQgPHNwYW4+XHUwMEI3ICR7ZXNjKGMucXVvdGUud2hvKX0gXHUwMEI3ICR7ZXNjKGMucXVvdGUud2hlbil9PC9zcGFuPjwvZGl2PmAgOiBcIlwiKVxuICAgICAgKyAoYy5pbWFnZVVybCA/IGA8ZGl2IGNsYXNzPVwibGFiZWxcIj4ke2VzYyhjLnF1b3RlPy53aG8gPz8gXCJFeHBlcnRcIil9J3Mgc2NyZWVuIGF0IHRoaXMgbW9tZW50PC9kaXY+PGRpdiBjbGFzcz1cImZyYW1lXCI+PGltZyBzcmM9XCIke2F0dHIoYy5pbWFnZVVybCl9XCI+JHtjLmJib3ggPyBgPGRpdiBjbGFzcz1cImJib3hcIiBzdHlsZT1cImxlZnQ6JHtjLmJib3gueCAqIDEwMH0lO3RvcDoke2MuYmJveC55ICogMTAwfSU7d2lkdGg6JHtjLmJib3gudyAqIDEwMH0lO2hlaWdodDoke2MuYmJveC5oICogMTAwfSVcIj48L2Rpdj5gIDogXCJcIn08L2Rpdj5gIDogXCJcIik7XG4gICAgZWwucXVlcnlTZWxlY3RvcihcIi54XCIpIS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gZWwucmVtb3ZlKCkpO1xuICAgIGVsLnF1ZXJ5U2VsZWN0b3IoXCIubVwiKT8uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IGVsLmNsYXNzTGlzdC50b2dnbGUoXCJtaW5cIikpO1xuICAgIGNhcmRzLnJlcGxhY2VDaGlsZHJlbihlbCk7IC8vIG9uZSBjYXJkIGF0IGEgdGltZTogdGhlIG5ld2VzdCBndWlkYW5jZVxuICAgIGlmIChjLnRvbmUgPT09IFwiaW5mb1wiKSBzZXRUaW1lb3V0KCgpID0+IGVsLnJlbW92ZSgpLCAyMF8wMDApO1xuICB9O1xuXG4gIGNvbnN0IG9mZiA9IHQubGlzdGVuKChtKSA9PiB7XG4gICAgaWYgKG0ua2luZCA9PT0gXCJzdGF0dXNcIikge1xuICAgICAgc3RhdHVzID0gbTtcbiAgICAgIHJlbmRlclBpbGwoKTtcbiAgICB9IGVsc2UgaWYgKG0ua2luZCA9PT0gXCJ0dXRvckNhcmRcIikgc2hvd0NhcmQobSk7XG4gICAgZWxzZSBpZiAobS5raW5kID09PSBcInR1dG9yU2F5XCIpIHNob3dDYXJkKHsga2luZDogXCJ0dXRvckNhcmRcIiwgdG9uZTogXCJpbmZvXCIsIHRpdGxlOiBcIkFkYVwiLCB0ZXh0OiBtLnRleHQgfSk7XG4gICAgZWxzZSBpZiAobS5raW5kID09PSBcImFnZW50U3RhdGVcIiAmJiBtLmNhcHRpb24pIHtcbiAgICAgIGNhcHRpb24uaGlkZGVuID0gZmFsc2U7XG4gICAgICBjYXB0aW9uLmlubmVySFRNTCA9IGA8c3BhbiBjbGFzcz1cIndob1wiPkFkYTwvc3Bhbj4ke2VzYyhtLmNhcHRpb24pfWA7XG4gICAgICBjbGVhclRpbWVvdXQoY2FwdGlvblRpbWVyKTtcbiAgICAgIGNhcHRpb25UaW1lciA9IHNldFRpbWVvdXQoKCkgPT4gKGNhcHRpb24uaGlkZGVuID0gdHJ1ZSksIE1hdGgubWF4KDQwMDAsIG0uY2FwdGlvbi5sZW5ndGggKiA3MCkpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiAoKSA9PiB7XG4gICAgb2ZmKCk7XG4gICAgaG9zdC5yZW1vdmUoKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYnRuKGxhYmVsOiBzdHJpbmcsIG9uQ2xpY2s6ICgpID0+IHZvaWQpIHtcbiAgY29uc3QgYiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gIGIudGV4dENvbnRlbnQgPSBsYWJlbDtcbiAgYi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgb25DbGljayk7XG4gIHJldHVybiBiO1xufVxuY29uc3QgZXNjID0gKHM6IHN0cmluZykgPT4gcy5yZXBsYWNlKC9bJjw+XCInXS9nLCAoYykgPT4gKHsgXCImXCI6IFwiJmFtcDtcIiwgXCI8XCI6IFwiJmx0O1wiLCBcIj5cIjogXCImZ3Q7XCIsICdcIic6IFwiJnF1b3Q7XCIsIFwiJ1wiOiBcIiYjMzk7XCIgfSlbY10hKTtcbmNvbnN0IGF0dHIgPSAoczogc3RyaW5nKSA9PiAoL14oaHR0cHM/OnxkYXRhOmltYWdlXFwvKS8udGVzdChzKSA/IGVzYyhzKSA6IFwiXCIpO1xuIiwgIi8qKlxuICogR2VuZXJpYyBpbnN0cnVtZW50YXRpb24gZm9yIEFOWSB3ZWIgYXBwICh0aGUgZXhwZXJ0J3Mgb3IgbmV3IGhpcmUncyByZWFsIHRvb2xzKTpcbiAqICAtIGZpZWxkIGNoYW5nZXMgKGxhYmVsICsgb2xkIFx1MjE5MiBuZXc7IHNlbnNpdGl2ZSB2YWx1ZXMgbWFza2VkKSwgY2xpY2tzIG9uIGJ1dHRvbnMvbGlua3MsIGZvcm0gc3VibWl0cywgbmF2aWdhdGlvblxuICogIC0gYWN0aXZpdHkgY291bnRzIGV2ZXJ5IDIgcyAobm8gY29udGVudCkgZm9yIHRoZSBwYXVzZSBkZXRlY3RvclxuICogIC0gdGVhY2ggbW9kZTogU2F2ZS9TdWJtaXQvQXBwcm92ZS1saWtlIGNsaWNrcyBhcmUgaGVsZCB1bnRpbCB0aGUgaHViIGFuc3dlcnMgYGJlZm9yZUFjdGlvbmBcbiAqIE5ldmVyIGNhcHR1cmVzIHBhc3N3b3JkcywgY2FyZCBudW1iZXJzLCBJQkFOcyBvciBhbnl0aGluZyBtYXRjaGluZyBTRU5TSVRJVkUuXG4gKi9cbmltcG9ydCB7IFNFTlNJVElWRSwgbmV3TXNnSWQsIHR5cGUgQnJpZGdlQm9keSwgdHlwZSBCcmlkZ2VNc2csIHR5cGUgUGFnZVNuYXBzaG90IH0gZnJvbSBcIi4uLy4uL3NoYXJlZC9icmlkZ2VcIjtcbmltcG9ydCB0eXBlIHsgVHJhbnNwb3J0IH0gZnJvbSBcIi4vb3ZlcmxheVwiO1xuXG5jb25zdCBBQ1RJT05fUkUgPSAvXFxiKHNhdmV8c3VibWl0fGFwcHJvdmV8Y29uZmlybXxib29rfHBvc3R8c2VuZHxwYXl8cmVsZWFzZXxmaW5pc2h8Y29tcGxldGV8Y3JlYXRlfHVwZGF0ZSlcXGIvaTtcbmNvbnN0IE1BWF9GSUVMRFMgPSA2MDtcblxuZXhwb3J0IGZ1bmN0aW9uIHN0YXJ0RG9tQ2FwdHVyZSh0OiBUcmFuc3BvcnQsIGlzQWN0aXZlOiAoKSA9PiB7IGNhcHR1cmU6IGJvb2xlYW47IHRlYWNoOiBib29sZWFuIH0pOiAoKSA9PiB2b2lkIHtcbiAgY29uc3QgY291bnRzID0geyBrZXlzdHJva2VzOiAwLCBjbGlja3M6IDAsIHNjcm9sbHM6IDAsIG1vdXNlTW92ZVB4OiAwIH07XG4gIGNvbnN0IGZvY3VzVmFsdWVzID0gbmV3IFdlYWtNYXA8RWxlbWVudCwgc3RyaW5nPigpO1xuICBsZXQgYnlwYXNzOiBFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIGxldCBsYXN0OiBbbnVtYmVyLCBudW1iZXJdIHwgbnVsbCA9IG51bGw7XG4gIGNvbnN0IG9uID0gKCkgPT4gaXNBY3RpdmUoKS5jYXB0dXJlIHx8IGlzQWN0aXZlKCkudGVhY2g7XG4gIGNvbnN0IGVtaXQgPSAoYjogQnJpZGdlQm9keSkgPT4gb24oKSAmJiB0LnNlbmQoYik7XG5cbiAgY29uc3Qgb25Gb2N1cyA9IChlOiBFdmVudCkgPT4ge1xuICAgIGNvbnN0IGVsID0gZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudDtcbiAgICBpZiAoaXNGaWVsZChlbCkpIGZvY3VzVmFsdWVzLnNldChlbCwgdmFsdWVPZihlbCkpO1xuICB9O1xuICBjb25zdCBvbkNoYW5nZSA9IChlOiBFdmVudCkgPT4ge1xuICAgIGNvbnN0IGVsID0gZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudDtcbiAgICBpZiAoIWlzRmllbGQoZWwpKSByZXR1cm47XG4gICAgY29uc3QgbGFiZWwgPSBsYWJlbE9mKGVsKTtcbiAgICBjb25zdCBiZWZvcmUgPSBmb2N1c1ZhbHVlcy5nZXQoZWwpID8/IFwiXCI7XG4gICAgY29uc3QgYWZ0ZXIgPSB2YWx1ZU9mKGVsKTtcbiAgICBmb2N1c1ZhbHVlcy5zZXQoZWwsIGFmdGVyKTtcbiAgICBpZiAoYmVmb3JlID09PSBhZnRlcikgcmV0dXJuO1xuICAgIGVtaXQoe1xuICAgICAga2luZDogXCJhcHBcIiwgYXQ6IERhdGUubm93KCksIHZlcmI6IFwiZWRpdFwiLCBwYWdlOiBzbmFwc2hvdCgpLFxuICAgICAgZGVzY3JpcHRpb246IGBTZXQgXCIke2xhYmVsfVwiIGZyb20gXCIke2JlZm9yZSB8fCBcIi1cIn1cIiB0byBcIiR7YWZ0ZXIgfHwgXCItXCJ9XCIgb24gXCIke2RvY3VtZW50LnRpdGxlfVwiYCxcbiAgICAgIHBheWxvYWQ6IHsgYWN0aW9uOiBcImNoYW5nZVwiLCBlbnRpdHk6IHsga2luZDogXCJwYWdlXCIsIGtleTogbG9jYXRpb24ucGF0aG5hbWUgfSwgZmllbGQ6IGxhYmVsLCBvbGRWYWx1ZTogYmVmb3JlLCBuZXdWYWx1ZTogYWZ0ZXIsIHNlbGVjdG9yOiBzZWxlY3Rvck9mKGVsKSwgcm91dGU6IGxvY2F0aW9uLmhyZWYgfSxcbiAgICB9KTtcbiAgfTtcbiAgY29uc3Qgb25DbGljayA9IChlOiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgY291bnRzLmNsaWNrcysrO1xuICAgIGNvbnN0IGVsID0gKGUudGFyZ2V0IGFzIEVsZW1lbnQpPy5jbG9zZXN0Py4oXCJidXR0b24sIGEsIFtyb2xlPWJ1dHRvbl0sIGlucHV0W3R5cGU9c3VibWl0XSwgaW5wdXRbdHlwZT1idXR0b25dXCIpO1xuICAgIGlmICghZWwpIHJldHVybjtcbiAgICBjb25zdCB0ZXh0ID0gKGVsLnRleHRDb250ZW50IHx8IChlbCBhcyBIVE1MSW5wdXRFbGVtZW50KS52YWx1ZSB8fCBlbC5nZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIpIHx8IFwiXCIpLnRyaW0oKS5zbGljZSgwLCA2MCk7XG4gICAgaWYgKCF0ZXh0KSByZXR1cm47XG4gICAgLy8gdGVhY2g6IGhvbGQgYWN0aW9uLWxpa2UgY2xpY2tzIHVudGlsIHRoZSBodWIgaGFzIGNoZWNrZWQgdGhlIGd1YXJkcmFpbHNcbiAgICBpZiAoaXNBY3RpdmUoKS50ZWFjaCAmJiBBQ1RJT05fUkUudGVzdCh0ZXh0KSAmJiBieXBhc3MgIT09IGVsKSB7XG4gICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBlLnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xuICAgICAgdm9pZCBob2xkQW5kQ2hlY2soZWwgYXMgSFRNTEVsZW1lbnQsIHRleHQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoYnlwYXNzID09PSBlbCkgYnlwYXNzID0gbnVsbDtcbiAgICBlbWl0KHtcbiAgICAgIGtpbmQ6IFwiYXBwXCIsIGF0OiBEYXRlLm5vdygpLCB2ZXJiOiBBQ1RJT05fUkUudGVzdCh0ZXh0KSA/IFwic2F2ZVwiIDogXCJvdGhlclwiLCBwYWdlOiBzbmFwc2hvdCgpLFxuICAgICAgZGVzY3JpcHRpb246IGBDbGlja2VkIFwiJHt0ZXh0fVwiIG9uIFwiJHtkb2N1bWVudC50aXRsZX1cImAsXG4gICAgICBwYXlsb2FkOiB7IGFjdGlvbjogQUNUSU9OX1JFLnRlc3QodGV4dCkgPyBcInNhdmVcIiA6IFwiY2xpY2tcIiwgZW50aXR5OiB7IGtpbmQ6IFwicGFnZVwiLCBrZXk6IGxvY2F0aW9uLnBhdGhuYW1lIH0sIHNlbGVjdG9yOiBzZWxlY3Rvck9mKGVsKSwgcm91dGU6IGxvY2F0aW9uLmhyZWYgfSxcbiAgICB9KTtcbiAgfTtcbiAgY29uc3QgaG9sZEFuZENoZWNrID0gYXN5bmMgKGVsOiBIVE1MRWxlbWVudCwgdGV4dDogc3RyaW5nKSA9PiB7XG4gICAgY29uc3QgcmVxSWQgPSBuZXdNc2dJZCgpO1xuICAgIGNvbnN0IG91dGxpbmUgPSBlbC5zdHlsZS5vdXRsaW5lO1xuICAgIGVsLnN0eWxlLm91dGxpbmUgPSBcIjNweCBzb2xpZCAjM2I2ZmI2XCI7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgbmV3IFByb21pc2U8eyBhbGxvdzogYm9vbGVhbiB9PigocmVzb2x2ZSkgPT4ge1xuICAgICAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IChzdG9wKCksIHJlc29sdmUoeyBhbGxvdzogdHJ1ZSB9KSksIDYwMDApOyAvLyBuZXZlciBzdHJhbmQgdGhlIHVzZXJcbiAgICAgIGNvbnN0IHN0b3AgPSB0Lmxpc3RlbigobTogQnJpZGdlTXNnKSA9PiB7XG4gICAgICAgIGlmIChtLmtpbmQgPT09IFwiYmVmb3JlQWN0aW9uUmVzdWx0XCIgJiYgbS5yZXFJZCA9PT0gcmVxSWQpIHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICAgICAgICAgIHN0b3AoKTtcbiAgICAgICAgICByZXNvbHZlKG0pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHQuc2VuZCh7IGtpbmQ6IFwiYmVmb3JlQWN0aW9uXCIsIHJlcUlkLCBhY3Rpb246IGBjbGljayBcIiR7dGV4dH1cImAsIHBhZ2U6IHNuYXBzaG90KCkgfSk7XG4gICAgfSk7XG4gICAgZWwuc3R5bGUub3V0bGluZSA9IHJlcy5hbGxvdyA/IG91dGxpbmUgOiBcIjNweCBzb2xpZCAjYzYyODI4XCI7XG4gICAgaWYgKHJlcy5hbGxvdykge1xuICAgICAgYnlwYXNzID0gZWw7XG4gICAgICBlbC5jbGljaygpO1xuICAgICAgc2V0VGltZW91dCgoKSA9PiAoZWwuc3R5bGUub3V0bGluZSA9IG91dGxpbmUpLCAzMDApO1xuICAgIH1cbiAgfTtcbiAgY29uc3Qgb25TdWJtaXQgPSAoZTogRXZlbnQpID0+IHtcbiAgICBjb25zdCBmID0gZS50YXJnZXQgYXMgSFRNTEZvcm1FbGVtZW50O1xuICAgIGVtaXQoeyBraW5kOiBcImFwcFwiLCBhdDogRGF0ZS5ub3coKSwgdmVyYjogXCJzYXZlXCIsIHBhZ2U6IHNuYXBzaG90KCksIGRlc2NyaXB0aW9uOiBgU3VibWl0dGVkIGZvcm0gXCIke2YuZ2V0QXR0cmlidXRlKFwibmFtZVwiKSB8fCBmLmlkIHx8IFwiZm9ybVwifVwiIG9uIFwiJHtkb2N1bWVudC50aXRsZX1cImAsIHBheWxvYWQ6IHsgYWN0aW9uOiBcInN1Ym1pdFwiLCBlbnRpdHk6IHsga2luZDogXCJwYWdlXCIsIGtleTogbG9jYXRpb24ucGF0aG5hbWUgfSwgcm91dGU6IGxvY2F0aW9uLmhyZWYgfSB9KTtcbiAgfTtcbiAgY29uc3Qgb25LZXkgPSAoKSA9PiBjb3VudHMua2V5c3Ryb2tlcysrO1xuICBjb25zdCBvbldoZWVsID0gKCkgPT4gY291bnRzLnNjcm9sbHMrKztcbiAgY29uc3Qgb25Nb3ZlID0gKGU6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBpZiAobGFzdCkgY291bnRzLm1vdXNlTW92ZVB4ICs9IE1hdGguYWJzKGUuY2xpZW50WCAtIGxhc3RbMF0pICsgTWF0aC5hYnMoZS5jbGllbnRZIC0gbGFzdFsxXSk7XG4gICAgbGFzdCA9IFtlLmNsaWVudFgsIGUuY2xpZW50WV07XG4gIH07XG5cbiAgbGV0IGxhc3RVcmwgPSBcIlwiO1xuICBjb25zdCBuYXZDaGVjayA9ICgpID0+IHtcbiAgICBpZiAobG9jYXRpb24uaHJlZiA9PT0gbGFzdFVybCkgcmV0dXJuO1xuICAgIGxhc3RVcmwgPSBsb2NhdGlvbi5ocmVmO1xuICAgIGVtaXQoeyBraW5kOiBcImFwcFwiLCBhdDogRGF0ZS5ub3coKSwgdmVyYjogXCJuYXZpZ2F0ZVwiLCBwYWdlOiBzbmFwc2hvdCgpLCBkZXNjcmlwdGlvbjogYE9wZW5lZCBcIiR7ZG9jdW1lbnQudGl0bGV9XCIgKCR7bG9jYXRpb24uaG9zdG5hbWV9JHtsb2NhdGlvbi5wYXRobmFtZX0pYCwgcGF5bG9hZDogeyBhY3Rpb246IFwibmF2aWdhdGVcIiwgcm91dGU6IGxvY2F0aW9uLmhyZWYgfSB9KTtcbiAgfTtcblxuICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwiZm9jdXNpblwiLCBvbkZvY3VzLCB0cnVlKTtcbiAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBvbkNoYW5nZSwgdHJ1ZSk7XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgb25DbGljaywgdHJ1ZSk7XG4gIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJzdWJtaXRcIiwgb25TdWJtaXQsIHRydWUpO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXksIHRydWUpO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcIndoZWVsXCIsIG9uV2hlZWwsIHsgcGFzc2l2ZTogdHJ1ZSB9KTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25Nb3ZlLCB7IHBhc3NpdmU6IHRydWUgfSk7XG4gIGNvbnN0IHRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgIG5hdkNoZWNrKCk7XG4gICAgaWYgKGNvdW50cy5rZXlzdHJva2VzIHx8IGNvdW50cy5jbGlja3MgfHwgY291bnRzLnNjcm9sbHMgfHwgY291bnRzLm1vdXNlTW92ZVB4KSB7XG4gICAgICBlbWl0KHsga2luZDogXCJhY3Rpdml0eVwiLCAuLi5jb3VudHMsIG1vdXNlTW92ZVB4OiBNYXRoLnJvdW5kKGNvdW50cy5tb3VzZU1vdmVQeCksIHdpbmRvd01zOiAyMDAwLCBhdDogRGF0ZS5ub3coKSB9KTtcbiAgICB9XG4gICAgY291bnRzLmtleXN0cm9rZXMgPSBjb3VudHMuY2xpY2tzID0gY291bnRzLnNjcm9sbHMgPSBjb3VudHMubW91c2VNb3ZlUHggPSAwO1xuICB9LCAyMDAwKTtcblxuICByZXR1cm4gKCkgPT4ge1xuICAgIGNsZWFySW50ZXJ2YWwodGltZXIpO1xuICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJmb2N1c2luXCIsIG9uRm9jdXMsIHRydWUpO1xuICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgb25DaGFuZ2UsIHRydWUpO1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgb25DbGljaywgdHJ1ZSk7XG4gICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInN1Ym1pdFwiLCBvblN1Ym1pdCwgdHJ1ZSk7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5LCB0cnVlKTtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIndoZWVsXCIsIG9uV2hlZWwpO1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uTW92ZSk7XG4gIH07XG59XG5cbi8qKiBWaXNpYmxlIGZvcm0gc3RhdGU6IGxhYmVsIFx1MjE5MiB2YWx1ZSAobWFza2VkIHdoZW4gc2Vuc2l0aXZlKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzbmFwc2hvdCgpOiBQYWdlU25hcHNob3Qge1xuICBjb25zdCBmaWVsZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgY29uc3QgZWxzID0gWy4uLmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KFwiaW5wdXQsIHNlbGVjdCwgdGV4dGFyZWFcIildLmZpbHRlcigoZWwpID0+IGlzRmllbGQoZWwpICYmIHZpc2libGUoZWwpKTtcbiAgZm9yIChjb25zdCBlbCBvZiBlbHMuc2xpY2UoMCwgTUFYX0ZJRUxEUykpIGZpZWxkc1tsYWJlbE9mKGVsKV0gPSB2YWx1ZU9mKGVsKTtcbiAgcmV0dXJuIHsgdXJsOiBsb2NhdGlvbi5ocmVmLCB0aXRsZTogZG9jdW1lbnQudGl0bGUsIGZpZWxkcyB9O1xufVxuXG5mdW5jdGlvbiBpc0ZpZWxkKGVsOiBFbGVtZW50IHwgbnVsbCk6IGVsIGlzIEhUTUxJbnB1dEVsZW1lbnQge1xuICBpZiAoIWVsIHx8ICEoZWwgaW5zdGFuY2VvZiBIVE1MRWxlbWVudCkpIHJldHVybiBmYWxzZTtcbiAgaWYgKGVsIGluc3RhbmNlb2YgSFRNTElucHV0RWxlbWVudCkgcmV0dXJuICFbXCJoaWRkZW5cIiwgXCJidXR0b25cIiwgXCJzdWJtaXRcIiwgXCJpbWFnZVwiLCBcInJlc2V0XCIsIFwiZmlsZVwiXS5pbmNsdWRlcyhlbC50eXBlKTtcbiAgcmV0dXJuIGVsIGluc3RhbmNlb2YgSFRNTFNlbGVjdEVsZW1lbnQgfHwgZWwgaW5zdGFuY2VvZiBIVE1MVGV4dEFyZWFFbGVtZW50O1xufVxuXG5mdW5jdGlvbiB2YWx1ZU9mKGVsOiBIVE1MRWxlbWVudCk6IHN0cmluZyB7XG4gIGNvbnN0IGlucHV0ID0gZWwgYXMgSFRNTElucHV0RWxlbWVudDtcbiAgY29uc3QgbGFiZWwgPSBsYWJlbE9mKGVsKTtcbiAgaWYgKGlucHV0LnR5cGUgPT09IFwicGFzc3dvcmRcIiB8fCBTRU5TSVRJVkUudGVzdChsYWJlbCkgfHwgU0VOU0lUSVZFLnRlc3QoaW5wdXQubmFtZSA/PyBcIlwiKSB8fCBTRU5TSVRJVkUudGVzdChpbnB1dC5hdXRvY29tcGxldGUgPz8gXCJcIikpIHJldHVybiBcIlx1MjAyMlx1MjAyMlx1MjAyMlwiO1xuICBpZiAoaW5wdXQudHlwZSA9PT0gXCJjaGVja2JveFwiIHx8IGlucHV0LnR5cGUgPT09IFwicmFkaW9cIikgcmV0dXJuIGlucHV0LmNoZWNrZWQgPyBcImNoZWNrZWRcIiA6IFwidW5jaGVja2VkXCI7XG4gIGlmIChlbCBpbnN0YW5jZW9mIEhUTUxTZWxlY3RFbGVtZW50KSByZXR1cm4gZWwuc2VsZWN0ZWRPcHRpb25zWzBdPy50ZXh0Q29udGVudD8udHJpbSgpID8/IGVsLnZhbHVlO1xuICByZXR1cm4gKGlucHV0LnZhbHVlID8/IFwiXCIpLnNsaWNlKDAsIDIwMCk7XG59XG5cbmZ1bmN0aW9uIGxhYmVsT2YoZWw6IEhUTUxFbGVtZW50KTogc3RyaW5nIHtcbiAgY29uc3QgYnlGb3IgPSBlbC5pZCA/IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoYGxhYmVsW2Zvcj1cIiR7Q1NTLmVzY2FwZShlbC5pZCl9XCJdYCk/LnRleHRDb250ZW50IDogbnVsbDtcbiAgY29uc3Qgd3JhcHBpbmcgPSBlbC5jbG9zZXN0KFwibGFiZWxcIik/LmNoaWxkTm9kZXNbMF0/LnRleHRDb250ZW50O1xuICBjb25zdCByYXcgPSBlbC5nZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIpIHx8IGJ5Rm9yIHx8IHdyYXBwaW5nIHx8IChlbCBhcyBIVE1MSW5wdXRFbGVtZW50KS5wbGFjZWhvbGRlciB8fCBlbC5nZXRBdHRyaWJ1dGUoXCJuYW1lXCIpIHx8IGVsLmlkIHx8IGVsLnRhZ05hbWUudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIHJhdy5yZXBsYWNlKC9cXHMrL2csIFwiIFwiKS50cmltKCkuc2xpY2UoMCwgNjApO1xufVxuXG5mdW5jdGlvbiBzZWxlY3Rvck9mKGVsOiBFbGVtZW50KTogc3RyaW5nIHtcbiAgaWYgKGVsLmlkKSByZXR1cm4gYCMke2VsLmlkfWA7XG4gIGNvbnN0IG5hbWUgPSBlbC5nZXRBdHRyaWJ1dGUoXCJuYW1lXCIpO1xuICByZXR1cm4gbmFtZSA/IGAke2VsLnRhZ05hbWUudG9Mb3dlckNhc2UoKX1bbmFtZT1cIiR7bmFtZX1cIl1gIDogZWwudGFnTmFtZS50b0xvd2VyQ2FzZSgpO1xufVxuXG5mdW5jdGlvbiB2aXNpYmxlKGVsOiBIVE1MRWxlbWVudCkge1xuICBjb25zdCByID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIHJldHVybiByLndpZHRoID4gMCAmJiByLmhlaWdodCA+IDA7XG59XG4iLCAiLyoqXG4gKiBDb250ZW50IHNjcmlwdCAoZXZlcnkgdGFiKS4gVGhyZWUgcm9sZXMgZGVwZW5kaW5nIG9uIHRoZSBwYWdlOlxuICogIC0gQUkgQXBwcmVudGljZSB3ZWIgYXBwIHBhZ2VzIChodWIgL2NhcHR1cmUgL3RlYWNoLCBNaW5pRVJQKTogcmVsYXkgb25seSBcdTIwMTQgcGFnZSBcdTIxQzQgYmFja2dyb3VuZCBcdTIxQzQgb3RoZXIgdGFicy5cbiAqICAgIChNaW5pRVJQIGluc3RydW1lbnRzIGl0c2VsZiBhbmQgZW1iZWRzIHRoZSBvdmVybGF5LilcbiAqICAtIGFueSBvdGhlciBzaXRlOiBnZW5lcmljIERPTSBjYXB0dXJlICsgb3ZlcmxheSwgYWN0aXZlIHdoaWxlIGEgaHViIHNlc3Npb24gcnVucy5cbiAqL1xuaW1wb3J0IHsgRGVkdXBlLCBuZXdNc2dJZCwgdHlwZSBCcmlkZ2VCb2R5LCB0eXBlIEJyaWRnZU1zZyB9IGZyb20gXCIuLi8uLi9zaGFyZWQvYnJpZGdlXCI7XG5pbXBvcnQgeyBzdGFydE92ZXJsYXksIHR5cGUgVHJhbnNwb3J0IH0gZnJvbSBcIi4vb3ZlcmxheVwiO1xuaW1wb3J0IHsgc3RhcnREb21DYXB0dXJlIH0gZnJvbSBcIi4vY2FwdHVyZS1kb21cIjtcblxuLyoqIFBhZ2VzIG9mIHRoZSBBSSBBcHByZW50aWNlIHdlYiBhcHAgY2FycnkgPG1ldGEgbmFtZT1cImFwcHJlbnRpY2UtYXBwXCI+IChodWIgKyBNaW5pRVJQKTogcmVsYXkgb25seS4gKi9cbmNvbnN0IHJvbGU6IFwiYXBwXCIgfCBcInNpdGVcIiA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ21ldGFbbmFtZT1cImFwcHJlbnRpY2UtYXBwXCJdJykgPyBcImFwcFwiIDogXCJzaXRlXCI7XG5jb25zdCBkZWR1cGUgPSBuZXcgRGVkdXBlKCk7XG5jb25zdCBsaXN0ZW5lcnMgPSBuZXcgU2V0PChtOiBCcmlkZ2VNc2cpID0+IHZvaWQ+KCk7XG5cbmZ1bmN0aW9uIGRlbGl2ZXJMb2NhbChtOiBCcmlkZ2VNc2cpIHtcbiAgaWYgKCFkZWR1cGUuZmlyc3RUaW1lKG0uaWQpKSByZXR1cm47XG4gIGxpc3RlbmVycy5mb3JFYWNoKChmbikgPT4gZm4obSkpO1xufVxuXG4vLyBiYWNrZ3JvdW5kIFx1MjE5MiB0aGlzIHRhYlxuY2hyb21lLnJ1bnRpbWUub25NZXNzYWdlLmFkZExpc3RlbmVyKCh4OiB7IHR5cGU/OiBzdHJpbmc7IG1zZz86IEJyaWRnZU1zZyB9KSA9PiB7XG4gIGlmICh4Py50eXBlICE9PSBcInJlbGF5XCIgfHwgIXgubXNnKSByZXR1cm47XG4gIGlmIChyb2xlID09PSBcInNpdGVcIikgZGVsaXZlckxvY2FsKHgubXNnKTtcbiAgZWxzZSB3aW5kb3cucG9zdE1lc3NhZ2UoeyBfX2FwcHJlbnRpY2U6IHgubXNnLCBmcm9tRXh0OiB0cnVlIH0sIFwiKlwiKTsgLy8gaW50byB0aGUgd2ViIGFwcCdzIGJyaWRnZVxufSk7XG5cbi8vIHdlYiBhcHAgcGFnZSBcdTIxOTIgYmFja2dyb3VuZCAoaHViIC8gTWluaUVSUCBwYWdlcyBzcGVhayB0aHJvdWdoIHdpbmRvdy5wb3N0TWVzc2FnZSlcbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCAoZTogTWVzc2FnZUV2ZW50PHsgX19hcHByZW50aWNlPzogQnJpZGdlTXNnOyBmcm9tRXh0PzogYm9vbGVhbiB9PikgPT4ge1xuICBpZiAoZS5zb3VyY2UgIT09IHdpbmRvdyB8fCAhZS5kYXRhPy5fX2FwcHJlbnRpY2UgfHwgZS5kYXRhLmZyb21FeHQpIHJldHVybjtcbiAgdm9pZCBjaHJvbWUucnVudGltZS5zZW5kTWVzc2FnZSh7IHR5cGU6IFwicmVsYXlcIiwgbXNnOiBlLmRhdGEuX19hcHByZW50aWNlIH0pLmNhdGNoKCgpID0+IHt9KTtcbn0pO1xuXG5pZiAocm9sZSA9PT0gXCJzaXRlXCIpIHtcbiAgY29uc3QgdHJhbnNwb3J0OiBUcmFuc3BvcnQgPSB7XG4gICAgc2VuZChib2R5OiBCcmlkZ2VCb2R5KSB7XG4gICAgICBjb25zdCBtc2cgPSB7IC4uLmJvZHksIGlkOiBuZXdNc2dJZCgpIH0gYXMgQnJpZGdlTXNnO1xuICAgICAgZGVkdXBlLmZpcnN0VGltZShtc2cuaWQpO1xuICAgICAgdm9pZCBjaHJvbWUucnVudGltZS5zZW5kTWVzc2FnZSh7IHR5cGU6IFwicmVsYXlcIiwgbXNnIH0pLmNhdGNoKCgpID0+IHt9KTtcbiAgICB9LFxuICAgIGxpc3Rlbihmbikge1xuICAgICAgbGlzdGVuZXJzLmFkZChmbik7XG4gICAgICByZXR1cm4gKCkgPT4gdm9pZCBsaXN0ZW5lcnMuZGVsZXRlKGZuKTtcbiAgICB9LFxuICB9O1xuICBsZXQgbW9kZTogXCJjYXB0dXJlXCIgfCBcInRlYWNoXCIgfCBcIm9mZlwiID0gXCJvZmZcIjtcbiAgbGV0IG9mZlJlY29yZCA9IGZhbHNlO1xuICB0cmFuc3BvcnQubGlzdGVuKChtKSA9PiB7XG4gICAgaWYgKG0ua2luZCA9PT0gXCJzdGF0dXNcIikge1xuICAgICAgbW9kZSA9IG0ubW9kZSA9PT0gXCJjYXB0dXJlXCIgfHwgbS5tb2RlID09PSBcInRlYWNoXCIgPyBtLm1vZGUgOiBcIm9mZlwiO1xuICAgICAgb2ZmUmVjb3JkID0gbS5vZmZSZWNvcmQ7XG4gICAgfVxuICB9KTtcbiAgc3RhcnRPdmVybGF5KHRyYW5zcG9ydCwgeyBjb250cm9sczogdHJ1ZSB9KTtcbiAgc3RhcnREb21DYXB0dXJlKHRyYW5zcG9ydCwgKCkgPT4gKHsgY2FwdHVyZTogbW9kZSA9PT0gXCJjYXB0dXJlXCIgJiYgIW9mZlJlY29yZCwgdGVhY2g6IG1vZGUgPT09IFwidGVhY2hcIiB9KSk7XG4gIHRyYW5zcG9ydC5zZW5kKHsga2luZDogXCJoZWxsb1wiLCBmcm9tOiBcImV4dFwiLCBhcHA6IGxvY2F0aW9uLmhvc3RuYW1lIH0pO1xuICAvLyBhc2sgdGhlIGJhY2tncm91bmQgZm9yIHRoZSBjdXJyZW50IGh1YiBzdGF0dXMgKHdlIG1heSBoYXZlIGxvYWRlZCBtaWQtc2Vzc2lvbilcbiAgdm9pZCBjaHJvbWUucnVudGltZS5zZW5kTWVzc2FnZSh7IHR5cGU6IFwiZ2V0U3RhdHVzXCIgfSkudGhlbigocz86IEJyaWRnZU1zZykgPT4gcyAmJiBkZWxpdmVyTG9jYWwoeyAuLi5zLCBpZDogbmV3TXNnSWQoKSB9KSkuY2F0Y2goKCkgPT4ge30pO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQXdDTyxJQUFNLFdBQVcsTUFBTSxLQUFLLE9BQU8sRUFBRSxTQUFTLEVBQUUsRUFBRSxNQUFNLENBQUMsSUFBSSxLQUFLLElBQUksRUFBRSxTQUFTLEVBQUU7QUFHbkYsSUFBTSxTQUFOLE1BQWE7QUFBQSxFQUNWLE9BQU8sb0JBQUksSUFBWTtBQUFBLEVBQ3ZCLFFBQWtCLENBQUM7QUFBQSxFQUMzQixVQUFVLElBQXFCO0FBQzdCLFFBQUksS0FBSyxLQUFLLElBQUksRUFBRSxFQUFHLFFBQU87QUFDOUIsU0FBSyxLQUFLLElBQUksRUFBRTtBQUNoQixTQUFLLE1BQU0sS0FBSyxFQUFFO0FBQ2xCLFFBQUksS0FBSyxNQUFNLFNBQVMsSUFBSyxNQUFLLEtBQUssT0FBTyxLQUFLLE1BQU0sTUFBTSxDQUFFO0FBQ2pFLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFHTyxJQUFNLFlBQVk7OztBQ2xDekIsSUFBTUEsT0FBTTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBMkJMLFNBQVMsYUFBYSxHQUFjLE1BQWtDO0FBQzNFLFFBQU0sT0FBTyxTQUFTLGNBQWMsS0FBSztBQUN6QyxPQUFLLEtBQUs7QUFDVixRQUFNLE9BQU8sS0FBSyxhQUFhLEVBQUUsTUFBTSxPQUFPLENBQUM7QUFDL0MsT0FBSyxZQUFZLFVBQVVBLElBQUcsMkJBQTJCLEtBQUssUUFBUSxZQUFZLEVBQUU7QUFDcEYsR0FBQyxL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
