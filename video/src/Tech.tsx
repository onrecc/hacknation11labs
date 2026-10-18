import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { Bg, C, Caption, Mark, font, type Words } from "./Product";
import { FadeOut } from "./Demo";
import t1 from "../public/t1.json";
import t2 from "../public/t2.json";
import t3 from "../public/t3.json";
import t4 from "../public/t4.json";
import events from "../public/events.json";

/** card cues = when the narration says it */
const at = (d: Words, w: string) => d.words.find((x) => x.w.startsWith(w))?.s ?? 0;
const FPS = 30;
const f = (s: number) => Math.round(s * FPS);
const mono = "'SF Mono', Menlo, ui-monospace, monospace";
const GAP = 0.35;
const S = [t1, t2, t3, t4].map((t) => t.dur + GAP);
const END = 2.2;
export const techDuration = () => f(S.reduce((a, b) => a + b, 0) + END);
const T3 = { voice: at(t3 as Words, "voice"), firefox: at(t3 as Words, "Firefox"), transcripts: at(t3 as Words, "redaction") };
const fade = (fr: number, a = 0, d = 10) => interpolate(fr, [a, a + d], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

const Title: React.FC<{ n: string; children: React.ReactNode }> = ({ n, children }) => {
  const fr = useCurrentFrame();
  return (
    <div style={{ position: "absolute", top: 54, left: 120, fontFamily: font, color: C.text, display: "flex", gap: 14, alignItems: "center", opacity: fade(fr) }}>
      <span style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: "2px 12px", color: C.muted, fontSize: 20 }}>{n}</span>
      <span style={{ fontSize: 40, fontWeight: 650, letterSpacing: "-0.02em" }}>{children}</span>
    </div>
  );
};
const Card: React.FC<{ style?: React.CSSProperties; children: React.ReactNode; delay?: number }> = ({ style, children, delay = 0 }) => {
  const fr = useCurrentFrame();
  const e = spring({ frame: fr - delay, fps: FPS, config: { damping: 200 } });
  return <div style={{ position: "absolute", background: C.subtle, border: `1px solid ${C.line}`, borderRadius: 12, fontFamily: font, color: C.text, opacity: e, transform: `translateY(${(1 - e) * 24}px)`, ...style }}>{children}</div>;
};
/** the meaningful events in full white, the plumbing in grey; a correction in the app's red */
const TYPE_COLOR: Record<string, string> = { utterance: C.text, "agent.question": C.text, "agent.turn": C.text, "knowledge.correction": C.red, "answer.linked": C.text, "pause.detected": C.text, "screen.action": C.text, "app.event": C.text };

/** 1 · the append-only event log, real events from the demo session */
const LogScene: React.FC = () => {
  const fr = useCurrentFrame();
  const shown = Math.min(events.length, Math.floor(fr / 6.8) + 1);
  const rows = events.slice(Math.max(0, shown - 17), shown);
  return (
    <AbsoluteFill>
      <Title n="1">One append-only event log</Title>
      <Card style={{ left: 120, top: 150, width: 1040, height: 740, padding: "18px 0", overflow: "hidden" }}>
        <div style={{ padding: "0 24px 12px", color: C.muted, fontSize: 18, borderBottom: `1px solid ${C.line}`, fontFamily: mono }}>events.jsonl · ses_demo_sabine_01 · {shown} / 1,000+</div>
        {rows.map((e, i) => (
          <div key={e.t + e.type + i} style={{ display: "flex", gap: 18, padding: "9px 24px", fontFamily: mono, fontSize: 19, opacity: i === rows.length - 1 ? fade(fr % 6.8 + 6, 0, 4) : 1, borderBottom: "1px solid rgba(255,255,255,.04)" }}>
            <span style={{ color: C.muted, width: 78, textAlign: "right" }}>{(e.t / 1000).toFixed(1)}s</span>
            <span style={{ color: TYPE_COLOR[e.type] ?? C.faint, width: 270 }}>{e.type}</span>
            <span style={{ color: "#d0d0d0", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.type === "redaction.applied" ? "IBAN masked" : e.d}</span>
          </div>
        ))}
      </Card>
      {[
        { y: 150, d: f(at(t1 as Words, "Scribe")), h: "Scribe", s: "ElevenLabs · word timestamps", c: C.ok },
        { y: 330, d: f(at(t1 as Words, "interviewer")), h: "Interviewer agent", s: "ElevenAgents · speaks only at real pauses", c: C.ok },
        { y: 510, d: f(at(t1 as Words, "tutor")), h: "Tutor agent", s: "ElevenAgents · same log on the new hire's screen", c: C.ok },
      ].map((b) => (
        <Card key={b.h} delay={b.d} style={{ left: 1200, top: b.y, width: 600, padding: "26px 30px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ width: 12, height: 12, borderRadius: 6, background: b.c }} /><b style={{ fontSize: 30 }}>{b.h}</b></div>
          <div style={{ color: C.muted, fontSize: 22, marginTop: 8 }}>{b.s}</div>
        </Card>
      ))}
    </AbsoluteFill>
  );
};

const CODE = `const quoteFor = (uid, text, where) => {
  const q = verbatimQuote(ix, [uid], text);
  if (!q) problems.push({ where,
    problem: \`quote not verbatim in \${uid}\` });
  ...
if (!quotes.length) {
  problems.push({ where,
    problem: "dropped: no verbatim quote in the expert's words" });
  continue;
}
if (!moments.length) {
  problems.push({ where,
    problem: "dropped: no screen moment (every step needs one)" });`;

/** 2 · Claude proposes, code verifies */
const TrustScene: React.FC = () => {
  const fr = useCurrentFrame();
  const checks: [string, boolean, number][] = [
    ["Quote matches the transcript word for word", true, at(t2 as Words, "quote")],
    ["Screen moment points to a real frame", true, at(t2 as Words, "screen")],
    ["Guardrail is a checkable condition", true, at(t2 as Words, "guardrail")],
    ["Anything unverifiable", false, at(t2 as Words, "Anything")],
  ];
  const mapIn = f(at(t2 as Words, "Then"));
  return (
    <AbsoluteFill>
      <Title n="2">What worked: Claude proposes, our code verifies</Title>
      <Card style={{ left: 120, top: 160, width: 760, padding: "28px 32px" }}>
        <div style={{ color: C.muted, fontSize: 22, marginBottom: 18 }}>Every claim in the Work Map</div>
        {checks.map(([txt, ok, at]) => (
          <div key={txt} style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 30, padding: "12px 0", opacity: fade(fr, f(at)) }}>
            <span style={{ width: 40, height: 40, borderRadius: 20, display: "grid", placeItems: "center", background: C.soft, color: ok ? C.ok : C.red, fontWeight: 700 }}>{ok ? "✓" : "✕"}</span>
            <span style={{ textDecoration: ok ? undefined : "line-through", color: ok ? C.text : C.muted }}>{txt}</span>
            {!ok && <span style={{ color: C.red, fontSize: 26 }}>dropped</span>}
          </div>
        ))}
      </Card>
      <div style={{ position: "absolute", left: 940, top: 160, width: 860, height: 760, opacity: 1 - fade(fr, mapIn - 6, 10) }}>
        <Card style={{ left: 0, top: 0, width: 860, padding: "18px 0" }} delay={f(1)}>
          <div style={{ padding: "0 24px 12px", color: C.muted, fontSize: 18, borderBottom: `1px solid ${C.line}`, fontFamily: mono }}>shared/workmap.ts · assemble()</div>
          <pre style={{ margin: 0, padding: "16px 24px", fontFamily: mono, fontSize: 19, lineHeight: 1.5, color: "#d6d6d6", whiteSpace: "pre-wrap" }}>{CODE}</pre>
        </Card>
      </div>
      <Sequence from={mapIn}>
        <Card style={{ left: 940, top: 160, width: 860, height: Math.round(860 * 0.625) + 40, overflow: "hidden" }}>
          <div style={{ height: 40, display: "flex", alignItems: "center", padding: "0 16px", gap: 7, borderBottom: `1px solid ${C.line}` }}>{[0, 1, 2].map((c) => <span key={c} style={{ width: 11, height: 11, borderRadius: 6, background: C.lineStrong }} />)}<span style={{ marginLeft: 12, color: C.muted, fontSize: 16 }}>Work Map · re-confirmed by Sabine</span></div>
          <OffthreadVideo src={staticFile("03-workmap.mp4")} muted style={{ width: 860, height: Math.round(860 * 0.625) }} />
        </Card>
      </Sequence>
    </AbsoluteFill>
  );
};

/** 3 · what didn't work, said plainly */
const HonestScene: React.FC = () => (
  <AbsoluteFill>
    <Title n="3">What didn't work</Title>
    {[
      ["Voice tested with a synthetic mic", "not yet in a real, noisy room", T3.voice],
      ["Firefox build not tested end to end", "Chrome is", T3.firefox],
      ["Redaction is rule-based", "IBANs, emails, phone and card numbers are caught; names only from a list", T3.transcripts],
    ].map(([h, s, at], i) => (
      <Card key={h as string} delay={f(at as number)} style={{ left: 120, top: 190 + i * 210, width: 1680, padding: "30px 36px" }}>
        <div style={{ fontSize: 38, fontWeight: 600 }}>{h}</div>
        <div style={{ fontSize: 26, color: C.muted, marginTop: 8 }}>{s}</div>
      </Card>
    ))}
  </AbsoluteFill>
);

const StackScene: React.FC = () => {
  const fr = useCurrentFrame();
  const items = ["React + Vite", "Firebase", "Cloud Functions", "Chrome extension", "ElevenLabs Agents + Scribe", "Claude Sonnet / Opus"];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: font, color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 76, fontWeight: 600, letterSpacing: "-0.04em", marginBottom: 14, opacity: fade(fr) }}><Mark size={58} />Protégé</div>
      <div style={{ fontSize: 30, color: C.muted, marginBottom: 34, opacity: fade(fr) }}>built with</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, justifyContent: "center", width: 1400 }}>
        {items.map((s, i) => <span key={s} style={{ fontSize: 40, fontWeight: 600, border: `1px solid ${C.line}`, borderRadius: 8, padding: "14px 30px", background: C.subtle, opacity: fade(fr, 4 + i * 5), color: C.text }}>{s}</span>)}
      </div>
    </AbsoluteFill>
  );
};

export const Tech: React.FC = () => {
  const starts = S.reduce<number[]>((a, d, i) => [...a, i ? a[i - 1] + S[i - 1] : 0], []);
  const scenes = [LogScene, TrustScene, HonestScene, StackScene];
  const vo = [t1, t2, t3, t4];
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Bg />
      {scenes.map((Scene, i) => (
        <Sequence key={i} from={f(starts[i])} durationInFrames={f(S[i] + (i === 3 ? END : 0))}>
          <AbsoluteFill><Scene /></AbsoluteFill>
          <Sequence from={f(0.15)}><Audio src={staticFile(`t${i + 1}.mp3`)} /><Caption data={vo[i] as Words} /></Sequence>
          {i === 3 && <FadeOut len={f(S[i] + END)} />}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
