/**
 * Embeddable version (no extension needed) for same-origin web apps:
 *   <script src="https://<apprentice-host>/apprentice-embed.js" defer></script>
 * Uses BroadcastChannel to reach the hub tab on the same origin. Steps aside if the extension is installed.
 */
import { Dedupe, newMsgId, type BridgeBody, type BridgeMsg } from "../../shared/bridge";
import type { Transport } from "./overlay";
import { startSite } from "./site";

setTimeout(() => {
  if (document.documentElement.dataset.apprenticeExt) return;
  const ch = new BroadcastChannel("apprentice");
  const dedupe = new Dedupe();
  const listeners = new Set<(m: BridgeMsg) => void>();
  ch.addEventListener("message", (e: MessageEvent<BridgeMsg>) => {
    if (e.data?.id && dedupe.firstTime(e.data.id)) listeners.forEach((fn) => fn(e.data));
  });
  const transport: Transport = {
    send(body: BridgeBody) {
      const msg = { ...body, id: newMsgId() } as BridgeMsg;
      dedupe.firstTime(msg.id);
      ch.postMessage(msg);
    },
    listen(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
  // MiniERP publishes structured events itself ("feed"): overlay + save hold only, no duplicate DOM capture
  const feed = document.querySelector('meta[name="apprentice-app"]')?.getAttribute("content") === "feed";
  startSite(transport, undefined, { feed });
}, 1200); // the extension's content script (document_idle) marks the page first; then this fallback steps aside
