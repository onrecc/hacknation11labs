/**
 * Replaying the expert's moment: a few seconds of her screen recording around a step, and her own words from the mic.
 * Both come from the 10 s `media.chunk` recordings (each a self-contained WebM). Anything missing or unplayable
 * (demo fixture, workday sessions without video, codec trouble) silently leaves the still frame / plain quote in place.
 */
import { useEffect, useRef, useState } from "react";
import type { MediaClip } from "@shared/logindex";

export type MediaSource = (sessionId: string, uri: string) => Promise<string | null>;

/** Screen replay window around a moment, and the slack around a quote's spoken words (ms). */
export const SCREEN_BEFORE = 3000;
export const SCREEN_AFTER = 5000;
export const WORDS_BEFORE = 300;
export const WORDS_AFTER = 500;
/** Extra time before the hard stop, in case the browser never reports reaching the clip's end. */
const STOP_GRACE_MS = 1500;
/** Tolerance when deciding whether playback sits outside the clip (s). */
const SEEK_SLACK_S = 0.25;

/** Resolve a chunk uri to a playable URL; null while loading, when there is no source, or when it fails. */
export function useMediaUrl(media: MediaSource | undefined, sessionId: string, uri: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    setUrl(null);
    if (!media || !uri) return;
    media(sessionId, uri).then((u) => ok && setUrl(u), () => ok && setUrl(null));
    return () => void (ok = false);
  }, [media, sessionId, uri]);
  return url;
}

/** `#t=` media fragment: the browser starts (and, where supported, stops) at the clip on its own. */
const withFragment = (url: string, clip: MediaClip): string => `${url}#t=${(clip.start / 1000).toFixed(2)},${(clip.end / 1000).toFixed(2)}`;

/** Keep playback inside [start, end]: jump to the start when outside it. */
function seekIntoClip(el: HTMLMediaElement, clip: MediaClip): void {
  const s = clip.start / 1000;
  if (el.currentTime < s - SEEK_SLACK_S || el.currentTime >= clip.end / 1000 - SEEK_SLACK_S / 5) el.currentTime = s;
}

/** The screen recording around a moment, with sound controls; the still frame is the poster until it plays. */
export function ClipVideo({ url, clip, poster, label, onFail, onPlayingChange }: {
  url: string; clip: MediaClip; poster?: string; label: string; onFail: () => void; onPlayingChange: (playing: boolean) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const end = clip.end / 1000;
  return (
    <video
      ref={ref}
      className="frame-video"
      src={withFragment(url, clip)}
      poster={poster}
      aria-label={label}
      controls
      playsInline
      preload="none"
      onLoadedMetadata={() => ref.current && seekIntoClip(ref.current, clip)}
      onPlay={() => { if (ref.current) seekIntoClip(ref.current, clip); onPlayingChange(true); }}
      onTimeUpdate={() => { if (ref.current && ref.current.currentTime >= end) ref.current.pause(); }}
      onPause={() => onPlayingChange(false)}
      onEnded={() => onPlayingChange(false)}
      onError={onFail}
    />
  );
}

/** "Play her words": the mic recording from the quote's first to last word. Hidden when there is no recording. */
export function PlayWords({ url, clip, who }: { url: string | null; clip: MediaClip | null; who?: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPlaying(false);
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { stop(); setFailed(false); }, [url, clip?.uri, clip?.start]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!url || !clip || failed) return null;

  const fail = () => { stop(); setFailed(true); };
  const play = () => {
    if (audio.current) return stop();
    const el = new Audio(withFragment(url, clip));
    el.onloadedmetadata = () => seekIntoClip(el, clip);
    el.ontimeupdate = () => { if (el.currentTime >= clip.end / 1000) stop(); };
    el.onended = stop;
    el.onerror = fail;
    audio.current = el;
    setPlaying(true);
    timer.current = setTimeout(stop, clip.end - clip.start + STOP_GRACE_MS);
    el.play().catch(fail);
  };
  return (
    <button type="button" className="link-quiet play-words" onClick={play} aria-pressed={playing}>
      {playing ? <StopIcon /> : <PlayIcon />}
      {playing ? "Stop" : `Play ${who ? `${who}'s` : "her"} words`}
    </button>
  );
}

const PlayIcon = () => <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden><path d="M4.5 3v10l8-5z" /></svg>;
const StopIcon = () => <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden><rect x="4" y="4" width="8" height="8" rx="1" /></svg>;
