import { useEffect, useState, useSyncExternalStore } from "react";
import type { Event, Id, Quote as QuoteT, ScreenMoment } from "@shared/schema";
import { fmtT } from "@shared/logindex";
import { blobUrl } from "../lib/sessions";

/** Re-render on any change of an object exposing subscribe() + a snapshot getter. */
export function useStore<T>(store: { subscribe: (fn: () => void) => () => void } | null, get: () => T): T {
  return useSyncExternalStore((fn) => (store ? store.subscribe(fn) : () => {}), get);
}

export function FrameImg({ sessionId, frameId, uri, bbox, className }: { sessionId: Id; frameId?: Id; uri?: string; bbox?: ScreenMoment["bbox"]; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    setErr(false);
    const tryUris = uri ? [uri] : frameId ? [`frames/${frameId}.webp`, `frames/${frameId}.svg`] : [];
    (async () => {
      for (const u of tryUris) {
        try {
          return setSrc(await blobUrl(sessionId, u));
        } catch { /* next */ }
      }
      setErr(true);
    })();
  }, [sessionId, frameId, uri]);
  if (err) return <div className={`frame missing ${className ?? ""}`}>frame unavailable</div>;
  return (
    <div className={`frame ${className ?? ""}`}>
      {src && <img src={src} alt={frameId ?? "frame"} />}
      {bbox && <div className="bbox" style={{ left: `${bbox.x * 100}%`, top: `${bbox.y * 100}%`, width: `${bbox.w * 100}%`, height: `${bbox.h * 100}%` }} />}
    </div>
  );
}

/** Verbatim quote with timestamp; plays the mic audio around it when the media chunk exists. */
export function Quote({ q, events, who }: { q: QuoteT; events?: Event[]; who?: string }) {
  const [playing, setPlaying] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const chunk = events?.find((e) => e.type === "media.chunk" && e.payload.stream === "mic" && e.t <= q.t && q.t < e.t + e.payload.durationMs);
  useEffect(() => {
    if (chunk?.type === "media.chunk") blobUrl(q.sessionId, chunk.payload.uri).then(setUrl, () => setUrl(null));
  }, [chunk?.id]);
  async function play() {
    if (!chunk || chunk.type !== "media.chunk" || !url) return;
    const a = new Audio(url);
    a.currentTime = Math.max(0, (q.t - chunk.t) / 1000 - 0.3);
    setPlaying(true);
    await a.play();
    setTimeout(() => (a.pause(), setPlaying(false)), q.tEnd - q.t + 800);
  }
  return (
    <blockquote className="quote">
      “{q.text}” <span className="muted">{who ? `· ${who} ` : ""}· {fmtT(q.t)} · {q.phase}</span>
      {url && <button className="link" onClick={play} disabled={playing}>{playing ? "playing…" : "▶ play"}</button>}
    </blockquote>
  );
}

export function EventFeed({ events, max = 60 }: { events: Event[]; max?: number }) {
  const shown = events.filter((e) => !["frame.captured", "input.activity", "speech.vad", "media.chunk", "model.call", "redaction.applied", "agent.context_pushed"].includes(e.type)).slice(-max).reverse();
  return (
    <div className="feed">
      {shown.map((e) => (
        <div key={e.id} className={`feed-row t-${e.type.split(".")[0]}`}>
          <span className="muted mono">{fmtT(e.t)}</span> <span className="tag">{e.type}</span> {summarize(e)}
        </div>
      ))}
    </div>
  );
}

export function summarize(e: Event): string {
  switch (e.type) {
    case "utterance": return `${e.payload.speaker}${e.payload.addressedTo === "self" ? " (aloud)" : ""}: ${e.payload.text}`;
    case "screen.action": return e.payload.description;
    case "agent.question": return `[${e.payload.category}] ${e.payload.text}`;
    case "agent.turn": return e.payload.text;
    case "pause.detected": return `${e.payload.decision}: ${e.payload.reason}`;
    case "answer.linked": return `“${e.payload.quote}”`;
    case "knowledge.correction": return `${e.payload.kind}: ${e.payload.before ?? ""} → ${e.payload.after ?? ""}`;
    case "marker.case_boundary": return `${e.payload.state} ${e.payload.case.key} ${e.payload.outcome ?? ""}`;
    case "marker.off_record": return e.payload.state;
    case "question.deferred": return e.payload.text;
    case "screen.observed": return e.payload.summary;
    case "tutor.intervention": return e.payload.spokenText;
    case "teachback.verdict": return `${e.payload.verdict} ${e.payload.correction ?? ""}`;
    case "phase.changed": return `${e.payload.from} → ${e.payload.to}`;
    case "gap.status": return `${e.payload.gapId} ${e.payload.status}`;
    default: return "";
  }
}
