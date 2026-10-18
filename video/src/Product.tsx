import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import n1 from "../public/n1.json";
import n2 from "../public/n2.json";
import n3 from "../public/n3.json";
import timing from "../public/timing.json"; // durations of ada/sabine clips (s), written by prep script

const FPS = 30;
export type Words = { text: string; words: { w: string; s: number; e: number }[]; dur: number };
const KEY = /^(why|ElevenLabs|Ada|Work|Map|steps|decisions|guardrails|own|words|screen|moment|self-correction|held|opex|never|Lena|Sabine)/i;
const f = (s: number) => Math.round(s * FPS);

// timeline (seconds)
const T = (() => {
  const a0 = 0.2, a1 = a0 + n1.dur + 0.15;          // capture narration → Ada question
  const s1 = a1 + timing.ada + 0.2;                // Sabine answer
  const capEnd = s1 + timing.sabine + 0.3;
  const map0 = capEnd, mapEnd = map0 + 0.3 + n2.dur + 0.3;
  const tb0 = mapEnd, end = tb0 + 0.2 + n3.dur + 0.9;
  return { a0, a1, s1, capEnd, map0, mapEnd, tb0, end };
})();
export const productDuration = () => f(T.end);

export const C = { bg: "#0a0a0a", subtle: "#111111", soft: "#1a1a1a", text: "#ededed", muted: "#a1a1a1", faint: "#737373", line: "#262626", lineStrong: "#3a3a3a", ok: "#3dd68c", red: "#ff6166", blue: "#52a8ff", warn: "#ffb224" };
export const font = loadFont("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin", "latin-ext"] }).fontFamily;

/** the app's brand mark: rounded square with an inner ring (styles.css .nav .brand::before) */
export const Mark: React.FC<{ size: number }> = ({ size }) => <span style={{ width: size, height: size, borderRadius: size / 4, background: C.text, boxShadow: `inset 0 0 0 ${size / 4}px ${C.text}, inset 0 0 0 ${(size * 6) / 16}px ${C.bg}`, display: "inline-block", flex: "none" }} />;

export const Bg: React.FC = () => {
  return <AbsoluteFill style={{ background: C.bg }} />;
};

const Browser: React.FC<{ src: string; url: string; zoom?: [number, number, number, number]; startFrom?: number }> = ({ src, url, zoom = [1, 1, 50, 50], startFrom = 0 }) => {
  const fr = useCurrentFrame(); const { durationInFrames } = useVideoConfig();
  const enter = spring({ frame: fr, fps: FPS, config: { damping: 200 } });
  const z = interpolate(fr, [0, durationInFrames], [zoom[0], zoom[1]], { easing: Easing.inOut(Easing.cubic) });
  const W = 1340, H = Math.round(1340 * 0.625) + 44;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 84 }}>
      <div style={{ width: W, height: H, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.line}`, background: C.subtle, opacity: enter, transform: `translateY(${(1 - enter) * 30}px) scale(${0.97 + 0.03 * enter})` }}>
        <div style={{ height: 44, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: `1px solid ${C.line}`, background: C.subtle }}>
          {[0, 1, 2].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: C.lineStrong }} />)}
          <div style={{ marginLeft: 16, flex: 1, maxWidth: 620, height: 28, borderRadius: 6, background: C.bg, border: `1px solid ${C.line}`, color: C.muted, fontFamily: font, fontSize: 15, display: "flex", alignItems: "center", padding: "0 12px" }}>{url}</div>
        </div>
        <div style={{ width: W, height: H - 44, overflow: "hidden" }}>
          <div style={{ width: "100%", height: "100%", transform: `scale(${z})`, transformOrigin: `${zoom[2]}% ${zoom[3]}%` }}>
            <OffthreadVideo src={staticFile(src)} startFrom={startFrom} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** word-by-word caption, key words highlighted, ≤ 7 words per line */
export const Caption: React.FC<{ data: Words }> = ({ data }) => {
  const t = useCurrentFrame() / FPS;
  const lines: Words["words"][] = [];
  let cur: Words["words"] = [];
  data.words.forEach((w, i) => {
    cur.push(w);
    const left = data.words.length - i - 1;
    if (left > 2 && (cur.length >= 7 || /[.,!?]$/.test(w.w) && cur.length >= 3)) { lines.push(cur); cur = []; }
  });
  if (cur.length) lines.push(cur);
  const line = lines.find((l) => t <= l[l.length - 1].e + 0.15) ?? lines[lines.length - 1];
  if (t > data.dur + 0.4) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 46 }}>
      <div style={{ fontFamily: font, fontSize: 42, fontWeight: 500, letterSpacing: "-0.01em", color: C.text, background: C.subtle, padding: "10px 22px", borderRadius: 8, border: `1px solid ${C.line}` }}>
        {line.map((w, i) => {
          const on = t >= w.s - 0.05;
          return <span key={i} style={{ color: on ? C.text : C.faint, fontWeight: on && KEY.test(w.w) ? 700 : undefined }}>{w.w}{i < line.length - 1 ? " " : ""}</span>;
        })}
      </div>
    </AbsoluteFill>
  );
};

const Chip: React.FC<{ n: string; label: string }> = ({ n, label }) => {
  const fr = useCurrentFrame(); const o = interpolate(fr, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: 26, left: 290, opacity: o, fontFamily: font, display: "flex", gap: 10, alignItems: "center", color: C.text, fontSize: 24, fontWeight: 600 }}>
      <span style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: "2px 10px", color: C.muted, fontSize: 18 }}>{n}</span>{label}
    </div>
  );
};

/** badge: Teach runs through the browser extension, on any web app */
const Ext: React.FC = () => {
  const fr = useCurrentFrame(); const o = interpolate(fr, [20, 35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <div style={{ position: "absolute", top: 30, right: 290, opacity: o, fontFamily: font, fontSize: 20, color: C.text, border: `1px solid ${C.line}`, borderRadius: 6, padding: "6px 14px", background: C.subtle, display: "flex", gap: 10, alignItems: "center" }}>
    <span style={{ width: 8, height: 8, borderRadius: 4, background: C.ok }} />Browser extension · works on any web app
  </div>;
};

/** speech card for Ada / Sabine with a live waveform */
const Speech: React.FC<{ who: string; role: string; color: string; children: React.ReactNode; side: "left" | "right" }> = ({ who, role, color, children, side }) => {
  const fr = useCurrentFrame();
  const e = spring({ frame: fr, fps: FPS, config: { damping: 18, stiffness: 160 } });
  return (
    <div style={{ position: "absolute", bottom: 170, [side]: 120, width: 720, transform: `translateY(${(1 - e) * 40}px)`, opacity: e, fontFamily: font, background: C.subtle, border: `1px solid ${C.line}`, borderRadius: 12, padding: "22px 26px", boxShadow: "0 16px 40px rgba(0,0,0,.5)" } as React.CSSProperties}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span style={{ width: 36, height: 36, borderRadius: 18, background: C.soft, border: `1px solid ${C.lineStrong}`, display: "grid", placeItems: "center", color: C.text, fontWeight: 600, fontSize: 17 }}>{who[0]}</span>
        <b style={{ color: C.text, fontSize: 22 }}>{who}</b><span style={{ color: C.muted, fontSize: 18 }}>{role}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center", height: 26 }}>
          {Array.from({ length: 14 }, (_, i) => <span key={i} style={{ width: 4, borderRadius: 2, background: color, height: 6 + Math.abs(Math.sin(fr / 3 + i * 1.3)) * 20 }} />)}
        </span>
      </div>
      <div style={{ color: C.text, fontSize: 30, lineHeight: 1.35, fontWeight: 500 }}>{children}</div>
    </div>
  );
};

export const Product: React.FC = () => {
  const capLen = f(T.capEnd), mapLen = f(T.mapEnd - T.map0), tbLen = f(T.end - T.tb0);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Bg />
      <Sequence durationInFrames={capLen}>
        <Browser src="02-erp-capture.mp4" url="MiniERP + Protégé browser extension" zoom={[1, 1.06, 100, 60]} startFrom={f(0.8)} />
        <Chip n="1" label="Capture: Ada asks why" />
        <Sequence from={f(T.a0)}><Audio src={staticFile("n1.mp3")} /><Caption data={n1 as Words} /></Sequence>
        <Sequence from={f(T.a1)} durationInFrames={f(timing.ada + 0.3)}>
          <Audio src={staticFile("ada-q1.mp3")} />
          <Speech who="Ada" role="ElevenLabs interviewer" color={C.text} side="right">“You moved that one to capex. What made you do that?”</Speech>
        </Sequence>
        <Sequence from={f(T.s1)} durationInFrames={f(timing.sabine + 0.6)}>
          <Audio src={staticFile("sabine-a1.mp3")} />
          <Speech who="Sabine" role="AP specialist, 24 years" color={C.muted} side="left">
            “Equipment over <s style={{ color: C.red }}><span style={{ color: C.muted }}>three thousand</span></s> euros is always capex. <span style={{ color: C.muted }}>No, wait, sorry,</span> <b>five thousand.</b>”
          </Speech>
        </Sequence>
      </Sequence>
      <Sequence from={f(T.map0)} durationInFrames={mapLen}>
        <Browser src="03-workmap.mp4" url="Protégé · Work Map" zoom={[1, 1.08, 60, 40]} />
        <Chip n="2" label="Map: every rule has proof" />
        <Sequence from={f(0.3)}><Audio src={staticFile("n2.mp3")} /><Caption data={n2 as Words} /></Sequence>
      </Sequence>
      <Sequence from={f(T.tb0)} durationInFrames={tbLen}>
        <Browser src="04-teach-held.mp4" startFrom={f(3.4)} url="MiniERP + Protégé browser extension" zoom={[1, 1.1, 100, 50]} />
        <Chip n="3" label="Teach: Ada's cards coach Olena in Ukrainian" />
        <Ext />
        <Sequence from={f(0.2)}><Audio src={staticFile("n3.mp3")} /><Caption data={n3 as Words} /></Sequence>
      </Sequence>
    </AbsoluteFill>
  );
};
