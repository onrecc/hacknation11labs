/**
 * Web side of the bridge (protocol: shared/bridge.ts). Sends on BroadcastChannel (same-origin tabs) AND
 * window.postMessage (picked up by the extension content script and relayed to tabs on any origin).
 */
import type { CaseFacts, Id } from "@shared/schema";
import { Dedupe, newMsgId, type BridgeBody, type BridgeMsg } from "@shared/bridge";

export type { ErpMode, BridgeMsg, PageSnapshot } from "@shared/bridge";

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("apprentice") : null;
const dedupe = new Dedupe();
const listeners = new Set<(m: BridgeMsg) => void>();

function deliver(m: BridgeMsg) {
  if (!m || typeof m !== "object" || !m.id || !dedupe.firstTime(m.id)) return;
  listeners.forEach((fn) => fn(m));
}

channel?.addEventListener("message", (e: MessageEvent<BridgeMsg>) => deliver(e.data));
if (typeof window !== "undefined") {
  window.addEventListener("message", (e: MessageEvent<{ __apprentice?: BridgeMsg; fromExt?: boolean }>) => {
    if (e.source === window && e.data?.__apprentice && e.data.fromExt) deliver(e.data.__apprentice);
  });
}

export function send(body: BridgeBody) {
  const msg = { ...body, id: newMsgId() } as BridgeMsg;
  dedupe.firstTime(msg.id); // don't deliver our own message back to ourselves
  channel?.postMessage(msg);
  if (typeof window !== "undefined") window.postMessage({ __apprentice: msg }, "*");
}

export function listen(fn: (msg: BridgeMsg) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Ask the hub before a save. No hub / no answer within `timeoutMs` → allowed. */
export function beforeSave(facts: CaseFacts, timeoutMs = 900): Promise<{ allow: boolean; guardrailIds?: Id[]; message?: string }> {
  const reqId = newMsgId();
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
