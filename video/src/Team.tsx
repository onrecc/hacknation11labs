import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { Bg, C, Mark, font } from "./Product";

/** the three of us; the third teammate joined on the last day */
export const MEMBERS = ["Rene Saarikko", "Toivo", "Wilmer"];

/** Team video: your phone clips in order, each with an optional lower-third / tag. Clips go in video/public/team/.
 *  Render: npx remotion render src/index.ts Team out/team.mp4 --props=team.json */
export type Shot = { src: string; from?: number; dur: number; title?: string; sub?: string; tag?: string };
export type TeamProps = { shots: Shot[] };
const FPS = 30, END = 2.5;
const f = (s: number) => Math.round(s * FPS);
export const teamDuration = (p: TeamProps) => p.shots.reduce((a, s) => a + f(s.dur), 0) + f(END);
export const teamDefault: TeamProps = { shots: [
  { src: "team/1-all.mp4", dur: 6, title: "MEET THE TEAM", sub: "Protégé · Hack-Nation Stockholm" },
  { src: "team/2-wilmer.mp4", dur: 10, title: MEMBERS[2], sub: "Critical review + bug fixing" },
  { src: "team/3-rene.mp4", dur: 10, title: MEMBERS[0], sub: "Capture + Teach" },
  { src: "team/4-toivo.mp4", dur: 10, title: MEMBERS[1], sub: "Work Map" },
  { src: "team/5-playful.mp4", dur: 7, tag: "GOOD VIBES ONLY" },
  { src: "team/6-all.mp4", dur: 8 },
] };

const LowerThird: React.FC<{ title: string; sub?: string }> = ({ title, sub }) => {
  const fr = useCurrentFrame();
  const e = spring({ frame: fr - 6, fps: FPS, config: { damping: 200 } });
  return (
    <div style={{ position: "absolute", left: 90, bottom: 110, fontFamily: font, opacity: e, transform: `translateX(${(1 - e) * -40}px)` }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 14, background: "rgba(10,10,10,.85)", border: `1px solid ${C.line}`, borderRadius: 10, padding: "16px 26px", backdropFilter: "blur(8px)" }}>
        <Mark size={36} />
        <div>
          <div style={{ color: C.text, fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</div>
          {sub && <div style={{ color: C.muted, fontSize: 26, marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
};
const Tag: React.FC<{ text: string }> = ({ text }) => {
  const fr = useCurrentFrame();
  const e = spring({ frame: fr - 8, fps: FPS, config: { damping: 9, stiffness: 140 } });
  return <div style={{ position: "absolute", right: 110, top: 110, fontFamily: font, fontSize: 56, fontWeight: 800, color: C.bg, background: C.text, padding: "12px 28px", borderRadius: 10, transform: `rotate(-4deg) scale(${e})` }}>{text}</div>;
};
const EndCard: React.FC = () => {
  const fr = useCurrentFrame();
  const o = interpolate(fr, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ zIndex: 0 }}><Bg />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: font, color: C.text, opacity: o }}>
        <div style={{ display: "flex", alignItems: "center", gap: 26, fontSize: 100, fontWeight: 600, letterSpacing: "-0.04em" }}><Mark size={76} />Protégé</div>
        <div style={{ fontSize: 40, color: C.muted, marginTop: 20 }}>An apprentice, not a recorder.</div>
        <div style={{ fontSize: 26, color: C.muted, marginTop: 36 }}>{MEMBERS.join(" · ")} · ElevenLabs × Hack-Nation</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Team: React.FC<TeamProps> = ({ shots }) => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {shots.map((s, i) => {
        const from = at; at += f(s.dur);
        return (
          <Sequence key={i} from={from} durationInFrames={f(s.dur)}>
            <OffthreadVideo src={staticFile(s.src)} startFrom={f(s.from ?? 0)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {s.title && <LowerThird title={s.title} sub={s.sub} />}
            {s.tag && <Tag text={s.tag} />}
          </Sequence>
        );
      })}
      <Sequence from={at} durationInFrames={f(END)}><EndCard /></Sequence>
    </AbsoluteFill>
  );
};
