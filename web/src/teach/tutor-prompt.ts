/** Pure helpers for the tutor agent prompt (no browser deps: also used by tools/src/agent-test.ts). */
import type { WorkMap } from "../../../shared/schema";

/** Compact Work Map text for the tutor agent's prompt ({{work_map}}). */
export function workMapForPrompt(wm: WorkMap): string {
  const name = wm.expert.displayName;
  const lines: string[] = [`Task: ${wm.task.title}. Expert: ${name}.`];
  for (const s of wm.steps) {
    lines.push(`STEP ${s.order}. ${s.title}: ${s.instructions}`);
    for (const d of wm.decisions.filter((x) => s.decisionIds.includes(x.id))) {
      lines.push(`  DECISION (${d.kind}) ${d.question} → ${d.options.map((o) => `${o.option}${o.whenText ? ` when ${o.whenText}` : ""}`).join("; ")}. ${name}: "${d.reason.text}"`);
    }
    for (const g of wm.guardrails.filter((x) => s.guardrailIds.includes(x.id))) {
      lines.push(`  GUARDRAIL [${g.id}] (${g.kind}, ${g.severity}) ${g.statement} → ${g.requiredAction}.${g.evidence.quotes[0] ? ` ${name}: "${g.evidence.quotes[0].text}"` : ""}`);
    }
  }
  if (wm.commonMistakes.length) lines.push(`COMMON MISTAKES: ${wm.commonMistakes.map((m) => `${m.description} (do instead: ${m.correctBehavior})`).join("; ")}`);
  if (wm.glossary.length) lines.push(`GLOSSARY: ${wm.glossary.map((g) => `${g.term} = ${g.meaning}`).join("; ")}`);
  return lines.join("\n");
}

