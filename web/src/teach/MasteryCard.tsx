/** The learner's mastery report as a card: rules as labelled chips, steps, prediction score, "Practice next" buttons. Logic: mastery.ts. */
import type { MasteryReport, WorkMap } from "@shared/schema";
import { JudgeMarker } from "../components/JudgeMarker";
import { masteryRows, predictionScore, stepChip, type Chip, type PracticeCase } from "./mastery";

interface Props {
  report: MasteryReport;
  wm: WorkMap;
  learner: string;
  cases: readonly PracticeCase[];
  caughtOn: ReadonlyMap<string, string>;
  /** Starts a fresh teach session on that case; undefined while busy. */
  onPractice?: (c: PracticeCase) => void;
}

export function MasteryCard({ report, wm, learner, cases, caughtOn, onPractice }: Props) {
  const rows = masteryRows(report, wm, cases, caughtOn);
  const steps = report.perStep.filter((x) => x.status !== "not_seen");
  const mapUrl = wm.sourceSessionIds[0] ? `/map/${wm.sourceSessionIds[0]}` : null;
  return (
    <div className="card" aria-live="polite">
      <h3>Mastery report · {learner} <JudgeMarker n={4} /></h3>
      <p className="mastery-score">Predictions: <b>{predictionScore(report.predictions)}</b></p>
      <h4>{wm.expert.displayName.split(" ")[0]}'s rules</h4>
      <ul className="mastery-list">
        {rows.map((r) => (
          <li key={r.guardrailId}>
            <ChipPill chip={r.chip} />
            <span>{r.statement}</span>
            {(r.practice || mapUrl) && (
              <span className="actions">
                {r.practice && (
                  <button disabled={!onPractice} onClick={() => r.practice && onPractice?.(r.practice)}>
                    Practice next: INV-{r.practice.key} ({r.practice.label})
                  </button>
                )}
                {mapUrl && <a className="small" href={`${mapUrl}#${r.guardrailId}`} target="_blank" rel="noreferrer">See the rule in the Work Map</a>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {steps.length > 0 && (
        <>
          <h4>Steps</h4>
          <ul className="mastery-list">
            {steps.map((x) => (
              <li key={x.stepId}>
                <ChipPill chip={stepChip(x.status)} />
                <span>{wm.steps.find((s) => s.id === x.stepId)?.title ?? x.stepId}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ChipPill({ chip }: { chip: Chip }) {
  const cls = chip.tone === "idle" ? "pill" : `pill ${chip.tone}`;
  return <span className={cls}><span aria-hidden="true">{chip.icon}</span> {chip.text}</span>;
}
