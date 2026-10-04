/**
 * Cross-tab protocol between the work tab (MiniERP or ANY website via the extension) and the hub tab
 * (/capture or /teach) that owns the session, screen capture and the voice agent.
 *
 * Transports (all carry the same messages, deduplicated by `id`):
 *  - BroadcastChannel("apprentice"): same-origin tabs (hub ⇄ MiniERP).
 *  - window.postMessage({__apprentice: msg}) ⇄ extension content script ⇄ background worker ⇄ other tabs (any origin).
 */
import type { AppEvent, CaseFacts, Id } from "./schema";

export type ErpMode = "capture" | "teach" | "free";

/** Visible form state of a generic page (labels → values, sensitive values masked). */
export interface PageSnapshot {
  url: string;
  title: string;
  fields: Record<string, string>;
}

export type BridgeBody =
  | { kind: "hello"; from: "erp" | "hub" | "ext"; mode?: ErpMode; app?: string }
  | { kind: "status"; mode: ErpMode | "off"; sessionId?: Id; offRecord: boolean; recording: boolean; expert?: string }
  | { kind: "app"; payload: AppEvent["payload"]; description?: string; verb?: string; facts?: CaseFacts; page?: PageSnapshot; at: number }
  | { kind: "activity"; keystrokes: number; clicks: number; scrolls: number; mouseMovePx: number; windowMs: number; at: number }
  | { kind: "case"; state: "start" | "end"; case: { id: Id; kind: string; key: string; label?: string }; outcome?: string; facts?: CaseFacts; at: number }
  | { kind: "marker"; marker: "off_record_start" | "off_record_end" | "bookmark" | "end_task"; at: number }
  | { kind: "beforeSave"; reqId: string; facts: CaseFacts }
  | { kind: "beforeSaveResult"; reqId: string; allow: boolean; guardrailIds?: Id[]; message?: string }
  /** Generic websites: an action (Save/Submit/Approve…) is about to happen; the hub may hold it. */
  | { kind: "beforeAction"; reqId: string; action: string; page: PageSnapshot; feed?: boolean }
  | { kind: "beforeActionResult"; reqId: string; allow: boolean; guardrailIds?: Id[]; message?: string }
  /** Extension-captured screenshot of the work tab (JPEG data URL) — capture without the share dialog. */
  /** pii: normalized viewport boxes of personal-data fields; the hub blurs them before storing or sending to vision. */
  | { kind: "frame"; dataUrl: string; at: number; url: string; pii?: Array<{ x: number; y: number; w: number; h: number }> }
  /** Overlay content on the work tab. */
  | { kind: "tutorSay"; text: string }
  | { kind: "tutorCard"; tone: "block" | "nudge" | "info" | "predict"; title: string; text: string; quote?: { text: string; who: string; when: string }; imageUrl?: string; bbox?: { x: number; y: number; w: number; h: number } }
  | { kind: "agentState"; speaking: boolean; listening: boolean; caption?: string };

export type BridgeMsg = BridgeBody & { id: string };

export const newMsgId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Remembers recently seen ids so a message delivered by two transports is handled once. */
export class Dedupe {
  private seen = new Set<string>();
  private order: string[] = [];
  firstTime(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > 500) this.seen.delete(this.order.shift()!);
    return true;
  }
}

/** Keys whose values must never leave the page (masked in PageSnapshot). */
export const SENSITIVE = /pass|iban|card|cvv|cvc|ssn|social|tax.?id|account.?(no|number)|token|secret|pin\b/i;
