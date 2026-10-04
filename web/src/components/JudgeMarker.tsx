/**
 * Judge mode markers (P0-2): "① When to ask" etc. next to the element that answers that Apprentice Test question.
 * Renders nothing unless judge mode is on (`?judge=1`, remembered; `?judge=0` turns it off). Logic: lib/judge.ts.
 */
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { JUDGE_QUESTIONS, browserStore, judgeLabel, resolveJudgeFlag, type JudgeQuestion } from "../lib/judge";
import "./judge.css";

export function useJudge(): boolean {
  const { search } = useLocation();
  return useMemo(() => resolveJudgeFlag(search, browserStore()), [search]);
}

export function JudgeMarker({ n }: { n: JudgeQuestion }) {
  const on = useJudge();
  if (!on) return null;
  const q = JUDGE_QUESTIONS[n];
  return (
    <span className="judge-marker" role="note" tabIndex={0} title={q.hint} aria-label={`Apprentice Test ${judgeLabel(n)}: ${q.hint}`}>
      <span aria-hidden="true">{q.glyph}</span> {q.label}
    </span>
  );
}

/** One muted line under a page title: which markers exist and where they sit. */
export function JudgeLegend() {
  const on = useJudge();
  if (!on) return null;
  const all = ([1, 2, 3, 4, 5] as const).map(judgeLabel).join(" · ");
  return <p className="judge-legend muted small">Apprentice Test: {all}. Markers sit next to each answer; hover for details. Hide with ?judge=0.</p>;
}
