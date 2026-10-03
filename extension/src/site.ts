/** "Any website" mode, shared by the extension content script and the embeddable script. */
import type { BridgeMsg } from "../../shared/bridge";
import { startOverlay, type Transport } from "./overlay";
import { startDomCapture } from "./capture-dom";

export function startSite(transport: Transport, onStatusRequest?: () => void): () => void {
  let mode: "capture" | "teach" | "off" = "off";
  let offRecord = false;
  const offStatus = transport.listen((m: BridgeMsg) => {
    if (m.kind === "status") {
      mode = m.mode === "capture" || m.mode === "teach" ? m.mode : "off";
      offRecord = m.offRecord;
    }
  });
  const stopOverlay = startOverlay(transport, { controls: true });
  const stopCapture = startDomCapture(transport, () => ({ capture: mode === "capture" && !offRecord, teach: mode === "teach" }));
  transport.send({ kind: "hello", from: "ext", app: location.hostname });
  onStatusRequest?.();
  return () => {
    offStatus();
    stopOverlay();
    stopCapture();
  };
}
