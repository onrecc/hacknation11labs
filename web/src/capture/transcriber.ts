/**
 * Always-on speech-to-text with word timings. ScribeTranscriber (ElevenLabs Scribe v2 Realtime) when a token
 * is available; WebSpeechTranscriber (Chrome) as the no-key fallback (word times are interpolated).
 */
import { Scribe, RealtimeEvents, CommitStrategy } from "@elevenlabs/client";
import type { Word } from "@shared/schema";
import { voiceToken } from "../lib/api";
import { micConstraint, preferredMicId } from "../voice/mic";

export interface TranscribedUtterance {
  text: string;
  t: number; // session ms
  tEnd: number;
  words: Word[];
  language: string;
  sttModel: string;
}

export interface TranscriberEvents {
  onSpeechStart: (t: number) => void;
  /** Every partial result while someone is still talking (keeps reply windows open for long answers). */
  onSpeechActivity?: (t: number) => void;
  onUtterance: (u: TranscribedUtterance) => void;
  onError: (e: unknown) => void;
}

export interface Transcriber {
  readonly name: string;
  start(): Promise<void>;
  /** While true, results are discarded (off-record). */
  muted: boolean;
  stop(): void;
}

/** now() = session clock in ms */
export async function createTranscriber(now: () => number, ev: TranscriberEvents, language = "en"): Promise<Transcriber> {
  try {
    const { token } = await voiceToken("scribe");
    if (token) return new ScribeTranscriber(token, now, ev, language);
  } catch (e) {
    console.info("Scribe unavailable, using Web Speech fallback:", (e as Error).message);
  }
  return new WebSpeechTranscriber(now, ev, language);
}

class ScribeTranscriber implements Transcriber {
  readonly name = "scribe_v2_realtime";
  muted = false;
  private conn: ReturnType<typeof Scribe.connect> | null = null;
  private t0 = 0;
  private speaking = false;

  constructor(private token: string, private now: () => number, private ev: TranscriberEvents, private language: string) {}

  async start() {
    this.t0 = this.now();
    this.conn = Scribe.connect({
      token: this.token,
      modelId: "scribe_v2_realtime",
      languageCode: this.language,
      includeTimestamps: true,
      commitStrategy: CommitStrategy.VAD,
      // a segment ends after 1.2 s of silence: answers reach the hub sooner, short thinking pauses don't split them
      vadSilenceThresholdSecs: 1.2,
      // same mic as the rest of Ada (never a Bluetooth headset's mic when the laptop has one: see voice/mic.ts)
      microphone: { ...micConstraint(await preferredMicId()), echoCancellation: true, noiseSuppression: true },
    });
    this.conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, () => {
      if (this.muted) return;
      if (!this.speaking) {
        this.speaking = true;
        this.ev.onSpeechStart(this.now());
      }
      this.ev.onSpeechActivity?.(this.now());
    });
    this.conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, (m) => {
      this.speaking = false;
      if (this.muted || !m.text.trim()) return;
      // Scribe word times are seconds since the connection started (verify against the API docs).
      const words: Word[] = (m.words ?? []).filter((w) => w.type === "word").map((w) => ({
        w: w.text, t: this.t0 + Math.round((w.start ?? 0) * 1000), tEnd: this.t0 + Math.round((w.end ?? 0) * 1000), conf: Math.exp(w.logprob ?? 0),
      }));
      const t = words[0]?.t ?? this.now();
      this.ev.onUtterance({ text: m.text.trim(), t, tEnd: words.at(-1)?.tEnd ?? this.now(), words, language: m.language_code ?? this.language, sttModel: this.name });
    });
    this.conn.on(RealtimeEvents.ERROR, (e) => this.ev.onError(e));
  }

  stop() {
    this.conn?.close();
  }
}

type SR = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };

class WebSpeechTranscriber implements Transcriber {
  readonly name = "webspeech";
  muted = false;
  private rec: SR | null = null;
  private stopped = false;
  private segStart: number | null = null;

  constructor(private now: () => number, private ev: TranscriberEvents, private language: string) {}

  async start() {
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
    if (!Ctor) throw new Error("No speech recognition in this browser (use Chrome, or configure ElevenLabs Scribe)");
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.language === "en" ? "en-US" : this.language;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (this.segStart === null) {
          this.segStart = this.now();
          if (!this.muted) this.ev.onSpeechStart(this.segStart);
        }
        if (!this.muted) this.ev.onSpeechActivity?.(this.now());
        if (r.isFinal) {
          const text = String(r[0].transcript).trim();
          const t = this.segStart, tEnd = this.now();
          this.segStart = null;
          if (this.muted || !text) continue;
          this.ev.onUtterance({ text, t, tEnd, words: interpolateWords(text, t, tEnd, r[0].confidence), language: rec.lang, sttModel: this.name });
        }
      }
    };
    rec.onerror = (e) => e.error !== "no-speech" && this.ev.onError(e);
    rec.onend = () => !this.stopped && rec.start(); // keep listening forever
    rec.start();
    this.rec = rec;
  }

  stop() {
    this.stopped = true;
    this.rec?.stop();
  }
}

/** Spread words over [t, tEnd] proportional to length (fallback when the STT has no word timings). */
export function interpolateWords(text: string, t: number, tEnd: number, conf?: number): Word[] {
  const ws = text.split(/\s+/).filter(Boolean);
  const total = ws.reduce((a, w) => a + w.length + 1, 0);
  let cur = t;
  return ws.map((w) => {
    const d = ((tEnd - t) * (w.length + 1)) / total;
    const word: Word = { w, t: Math.round(cur), tEnd: Math.round(cur + d * 0.92), ...(conf ? { conf } : {}) };
    cur += d;
    return word;
  });
}
