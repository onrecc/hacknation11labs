/** "Any website" mode, shared by the extension content script and the embeddable script. */
import { newMsgId, type BridgeBody, type BridgeMsg } from "../../shared/bridge";
import { startOverlay, type Transport } from "./overlay";
import { startDomCapture } from "./capture-dom";

export function startSite(transport: Transport, onStatusRequest?: () => void, opts: { feed?: boolean } = {}): () => void {
  let mode: "capture" | "teach" | "off" = "off";
  let offRecord = false;
  const offStatus = transport.listen((m: BridgeMsg) => {
    if (m.kind === "status") {
      mode = m.mode === "capture" || m.mode === "teach" ? m.mode : "off";
      offRecord = m.offRecord;
    }
  });
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
  const stopCapture = startDomCapture(transport, () => ({ capture: mode === "capture" && !offRecord, teach: mode === "teach" }), { events: !opts.feed, notify });
  transport.send({ kind: "hello", from: "ext", app: location.hostname });
  onStatusRequest?.();
  return () => {
    offStatus();
    stopOverlay();
    stopCapture();
  };
}
