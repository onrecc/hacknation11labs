/**
 * Content script (every tab). Three roles depending on the page:
 *  - AI Apprentice web app pages (hub /capture /teach, MiniERP): relay only — page ⇄ background ⇄ other tabs.
 *    (MiniERP instruments itself and embeds the overlay.)
 *  - any other site: generic DOM capture + overlay, active while a hub session runs.
 */
import { Dedupe, newMsgId, type BridgeBody, type BridgeMsg } from "../../shared/bridge";
import { startOverlay, type Transport } from "./overlay";
import { startDomCapture } from "./capture-dom";

/** Pages of the AI Apprentice web app carry <meta name="apprentice-app"> (hub + MiniERP): relay only. */
const role: "app" | "site" = document.querySelector('meta[name="apprentice-app"]') ? "app" : "site";
const dedupe = new Dedupe();
const listeners = new Set<(m: BridgeMsg) => void>();

function deliverLocal(m: BridgeMsg) {
  if (!dedupe.firstTime(m.id)) return;
  listeners.forEach((fn) => fn(m));
}

// background → this tab
chrome.runtime.onMessage.addListener((x: { type?: string; msg?: BridgeMsg }) => {
  if (x?.type !== "relay" || !x.msg) return;
  if (role === "site") deliverLocal(x.msg);
  else window.postMessage({ __apprentice: x.msg, fromExt: true }, "*"); // into the web app's bridge
});

// web app page → background (hub / MiniERP pages speak through window.postMessage)
window.addEventListener("message", (e: MessageEvent<{ __apprentice?: BridgeMsg; fromExt?: boolean }>) => {
  if (e.source !== window || !e.data?.__apprentice || e.data.fromExt) return;
  void chrome.runtime.sendMessage({ type: "relay", msg: e.data.__apprentice }).catch(() => {});
});

if (role === "site") {
  const transport: Transport = {
    send(body: BridgeBody) {
      const msg = { ...body, id: newMsgId() } as BridgeMsg;
      dedupe.firstTime(msg.id);
      void chrome.runtime.sendMessage({ type: "relay", msg }).catch(() => {});
    },
    listen(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
  let mode: "capture" | "teach" | "off" = "off";
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
  // ask the background for the current hub status (we may have loaded mid-session)
  void chrome.runtime.sendMessage({ type: "getStatus" }).then((s?: BridgeMsg) => s && deliverLocal({ ...s, id: newMsgId() })).catch(() => {});
}
