/**
 * /map            → sessions + work maps
 * /map/:sessionId → live session timeline + its Work Map (clickable steps with evidence)
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Event, Guardrail, Session, Step, WorkMap } from "@shared/schema";
import { LogIndex, fmtT } from "@shared/logindex";
import { assemble, buildDraft, condenseLog, nextVersion } from "@shared/workmap";
import { describe } from "@shared/conditions";
import { FACT_PATHS } from "@shared/llm";
import { getSession, listSessions, listWorkMaps, loadWorkMap, saveWorkMapVersion, subscribeEvents, updateSession, type WorkMapHead } from "../lib/sessions";
import { signedIn } from "../lib/firebase";
import { llm } from "../lib/api";
import { EventFeed, FrameImg, Quote, summarize } from "../components/ui";

export default function MapPage() {
  const { sessionId } = useParams();
  return sessionId ? <SessionMap sessionId={sessionId} /> : <MapIndex />;
}

function MapIndex() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [maps, setMaps] = useState<WorkMapHead[]>([]);
  useEffect(() => {
    void signedIn.then(async () => {
      setSessions(await listSessions());
      setMaps(await listWorkMaps());
    });
  }, []);
  return (
    <div className="page">
      <h1>Work Maps</h1>
      <div className="cols">
        <div className="card">
          <h3>Sessions</h3>
          <table className="grid">
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/map/${s.id}`}>{s.task.title}</Link><div className="muted small mono">{s.id}</div></td>
                  <td>{s.kind}</td><td>{s.participant.displayName}</td><td>{s.status}</td><td className="muted small">{s.createdAt.slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Work Maps</h3>
          <table className="grid">
            <tbody>
              {maps.map((m) => (
                <tr key={m.id}>
                  <td>{m.title ?? m.id}<div className="muted small mono">{m.id}</div></td><td>v{m.latestVersion}</td><td>{m.status}</td>
                  <td>{m.sourceSessionIds[0] && <Link to={`/map/${m.sourceSessionIds[0]}`}>open</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const PROV_LABEL: Record<string, string> = { observed: "seen", stated_live: "said live", stated_debrief: "said in debrief", teachback_correction: "teach-back", inferred: "inferred" };

function SessionMap({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [wm, setWm] = useState<WorkMap | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    let off = () => {};
    void signedIn.then(async () => {
      const s = await getSession(sessionId);
      setSession(s);
      off = subscribeEvents(sessionId, setEvents);
      if (s?.workMapId) setWm(await loadWorkMap(s.workMapId));
    });
    return () => off();
  }, [sessionId]);

  const ix = useMemo(() => new LogIndex(sessionId, events), [sessionId, events]);
  const draft = useMemo(() => (session ? buildDraft(session, events) : null), [session, events]);
  const shown = wm ?? draft;

  async function rebuild() {
    if (!session) return;
    setBusy("Extracting with the LLM…");
    try {
      const proposal = await llm("extract_workmap", { log: condenseLog(ix), factPaths: [...FACT_PATHS] });
      const { workmap, problems } = assemble(buildDraft(session, events, wm?.id), proposal, ix);
      const next = nextVersion(wm, { ...workmap, status: wm?.status === "confirmed" ? "teachback_pending" : workmap.status, teachBack: wm?.teachBack ?? workmap.teachBack }, "map", "Re-extracted from session log");
      await saveWorkMapVersion(next);
      if (!session.workMapId) await updateSession(session.id, { workMapId: next.id });
      setWm(next);
      setProblems(problems.map((p) => `${p.where}: ${p.problem}`));
    } catch (e) {
      setProblems([(e as Error).message]);
    } finally {
      setBusy(null);
    }
  }

  if (!session) return <div className="page">Loading session…</div>;
  const step = shown?.steps.find((s) => s.id === sel) ?? null;

  return (
    <div className="page">
      <h1>{session.task.title}</h1>
      <p className="muted">
        {session.participant.displayName} · {session.kind} · {session.status} · {events.length} events · {ix.frames.length} frames
        {shown && <> · Work Map <b>{wm ? `v${wm.version} ${wm.status}` : "draft (not saved)"}</b></>}
      </p>
      <div className="btns">
        <button onClick={rebuild} disabled={!!busy}>{busy ?? "Build / rebuild Work Map (LLM)"}</button>
        <Link to="/map">← all sessions</Link>
      </div>
      {problems.length > 0 && <details className="card"><summary>{problems.length} evidence problems (claims dropped or downgraded)</summary><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></details>}

      <Timeline ix={ix} events={events} onPick={(stepId) => setSel(stepId)} wm={shown} />

      {shown && (
        <div className="cols map">
          <div>
            <h3>Steps</h3>
            {shown.steps.length === 0 && <p className="muted">No steps yet. Build the Work Map from the session log.</p>}
            {shown.steps.map((s) => (
              <button key={s.id} className={`step ${sel === s.id ? "sel" : ""}`} onClick={() => setSel(s.id)}>
                <b>{s.order}. {s.title}</b>
                <span className="muted small">{s.decisionIds.length} decisions · {s.guardrailIds.length} guardrails{s.history.length ? " · corrected" : ""}</span>
              </button>
            ))}
            <h3>Common mistakes</h3>
            {shown.commonMistakes.map((m) => (
              <div key={m.id} className="card mistake">
                <b>{m.description}</b> → {m.correctBehavior}
                <Quote q={m.quote} events={events} who={shown.expert.displayName} />
              </div>
            ))}
            <h3>Gaps</h3>
            {shown.gaps.map((g) => <div key={g.id} className="small">{g.status === "resolved" ? "✓" : "○"} {g.description}</div>)}
          </div>
          <div>{step ? <StepDetail step={step} wm={shown} events={events} /> : <p className="muted">Select a step.</p>}</div>
        </div>
      )}
      <details className="card"><summary>Raw event feed</summary><EventFeed events={events} max={300} /></details>
    </div>
  );
}

function Timeline({ ix, wm, onPick }: { ix: LogIndex; events: Event[]; wm: WorkMap | null; onPick: (stepId: string) => void }) {
  const end = Math.max(1, ...ix.events.map((e) => e.tEnd ?? e.t));
  const pct = (t: number) => `${(t / end) * 100}%`;
  const marks = ix.events.filter((e) => ["agent.question", "knowledge.correction", "screen.action", "marker.bookmark"].includes(e.type));
  return (
    <div className="timeline card">
      <div className="lane"><span className="lane-label">cases</span>
        {wm?.cases.map((c) => <div key={c.id} className="seg case" style={{ left: pct(c.t), width: pct(c.tEnd - c.t) }} title={`${c.key} ${c.outcome ?? ""}`}>{c.key}</div>)}
        {ix.offRecord.map(([a, b]) => <div key={a} className="seg off" style={{ left: pct(a), width: pct(b - a) }} title="off the record">off</div>)}
      </div>
      <div className="lane"><span className="lane-label">steps</span>
        {wm?.steps.map((s) => s.screenMoment && <button key={s.id} className="dot step-dot" style={{ left: pct(s.screenMoment.t) }} title={s.title} onClick={() => onPick(s.id)}>{s.order}</button>)}
      </div>
      <div className="lane"><span className="lane-label">events</span>
        {marks.map((e) => <span key={e.id} className={`tick t-${e.type.replace(".", "-")}`} style={{ left: pct(e.t) }} title={`${fmtT(e.t)} ${e.type}: ${summarize(e)}`} />)}
      </div>
      <div className="axis"><span>0:00</span><span>{fmtT(end)}</span></div>
    </div>
  );
}

function StepDetail({ step, wm, events }: { step: Step; wm: WorkMap; events: Event[] }) {
  const decisions = wm.decisions.filter((d) => step.decisionIds.includes(d.id));
  const guardrails = wm.guardrails.filter((g) => step.guardrailIds.includes(g.id));
  const m = step.screenMoment;
  return (
    <div className="card detail">
      <h2>Step {step.order} of {wm.steps.length}: {step.title}</h2>
      <Prov p={step.provenance} confirmed={step.confirmedByExpert} />
      {m && <><p className="muted small">Screen moment {fmtT(m.t)}</p><FrameImg sessionId={m.sessionId} frameId={m.frameId} bbox={m.bbox} /></>}
      <p>{step.instructions}</p>
      {decisions.map((d) => (
        <div key={d.id} className="block">
          <h4>Decision ({d.kind}): {d.question}</h4>
          <p>{d.observedChoice}</p>
          <ul>{d.options.map((o) => <li key={o.option}><b>{o.option}</b>{o.whenText ? `: ${o.whenText}` : ""}</li>)}</ul>
          <Quote q={d.reason} events={events} who={wm.expert.displayName} />
          <History h={d.history} />
        </div>
      ))}
      {guardrails.map((g) => <GuardrailCard key={g.id} g={g} wm={wm} events={events} />)}
      <History h={step.history} />
    </div>
  );
}

function GuardrailCard({ g, wm, events }: { g: Guardrail; wm: WorkMap; events: Event[] }) {
  return (
    <div className={`block guardrail ${g.severity}`}>
      <h4>Guardrail ({g.kind}, {g.severity}): {g.statement}</h4>
      <p><b>Do:</b> {g.requiredAction}{g.escalateTo ? ` · escalate to ${g.escalateTo.role}${g.escalateTo.name ? ` (${g.escalateTo.name})` : ""}` : ""}</p>
      {g.condition && <p className="mono small">violated when: {describe(g.condition)}</p>}
      <Prov p={g.provenance} confirmed={g.confirmedByExpert} />
      {g.evidence.quotes.map((q, i) => <Quote key={i} q={q} events={events} who={wm.expert.displayName} />)}
      <History h={g.history} />
    </div>
  );
}

function Prov({ p, confirmed }: { p: string[]; confirmed: boolean }) {
  return <div className="badges">{p.map((x) => <span key={x} className={`badge ${x}`}>{PROV_LABEL[x] ?? x}</span>)}{confirmed && <span className="badge ok">confirmed</span>}</div>;
}

function History({ h }: { h: Step["history"] }) {
  if (!h.length) return null;
  return (
    <details className="history"><summary>corrected {h.length}×</summary>
      <ul>{h.map((x) => <li key={x.correctionEventId}><s>{x.before}</s> → {x.after} <span className="muted small">({x.phase}, {fmtT(x.at)})</span></li>)}</ul>
    </details>
  );
}
