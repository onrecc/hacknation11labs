"use strict";
(() => {
  // src/api.ts
  var ext = globalThis.browser ?? chrome;

  // src/background.ts
  var hubTabId = null;
  var lastStatus = null;
  var shotTimer = null;
  ext.runtime.onMessage.addListener((x, sender, reply) => {
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
      lastStatus = msg;
      updateScreenshots();
    }
    void broadcast(msg, from);
  });
  async function broadcast(msg, exceptTabId) {
    const tabs = await ext.tabs.query({});
    for (const t of tabs) {
      if (t.id == null || t.id === exceptTabId || !t.url || !/^https?:/.test(t.url)) continue;
      ext.tabs.sendMessage(t.id, { type: "relay", msg }).catch(() => {
      });
    }
  }
  function updateScreenshots() {
    const on = !!lastStatus && lastStatus.mode === "capture" && lastStatus.recording && !lastStatus.offRecord;
    if (on && !shotTimer) shotTimer = setInterval(() => void shoot(), 1e3);
    if (!on && shotTimer) {
      clearInterval(shotTimer);
      shotTimer = null;
    }
  }
  async function shoot() {
    if (hubTabId == null) return;
    const [active] = await ext.tabs.query({ active: true, lastFocusedWindow: true });
    if (!active?.id || active.id === hubTabId || !active.url || !/^https?:/.test(active.url)) return;
    try {
      const pii = await ext.tabs.sendMessage(active.id, { type: "piiRects" }).catch(() => []) ?? [];
      const dataUrl = await ext.tabs.captureVisibleTab(active.windowId, { format: "jpeg", quality: 60 });
      const msg = { kind: "frame", dataUrl, at: Date.now(), url: active.url, pii, id: crypto.randomUUID() };
      ext.tabs.sendMessage(hubTabId, { type: "relay", msg }).catch(() => {
      });
    } catch {
    }
  }
  ext.tabs.onRemoved.addListener((id) => {
    if (id === hubTabId) {
      hubTabId = null;
      lastStatus = null;
      updateScreenshots();
    }
  });
})();
