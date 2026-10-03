/**
 * Generic instrumentation for ANY web app (the expert's or new hire's real tools):
 *  - field changes (label + old → new; sensitive values masked), clicks on buttons/links, form submits, navigation
 *  - activity counts every 2 s (no content) for the pause detector
 *  - teach mode: Save/Submit/Approve-like clicks are held until the hub answers `beforeAction`
 * Never captures passwords, card numbers, IBANs or anything matching SENSITIVE.
 */
import { SENSITIVE, newMsgId, type BridgeBody, type BridgeMsg, type PageSnapshot } from "../../shared/bridge";
import type { Transport } from "./overlay";

const ACTION_RE = /\b(save|submit|approve|confirm|book|post|send|pay|release|finish|complete|create|update)\b/i;
const MAX_FIELDS = 60;

export function startDomCapture(t: Transport, isActive: () => { capture: boolean; teach: boolean }): () => void {
  const counts = { keystrokes: 0, clicks: 0, scrolls: 0, mouseMovePx: 0 };
  const focusValues = new WeakMap<Element, string>();
  let bypass: Element | null = null;
  let last: [number, number] | null = null;
  const on = () => isActive().capture || isActive().teach;
  const emit = (b: BridgeBody) => on() && t.send(b);

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
      void holdAndCheck(el as HTMLElement, text);
      return;
    }
    if (bypass === el) bypass = null;
    emit({
      kind: "app", at: Date.now(), verb: ACTION_RE.test(text) ? "save" : "other", page: snapshot(),
      description: `Clicked "${text}" on "${document.title}"`,
      payload: { action: ACTION_RE.test(text) ? "save" : "click", entity: { kind: "page", key: location.pathname }, selector: selectorOf(el), route: location.href },
    });
  };
  const holdAndCheck = async (el: HTMLElement, text: string) => {
    const reqId = newMsgId();
    const outline = el.style.outline;
    el.style.outline = "3px solid #3b6fb6";
    const res = await new Promise<{ allow: boolean }>((resolve) => {
      const timer = setTimeout(() => (stop(), resolve({ allow: true })), 6000); // never strand the user
      const stop = t.listen((m: BridgeMsg) => {
        if (m.kind === "beforeActionResult" && m.reqId === reqId) {
          clearTimeout(timer);
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
      setTimeout(() => (el.style.outline = outline), 300);
    }
  };
  const onSubmit = (e: Event) => {
    const f = e.target as HTMLFormElement;
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
