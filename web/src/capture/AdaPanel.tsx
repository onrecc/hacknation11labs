/**
 * Ada panel: the conversation, front and centre. Ada's current question, why she asked it at that moment,
 * who's talking, and her question budget. Renders HubState only; the wording comes from adaState.ts.
 */
import type { ReactNode } from "react";
import type { HubState } from "./hub";
import { categoryLabel, listenLabel, listenState, type CurrentQuestion } from "./adaState";
import { describeTarget } from "./questionTarget";
import { JudgeMarker, useJudge } from "../components/JudgeMarker";

interface AdaPanelProps {
  s: HubState;
  /** toggles off-the-record (the trust control lives next to the conversation) */
  onOffRecord: () => void;
  /** live questions allowed per 10 minutes (PAUSE.budgetPer10Min) */
  budget: number;
  /** optional marker next to the "why now" line (judge hints, P0-2) */
  whyMarker?: ReactNode;
}

const DECISION_LABEL = { ask: "Asked", wait: "Waiting", defer: "Saved for debrief" } as const;

export function AdaPanel({ s, onOffRecord, budget, whyMarker }: AdaPanelProps) {
  const ls = listenState(s);
  const judge = useJudge();
  const q = s.currentQuestion;
  const pause = s.lastPauseInfo;
  const showPause = pause && !(q && pause.decision === "ask" && pause.reason === q.why);
  return (
    <section className={`card ada ${s.offRecord ? "off" : ""}`} aria-label="Ada">
      <div className="ada-head">
        <span className={`ada-state ${ls}`}><i aria-hidden="true" />{listenLabel(ls)}</span>
        <span>
          <JudgeMarker n={5} />{" "}
          <button className={s.offRecord ? "danger" : ""} aria-pressed={s.offRecord} onClick={onOffRecord}>{s.offRecord ? "Back on the record" : "Off the record"}</button>
        </span>
      </div>
      <div className="ada-question" aria-live="polite">
        {q ? (
          <>
            <div className="ada-meta"><span className="badge">{categoryLabel(q.category)}</span> <span className="muted small">{q.answered ? "Answered" : "Waiting for your answer"}</span></div>
            <p className="ada-q">{q.text}</p>
            <p className="ada-why"><b>Why now:</b> {q.why} {whyMarker}</p>
            {q.aboutScreen && <p className="muted small">About: {q.aboutScreen}</p>}
            {q.target && <TargetLine q={q} />}
          </>
        ) : s.offRecord ? (
          <p className="muted">Nothing is recorded and Ada won't ask until you're back on the record.</p>
        ) : (
          <p className="muted">Ada is quiet. She asks <i>why</i> at a natural pause, for example right after you save.</p>
        )}
      </div>
      {showPause && (
        <p className="ada-pause small"><span className="badge">{DECISION_LABEL[pause.decision]}</span> {pause.reason}</p>
      )}
      <p className="ada-stats muted small">
        {s.liveQuestions} asked this task · {s.questionBudgetLeft} of {budget} left in 10 min · {s.deferredQuestions} saved for the debrief
        {(s.redactedCount > 0 || judge) && <> · {s.redactedCount} items redacted</>}
      </p>
    </section>
  );
}

/** ② What to ask: the question's target and why the screen alone doesn't answer it, plus what Ada chose not to ask. */
function TargetLine({ q }: { q: CurrentQuestion }) {
  if (!q.target) return null;
  const d = describeTarget(q.target);
  const also = [...new Set(d.alsoConsidered)]; // listed once each (also the React key)
  return (
    <div className="ada-target muted small">
      <b>Target:</b> {d.target}. {d.whyNotScreen} <JudgeMarker n={2} />
      {also.length > 0 && (
        <details>
          <summary>Also considered ({also.length}), not asked</summary>
          <ul>{also.map((x) => <li key={x}>{x}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
