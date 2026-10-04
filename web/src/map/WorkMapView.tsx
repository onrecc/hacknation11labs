/**
 * The Work Map screen judges look at (MAP-PLAN.md §5): header stats, flowchart, detail panel, session strip, tabs.
 * Pure view: works with the bundled fixture (/map/demo) or live Firestore data. No LLM in the rendering path.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CaseFacts, Claim, Decision, Event, Gap, Guardrail, Id, Quote as QuoteT, ScreenMoment, Step, WorkMap } from "@shared/schema";
import { LogIndex } from "@shared/logindex";
import { violations } from "@shared/conditions";
import { PROV, agentInstructions, claimsByEvent, conditionText, flowModel, fmtClock, machineGuardrails, quoteParts, type FlowNode } from "./present";
import "./map.css";

export type FrameSource = (sessionId: string, frameId: string) => Promise<string | null>;
type MediaSource = (sessionId: string, uri: string) => Promise<string | null>;
const Sources = createContext<{ frame: FrameSource; media?: MediaSource }>({ frame: async () => null });

type Sel = { kind: "step" | "decision" | "guardrail" | "mistake" | "gap" | "offrecord"; id: Id } | null;
type Tab = "flow" | "guardrails" | "debrief" | "teachback" | "mistakes" | "glossary" | "export";

export function WorkMapView({ wm, events, frameSource, mediaSource, live }: { wm: WorkMap; events: Event[]; frameSource: FrameSource; mediaSource?: MediaSource; live?: boolean }) {
  const [tab, setTab] = useState<Tab>("flow");
  const [sel, setSel] = useState<Sel>(() => (wm.steps[0] ? { kind: "step", id: wm.steps[0].id } : null));
  const ix = useMemo(() => new LogIndex(wm.sourceSessionIds[0] ?? "", events), [wm.sourceSessionIds, events]);
  const corrections = ix.ofType("knowledge.correction").length;
  useEffect(() => {
    const first = wm.steps.length ? { kind: "step" as const, id: [...wm.steps].sort((a, b) => a.order - b.order)[0].id } : null;
    if (!sel) setSel(first);
    else if (sel.kind === "step" && !wm.steps.some((s) => s.id === sel.id)) setSel(first);
  }, [wm, sel]);

  const select = (s: Sel) => {
    setSel(s);
    if (s && (s.kind === "step" || s.kind === "decision" || s.kind === "guardrail" || s.kind === "mistake" || s.kind === "offrecord") && tab !== "flow" && tab !== "guardrails" && tab !== "mistakes") setTab("flow");
  };

  return (
    <Sources.Provider value={{ frame: frameSource, media: mediaSource }}>
      <div className="wm">
        <header className="wm-head">
          <div>
            <h1>{wm.task.title}</h1>
            <div className="muted">Learned from <b>{wm.expert.displayName}</b> · {wm.expert.role}{wm.expert.yearsInRole ? ` · ${wm.expert.yearsInRole} years` : ""}</div>
          </div>
          <StatusBadge wm={wm} live={live} />
        </header>
        <div className="wm-stats">
          <Stat n={wm.steps.length} label="steps" />
          <Stat n={wm.stats.judgmentCalls} label="judgment calls" />
          <Stat n={wm.guardrails.length} label="guardrails" tone="danger" />
          <Stat n={wm.stats.liveQuestions} label="asked while working" />
          <Stat n={wm.stats.debriefQuestions} label="asked in debrief" />
          <Stat n={corrections} label="corrections applied" tone="warn" />
        </div>

        <nav className="wm-tabs">
          {([["flow", "Work Map"], ["guardrails", `Guardrails (${wm.guardrails.length})`], ["debrief", "Debrief & gaps"], ["teachback", "Teach-back"], ["mistakes", `Mistakes (${wm.commonMistakes.length})`], ["glossary", "Glossary"], ["export", "Export for agents"]] as Array<[Tab, string]>).map(([k, l]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>

        {tab === "flow" && (
          <div className="wm-main">
            <Flowchart wm={wm} sel={sel} onSelect={select} />
            <Detail wm={wm} ix={ix} sel={sel} onSelect={select} />
          </div>
        )}
        {tab === "guardrails" && <GuardrailsTab wm={wm} ix={ix} onSelect={select} />}
        {tab === "debrief" && <DebriefTab wm={wm} ix={ix} />}
        {tab === "teachback" && <TeachbackTab wm={wm} />}
        {tab === "mistakes" && <MistakesTab wm={wm} />}
        {tab === "glossary" && <GlossaryTab wm={wm} />}
        {tab === "export" && <ExportTab wm={wm} />}

        <SessionStrip wm={wm} ix={ix} onSelect={select} />
      </div>
    </Sources.Provider>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "danger" | "warn" }) {
  return <div className={`wm-stat ${tone ?? ""}`}><b>{n}</b><span>{label}</span></div>;
}

function StatusBadge({ wm, live }: { wm: WorkMap; live?: boolean }) {
  const label = { draft: "Draft", debrief: "Debrief in progress", teachback_pending: "Waiting for teach-back", confirmed: "Confirmed by expert" }[wm.status];
  return (
    <div className={`wm-status s-${wm.status}`}>
      <span>{wm.status === "confirmed" ? "✓ " : live ? "● " : ""}{label}</span>
      <small>v{wm.version} · updated {wm.updatedAt.slice(11, 16)}</small>
    </div>
  );
}

// ───────────────────────── icons (inline SVG: emoji don't render in every font) ─────────────────────────

const PROV_ICON: Record<string, IconName> = { observed: "eye", stated_live: "mic", stated_debrief: "chat", teachback_correction: "pencil", inferred: "question" };
type IconName = "eye" | "mic" | "chat" | "pencil" | "check" | "question" | "diamond" | "dot";
const ICON_PATHS: Record<IconName, string> = {
  eye: "M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  mic: "M8 1.5a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0v-4a2 2 0 0 0-2-2Z M4 7.5a4 4 0 0 0 8 0 M8 11.5v3 M5.5 14.5h5",
  chat: "M2 3.5h12v7H6l-3 2.5v-2.5H2Z",
  pencil: "M10.5 2.5l3 3-8 8H2.5v-3Z M9 4l3 3",
  check: "M2.5 8.5l3.5 3.5 7.5-8",
  question: "M5.5 6a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7 M8 13v.5",
  diamond: "M8 1.5 14.5 8 8 14.5 1.5 8Z",
  dot: "M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
};
function Icon({ name }: { name: IconName }) {
  return <svg className="ic" viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON_PATHS[name]} /></svg>;
}

// ───────────────────────── flowchart ─────────────────────────

function Flowchart({ wm, sel, onSelect }: { wm: WorkMap; sel: Sel; onSelect: (s: Sel) => void }) {
  const nodes = flowModel(wm);
  if (!nodes.length) return <div className="wm-flow empty card">No steps yet. The map fills in as the expert works.</div>;
  return (
    <div className="wm-flow" aria-label="Work Map flowchart">
      <div className="flow-start">Start: next open {wm.cases[0]?.kind ?? "case"}</div>
      {nodes.map((n, i) => <FlowItem key={`${n.kind}-${n.step.id}-${i}`} n={n} sel={sel} onSelect={onSelect} wm={wm} />)}
      <div className="flow-arrow" />
      <div className="flow-start end">Done: next {wm.cases[0]?.kind ?? "case"}</div>
    </div>
  );
}

function FlowItem({ n, sel, onSelect, wm }: { n: FlowNode; sel: Sel; onSelect: (s: Sel) => void; wm: WorkMap }) {
  if (n.kind === "gate") {
    const next = wm.steps.find((x) => x.order === n.step.order + 1);
    return (
      <>
        <div className="flow-arrow" />
        <button className={`flow-gate ${sel?.kind === "step" && sel.id === n.step.id ? "sel" : ""}`} onClick={() => onSelect({ kind: "step", id: n.step.id })} title="Only some cases go through the next step">
          <span className="gate-ic" aria-hidden><Icon name="diamond" /></span>
          <span className="gate-q">{n.question}</span>
        </button>
        <div className="flow-gate-legs">
          <span className="leg-yes">yes ↓</span>
          <span className="leg-no">no → {next ? `skip to step ${next.order}` : "done"}</span>
        </div>
      </>
    );
  }
  if (n.kind === "branch") {
    return (
      <div className="flow-branch">
        <div className="flow-arrow short" />
        <div className="flow-outcomes">
          {n.outcomes.map((o, i) => (
            <button key={i} className={`flow-outcome ${o.fallback ? "fallback" : ""} ${sel?.kind === "decision" && sel.id === o.decisionId ? "sel" : ""}`} onClick={() => onSelect({ kind: "decision", id: o.decisionId })}>
              <small>{o.when || "otherwise"}</small>
              <b>{o.label}</b>
            </button>
          ))}
        </div>
        <div className="flow-merge" />
      </div>
    );
  }
  const s = n.step;
  const isSel = sel?.kind === "step" && sel.id === s.id;
  return (
    <>
      <div className="flow-arrow" />
      <div className={`flow-step ${isSel ? "sel" : ""} ${s.optional ? "optional" : ""}`}>
        <button className="flow-step-main" onClick={() => onSelect({ kind: "step", id: s.id })}>
          <span className="flow-num">{s.order}</span>
          <span className="flow-title">{s.title}</span>
          <span className="flow-meta">
            {s.provenance.map((p) => <span key={p} className={`pi pi-${p}`} title={PROV[p]?.label}><Icon name={PROV_ICON[p] ?? "dot"} /></span>)}
            {s.history.length > 0 && <span className="pi corr" title="corrected"><Icon name="pencil" /></span>}
            {s.confirmedByExpert && <span className="pi ok" title="confirmed by the expert"><Icon name="check" /></span>}
          </span>
        </button>
        {(n.decisions.length > 0 || n.guardrails.length > 0 || n.mistakes.length > 0) && (
          <div className="flow-tags">
            {n.decisions.map((d) => <button key={d.id} className={`tag-d ${sel?.id === d.id ? "sel" : ""}`} onClick={() => onSelect({ kind: "decision", id: d.id })} title={d.question}>◆ {d.question}</button>)}
            {n.guardrails.map((g) => <button key={g.id} className={`tag-g ${g.severity} ${sel?.id === g.id ? "sel" : ""}`} onClick={() => onSelect({ kind: "guardrail", id: g.id })} title={g.statement}>⛔ {shortRule(g)}</button>)}
            {n.mistakes.map((m) => <button key={m.id} className={`tag-m ${sel?.id === m.id ? "sel" : ""}`} onClick={() => onSelect({ kind: "mistake", id: m.id })} title={m.description}>✗ Don't: {m.description}</button>)}
          </div>
        )}
      </div>
    </>
  );
}

const shortRule = (g: Guardrail) => (g.statement.length > 60 ? g.statement.slice(0, 57) + "…" : g.statement);

// ───────────────────────── detail panel ─────────────────────────

function Detail({ wm, ix, sel, onSelect }: { wm: WorkMap; ix: LogIndex; sel: Sel; onSelect: (s: Sel) => void }) {
  if (!sel) return <aside className="wm-detail card muted">Click a step, decision or guardrail.</aside>;
  if (sel.kind === "offrecord") {
    return (
      <aside className="wm-detail card">
        <div className="kicker">Trust</div>
        <h2>Off the record</h2>
        <p>The expert asked to go off the record here. Nothing was kept: no screen frames, no audio, no transcript, no AI calls. Only the start and end markers exist, and nothing from this span appears anywhere in the Work Map.</p>
        <div className="offrec-big">Nothing kept</div>
      </aside>
    );
  }
  if (sel.kind === "step") {
    const s = wm.steps.find((x) => x.id === sel.id);
    if (!s) return null;
    const decisions = wm.decisions.filter((d) => s.decisionIds.includes(d.id));
    const guardrails = wm.guardrails.filter((g) => s.guardrailIds.includes(g.id));
    return (
      <aside className="wm-detail card">
        <div className="kicker">Step {s.order} of {wm.steps.length}{s.optional ? " · only sometimes" : ""}</div>
        <h2>{s.title}</h2>
        <Moment m={s.screenMoment} caseLabel={caseLabel(wm, ix, s.screenMoment)} />
        <p className="lead">{s.instructions}</p>
        {s.optional && (s.whenText || s.when) && <p className="when">Only when: <b>{s.whenText ?? conditionText(s.when!)}</b></p>}
        <ProvRow c={s} />
        {s.evidence.quotes.map((q, i) => <QuoteView key={i} q={q} wm={wm} corrected={s.history.length > 0} />)}
        {decisions.map((d) => <DecisionBlock key={d.id} d={d} wm={wm} onSelect={onSelect} compact />)}
        {guardrails.map((g) => <GuardrailBlock key={g.id} g={g} wm={wm} compact onSelect={onSelect} />)}
        <History c={s} />
        <Seen wm={wm} ids={s.observedInCases} />
      </aside>
    );
  }
  if (sel.kind === "decision") {
    const d = wm.decisions.find((x) => x.id === sel.id);
    if (!d) return null;
    const step = wm.steps.find((s) => s.id === d.stepId);
    return (
      <aside className="wm-detail card">
        <div className="kicker">Decision{step ? ` · step ${step.order}` : ""} · <KindBadge kind={d.kind} /></div>
        <h2>{d.question}</h2>
        {d.evidence.moments[0] && <Moment m={d.evidence.moments[0]} caseLabel={caseLabel(wm, ix, d.evidence.moments[0])} />}
        <DecisionBlock d={d} wm={wm} onSelect={onSelect} />
      </aside>
    );
  }
  if (sel.kind === "guardrail") {
    const g = wm.guardrails.find((x) => x.id === sel.id);
    if (!g) return null;
    return (
      <aside className="wm-detail card">
        <div className="kicker">Guardrail · {g.kind.replace(/_/g, " ")} · {g.severity === "block" ? "blocks the save" : g.severity}</div>
        <h2 className="danger-text">{g.statement}</h2>
        {g.evidence.moments[0] && <Moment m={g.evidence.moments[0]} caseLabel={caseLabel(wm, ix, g.evidence.moments[0])} />}
        <GuardrailBlock g={g} wm={wm} onSelect={onSelect} />
      </aside>
    );
  }
  if (sel.kind === "mistake") {
    const m = wm.commonMistakes.find((x) => x.id === sel.id);
    if (!m) return null;
    return (
      <aside className="wm-detail card">
        <div className="kicker warn-text">Common mistake · the expert caught herself</div>
        <h2>Don't: {m.description}</h2>
        <Moment m={m.moment} caseLabel={caseLabel(wm, ix, m.moment)} />
        <p className="lead">Do instead: <b>{m.correctBehavior}</b></p>
        <QuoteView q={m.quote} wm={wm} corrected={false} />
        <p className="muted small">The tutor watches for this mistake when a new hire works a similar case.</p>
        <Related wm={wm} ids={m.relatedIds} onSelect={onSelect} />
      </aside>
    );
  }
  return null;
}

function DecisionBlock({ d, wm, onSelect, compact }: { d: Decision; wm: WorkMap; onSelect: (s: Sel) => void; compact?: boolean }) {
  return (
    <section className="blk decision">
      {compact && <h4><button className="link" onClick={() => onSelect({ kind: "decision", id: d.id })}>◆ {d.question}</button> <KindBadge kind={d.kind} /></h4>}
      <p><span className="muted">Chose:</span> <b>{d.observedChoice}</b></p>
      <ul className="options">
        {d.options.map((o) => <li key={o.option}><b>{o.option}</b>{o.whenText ? <span className="muted"> when {o.whenText}</span> : o.when ? <span className="muted"> when {conditionText(o.when)}</span> : null}</li>)}
      </ul>
      <div className="why-label">Why, in {wm.expert.displayName}'s words</div>
      <QuoteView q={d.reason} wm={wm} corrected={d.history.length > 0} big />
      {!compact && <ProvRow c={d} />}
      {!compact && <History c={d} />}
    </section>
  );
}

function GuardrailBlock({ g, wm, compact, onSelect }: { g: Guardrail; wm: WorkMap; compact?: boolean; onSelect: (s: Sel) => void }) {
  return (
    <section className={`blk guardrail-blk ${g.severity}`}>
      {compact && <h4><button className="link danger-text" onClick={() => onSelect({ kind: "guardrail", id: g.id })}>⛔ {g.statement}</button></h4>}
      <dl className="rule">
        <dt>Do instead</dt><dd>{g.requiredAction}</dd>
        {g.escalateTo && <><dt>Ask</dt><dd>{g.escalateTo.name ? `${g.escalateTo.name} (${g.escalateTo.role})` : g.escalateTo.role}</dd></>}
        <dt>Applies to</dt><dd>{g.scope}</dd>
        {g.condition && <><dt>Checked by code</dt><dd>blocks the save when {conditionText(g.condition)}</dd></>}
        {!g.condition && <><dt>Checked by code</dt><dd className="muted">no: shown as a reminder only</dd></>}
      </dl>
      {g.evidence.quotes.map((q, i) => <QuoteView key={i} q={q} wm={wm} corrected={g.history.length > 0} />)}
      {!compact && <ProvRow c={g} />}
      {!compact && <History c={g} />}
    </section>
  );
}

function KindBadge({ kind }: { kind: Decision["kind"] }) {
  const l = { rule: "rule", judgment: "judgment call", habit: "habit (not a rule)", mistake: "mistake", unknown: "unclear" }[kind];
  return <span className={`kind k-${kind}`}>{l}</span>;
}

function ProvRow({ c }: { c: Claim }) {
  return (
    <div className="prov">
      {c.provenance.map((p) => <span key={p} className={`pv pv-${p}`}><Icon name={PROV_ICON[p] ?? "dot"} /> {PROV[p]?.label ?? p}</span>)}
      {c.confirmedByExpert && <span className="pv pv-ok">✓ confirmed by the expert</span>}
    </div>
  );
}

function History({ c }: { c: Claim }) {
  if (!c.history.length) return null;
  return (
    <div className="hist">
      {c.history.map((h) => (
        <div key={h.correctionEventId} className="hist-row">
          <span className="hist-ic">✎</span>
          <div><s>{h.before}</s><br /><b>{h.after}</b><div className="muted small">corrected {h.phase === "capture" ? "while working" : h.phase === "debrief" ? "in the debrief" : h.phase === "teachback" ? "in the teach-back" : h.phase} at {fmtClock(h.at)}</div></div>
        </div>
      ))}
    </div>
  );
}

function Seen({ wm, ids }: { wm: WorkMap; ids: Id[] }) {
  if (!ids.length) return null;
  return <div className="seen">Seen in: {ids.map((id) => { const c = wm.cases.find((x) => x.id === id); return <span key={id} className="chip">{c ? `${c.kind === "invoice" ? "INV-" : ""}${c.key}` : id}{c?.outcome ? ` · ${c.outcome.replace(/_/g, " ")}` : ""}</span>; })}</div>;
}

function Related({ wm, ids, onSelect }: { wm: WorkMap; ids: Id[]; onSelect: (s: Sel) => void }) {
  if (!ids.length) return null;
  return (
    <div className="seen">Related:{" "}
      {ids.map((id) => {
        const g = wm.guardrails.find((x) => x.id === id), d = wm.decisions.find((x) => x.id === id), s = wm.steps.find((x) => x.id === id);
        const label = g ? `⛔ ${shortRule(g)}` : d ? `◆ ${d.question}` : s ? `${s.order}. ${s.title}` : id;
        const kind = g ? "guardrail" : d ? "decision" : "step";
        return <button key={id} className="chip link" onClick={() => onSelect({ kind, id } as Sel)}>{label}</button>;
      })}
    </div>
  );
}

const caseLabel = (wm: WorkMap, ix: LogIndex, m: ScreenMoment) => {
  const e = m.eventIds.map((id) => ix.byId.get(id)).find((x) => x?.caseId);
  const c = wm.cases.find((x) => x.id === e?.caseId) ?? wm.cases.find((x) => x.t <= m.t && m.t <= x.tEnd + 1500);
  return c ? `${c.kind === "invoice" ? "INV-" : ""}${c.key}` : "";
};

// ───────────────────────── evidence: frame + quote ─────────────────────────

export function Moment({ m, caseLabel }: { m: ScreenMoment; caseLabel?: string }) {
  const { frame } = useContext(Sources);
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let ok = true;
    setSrc(undefined);
    frame(m.sessionId, m.frameId).then((u) => ok && setSrc(u), () => ok && setSrc(null));
    return () => void (ok = false);
  }, [m.sessionId, m.frameId, frame]);
  return (
    <figure className="moment">
      <div className="moment-img">
        {src ? <img src={src} alt={`screen at ${fmtClock(m.t)}`} /> : <div className="moment-missing">{src === null ? "frame unavailable" : "loading…"}</div>}
        {src && m.bbox && <div className="moment-box" style={{ left: `${m.bbox.x * 100}%`, top: `${m.bbox.y * 100}%`, width: `${m.bbox.w * 100}%`, height: `${m.bbox.h * 100}%` }} />}
      </div>
      <figcaption>Screen moment {fmtClock(m.t)}{caseLabel ? ` · ${caseLabel}` : ""}<span className="mono muted"> · {m.frameId}</span></figcaption>
    </figure>
  );
}

export function QuoteView({ q, wm, corrected, big }: { q: QuoteT; wm: WorkMap; corrected: boolean; big?: boolean }) {
  const { media } = useContext(Sources);
  const parts = quoteParts(q, corrected);
  const phase = q.phase === "capture" ? (q.questionId ? "answering a live question" : "thinking aloud") : q.phase === "debrief" ? "in the debrief" : q.phase === "teachback" ? "in the teach-back" : q.phase;
  return (
    <blockquote className={`wq ${big ? "big" : ""}`}>
      <p>“{parts.map((p, i) => <span key={i} className={p.style ? `q-${p.style}` : undefined}>{p.text}</span>)}”</p>
      <footer>{wm.expert.displayName} · {phase} · {fmtClock(q.t)}{media && <PlayQuote q={q} />}</footer>
    </blockquote>
  );
}

function PlayQuote({ q }: { q: QuoteT }) {
  void q;
  return null; // audio playback needs mic chunks (none in the fixture); live sessions use the boilerplate Quote player
}

// ───────────────────────── session strip ─────────────────────────

function SessionStrip({ wm, ix, onSelect }: { wm: WorkMap; ix: LogIndex; onSelect: (s: Sel) => void }) {
  const end = Math.max(1, ...ix.events.map((e) => e.tEnd ?? e.t));
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / end) * 100))}%`;
  const phases: Array<{ phase: string; t: number; tEnd: number }> = [];
  let cur = { phase: "capture", t: 0 };
  for (const e of ix.ofType("phase.changed")) {
    phases.push({ ...cur, tEnd: e.t });
    cur = { phase: e.payload.to, t: e.t };
  }
  phases.push({ ...cur, tEnd: end });
  const byEvent = claimsByEvent(wm);
  const pick = (eventIds: Id[]) => {
    for (const e of eventIds) {
      const id = byEvent.get(e);
      if (!id) continue;
      const kind = id.startsWith("gr_") ? "guardrail" : id.startsWith("dec_") ? "decision" : id.startsWith("mis_") ? "mistake" : "step";
      return onSelect({ kind, id } as Sel);
    }
  };
  const questions = ix.ofType("agent.question");
  const answers = ix.ofType("answer.linked");
  const GR = new Set(["guardrail_limit", "exception", "stop_and_ask", "never_do"]);
  return (
    <section className="strip card">
      <div className="strip-head"><b>Session</b><span className="muted small">{fmtClock(end)} · click a marker to see what it taught</span></div>
      <div className="strip-lane phases">
        {phases.filter((p) => p.tEnd > p.t).map((p, i) => <div key={i} className={`ph ph-${p.phase}`} style={{ left: pct(p.t), width: `calc(${pct(p.tEnd)} - ${pct(p.t)})` }}>{p.phase === "capture" ? "working" : p.phase === "teachback" ? "teach-back" : p.phase}</div>)}
      </div>
      <div className="strip-lane cases">
        {wm.cases.map((c) => <div key={c.id} className="cs" style={{ left: pct(c.t), width: `calc(${pct(c.tEnd)} - ${pct(c.t)})` }} title={`${c.key} ${c.outcome ?? ""}`}>{c.kind === "invoice" ? "INV-" : ""}{c.key}{c.outcome ? ` · ${c.outcome.replace(/_/g, " ")}` : ""}</div>)}
        {ix.offRecord.map(([a, b]) => <button key={a} className="off" style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} onClick={() => onSelect({ kind: "offrecord", id: String(a) })} title="Off the record: nothing kept">off record</button>)}
      </div>
      <div className="strip-lane marks">
        {questions.map((q) => {
          const a = answers.find((x) => x.payload.questionId === q.payload.questionId);
          return <button key={q.id} className={`mk q ${GR.has(q.payload.category) ? "gr" : ""} ${q.phase}`} style={{ left: pct(q.t) }} title={`${fmtClock(q.t)} · ${q.phase === "debrief" ? "debrief" : "live"} question [${q.payload.category}]: ${q.payload.text}${a ? `\n→ “${a.payload.quote}”` : ""}`} onClick={() => pick([...q.payload.about.actionIds, ...(a ? [a.id] : [])])}>?</button>;
        })}
        {ix.ofType("knowledge.correction").map((c) => <button key={c.id} className="mk c" style={{ left: pct(c.t) }} title={`${fmtClock(c.t)} · correction (${c.payload.kind.replace(/_/g, " ")}): ${c.payload.before ?? ""} → ${c.payload.after ?? ""}`} onClick={() => pick([c.id])}>✎</button>)}
        {ix.ofType("question.deferred").map((d) => <span key={d.id} className="mk d" style={{ left: pct(d.t) }} title={`${fmtClock(d.t)} · saved for the debrief: ${d.payload.text}`}>⏸</span>)}
        {ix.ofType("teachback.verdict").map((v) => <span key={v.id} className={`mk v ${v.payload.verdict}`} style={{ left: pct(v.t) }} title={`${fmtClock(v.t)} · teach-back ${v.payload.verdict}${v.payload.correction ? `: ${v.payload.correction}` : ""}`}>{v.payload.verdict === "confirmed" ? "✓" : v.payload.verdict === "corrected" ? "✎" : "?"}</span>)}
      </div>
      <div className="strip-legend small muted">
        <span><i className="lg q" /> live question</span><span><i className="lg q gr" /> guardrail question</span><span><i className="lg q debrief" /> debrief question</span>
        <span><i className="lg c" /> correction</span><span>⏸ saved for debrief</span><span>✓ teach-back confirmed</span>
      </div>
    </section>
  );
}

// ───────────────────────── tabs ─────────────────────────

function GuardrailsTab({ wm, ix, onSelect }: { wm: WorkMap; ix: LogIndex; onSelect: (s: Sel) => void }) {
  void ix;
  return (
    <div className="wm-cols">
      <div>
        {wm.guardrails.map((g) => (
          <div key={g.id} className={`card gcard ${g.severity}`}>
            <h3 className="danger-text"><button className="link danger-text" onClick={() => onSelect({ kind: "guardrail", id: g.id })}>⛔ {g.statement}</button></h3>
            <GuardrailBlock g={g} wm={wm} onSelect={onSelect} />
          </div>
        ))}
      </div>
      <TryCase wm={wm} />
    </div>
  );
}

/** "Try a case": the same deterministic engine Teach uses to hold a save. */
function TryCase({ wm }: { wm: WorkMap }) {
  const [f, setF] = useState({ supplier: "Gerätebau Schmidt KG", group: "External", isNew: true, amount: 7200, category: "equipment", costCenter: "4711", assetNo: "", status: "approved", approver: "", month: 12, duplicate: false });
  const facts: CaseFacts = {
    invoice: { key: "TRY", amount: Number(f.amount), currency: "EUR", date: `2026-${String(f.month).padStart(2, "0")}-04`, month: Number(f.month), category: f.category, costCenter: f.costCenter, assetNo: f.assetNo || null, status: f.status, approver: f.approver || null, comment: "", duplicateDeliveryNote: f.duplicate },
    supplier: { name: f.supplier, group: f.group, isNew: f.isNew },
  };
  const hits = violations(wm, facts);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  return (
    <div className="card trycase">
      <h3>Try a case</h3>
      <p className="muted small">The same code the tutor runs before a new hire's save. No AI involved.</p>
      <div className="form">
        <label>Supplier<input value={f.supplier} onChange={set("supplier")} /></label>
        <label>Supplier group<select value={f.group} onChange={set("group")}><option>External</option><option>Intercompany CZ</option></select></label>
        <label>Amount (EUR)<input type="number" value={f.amount} onChange={set("amount")} /></label>
        <label>Category<select value={f.category} onChange={set("category")}><option>equipment</option><option>consumables</option><option>spare_parts</option><option>services</option></select></label>
        <label>Cost center<select value={f.costCenter} onChange={set("costCenter")}><option value="4711">4711 (opex)</option><option value="0400">0400 (capex)</option></select></label>
        <label>Asset number<input value={f.assetNo} onChange={set("assetNo")} placeholder="none" /></label>
        <label>Status on save<select value={f.status} onChange={set("status")}><option value="approved">approved</option><option value="awaiting_approval">awaiting approval</option><option value="on_hold">on hold</option><option value="coded">coded</option></select></label>
        <label>2nd approver<input value={f.approver} onChange={set("approver")} placeholder="none" /></label>
        <label>Month<input type="number" min={1} max={12} value={f.month} onChange={set("month")} /></label>
        <label className="check"><input type="checkbox" checked={f.isNew} onChange={set("isNew")} /> new supplier</label>
        <label className="check"><input type="checkbox" checked={f.duplicate} onChange={set("duplicate")} /> delivery note already paid</label>
      </div>
      <div className={`verdict ${hits.some((h) => h.severity === "block") ? "block" : hits.length ? "warn" : "ok"}`}>
        {hits.length === 0 ? "✓ Save allowed: no guardrail fires." : <>⛔ Save held: {hits.map((h) => <div key={h.id}><b>{h.statement}</b> → {h.requiredAction}</div>)}</>}
      </div>
    </div>
  );
}

function DebriefTab({ wm, ix }: { wm: WorkMap; ix: LogIndex }) {
  const open = wm.gaps.filter((g) => g.status === "open" && g.priority >= 0.5).length;
  const asked = ix.ofType("agent.question").filter((q) => q.phase === "debrief");
  const answers = ix.ofType("answer.linked");
  return (
    <div className="wm-cols">
      <div className="card">
        <h3>How the debrief knows it's done</h3>
        <div className="meter"><div className="meter-n">{open}</div><div>open gaps that matter<br /><span className="muted small">priority ≥ 0.5 · started with {wm.gaps.filter((g) => g.priority >= 0.5).length}</span></div></div>
        <p>The apprentice keeps asking, most important first, until <b>no open gap with priority ≥ 0.5 is left</b>, the expert says they're done, or it has asked 8 questions. Then it explains everything back (the teach-back) until the expert confirms.</p>
        <p className="muted small">It never repeats a question already answered while working. Questions it held back while the expert was busy are asked here first.</p>
      </div>
      <div>
        {wm.gaps.map((g) => <GapCard key={g.id} g={g} ix={ix} asked={asked.find((q) => q.payload.gapId === g.id)} answers={answers} wm={wm} />)}
        {!wm.gaps.length && <p className="muted">No gaps recorded.</p>}
      </div>
    </div>
  );
}

function GapCard({ g, asked, answers, wm }: { g: Gap; ix: LogIndex; asked?: Extract<Event, { type: "agent.question" }>; answers: Array<Extract<Event, { type: "answer.linked" }>>; wm: WorkMap }) {
  const a = asked ? answers.find((x) => x.payload.questionId === asked.payload.questionId) : undefined;
  const label: Record<Gap["kind"], string> = { unexplained_action: "unexplained action", unknown_scope: "scope", missing_threshold: "missing number", unseen_case: "unseen case", conflict: "rules in conflict", low_confidence: "rule or habit?", deferred_question: "saved while working", who_decides: "who decides" };
  return (
    <div className={`card gap g-${g.status}`}>
      <div className="gap-top"><span className="chip">{label[g.kind]}</span><span className="prio" title={`priority ${g.priority}`}><i style={{ width: `${g.priority * 100}%` }} /></span><span className={`gst ${g.status}`}>{g.status === "resolved" ? "✓ resolved" : g.status}</span></div>
      <p className="gap-q">“{asked?.payload.text ?? g.proposedQuestion}”</p>
      {a && <p className="gap-a">→ <i>“{a.payload.quote}”</i> <span className="muted small">· {wm.expert.displayName}</span></p>}
      {!a && <p className="muted small">{g.description}</p>}
    </div>
  );
}

function TeachbackTab({ wm }: { wm: WorkMap }) {
  const tb = wm.teachBack;
  return (
    <div className="wm-cols">
      <div className="card">
        <h3>How the teach-back proves it</h3>
        <p>The apprentice explains the whole process back in its own words, one part at a time, and asks "is that right?" after each. A correction changes the Work Map and the part is said again until confirmed. Only an explicit final "yes" confirms the map.</p>
        <div className={`tb-final ${tb.status}`}>
          {tb.status === "confirmed" && tb.confirmationQuote ? <>✓ “{tb.confirmationQuote.text}” <span className="muted small">· {wm.expert.displayName} · {fmtClock(tb.confirmationQuote.t)}</span></> : tb.status === "in_progress" ? "In progress" : "Not done yet"}
        </div>
      </div>
      <div>
        {tb.segments.map((s, i) => (
          <div key={s.id} className={`card tbseg v-${s.verdict ?? "none"}`}>
            <div className="tbseg-top"><b>Part {i + 1}</b><span className={`gst ${s.verdict ?? ""}`}>{s.verdict === "confirmed" ? "✓ confirmed" : s.verdict === "corrected" ? "✎ corrected, then confirmed" : s.verdict ?? "not asked"}</span></div>
            <p>{s.text}</p>
            {s.verdict === "corrected" && <TbCorrection wm={wm} stepIds={s.stepIds} />}
          </div>
        ))}
        {!tb.segments.length && <p className="muted">The teach-back hasn't happened yet.</p>}
      </div>
    </div>
  );
}

function TbCorrection({ wm, stepIds }: { wm: WorkMap; stepIds: Id[] }) {
  const claims: Array<Step | Decision | Guardrail> = [...wm.steps.filter((s) => stepIds.includes(s.id)), ...wm.decisions.filter((d) => stepIds.includes(d.stepId)), ...wm.guardrails.filter((g) => g.stepIds.some((s) => stepIds.includes(s)))];
  const h = claims.flatMap((c) => c.history).find((x) => x.phase === "teachback");
  if (!h) return null;
  return <div className="hist-row"><span className="hist-ic">✎</span><div><s>{h.before}</s><br /><b>{h.after}</b></div></div>;
}

function MistakesTab({ wm }: { wm: WorkMap }) {
  if (!wm.commonMistakes.length) return <p className="muted card">No mistakes caught in this session.</p>;
  return (
    <div className="wm-cols">
      {wm.commonMistakes.map((m) => (
        <div key={m.id} className="card mcard">
          <div className="kicker warn-text">The expert caught herself</div>
          <h3>Don't: {m.description}</h3>
          <p>Do instead: <b>{m.correctBehavior}</b></p>
          <Moment m={m.moment} />
          <QuoteView q={m.quote} wm={wm} corrected={false} />
        </div>
      ))}
    </div>
  );
}

function GlossaryTab({ wm }: { wm: WorkMap }) {
  return (
    <div className="card">
      <table className="grid"><tbody>{wm.glossary.map((g) => <tr key={g.term}><td><b>{g.term}</b></td><td>{g.meaning}</td></tr>)}</tbody></table>
      {!wm.glossary.length && <p className="muted">No terms yet.</p>}
    </div>
  );
}

function ExportTab({ wm }: { wm: WorkMap }) {
  const md = agentInstructions(wm);
  const json = JSON.stringify(machineGuardrails(wm), null, 2);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (k: string, s: string) => void navigator.clipboard.writeText(s).then(() => { setCopied(k); setTimeout(() => setCopied(null), 1500); });
  const download = (name: string, s: string, type: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([s], { type }));
    a.download = name;
    a.click();
  };
  return (
    <div className="wm-cols">
      <div className="card">
        <h3>Agent-ready instructions</h3>
        <p className="muted small">People first, then agents: the same steps and stop rules that teach a new hire, as instructions an AI agent can load. It stops where {wm.expert.displayName} would stop.</p>
        <div className="btns"><button onClick={() => copy("md", md)}>{copied === "md" ? "Copied" : "Copy markdown"}</button><button onClick={() => download(`${wm.id}-procedure.md`, md, "text/markdown")}>Download .md</button></div>
        <pre className="export">{md}</pre>
      </div>
      <div className="card">
        <h3>Machine-checkable guardrails</h3>
        <p className="muted small">Violation predicates over the case facts. An agent (or our tutor) evaluates these before saving.</p>
        <div className="btns"><button onClick={() => copy("json", json)}>{copied === "json" ? "Copied" : "Copy JSON"}</button><button onClick={() => download(`${wm.id}-guardrails.json`, json, "application/json")}>Download .json</button><button onClick={() => download(`${wm.id}-v${wm.version}.json`, JSON.stringify(wm, null, 2), "application/json")}>Full Work Map JSON</button></div>
        <pre className="export">{json}</pre>
      </div>
    </div>
  );
}
