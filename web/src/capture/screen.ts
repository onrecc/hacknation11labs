/** Screen sampling (1 fps frames with diff score + PII blur) and chunked MediaRecorder uploads. */
import type { BBox } from "@shared/schema";

export interface SampledFrame {
  blob: Blob;
  width: number;
  height: number;
  diff: number; // 0..1 vs previous frame
  phash: string;
  base64: () => Promise<string>;
}

export class FrameSampler {
  private video = document.createElement("video");
  private canvas = document.createElement("canvas");
  private tiny = document.createElement("canvas");
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

  /** Frame from an extension screenshot (JPEG data URL of the work tab). */
  async grabImage(dataUrl: string): Promise<SampledFrame | null> {
    const img = new Image();
    img.src = dataUrl;
    await img.decode().catch(() => null);
    if (!img.naturalWidth) return null;
    return this.grab(img, img.naturalWidth, img.naturalHeight);
  }

  async grab(source?: CanvasImageSource, sw?: number, sh?: number): Promise<SampledFrame | null> {
    const src = source ?? this.video;
    const srcW = sw ?? this.video.videoWidth, srcH = sh ?? this.video.videoHeight;
    if (!srcW) return null;
    const scale = Math.min(1, this.maxWidth / srcW);
    const w = Math.round(srcW * scale), h = Math.round(srcH * scale);
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext("2d")!;
    ctx.drawImage(src, 0, 0, w, h);
    for (const r of this.piiRegions) {
      ctx.save();
      ctx.filter = "blur(12px)";
      ctx.drawImage(this.canvas, r.x * w, r.y * h, r.w * w, r.h * h, r.x * w, r.y * h, r.w * w, r.h * h);
      ctx.restore();
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
      blob, width: w, height: h, diff: Math.round(diff * 1000) / 1000, phash,
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
  private n = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;

  constructor(
    readonly stream: MediaStream,
    readonly mime: string,
    readonly onChunk: (blob: Blob, index: number, durationMs: number, startedAtPerf: number) => void,
    readonly sliceMs = 10_000,
  ) {}

  private begin() {
    const startedAt = performance.now();
    const parts: Blob[] = [];
    const rec = new MediaRecorder(this.stream, MediaRecorder.isTypeSupported(this.mime) ? { mimeType: this.mime } : undefined);
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      if (!parts.length) return;
      this.onChunk(new Blob(parts, { type: rec.mimeType }), this.n++, Math.round(performance.now() - startedAt), startedAt);
    };
    rec.start();
    this.rec = rec;
  }

  private cut() {
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    this.rec = null;
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
    if (this.timer) clearInterval(this.timer);
    this.cut();
  }
}
