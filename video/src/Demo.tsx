import React from "react";
import { AbsoluteFill, Audio, Freeze, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { Bg, C, Caption, Mark, Product, font, productDuration, type Words } from "./Product";
import hook from "../public/hook.json";
import streetVo from "../public/street.json";
import i2 from "../public/i2.json";
import endVo from "../public/end.json";

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);
export type DemoProps = { street?: string; streetDur?: number; noHook?: boolean };
export const HOOK = hook.dur + 0.3, INTRO = i2.dur + 0.6, END = endVo.dur + 0.9;
export const demoDuration = (p: DemoProps) => (p.noHook ? 0 : f(p.street ? p.streetDur ?? 10 : HOOK)) + f(INTRO) + productDuration() + f(END);

const fadeIn = (fr: number, d = 12) => interpolate(fr, [0, d], [0, 1], { extrapolateRight: "clamp" });

/** the held save, close up: the demo opens and closes on it */
const HELD_AT = 11.5; // s into 04-teach-held.mp4 where the "Save held" card is fully in
const Held: React.FC<{ dim?: boolean }> = ({ dim }) => {
  const fr = useCurrentFrame();
  const z = interpolate(fr, [0, f(4)], [1.22, 1.3], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${z})`, transformOrigin: "100% 30%", opacity: dim ? 0.12 : 1, filter: dim ? "blur(6px)" : undefined }}>
        <Freeze frame={0}><OffthreadVideo src={staticFile("04-teach-held.mp4")} startFrom={f(HELD_AT)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} /></Freeze>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Logo: React.FC<{ sub?: string; tagline?: string; clear?: boolean }> = ({ sub, tagline, clear }) => {
  const fr = useCurrentFrame();
  const e = spring({ frame: fr, fps: FPS, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ fontFamily: font, color: C.text, alignItems: "center", justifyContent: "center", zIndex: 0 }}>
      {!clear && <Bg />}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 26, opacity: e, transform: `translateY(${(1 - e) * 20}px)` }}>
        <Mark size={84} />
        <div style={{ fontSize: 110, fontWeight: 600, letterSpacing: "-0.04em" }}>Protégé</div>
      </div>
      {sub && <div style={{ marginTop: 40, fontSize: 44, fontWeight: 500, color: C.text, opacity: fadeIn(fr - f(1.1), 15) }}>{sub}</div>}
      {tagline && <div style={{ marginTop: 22, fontSize: 32, color: C.muted, opacity: fadeIn(fr - f(1.8), 15) }}>{tagline}</div>}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const FadeOut: React.FC<{ len: number }> = ({ len }) => {
  const fr = useCurrentFrame();
  return <AbsoluteFill style={{ background: "#000", opacity: interpolate(fr, [len - 18, len - 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} />;
};

const FadeIn: React.FC<{ len: number }> = ({ len }) => {
  const fr = useCurrentFrame();
  return <AbsoluteFill style={{ background: "#000", opacity: interpolate(fr, [0, len], [1, 0], { extrapolateRight: "clamp" }) }} />;
};

/** the problem, narrated (Wilmer's street clip replaces it when it exists) */
const at = (w: string) => hook.words.find((x) => x.w.startsWith(w))?.s ?? 0;
const Hook: React.FC = () => {
  const fr = useCurrentFrame();
  const line = (t: number) => ({ opacity: interpolate(fr, [f(t), f(t) + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) });
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: font, color: C.text, alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", marginTop: -80 }}>
        <div style={{ display: "flex", gap: 140, alignItems: "flex-start" }}>
          <div style={line(0.2)}>
            <div style={{ fontSize: 84, fontWeight: 600, letterSpacing: "-0.04em" }}>Sabine</div>
            <div style={{ fontSize: 34, color: C.muted, marginTop: 10 }}>Accounts payable, Hamburg · 24 years</div>
            <div style={{ fontSize: 34, color: C.text, marginTop: 18, fontWeight: 500, ...line(at("retires")) }}>Retires next year</div>
          </div>
          <div style={line(at("Olena"))}>
            <div style={{ fontSize: 84, fontWeight: 600, letterSpacing: "-0.04em" }}>Olena</div>
            <div style={{ fontSize: 34, color: C.muted, marginTop: 10 }}>Qualified accountant, from Kharkiv</div>
            <div style={{ fontSize: 34, color: C.text, marginTop: 18, fontWeight: 500, ...line(at("German")) }}>Doesn't speak German yet</div>
          </div>
        </div>
      </div>
      <Sequence from={f(0.3)}><Audio src={staticFile("hook.mp3")} /><Caption data={hook as Words} /></Sequence>
    </AbsoluteFill>
  );
};

/** "So we built Protégé" over the held save, close up */
const Intro: React.FC = () => (
  <AbsoluteFill>
    <Held />
    <div style={{ position: "absolute", top: 40, left: 48, display: "flex", alignItems: "center", gap: 14, fontFamily: font, fontSize: 40, fontWeight: 600, letterSpacing: "-0.03em", color: C.text, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 20px" }}><Mark size={30} />Protégé</div>
    <Sequence from={f(0.3)}><Audio src={staticFile("i2.mp3")} /><Caption data={i2 as Words} /></Sequence>
  </AbsoluteFill>
);

/** the vision, clearly labelled as next (not built) */
const Next: React.FC = () => {
  const fr = useCurrentFrame();
  const cue = (endVo.words.find((w) => w.w.startsWith("Next"))?.s ?? 6) + 0.5;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 170, fontFamily: font }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", opacity: interpolate(fr, [f(cue), f(cue) + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        <span style={{ fontSize: 26, color: C.muted, marginRight: 6 }}>Next</span>
        {["Kraków, in Polish", "Care homes", "Aid workers"].map((t) => <span key={t} style={{ fontSize: 26, color: C.text, border: `1px solid ${C.line}`, background: C.subtle, borderRadius: 6, padding: "8px 16px" }}>{t}</span>)}
      </div>
    </AbsoluteFill>
  );
};

export const Demo: React.FC<DemoProps> = ({ street, streetDur = 10, noHook }) => {
  const h0 = noHook ? 0 : street ? f(streetDur) : f(HOOK);
  const p0 = h0 + f(INTRO), e0 = p0 + productDuration();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {/* music bed (ElevenLabs Music): quiet under the voice, fades in and out */}
      <Audio src={staticFile("music.mp3")} volume={(fr) => 0.11 * interpolate(fr, [0, 20, e0 + f(END) - 45, e0 + f(END) - 5], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      {h0 > 0 && <Sequence durationInFrames={h0}>
        {street ? <><OffthreadVideo src={staticFile(street)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /><Caption data={streetVo as Words} /></> : <Hook />}
        <FadeIn len={f(0.5)} />
      </Sequence>}
      <Sequence from={h0} durationInFrames={f(INTRO)}><Intro /></Sequence>
      <Sequence from={p0} durationInFrames={productDuration()}><Product /></Sequence>
      <Sequence from={e0} durationInFrames={f(END)}>
        <Held dim />
        <Logo clear sub="One rulebook for new hires and AI agents." tagline="An apprentice, not a recorder." />
        <Sequence from={f(0.5)}><Audio src={staticFile("end.mp3")} /><Caption data={endVo as Words} /></Sequence>
        <FadeOut len={f(END)} />
      </Sequence>
    </AbsoluteFill>
  );
};
