/**
 * The Work Map screen (MAP-PLAN.md §5). Calm, monochrome, progressive disclosure: a summary card, four tabs,
 * a quiet step list and one detail panel. Color is reserved for status (rules = red dot, confirmed = green dot).
 * Pure view: works with the bundled fixture (/map/demo) or live Firestore data. No LLM in the rendering path.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CaseFacts, Claim, Decision, Event, Gap, Guardrail, Id, Quote as QuoteT, ScreenMoment, Step, WorkMap } from "@shared/schema";
import { LogIndex } from "@shared/logindex";
import { violations } from "@shared/conditions";
import { PROV, agentInstructions, claimsByEvent, conditionText, flowModel, fmtClock, machineGuardrails, quoteParts, type FlowNode } from "./present";
import "./map.css";

export type FrameSource = (sessionId: string, frameId: string) => Promise<string | null>;
type MediaSource = (sessionId: string, uri: string) => Promise<string | null>;
const Sources = createContext<{ frame: FrameSource; media?: MediaSource }>({ frame: async () => null });

type Sel = { kind: "step" | "decision" | "guardrail" | "mistake" | "offrecord"; id: Id } | null;
type Tab = "map" | "rules" | "debrief" | "export";

export function WorkMapView({ wm, events, frameSource, mediaSource, live, actions, footer }: {
  wm: WorkMap; events: Event[]; frameSource: FrameSource; mediaSource?: MediaSource; live?: boolean; actions?: ReactNode; footer?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("map");
  const [sel, setSel] = useState<Sel>(null);
  const ix = useMemo(() => new LogIndex(wm.sourceSessionIds[0] ?? "", events), [wm.sourceSessionIds, events]);
  const ordered = useMemo(() => [...wm.steps].sort((a, b) => a.order - b.order), [wm.steps]);
  useEffect(() => {
    // open on the strongest moment: a step whose quote shows the expert correcting herself, else any quoted step
    const selfCorrected = (st: Step) => { const q = stepQuote(wm, st); return !!q && stepCorrected(wm, st) && quoteParts(q, true).some((p) => p.style === "struck"); };
    const spoken = ordered.find(selfCorrected) ?? ordered.find((st) => !!stepQuote(wm, st));
    const first = (spoken ?? ordered[0]) ? { kind: "step" as const, id: (spoken ?? ordered[0]).id } : null;
    if (!sel) setSel(first);
    else if (sel.kind === "step" && !wm.steps.some((s) => s.id === sel.id)) setSel(first);
  }, [wm, sel, ordered]);
  const select = (s: Sel) => {
    setSel(s);
    setTab("map");
  };

  return (
    <Sources.Provider value={{ frame: frameSource, media: mediaSource }}>
      <div className="wm">
        <header className="wm-titlebar">
          <div className="wm-title">
            <h1>{wm.task.title}</h1>
            <MetaLine wm={wm} ix={ix} live={live} />
          </div>
          <div className="wm-actions">
            {actions}
            <Link className="btn primary" to="/teach">Open in Teach</Link>
          </div>
        </header>
        <nav className="wm-tabs" role="tablist">
          {([["map", "Steps"], ["rules", "Rules"], ["debrief", "Debrief"], ["export", "Export"]] as Array<[Tab, string]>).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {l}
              {k === "rules" && <span className="count">{wm.guardrails.length}</span>}
            </button>
          ))}
        </nav>

        {tab === "map" && (
          <>
            <div className="wm-main">
              <StepList wm={wm} sel={sel} onSelect={setSel} />
              <Detail wm={wm} ix={ix} sel={sel} onSelect={setSel} />
            </div>
          </>
        )}
        {tab === "rules" && <RulesTab wm={wm} onSelect={select} />}
        {tab === "debrief" && <DebriefTab wm={wm} ix={ix} onSelect={select} />}
        {tab === "export" && <ExportTab wm={wm} />}
        {footer && tab === "export" && <div className="wm-footer">{footer}</div>}
      </div>
    </Sources.Provider>
  );
}

// ───────────────────────── header + summary card ─────────────────────────

function MetaLine({ wm, ix, live }: { wm: WorkMap; ix: LogIndex; live?: boolean }) {
  const corrections = ix.ofType("knowledge.correction").length;
  const duration = Math.max(0, ...ix.events.map((e) => e.tEnd ?? e.t));
  const status = { draft: "Draft", debrief: "In debrief", teachback_pending: "Awaiting teach-back", confirmed: "Confirmed" }[wm.status];
  const tone = wm.status === "confirmed" ? "ok" : live ? "live" : "pending";
  const n = wm.cases.length;
  return (
    <p className="wm-metaline">
      <span className="status"><span className={`wdot ${tone}`} />{status}</span>
      <span>{wm.expert.displayName}, {wm.expert.role}</span>
      <span>{n} {wm.cases[0]?.kind ?? "case"}{n === 1 ? "" : "s"} in a {Math.max(1, Math.round(duration / 60000))} min session</span>
      <span>{corrections} corrections</span>
      <span>v{wm.version}</span>
    </p>
  );
}

// ───────────────────────── step list (the flow) ─────────────────────────

function StepList({ wm, sel, onSelect }: { wm: WorkMap; sel: Sel; onSelect: (s: Sel) => void }) {
  const ordered = [...wm.steps].sort((a, b) => a.order - b.order);
  const activeStep = sel?.kind === "step" ? sel.id : sel?.kind === "decision" ? wm.decisions.find((d) => d.id === sel.id)?.stepId : sel?.kind === "guardrail" ? wm.guardrails.find((g) => g.id === sel.id)?.stepIds[0] : undefined;
  return (
    <section className="panel">
      {!ordered.length && <p className="pad dim">No steps yet. The map fills in as the expert works.</p>}
      <ol className="wm-steps">
        {ordered.map((s) => (
          <li key={s.id} className={`st ${activeStep === s.id ? "on" : ""}`}>
            <button onClick={() => onSelect({ kind: "step", id: s.id })}>
              <span className="st-num">{s.order}</span>
              <span className="st-title">{s.title}{s.optional && <span className="st-opt">optional</span>}</span>
              <span className="st-marks">
                {stepQuote(wm, s) && <span className="mk-quote" title={`${firstName(wm)} explained this step`}>“</span>}
                {stepCorrected(wm, s) && <span className="mk-corr" title="Corrected by the expert" />}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {ordered.length > 0 && <div className="st-key"><span><span className="mk-quote">“</span>{firstName(wm)} explained why</span><span><span className="mk-corr" />Corrected by {firstName(wm)}</span></div>}
    </section>
  );
}

// ───────────────────────── detail panel ─────────────────────────

function Detail({ wm, ix, sel, onSelect }: { wm: WorkMap; ix: LogIndex; sel: Sel; onSelect: (s: Sel) => void }) {
  let body: ReactNode = <p className="dim">Select a step.</p>;
  if (sel?.kind === "offrecord") {
    body = (
      <>
        <Kicker>Off the record</Kicker>
        <h2>Nothing was kept here</h2>
        <p className="lead">The expert paused recording. No screen, audio or transcript exists for this span, and nothing from it appears in the Work Map.</p>
      </>
    );
  } else if (sel?.kind === "step") {
    const s = wm.steps.find((x) => x.id === sel.id);
    if (s) {
      const decisions = wm.decisions.filter((d) => s.decisionIds.includes(d.id) && d.stepId === s.id);
      const rules = wm.guardrails.filter((g) => s.guardrailIds.includes(g.id));
      const why = stepQuote(wm, s);
      const whyCorrected = stepCorrected(wm, s);
      const showDesc = overlap(s.title, s.instructions) < 0.6;
      const decisionText = decisions.flatMap((d) => d.options.map((o) => `${o.option} ${o.whenText ?? ""}`)).join(" ");
      const extraRules = rules.filter((g) => !decisionText || overlap(g.statement, decisionText) < 0.5);
      body = (
        <>
          <div className="detail-head">
            <Kicker>Step {s.order} of {wm.steps.length}{s.optional && s.whenText ? ` · only if: ${s.whenText}` : ""}</Kicker>
            <h2>{s.title}</h2>
            {showDesc && <p className="lead">{s.instructions}</p>}
          </div>
          {why && <Quote q={why} corrected={whyCorrected} who={firstName(wm)} />}
          <Frame m={s.screenMoment} caption={caseLabel(wm, ix, s.screenMoment)} />
          {decisions.map((d) => <DecisionBlock key={d.id} d={d} onOpen={() => onSelect({ kind: "decision", id: d.id })} />)}
          {extraRules.length > 0 && (
            <ul className="rows">
              {extraRules.map((g) => <li key={g.id}><button onClick={() => onSelect({ kind: "guardrail", id: g.id })}><span className="row-kicker">Rule</span><span className="row-main">{g.statement}</span><Chevron /></button></li>)}
            </ul>
          )}
        </>
      );
    }
  } else if (sel?.kind === "decision") {
    const d = wm.decisions.find((x) => x.id === sel.id);
    const step = d && wm.steps.find((s) => s.id === d.stepId);
    if (d) {
      body = (
        <>
          <Back step={step} onSelect={onSelect} />
          <Kicker>Decision · {kindLabel(d.kind)}</Kicker>
          <h2>{d.question}</h2>
          {d.evidence.moments[0] && <Frame m={d.evidence.moments[0]} caption={caseLabel(wm, ix, d.evidence.moments[0])} />}
          <Field label="Options">
            <ul className="opts">{d.options.map((o) => <li key={o.option}><span>{o.option}</span><span className="dim">{o.whenText ?? (o.when ? conditionText(o.when) : "otherwise")}</span></li>)}</ul>
          </Field>
          <Quote q={d.reason} corrected={d.history.length > 0} who={firstName(wm)} />
          <Confirmed c={d} wm={wm} history />
        </>
      );
    }
  } else if (sel?.kind === "guardrail") {
    const g = wm.guardrails.find((x) => x.id === sel.id);
    const step = g && wm.steps.find((s) => g.stepIds.includes(s.id));
    if (g) body = (
      <>
        <Back step={step} onSelect={onSelect} />
        <Kicker>Rule · {g.severity === "block" ? "blocks the save" : "reminder"}</Kicker>
        <h2>{g.statement}</h2>
        {g.evidence.moments[0] && <Frame m={g.evidence.moments[0]} caption={caseLabel(wm, ix, g.evidence.moments[0])} />}
        <RuleFacts g={g} />
        {g.evidence.quotes[0] && <Quote q={g.evidence.quotes[0]} corrected={g.history.length > 0} who={firstName(wm)} />}
        <Confirmed c={g} wm={wm} history />
      </>
    );
  } else if (sel?.kind === "mistake") {
    const m = wm.commonMistakes.find((x) => x.id === sel.id);
    if (m) body = (
      <>
        <Kicker>Common mistake</Kicker>
        <h2>{m.description}</h2>
        <Frame m={m.moment} caption={caseLabel(wm, ix, m.moment)} />
        <Field label="Do instead">{m.correctBehavior}</Field>
        <Quote q={m.quote} corrected={false} who={firstName(wm)} />
      </>
    );
  }
  return <aside className="wm-detail" aria-live="polite">{body}</aside>;
}

function DecisionBlock({ d, onOpen }: { d: Decision; onOpen: () => void }) {
  return (
    <section className="decision">
      <button className="decision-q" onClick={onOpen}><span>{d.question}</span><span className="dim">{kindLabel(d.kind)}</span><Chevron /></button>
      <ul>{d.options.map((o) => <li key={o.option}><span>{o.option}</span><span className="dim">{o.whenText ?? (o.when ? conditionText(o.when) : "otherwise")}</span></li>)}</ul>
    </section>
  );
}

function RuleFacts({ g }: { g: Guardrail }) {
  return (
    <dl className="facts">
      <div><dt>Do instead</dt><dd>{g.requiredAction}</dd></div>
      {g.escalateTo && <div><dt>Ask</dt><dd>{g.escalateTo.name ? `${g.escalateTo.name}, ${g.escalateTo.role}` : g.escalateTo.role}</dd></div>}
      <div><dt>Applies to</dt><dd>{g.scope}</dd></div>
      <div><dt>Enforced</dt><dd>{g.condition ? <>Save is held when {conditionText(g.condition)}</> : <span className="dim">Not checkable by code; shown as a reminder</span>}</dd></div>
    </dl>
  );
}

function Back({ step, onSelect }: { step?: Step; onSelect: (s: Sel) => void }) {
  if (!step) return null;
  return <button className="back" onClick={() => onSelect({ kind: "step", id: step.id })}>← Step {step.order}: {step.title}</button>;
}

function Confirmed({ c, wm, history }: { c: Claim; wm: WorkMap; history?: boolean }) {
  void wm;
  if (!(history && c.history.length)) return null;
  return (
    <div className="prov">
      {history && c.history.map((h) => <div key={h.correctionEventId} className="prov-edit">Corrected: <s>{h.before}</s> → {h.after}</div>)}
    </div>
  );
}

// ───────────────────────── small parts ─────────────────────────

const Kicker = ({ children }: { children: ReactNode }) => <div className="kicker">{children}</div>;
const Field = ({ label, children }: { label: string; children: ReactNode }) => <section className="field"><h3>{label}</h3><div>{children}</div></section>;
const Chevron = () => <svg className="chev" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M6 3.5 10.5 8 6 12.5" /></svg>;
const firstName = (wm: WorkMap) => wm.expert.displayName.split(" ")[0];
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
/** The expert's own words for a step: its decision's reason, else its rule's quote, else the step's own quote. */
function stepQuote(wm: WorkMap, s: Step): QuoteT | undefined {
  const d = wm.decisions.find((x) => s.decisionIds.includes(x.id) && x.stepId === s.id);
  const g = wm.guardrails.find((x) => s.guardrailIds.includes(x.id) && x.evidence.quotes.length);
  return d?.reason ?? g?.evidence.quotes[0] ?? s.evidence.quotes[0];
}
function stepCorrected(wm: WorkMap, s: Step): boolean {
  const d = wm.decisions.find((x) => s.decisionIds.includes(x.id) && x.stepId === s.id);
  const g = wm.guardrails.find((x) => s.guardrailIds.includes(x.id) && x.evidence.quotes.length);
  return ((d ?? g ?? s).history.length ?? 0) > 0;
}
/** Share of the shorter text's words that also appear in the other (hides descriptions that just restate the title). */
const overlap = (a: string, b: string) => {
  const w = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((x) => x.length > 2));
  const A = w(a), B = w(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((x) => B.has(x) && n++);
  return n / Math.min(A.size, B.size);
};
const kindLabel = (k: Decision["kind"]) => ({ rule: "Rule", judgment: "Judgment call", habit: "Habit", mistake: "Mistake", unknown: "Unclear" })[k];
const caseLabel = (wm: WorkMap, ix: LogIndex, m: ScreenMoment) => {
  const e = m.eventIds.map((id) => ix.byId.get(id)).find((x) => x?.caseId);
  const c = wm.cases.find((x) => x.id === e?.caseId) ?? wm.cases.find((x) => x.t <= m.t && m.t <= x.tEnd + 1500);
  return `${fmtClock(m.t)}${c ? ` · ${c.kind === "invoice" ? "INV-" : ""}${c.key}` : ""}`;
};

export function Frame({ m, caption, zoom: zoomIn = 1.3, crop: cropH = 280 }: { m: ScreenMoment; caption?: string; zoom?: number; crop?: number }) {
  const { frame } = useContext(Sources);
  const [full, setFull] = useState(false);
  const zoom = m.bbox && !full ? zoomIn : 1;
  const crop = full ? 0 : cropH;
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => setFull(false), [m.frameId]);
  useEffect(() => {
    let ok = true;
    setSrc(undefined);
    frame(m.sessionId, m.frameId).then((u) => ok && setSrc(u), () => ok && setSrc(null));
    return () => void (ok = false);
  }, [m.sessionId, m.frameId, frame]);
  return (
    <figure className="wframe">
      <div className={`frame-img ${crop ? "cropped" : ""} ${zoom !== 1 ? "zoomed" : ""}`} style={crop ? { height: crop } : undefined}>
        {src ? (
          // zoom gently toward the highlighted field so the step's context reads at a glance
          <div className="frame-zoom" style={frameStyle(m, zoom, crop)}>
            <img src={src} alt={`Screen at ${fmtClock(m.t)}`} />
            {m.bbox && <div className="frame-box" style={{ left: `${m.bbox.x * 100}%`, top: `${m.bbox.y * 100}%`, width: `${m.bbox.w * 100}%`, height: `${m.bbox.h * 100}%` }} />}
          </div>
        ) : <div className="frame-empty">{src === null ? "Screenshot unavailable" : ""}</div>}
      </div>
      {caption && <figcaption><span>Screen at {caption}</span>{m.bbox && <button className="link-quiet" onClick={() => setFull(!full)}>{full ? "Zoom to field" : "Full screen"}</button>}</figcaption>}
    </figure>
  );
}

/**
 * Position the screenshot inside a fixed-height crop so the highlighted field sits in the middle, optionally zoomed.
 * 100cqw = container width; at 16:9 the image is 56.25cqw tall. Offsets are clamped so no empty edge shows.
 */
function frameStyle(m: ScreenMoment, z: number, crop: number): React.CSSProperties {
  if (!crop) return {};
  const cx = m.bbox ? m.bbox.x + m.bbox.w / 2 : 0.5;
  const cy = m.bbox ? m.bbox.y + m.bbox.h / 2 : 0.3;
  const w = `${z * 100}cqw`, h = `${z * 56.25}cqw`;
  return {
    position: "absolute", width: w, height: h,
    left: `clamp(calc(100cqw - ${w}), calc(50cqw - ${cx} * ${w}), 0px)`,
    top: `clamp(calc(${crop}px - ${h}), calc(${crop / 2}px - ${cy} * ${h}), 0px)`,
  };
}

export function Quote({ q, corrected, who }: { q: QuoteT; corrected: boolean; who?: string }) {
  const parts = quoteParts(q, corrected);
  const when = q.phase === "capture" ? (q.questionId ? "answering a question" : "thinking aloud") : q.phase === "debrief" ? "debrief" : q.phase === "teachback" ? "teach-back" : q.phase;
  return (
    <blockquote className="quote">
      <p>“{parts.map((p, i) => <span key={i} className={p.style ? `q-${p.style}` : undefined}>{p.text}</span>)}”</p>
      <footer>{who ? `${who}, ` : ""}{when} · {fmtClock(q.t)}</footer>
    </blockquote>
  );
}

// ───────────────────────── session timeline ─────────────────────────

function Timeline({ wm, ix, onSelect }: { wm: WorkMap; ix: LogIndex; onSelect: (s: Sel) => void }) {
  const end = Math.max(1, ...ix.events.map((e) => e.tEnd ?? e.t));
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / end) * 100))}%`;
  const span = (a: number, b: number) => ({ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` });
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
  const answers = ix.ofType("answer.linked");
  const PHASE: Record<string, string> = { capture: "Working", debrief: "Debrief", teachback: "Teach-back", review: "" };
  return (
    <section className="panel timeline">
      <div className="card-head"><h3>Session</h3><span className="tl-legend dim"><span><i className="lg q" />Question</span><span><i className="lg corr" />Correction</span><span><i className="lg off" />Off the record</span><span>{fmtClock(end)}</span></span></div>
      <div className="tl-body">
      <div className="tl-labels">
        {phases.filter((p) => p.tEnd > p.t && PHASE[p.phase]).map((p, i) => <span key={i} style={span(p.t, p.tEnd)}>{PHASE[p.phase]}</span>)}
      </div>
      <div className="tl-track">
        {phases.filter((p) => p.tEnd > p.t).map((p, i) => <span key={i} className={`tl-ph ph-${p.phase}`} style={span(p.t, p.tEnd)} />)}
        {ix.offRecord.map(([a, b]) => <button key={a} className="tl-off" style={span(a, b)} onClick={() => onSelect({ kind: "offrecord", id: String(a) })} title="Off the record: nothing kept" />)}
        {ix.ofType("agent.question").map((q) => {
          const a = answers.find((x) => x.payload.questionId === q.payload.questionId);
          return <button key={q.id} className={`tl-mk ${q.phase}`} style={{ left: pct(q.t) }} title={`${fmtClock(q.t)} · ${q.payload.text}${a ? `\n“${a.payload.quote}”` : ""}`} onClick={() => pick([...q.payload.about.actionIds, ...(a ? [a.id] : [])])} />;
        })}
        {ix.ofType("knowledge.correction").map((c) => <button key={c.id} className="tl-mk corr" style={{ left: pct(c.t) }} title={`${fmtClock(c.t)} · Correction: ${c.payload.before ?? ""} → ${c.payload.after ?? ""}`} onClick={() => pick([c.id])} />)}
      </div>
      <div className="tl-cases">
        {wm.cases.map((c) => <span key={c.id} style={span(c.t, c.tEnd)} title={c.outcome ?? ""}>{c.kind === "invoice" ? "INV-" : ""}{c.key}</span>)}
        {ix.offRecord.map(([a, b]) => <span key={a} className="off" style={span(a, b)}>off record</span>)}
      </div>
      </div>
    </section>
  );
}

// ───────────────────────── tabs ─────────────────────────

function RulesTab({ wm, onSelect }: { wm: WorkMap; onSelect: (s: Sel) => void }) {
  const [open, setOpen] = useState<Id | null>(null);
  return (
    <div className="wm-cols">
      <div className="stack">
        <section className="panel">
          <div className="card-head"><h3>Rules</h3><span className="dim">The save is held if any is broken</span></div>
          <ul className="list">
            {wm.guardrails.map((g) => (
              <li key={g.id} className={open === g.id ? "open" : ""}>
                <button className="list-row" onClick={() => setOpen(open === g.id ? null : g.id)}>
                  <span className="grow">{g.statement}</span>
                  {!g.condition && <span className="badge muted">Reminder</span>}
                  <Chevron />
                </button>
                {open === g.id && (
                  <div className="list-body">
                    <RuleFacts g={g} />
                    {g.evidence.quotes[0] && <Quote q={g.evidence.quotes[0]} corrected={g.history.length > 0} />}
                    <button className="link" onClick={() => onSelect({ kind: "guardrail", id: g.id })}>Show in Work Map →</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
        {wm.commonMistakes.length > 0 && (
          <section className="panel">
            <div className="card-head"><h3>Common mistakes</h3></div>
            <ul className="list">
              {wm.commonMistakes.map((m) => (
                <li key={m.id}><button className="list-row" onClick={() => onSelect({ kind: "mistake", id: m.id })}><span className="wdot warn" /><span className="grow">{m.description}<span className="dim"> · {m.correctBehavior}</span></span><Chevron /></button></li>
              ))}
            </ul>
          </section>
        )}
        {wm.glossary.length > 0 && (
          <section className="panel">
            <div className="card-head"><h3>Glossary</h3></div>
            <dl className="gloss">{wm.glossary.map((g) => <div key={g.term}><dt>{g.term}</dt><dd>{g.meaning}</dd></div>)}</dl>
          </section>
        )}
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
    <section className="panel sticky">
      <div className="card-head"><h3>Try a case</h3></div>
      <div className="try">
        <label>Supplier<input value={f.supplier} onChange={set("supplier")} /></label>
        <label>Group<select value={f.group} onChange={set("group")}><option>External</option><option>Intercompany CZ</option></select></label>
        <label>Amount (EUR)<input type="number" value={f.amount} onChange={set("amount")} /></label>
        <label>Category<select value={f.category} onChange={set("category")}><option>equipment</option><option>consumables</option><option>spare_parts</option><option>services</option></select></label>
        <label>Cost center<select value={f.costCenter} onChange={set("costCenter")}><option value="4711">4711 · Opex</option><option value="0400">0400 · Capex</option></select></label>
        <label>Asset number<input value={f.assetNo} onChange={set("assetNo")} placeholder="None" /></label>
        <label>Status<select value={f.status} onChange={set("status")}><option value="approved">Approved</option><option value="awaiting_approval">Awaiting approval</option><option value="on_hold">On hold</option><option value="coded">Coded</option></select></label>
        <label>2nd approver<input value={f.approver} onChange={set("approver")} placeholder="None" /></label>
        <label>Month<input type="number" min={1} max={12} value={f.month} onChange={set("month")} /></label>
        <div className="checks">
          <label className="check"><input type="checkbox" checked={f.isNew} onChange={set("isNew")} />New supplier</label>
          <label className="check"><input type="checkbox" checked={f.duplicate} onChange={set("duplicate")} />Delivery note already paid</label>
        </div>
      </div>
      <div className="verdict-wrap">
        <div className={`verdict ${hits.length ? "held" : "ok"}`}>
          {hits.length === 0 ? <b>Save allowed</b> : (
            <div><b>Save held</b>{hits.map((h) => <div key={h.id} className="v-line">{h.requiredAction}. <span className="dim">{h.statement}</span></div>)}</div>
          )}
        </div>
      </div>
    </section>
  );
}

function DebriefTab({ wm, ix, onSelect }: { wm: WorkMap; ix: LogIndex; onSelect: (s: Sel) => void }) {
  const open = wm.gaps.filter((g) => g.status === "open" && g.priority >= 0.5).length;
  const asked = ix.ofType("agent.question").filter((q) => q.phase === "debrief");
  const answers = ix.ofType("answer.linked");
  const tb = wm.teachBack;
  const confirmedParts = tb.segments.filter((s) => s.verdict === "confirmed" || s.verdict === "corrected").length;
  return (
    <div className="stack">
      <div className="wm-cols even">
        <section className="panel">
          <div className="card-head"><h3>Debrief questions</h3><span className="dim">{open === 0 ? "All answered" : `${open} open`}</span></div>
          <ul className="list qa">
            {wm.gaps.map((g) => <QA key={g.id} g={g} asked={asked.find((q) => q.payload.gapId === g.id)} answers={answers} />)}
            {!wm.gaps.length && <li className="dim pad">No debrief yet.</li>}
          </ul>
          <p className="card-foot dim">Asked most important first. The debrief ends when no important question is open, when the expert is done, or after eight questions.</p>
        </section>
        <section className="panel">
          <div className="card-head"><h3>Teach-back</h3><span className="dim">{confirmedParts} of {tb.segments.length} confirmed</span></div>
          <ol className="list tb">
            {tb.segments.map((s, i) => (
              <li key={s.id} className="list-row static">
                <span className="tb-n">{i + 1}</span>
                <span className="grow">{s.verdict === "corrected" ? <TbCorrected wm={wm} text={s.text} stepIds={s.stepIds} /> : s.text}</span>
              </li>
            ))}
            {!tb.segments.length && <li className="dim pad">Not done yet.</li>}
          </ol>
          {tb.confirmationQuote && <div className="confirm"><span className="wdot ok" />“{tb.confirmationQuote.text}”<span className="dim">&nbsp;· {firstName(wm)}</span></div>}
        </section>
      </div>
      <Timeline wm={wm} ix={ix} onSelect={onSelect} />
    </div>
  );
}

/** A corrected teach-back part: what the apprentice said, struck through, then what the expert corrected it to. */
function TbCorrected({ wm, text, stepIds }: { wm: WorkMap; text: string; stepIds: Id[] }) {
  const claims = [...wm.steps.filter((x) => stepIds.includes(x.id)), ...wm.decisions.filter((d) => stepIds.includes(d.stepId)), ...wm.guardrails.filter((g) => g.stepIds.some((x) => stepIds.includes(x)))];
  const h = claims.flatMap((c) => c.history).find((x) => x.phase === "teachback");
  return (
    <>
      <span className="tb-old">{text}</span>
      {h && <span className="tb-new"><span className="badge warnish">Corrected</span>{h.after}</span>}
    </>
  );
}

function QA({ g, asked, answers }: { g: Gap; asked?: Extract<Event, { type: "agent.question" }>; answers: Array<Extract<Event, { type: "answer.linked" }>> }) {
  const a = asked ? answers.find((x) => x.payload.questionId === asked.payload.questionId) : undefined;
  return (
    <li className="qa-item">
      <span className={`wdot ${g.status === "open" ? "warn" : "none"}`} />
      <div className="grow">
        <div>{asked?.payload.text ?? g.proposedQuestion}</div>
        {a && <div className="answer">“{a.payload.quote}”</div>}
      </div>
    </li>
  );
}

function ExportTab({ wm }: { wm: WorkMap }) {
  const md = agentInstructions(wm);
  const json = JSON.stringify(machineGuardrails(wm), null, 2);
  const [which, setWhich] = useState<"md" | "json">("md");
  const [copied, setCopied] = useState(false);
  const text = which === "md" ? md : json;
  const copy = () => void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: which === "md" ? "text/markdown" : "application/json" }));
    a.download = which === "md" ? `${wm.id}-procedure.md` : `${wm.id}-guardrails.json`;
    a.click();
  };
  return (
    <section className="panel">
      <div className="card-head">
        <div><h3>Export for agents</h3><span className="dim">The same steps and stop rules, ready for an AI agent to follow.</span></div>
        <div className="wseg">
          <button className={which === "md" ? "on" : ""} onClick={() => setWhich("md")}>Instructions</button>
          <button className={which === "json" ? "on" : ""} onClick={() => setWhich("json")}>Guardrails JSON</button>
        </div>
      </div>
      <div className="code">
        <div className="code-bar"><span className="dim mono">{which === "md" ? "procedure.md" : "guardrails.json"}</span><span><button className="btn ghost" onClick={copy}>{copied ? "Copied" : "Copy"}</button><button className="btn ghost" onClick={download}>Download</button></span></div>
        <pre>{text}</pre>
      </div>
    </section>
  );
}
