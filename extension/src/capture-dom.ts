/**
 * Generic instrumentation for ANY web app (the expert's or new hire's real tools):
 *  - field changes (label + old → new; sensitive values masked), clicks on buttons/links, form submits, navigation
 *  - activity counts every 2 s (no content) for the pause detector
 *  - teach mode: Save/Submit/Approve-like clicks AND form submits (Enter key) are held until the hub answers
 *    `beforeAction`. No answer in time or a failed check = the save stays held ("couldn't verify"), never waved through.
 * With `events: false` (apps that publish their own structured events) only the teach-mode hold runs.
 * Never captures passwords, card numbers, IBANs or anything matching SENSITIVE.
 */
import { SENSITIVE, newMsgId, type BridgeBody, type BridgeMsg, type PageSnapshot } from "../../shared/bridge";
import type { Transport } from "./overlay";

const ACTION_RE = /\b(save|submit|approve|confirm|book|post|send|pay|release|finish|complete|create|update)\b/i;
const MAX_FIELDS = 60;

const UNVERIFIED = "Couldn't verify this against the expert's rules. Check with the controller before saving.";

export function startDomCapture(
  t: Transport,
  isActive: () => { capture: boolean; teach: boolean },
  opts: { events: boolean; notify?: (card: Extract<BridgeBody, { kind: "tutorCard" }>) => void } = { events: true },
): () => void {
  const counts = { keystrokes: 0, clicks: 0, scrolls: 0, mouseMovePx: 0 };
  const focusValues = new WeakMap<Element, string>();
  let bypass: Element | null = null;
  let bypassForm: HTMLFormElement | null = null;
  let last: [number, number] | null = null;
  const on = () => isActive().capture || isActive().teach;
  const emit = (b: BridgeBody) => opts.events && on() && t.send(b);

  const onFocus = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (isField(el)) focusValues.set(el, valueOf(el));
  };
  const onChange = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (!isField(el)) return;
    const label = labelOf(el);
    const before = focusValues.get(el) ?? "";
    const after = valueOf(el);
    focusValues.set(el, after);
    if (before === after) return;
    emit({
      kind: "app", at: Date.now(), verb: "edit", page: snapshot(),
      description: `Set "${label}" from "${before || "-"}" to "${after || "-"}" on "${document.title}"`,
      payload: { action: "change", entity: { kind: "page", key: location.pathname }, field: label, oldValue: before, newValue: after, selector: selectorOf(el), route: location.href },
    });
  };
  const onClick = (e: MouseEvent) => {
    counts.clicks++;
    const el = (e.target as Element)?.closest?.("button, a, [role=button], input[type=submit], input[type=button]");
    if (!el) return;
    const text = (el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim().slice(0, 60);
    if (!text) return;
    // teach: hold action-like clicks until the hub has checked the guardrails
    if (isActive().teach && ACTION_RE.test(text) && bypass !== el) {
      e.preventDefault();
      e.stopImmediatePropagation();
      void holdAndCheck(el as HTMLElement, text, () => {
        bypass = el;
        (el as HTMLElement).click();
      });
      return;
    }
    if (bypass === el) setTimeout(() => bypass === el && (bypass = null), 0); // after the submit this click may trigger
    emit({
      kind: "app", at: Date.now(), verb: ACTION_RE.test(text) ? "save" : "other", page: snapshot(),
      description: `Clicked "${text}" on "${document.title}"`,
      payload: { action: ACTION_RE.test(text) ? "save" : "click", entity: { kind: "page", key: location.pathname }, selector: selectorOf(el), route: location.href },
    });
  };
  const holdAndCheck = async (el: HTMLElement, text: string, proceed: () => void) => {
    const reqId = newMsgId();
    const outline = (el.dataset.apOutline ??= el.style.outline); // the app's own outline, before we ever touched it
    el.style.outline = "3px solid #3b6fb6";
    const label = el.getAttribute("title");
    el.setAttribute("title", "Ada is checking this against the expert's rules…");
    const res = await new Promise<{ allow: boolean; timedOut?: boolean }>((resolve) => {
      // generous: the check may be an LLM call. No answer in 15 s = hold (the hub is gone or the check hung)
      const timer = setTimeout(() => (stop(), resolve({ allow: false, timedOut: true })), 15_000);
      const stop = t.listen((m: BridgeMsg) => {
        if (m.kind === "beforeActionResult" && m.reqId === reqId) {
          clearTimeout(timer);
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
      setTimeout(() => (el.style.outline = outline), 300);
    }
  };
  const onSubmit = (e: Event) => {
    const f = e.target as HTMLFormElement;
    // teach: a submit that didn't come through a held button click (Enter key, "OK"/"Next" buttons) is held too;
    // search boxes are not decisions, they pass
    const search = f.matches("[role=search]") || !!f.querySelector("input[type=search]");
    if (isActive().teach && bypassForm !== f && !search) {
      const submitter = (e as SubmitEvent).submitter as HTMLElement | null;
      if (!(submitter && bypass === submitter)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const text = (submitter?.textContent || (submitter as HTMLInputElement | null)?.value || f.getAttribute("name") || "submit form").trim().slice(0, 60);
        void holdAndCheck((submitter ?? f) as HTMLElement, text, () => {
          bypassForm = f;
          f.requestSubmit(submitter && f.contains(submitter) ? submitter : undefined);
          bypassForm = null;
        });
        return;
      }
    }
    if (bypass && bypass === (e as SubmitEvent).submitter) bypass = null;
    emit({ kind: "app", at: Date.now(), verb: "save", page: snapshot(), description: `Submitted form "${f.getAttribute("name") || f.id || "form"}" on "${document.title}"`, payload: { action: "submit", entity: { kind: "page", key: location.pathname }, route: location.href } });
  };
  const onKey = () => counts.keystrokes++;
  const onWheel = () => counts.scrolls++;
  const onMove = (e: MouseEvent) => {
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

  // baseline values, so changes made without a focus event (pickers, autofill, scripts) still get a correct "from"
  const seedBaseline = () => document.querySelectorAll<HTMLElement>("input, select, textarea").forEach((el) => isField(el) && !focusValues.has(el) && focusValues.set(el, valueOf(el)));
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
      emit({ kind: "activity", ...counts, mouseMovePx: Math.round(counts.mouseMovePx), windowMs: 2000, at: Date.now() });
    }
    counts.keystrokes = counts.clicks = counts.scrolls = counts.mouseMovePx = 0;
  }, 2000);

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

const PII_FIELD = /e-?mail|phone|mobile|tel\b|iban|bic|swift|birth|address|passport/i;
const PII_AUTOCOMPLETE = /^(cc-|email|tel|bday|street-address|address-line|postal-code|current-password|new-password)/;

/**
 * Where personal data is on screen right now (normalized to the viewport, slightly padded): passwords, card
 * numbers, IBANs, emails, phones… and anything the app marks with [data-pii]. Screenshots get these blurred.
 */
export function piiRects(): Array<{ x: number; y: number; w: number; h: number }> {
  const vw = window.innerWidth, vh = window.innerHeight;
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  const els = document.querySelectorAll<HTMLElement>("input, textarea, select, [contenteditable=true], [data-pii]");
  for (const el of els) {
    const input = el as HTMLInputElement;
    const label = el.matches("[data-pii]") ? "" : labelOf(el);
    const sensitive = el.matches("[data-pii]") || ["password", "email", "tel"].includes(input.type) || PII_AUTOCOMPLETE.test(input.autocomplete ?? "")
      || SENSITIVE.test(label) || PII_FIELD.test(label) || SENSITIVE.test(input.name ?? "") || PII_FIELD.test(input.name ?? "");
    if (!sensitive) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
    const pad = 4;
    const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
    out.push({ x: x / vw, y: y / vh, w: Math.min(vw - x, r.width + 2 * pad) / vw, h: Math.min(vh - y, r.height + 2 * pad) / vh });
  }
  return out;
}

/** Visible form state: label → value (masked when sensitive). */
export function snapshot(): PageSnapshot {
  const fields: Record<string, string> = {};
  const els = [...document.querySelectorAll<HTMLElement>("input, select, textarea")].filter((el) => isField(el) && visible(el));
  for (const el of els.slice(0, MAX_FIELDS)) fields[labelOf(el)] = valueOf(el);
  return { url: location.href, title: document.title, fields };
}

function isField(el: Element | null): el is HTMLInputElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) return !["hidden", "button", "submit", "image", "reset", "file"].includes(el.type);
  return el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

function valueOf(el: HTMLElement): string {
  const input = el as HTMLInputElement;
  const label = labelOf(el);
  if (input.type === "password" || SENSITIVE.test(label) || SENSITIVE.test(input.name ?? "") || SENSITIVE.test(input.autocomplete ?? "")) return "•••";
  if (input.type === "checkbox" || input.type === "radio") return input.checked ? "checked" : "unchecked";
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.textContent?.trim() ?? el.value;
  return (input.value ?? "").slice(0, 200);
}

function labelOf(el: HTMLElement): string {
  const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null;
  const wrapping = el.closest("label")?.childNodes[0]?.textContent;
  const raw = el.getAttribute("aria-label") || byFor || wrapping || (el as HTMLInputElement).placeholder || el.getAttribute("name") || el.id || el.tagName.toLowerCase();
  return raw.replace(/\s+/g, " ").trim().slice(0, 60);
}

function selectorOf(el: Element): string {
  if (el.id) return `#${el.id}`;
  const name = el.getAttribute("name");
  return name ? `${el.tagName.toLowerCase()}[name="${name}"]` : el.tagName.toLowerCase();
}

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
