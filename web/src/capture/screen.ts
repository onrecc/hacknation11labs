/** Screen sampling (1 fps frames with diff score + PII blur) and chunked MediaRecorder uploads. */
import type { BBox } from "@shared/schema";

export interface SampledFrame {
  blob: Blob;
  width: number;
  height: number;
  diff: number; // 0..1 vs previous frame
  phash: string;
  piiBlurred: number;
  base64: () => Promise<string>;
}

export class FrameSampler {
  private video = document.createElement("video");
  private canvas = document.createElement("canvas");
  private tiny = document.createElement("canvas");
  private pix = document.createElement("canvas");
  private prev: Uint8ClampedArray | null = null;
  /** Regions to blur on every frame (e.g. last known PII from vision, or known app fields). */
  piiRegions: BBox[] = [];

  /** stream = screen share; null = frames come from the extension (grabImage). */
  constructor(readonly stream: MediaStream | null, readonly maxWidth = 1280) {
    if (stream) {
      this.video.srcObject = stream;
      this.video.muted = true;
      void this.video.play();
    }
    this.tiny.width = 32;
    this.tiny.height = 18;
  }

  /** Frame from an extension screenshot (JPEG data URL of the work tab); `pii` = personal-data fields to blur. */
  async grabImage(dataUrl: string, pii: BBox[] = []): Promise<SampledFrame | null> {
    const img = new Image();
    img.src = dataUrl;
    await img.decode().catch(() => null);
    if (!img.naturalWidth) return null;
    return this.grab(img, img.naturalWidth, img.naturalHeight, pii);
  }

  /** Blurs `piiRegions` (+ `extraPii`) BEFORE the frame exists as a blob: nothing unblurred is stored or sent to vision. */
  async grab(source?: CanvasImageSource, sw?: number, sh?: number, extraPii: BBox[] = []): Promise<SampledFrame | null> {
    const src = source ?? this.video;
    const srcW = sw ?? this.video.videoWidth, srcH = sh ?? this.video.videoHeight;
    if (!srcW) return null;
    const scale = Math.min(1, this.maxWidth / srcW);
    const w = Math.round(srcW * scale), h = Math.round(srcH * scale);
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext("2d")!;
    ctx.drawImage(src, 0, 0, w, h);
    let piiBlurred = 0;
    for (const r of [...this.piiRegions, ...extraPii]) {
      // pixelate (shrink to ~1/16) then blur back up: no characters survive, the layout stays recognizable
      const rx = Math.max(0, r.x * w), ry = Math.max(0, r.y * h), rw = Math.min(w - rx, r.w * w), rh = Math.min(h - ry, r.h * h);
      if (rw < 1 || rh < 1) continue;
      const tw = Math.max(1, Math.round(rw / 16)), th = Math.max(1, Math.round(rh / 16));
      this.pix.width = tw;
      this.pix.height = th;
      this.pix.getContext("2d")!.drawImage(this.canvas, rx, ry, rw, rh, 0, 0, tw, th);
      ctx.save();
      ctx.filter = "blur(4px)";
      ctx.drawImage(this.pix, 0, 0, tw, th, rx, ry, rw, rh);
      ctx.restore();
      piiBlurred++;
    }
    // diff on a 32x18 grayscale thumbnail
    const t = this.tiny.getContext("2d", { willReadFrequently: true })!;
    t.drawImage(this.canvas, 0, 0, 32, 18);
    const px = t.getImageData(0, 0, 32, 18).data;
    const gray = new Uint8ClampedArray(32 * 18);
    for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
    let diff = 1;
    if (this.prev) {
      let changed = 0;
      for (let i = 0; i < gray.length; i++) if (Math.abs(gray[i] - this.prev[i]) > 12) changed++;
      diff = changed / gray.length;
    }
    this.prev = gray;
    const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
    let bits = "";
    for (let i = 0; i < 64; i++) bits += gray[i * 9] > mean ? "1" : "0";
    const phash = BigInt("0b" + bits).toString(16).padStart(16, "0");
    const blob = await new Promise<Blob>((res) => this.canvas.toBlob((b) => res(b!), "image/webp", 0.7));
    return {
      blob, width: w, height: h, diff: Math.round(diff * 1000) / 1000, phash, piiBlurred,
      base64: async () => {
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      },
    };
  }

  stop() {
    this.video.srcObject = null;
  }
}

/**
 * Records a stream in fixed slices. Each slice is a STANDALONE playable file (the recorder is restarted per
 * slice; MediaRecorder timeslice chunks after the first lack headers and can't be played on their own).
 */
export class ChunkRecorder {
  private rec: MediaRecorder | null = null;
  private slice: { drop: boolean } | null = null; // the slice being recorded right now
  private n = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;
  private stopping = false;
  /** Finished slices wait `holdMs` before upload, so a spoken "off the record" can still take its slice back. */
  private held: Array<{ blob: Blob; startedAt: number; endedAt: number; timer?: ReturnType<typeof setTimeout> }> = [];

  constructor(
    readonly stream: MediaStream,
    readonly mime: string,
    readonly onChunk: (blob: Blob, index: number, durationMs: number, startedAtPerf: number) => void,
    readonly sliceMs = 10_000,
    readonly holdMs = 0,
  ) {}

  private begin() {
    const startedAt = performance.now();
    const parts: Blob[] = [];
    const slice = { drop: false };
    const rec = new MediaRecorder(this.stream, MediaRecorder.isTypeSupported(this.mime) ? { mimeType: this.mime } : undefined);
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      if (!parts.length || slice.drop) return;
      const c = { blob: new Blob(parts, { type: rec.mimeType }), startedAt, endedAt: performance.now() } as (typeof this.held)[number];
      if (!this.holdMs || this.stopping) return this.deliver(c);
      c.timer = setTimeout(() => this.deliver(c), this.holdMs);
      this.held.push(c);
    };
    rec.start();
    this.rec = rec;
    this.slice = slice;
  }

  private deliver(c: (typeof this.held)[number]) {
    clearTimeout(c.timer);
    this.held = this.held.filter((x) => x !== c);
    this.onChunk(c.blob, this.n++, Math.round(c.endedAt - c.startedAt), c.startedAt);
  }

  /**
   * Throw away everything recorded since `perfT` (performance.now() time): held slices that overlap it and the
   * slice in progress. For the spoken off-record command: its audio is never uploaded.
   */
  dropSince(perfT: number) {
    for (const c of [...this.held]) {
      if (c.endedAt < perfT) continue;
      clearTimeout(c.timer);
      this.held = this.held.filter((x) => x !== c);
    }
    if (this.slice) this.slice.drop = true;
  }

  private cut() {
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    this.rec = null;
    this.slice = null;
  }

  start() {
    this.begin();
    this.timer = setInterval(() => {
      if (this.paused) return;
      this.cut();
      this.begin();
    }, this.sliceMs);
  }
  /** Off-record: close the current slice (it only holds on-record media) and record nothing until resume. */
  pause() {
    this.paused = true;
    this.cut();
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.begin();
  }
  stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.cut();
    [...this.held].forEach((c) => this.deliver(c)); // nothing waits past the end of the session
  }
}
