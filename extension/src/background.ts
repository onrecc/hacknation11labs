/**
 * Background (Chrome: service worker, Firefox: background script): relays bridge messages between tabs (any origin), remembers the hub tab and the
 * latest hub status, and — while a capture session is recording — screenshots the active work tab once per
 * second and sends it to the hub as a frame (capture without the screen-share dialog).
 */
import { ext } from "./api";
import type { BridgeMsg } from "../../shared/bridge";
import { isAppOrigin } from "./origins";

let hubTabId: number | null = null;
let lastStatus: (BridgeMsg & { kind: "status" }) | null = null;
let shotTimer: ReturnType<typeof setInterval> | null = null;

ext.runtime.onMessage.addListener((x: { type?: string; msg?: BridgeMsg }, sender, reply) => {
  const from = sender.tab?.id;
  // only the Protégé app may become the hub: any other page could otherwise start tab screenshots sent to itself
  const trusted = isAppOrigin(sender.tab?.url ?? sender.url);
  if (x?.type === "hub" && from != null && trusted) hubTabId = from;
  if (x?.type === "getStatus") {
    reply(lastStatus);
    return true;
  }
  if (x?.type !== "relay" || !x.msg) return;
  const msg = x.msg;
  if (msg.kind === "status" && !trusted) return; // hub-only message from an untrusted page: drop it
  if (msg.kind === "status" && from != null) {
    hubTabId = from;
    lastStatus = msg as BridgeMsg & { kind: "status" };
    updateScreenshots();
  }
  // End task / End day on a work tab's overlay: Ada goes over the work in the Protégé tab, so bring it forward
  if (msg.kind === "marker" && (msg.marker === "end_task" || msg.marker === "end_day")) void focusHub();
  void broadcast(msg, from);
});

async function focusHub() {
  if (hubTabId == null) return;
  try {
    const tab = await ext.tabs.update(hubTabId, { active: true });
    if (tab?.windowId != null) await ext.windows.update(tab.windowId, { focused: true });
  } catch {
    /* the hub tab is gone */
  }
}

async function broadcast(msg: BridgeMsg, exceptTabId?: number) {
  const tabs = await ext.tabs.query({});
  for (const t of tabs) {
    if (t.id == null || t.id === exceptTabId || !t.url || !/^https?:/.test(t.url)) continue;
    ext.tabs.sendMessage(t.id, { type: "relay", msg }).catch(() => {});
  }
}

function updateScreenshots() {
  const on = !!lastStatus && lastStatus.mode === "capture" && lastStatus.recording && !lastStatus.offRecord;
  if (on && !shotTimer) shotTimer = setInterval(() => void shoot(), 1000);
  if (!on && shotTimer) {
    clearInterval(shotTimer);
    shotTimer = null;
  }
}

async function shoot() {
  if (hubTabId == null) return;
  const [active] = await ext.tabs.query({ active: true, lastFocusedWindow: true });
  if (!active?.id || active.id === hubTabId || !active.url || !/^https?:/.test(active.url)) return; // never the hub itself
  try {
    // personal-data fields on the page: the hub blurs them before the frame is stored or sent to vision
    const pii = ((await ext.tabs.sendMessage(active.id, { type: "piiRects" }).catch(() => [])) ?? []) as Array<{ x: number; y: number; w: number; h: number }>;
    const dataUrl = await ext.tabs.captureVisibleTab(active.windowId, { format: "jpeg", quality: 60 });
    const msg = { kind: "frame", dataUrl, at: Date.now(), url: active.url, pii, id: crypto.randomUUID() } as BridgeMsg;
    ext.tabs.sendMessage(hubTabId, { type: "relay", msg }).catch(() => {});
  } catch {
    /* tab not capturable (chrome:// pages, devtools) */
  }
}

ext.tabs.onRemoved.addListener((id) => {
  if (id === hubTabId) {
    hubTabId = null;
    lastStatus = null;
    updateScreenshots();
    // no hub, no session: every work tab hides its overlay and stops capturing
    void broadcast({ kind: "status", mode: "off", offRecord: false, recording: false, id: crypto.randomUUID() } as BridgeMsg);
  }
});
