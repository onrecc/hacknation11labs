/**
 * Background (Chrome: service worker, Firefox: background script): relays bridge messages between tabs (any origin), remembers the hub tab and the
 * latest hub status, and — while a capture session is recording — screenshots the active work tab once per
 * second and sends it to the hub as a frame (capture without the screen-share dialog).
 */
import { ext } from "./api";
import type { BridgeMsg } from "../../shared/bridge";

let hubTabId: number | null = null;
let lastStatus: (BridgeMsg & { kind: "status" }) | null = null;
let shotTimer: ReturnType<typeof setInterval> | null = null;

ext.runtime.onMessage.addListener((x: { type?: string; msg?: BridgeMsg }, sender, reply) => {
  const from = sender.tab?.id;
  if (x?.type === "hub" && from != null) hubTabId = from;
  if (x?.type === "getStatus") {
    reply(lastStatus);
    return true;
  }
  if (x?.type !== "relay" || !x.msg) return;
  const msg = x.msg;
  if (msg.kind === "status" && from != null) {
    hubTabId = from;
    lastStatus = msg as BridgeMsg & { kind: "status" };
    updateScreenshots();
  }
  void broadcast(msg, from);
});

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
    const dataUrl = await ext.tabs.captureVisibleTab(active.windowId, { format: "jpeg", quality: 60 });
    const msg = { kind: "frame", dataUrl, at: Date.now(), url: active.url, id: crypto.randomUUID() } as BridgeMsg;
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
  }
});
