/**
 * Content script (every tab). Roles depending on the page:
 *  - Protégé hub pages (My day, Training, …): relay only — page ⇄ background ⇄ other tabs.
 *  - any work app, MiniERP included: overlay (status, Ada's captions, coaching cards) + holding Save/Approve-like
 *    clicks in teach mode + generic DOM capture. Apps that publish their own structured events (a "feed",
 *    like MiniERP) skip the generic capture events so nothing is logged twice.
 */
import { ext } from "./api";
import { Dedupe, newMsgId, type BridgeBody, type BridgeMsg } from "../../shared/bridge";
import type { Transport } from "./overlay";
import { startSite } from "./site";
import { piiRects } from "./capture-dom";
import { isAppOrigin } from "./origins";

/** Hub pages carry <meta name="apprentice-app">; MiniERP sets it to "feed" (a work app with structured events). */
const meta = document.querySelector<HTMLMetaElement>('meta[name="apprentice-app"]');
const feed = meta?.content === "feed";
const appPage = isAppOrigin(location.origin);
// "app" (relay into the page) only on the Protégé app itself — an untrusted page with the meta tag stays a "site"
const role: "app" | "site" = meta && !feed && appPage ? "app" : "site";
const dedupe = new Dedupe();
const listeners = new Set<(m: BridgeMsg) => void>();

function deliverLocal(m: BridgeMsg) {
  if (!dedupe.firstTime(m.id)) return;
  listeners.forEach((fn) => fn(m));
}

// background → this tab
ext.runtime.onMessage.addListener((x: { type?: string; msg?: BridgeMsg }, _sender, reply) => {
  if (x?.type === "piiRects") {
    reply(piiRects()); // right before a screenshot: where personal data is, so the hub can blur it
    return true;
  }
  if (x?.type !== "relay" || !x.msg) return;
  if (role === "site") deliverLocal(x.msg);
  else window.postMessage({ __apprentice: x.msg, fromExt: true }, location.origin); // into the web app's bridge
});

// web app page → background (hub / MiniERP pages speak through window.postMessage)
window.addEventListener("message", (e: MessageEvent<{ __apprentice?: BridgeMsg; fromExt?: boolean }>) => {
  if (e.source !== window || e.origin !== location.origin || !e.data?.__apprentice || e.data.fromExt) return;
  void ext.runtime.sendMessage({ type: "relay", msg: e.data.__apprentice }).catch(() => {});
});

document.documentElement.dataset.apprenticeExt = "1"; // hub: "extension connected"; sites: the embed script steps aside

if (role === "site") {
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
    void ext.runtime.sendMessage({ type: "getStatus" }).then((s?: BridgeMsg) => s && deliverLocal({ ...s, id: newMsgId() })).catch(() => {}), { feed });
}
