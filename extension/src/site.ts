/** "Any website" mode, shared by the extension content script and the embeddable script. */
import { newMsgId, type BridgeBody, type BridgeMsg } from "../../shared/bridge";
import { activeStatus, noteStatus, type HubStatusBook } from "../../shared/hubstatus";
import { startOverlay, type Transport } from "./overlay";
import { startDomCapture } from "./capture-dom";

export function startSite(transport: Transport, onStatusRequest?: () => void, opts: { feed?: boolean } = {}): () => void {
  // several hubs may broadcast (an expert's capture hub left open while a new hire practises): a live teach session
  // wins, so its save holds can't be switched off by the capture hub's next status
  let book: HubStatusBook = [];
  const offStatus = transport.listen((m: BridgeMsg) => {
    if (m.kind === "status") book = noteStatus(book, m, Date.now());
  });
  const active = () => {
    const s = activeStatus(book, Date.now());
    const mode = s?.mode === "capture" || s?.mode === "teach" ? s.mode : "off";
    return { capture: mode === "capture" && !s?.offRecord, teach: mode === "teach" };
  };
  // the overlay also hears local notices (e.g. "couldn't verify" when the hub never answered a held save)
  const local = new Set<(m: BridgeMsg) => void>();
  const overlayTransport: Transport = {
    send: (b) => transport.send(b),
    listen(fn) {
      const off = transport.listen(fn);
      local.add(fn);
      return () => (off(), local.delete(fn));
    },
  };
  const notify = (b: BridgeBody) => local.forEach((fn) => fn({ ...b, id: newMsgId() } as BridgeMsg));
  const stopOverlay = startOverlay(overlayTransport, { controls: true });
  const stopCapture = startDomCapture(transport, active, { events: !opts.feed, notify });
  transport.send({ kind: "hello", from: "ext", app: location.hostname });
  onStatusRequest?.();
  return () => {
    offStatus();
    stopOverlay();
    stopCapture();
  };
}
