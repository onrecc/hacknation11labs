/**
 * Content script (every tab). Three roles depending on the page:
 *  - AI Apprentice web app pages (hub /capture /teach, MiniERP): relay only — page ⇄ background ⇄ other tabs.
 *    (MiniERP instruments itself and embeds the overlay.)
 *  - any other site: generic DOM capture + overlay, active while a hub session runs.
 */
import { ext } from "./api";
import { Dedupe, newMsgId, type BridgeBody, type BridgeMsg } from "../../shared/bridge";
import type { Transport } from "./overlay";
import { startSite } from "./site";

/** Pages of the AI Apprentice web app carry <meta name="apprentice-app"> (hub + MiniERP): relay only. */
const role: "app" | "site" = document.querySelector('meta[name="apprentice-app"]') ? "app" : "site";
const dedupe = new Dedupe();
const listeners = new Set<(m: BridgeMsg) => void>();

function deliverLocal(m: BridgeMsg) {
  if (!dedupe.firstTime(m.id)) return;
  listeners.forEach((fn) => fn(m));
}

// background → this tab
ext.runtime.onMessage.addListener((x: { type?: string; msg?: BridgeMsg }) => {
  if (x?.type !== "relay" || !x.msg) return;
  if (role === "site") deliverLocal(x.msg);
  else window.postMessage({ __apprentice: x.msg, fromExt: true }, "*"); // into the web app's bridge
});

// web app page → background (hub / MiniERP pages speak through window.postMessage)
window.addEventListener("message", (e: MessageEvent<{ __apprentice?: BridgeMsg; fromExt?: boolean }>) => {
  if (e.source !== window || !e.data?.__apprentice || e.data.fromExt) return;
  void ext.runtime.sendMessage({ type: "relay", msg: e.data.__apprentice }).catch(() => {});
});

if (role === "site") {
  document.documentElement.dataset.apprenticeExt = "1"; // the embed script steps aside when the extension runs
  const transport: Transport = {
    send(body: BridgeBody) {
      const msg = { ...body, id: newMsgId() } as BridgeMsg;
      dedupe.firstTime(msg.id);
      void ext.runtime.sendMessage({ type: "relay", msg }).catch(() => {});
    },
    listen(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
  // we may have loaded mid-session: ask the background for the current hub status
  startSite(transport, () =>
    void ext.runtime.sendMessage({ type: "getStatus" }).then((s?: BridgeMsg) => s && deliverLocal({ ...s, id: newMsgId() })).catch(() => {}));
}
