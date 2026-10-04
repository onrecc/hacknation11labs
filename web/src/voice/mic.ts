/**
 * Which microphone Ada listens on (the hub's recorder, Scribe and the ElevenAgents conversation all use it).
 *
 * Opening a Bluetooth headset's microphone switches the headset to the hands-free profile: 8–16 kHz mono for ALL
 * audio while the mic is open, so Ada sounds like a bad phone line. When the default mic is a Bluetooth one and
 * another mic exists (the laptop's), we listen on that one and the headset stays in high-quality playback.
 * Override: localStorage["apprentice.micId"] = a deviceId, or "default" to always use the system default.
 */
const BLUETOOTH = /airpods|bluetooth|headset|hands-?free|buds|beats|jabra|bose|wh-1000|wf-1000|\bbt\b/i;
const BUILT_IN = /built-?in|macbook|internal|microphone array|realtek/i;

let choice: Promise<string | undefined> | null = null;

/** deviceId to open, or undefined for the system default. Decided once per page. */
export function preferredMicId(): Promise<string | undefined> {
  return (choice ??= pick().catch(() => undefined));
}

/** For getUserMedia/Scribe: `deviceId: { exact }` when we chose a specific mic. */
export const micConstraint = (id: string | undefined) => (id ? { deviceId: { exact: id } } : {});

async function pick(): Promise<string | undefined> {
  const override = readOverride();
  if (override) return override === "default" ? undefined : override;
  if (!navigator.mediaDevices?.enumerateDevices) return undefined;
  let mics = await audioInputs();
  if (mics.every((m) => !m.label)) {
    // device labels stay empty until the page may use the mic: ask once, release it right away
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
    mics = await audioInputs();
  }
  const def = mics.find((m) => m.deviceId === "default") ?? mics[0];
  const defIsBluetooth = !!def && BLUETOOTH.test(def.label);
  if (!defIsBluetooth) return undefined;
  const wired = mics.filter((m) => m.deviceId !== "default" && m.deviceId !== "communications" && !BLUETOOTH.test(m.label));
  const pickMic = wired.find((m) => BUILT_IN.test(m.label)) ?? wired[0];
  if (pickMic) console.info(`Ada listens on "${pickMic.label}" so the Bluetooth headset keeps high-quality sound`);
  return pickMic?.deviceId;
}

async function audioInputs() {
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
}

function readOverride(): string | null {
  try {
    return localStorage.getItem("apprentice.micId");
  } catch {
    return null;
  }
}
