/**
 * Mastery report logic (Apprentice Test Q4: did the new hire learn?). Pure, so it is testable without React or Firebase:
 * step status from what the learner saved, readable chips, the prediction score and which case to practice next.
 */
import type { CaseFacts, Guardrail, Id, MasteryReport, Step, WorkMap } from "@shared/schema";
import { evaluate } from "@shared/conditions";

export type GuardrailStatus = MasteryReport["perGuardrail"][number]["status"];
export type StepStatus = MasteryReport["perStep"][number]["status"];

export interface Chip {
  icon: string;
  text: string;
  tone: "ok" | "warn" | "danger" | "idle";
}

/** A case the learner can open to practice (MiniERP's teach set, or any app that publishes case facts). */
export interface PracticeCase {
  key: string;
  label: string;
  facts: CaseFacts;
}

export interface MasteryRow {
  guardrailId: Id;
  statement: string;
  chip: Chip;
  /** The rule still needs practice (caught, violated or never met). */
  needsPractice: boolean;
  practice?: PracticeCase;
}

const safe = (fn: () => boolean): boolean => {
  try {
    return fn();
  } catch {
    return false;
  }
};

/**
 * A step counts as mastered only with evidence it was exercised:
 *  - any of its rules caught by the tutor → assisted;
 *  - a step with rules → at least one of them met on a case and saved without help;
 *  - a step without rules → a saved case it applies to (`when`; no `when` = every case).
 * (A step with rules no longer counts as mastered after an unrelated save.)
 */
export function stepStatus(step: Pick<Step, "guardrailIds" | "when">, statusOf: (id: Id) => GuardrailStatus, saved: readonly CaseFacts[]): StepStatus {
  const st = step.guardrailIds.map(statusOf);
  if (st.includes("caught_by_tutor") || st.includes("violated")) return "assisted";
  if (st.length) return st.includes("respected") ? "mastered" : "not_seen";
  const when = step.when;
  const applied = saved.some((f) => !when || safe(() => evaluate(when, f)));
  return applied ? "mastered" : "not_seen";
}

export function guardrailChip(s: GuardrailStatus): Chip {
  switch (s) {
    case "respected": return { icon: "✓", text: "Followed", tone: "ok" };
    case "caught_by_tutor": return { icon: "⚠", text: "Caught before save", tone: "warn" };
    case "violated": return { icon: "✗", text: "Saved against the rule", tone: "danger" };
    default: return { icon: "–", text: "Not practised", tone: "idle" };
  }
}

export function stepChip(s: StepStatus): Chip {
  switch (s) {
    case "mastered": return { icon: "✓", text: "Done on your own", tone: "ok" };
    case "assisted": return { icon: "⚠", text: "With Ada's help", tone: "warn" };
    case "failed": return { icon: "✗", text: "Not done right", tone: "danger" };
    default: return { icon: "–", text: "Not practised", tone: "idle" };
  }
}

export function predictionScore(p: MasteryReport["predictions"]): string {
  if (!p.asked) return "No predictions asked";
  return `${p.correct} of ${p.asked} correct (${Math.round((p.correct / p.asked) * 100)}%)`;
}

/**
 * The case to practice a rule on: the case where the tutor caught it (retry it), else the first case where
 * approving it as it stands would break the rule.
 */
export function practiceCaseFor(g: Guardrail, cases: readonly PracticeCase[], caughtOn?: string): PracticeCase | undefined {
  const retry = caughtOn ? cases.find((c) => c.key === caughtOn) : undefined;
  if (retry) return retry;
  const cond = g.condition;
  if (!cond) return undefined;
  return cases.find((c) => safe(() => evaluate(cond, { ...c.facts, invoice: { ...c.facts.invoice, status: "approved" } })));
}

const ORDER: Record<GuardrailStatus, number> = { caught_by_tutor: 0, violated: 0, not_triggered: 1, respected: 2 };

/** One row per rule, the ones that need practice first. */
export function masteryRows(report: MasteryReport, wm: Pick<WorkMap, "guardrails">, cases: readonly PracticeCase[], caughtOn: ReadonlyMap<Id, string> = new Map()): MasteryRow[] {
  return report.perGuardrail
    .flatMap((r) => {
      const g = wm.guardrails.find((x) => x.id === r.guardrailId);
      if (!g) return [];
      const needsPractice = r.status !== "respected";
      const practice = needsPractice ? practiceCaseFor(g, cases, caughtOn.get(g.id)) : undefined;
      return [{ row: { guardrailId: g.id, statement: g.statement, chip: guardrailChip(r.status), needsPractice, ...(practice ? { practice } : {}) }, rank: ORDER[r.status] }];
    })
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.row);
}
