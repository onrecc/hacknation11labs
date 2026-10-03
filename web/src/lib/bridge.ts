/**
 * Cross-tab protocol between the MiniERP tab (where the expert / new hire works) and the hub tab
 * (/capture or /teach) that owns the session, the screen share and the voice agent.
 * BroadcastChannel = same origin, same browser. The ERP never writes to Firestore itself.
 */
import type { AppEvent, CaseFacts, Id } from "@shared/schema";

export type ErpMode = "capture" | "teach" | "free";

export type BridgeMsg =
  | { kind: "hello"; from: "erp" | "hub"; mode?: ErpMode }
  | { kind: "app"; payload: AppEvent["payload"]; description?: string; verb?: string; facts?: CaseFacts; at: number }
  | { kind: "activity"; keystrokes: number; clicks: number; scrolls: number; mouseMovePx: number; windowMs: number; at: number }
  | { kind: "case"; state: "start" | "end"; case: { id: Id; kind: string; key: string; label?: string }; outcome?: string; at: number }
  | { kind: "marker"; marker: "off_record_start" | "off_record_end" | "bookmark" | "end_task"; at: number }
  | { kind: "beforeSave"; reqId: string; facts: CaseFacts }
  | { kind: "beforeSaveResult"; reqId: string; allow: boolean; guardrailIds?: Id[]; message?: string }
  | { kind: "tutorSay"; text: string };

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("apprentice") : null;

export function send(msg: BridgeMsg) {
  channel?.postMessage(msg);
}

export function listen(fn: (msg: BridgeMsg) => void): () => void {
  const h = (e: MessageEvent<BridgeMsg>) => fn(e.data);
  channel?.addEventListener("message", h);
  return () => channel?.removeEventListener("message", h);
}

/** ERP side: ask the hub whether saving is allowed. No hub / no answer within `timeoutMs` → allowed. */
export function beforeSave(facts: CaseFacts, timeoutMs = 900): Promise<{ allow: boolean; guardrailIds?: Id[]; message?: string }> {
  const reqId = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const timer = setTimeout(() => (off(), resolve({ allow: true })), timeoutMs);
    const off = listen((m) => {
      if (m.kind === "beforeSaveResult" && m.reqId === reqId) {
        clearTimeout(timer);
        off();
        resolve(m);
      }
    });
    send({ kind: "beforeSave", reqId, facts });
  });
}
