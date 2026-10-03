/**
 * Pure presentation helpers for the Work Map UI (no React): flowchart model, quote correction markup,
 * plain-English conditions, agent-ready export.
 */
import type { Condition, Decision, Guardrail, Id, Quote, Step, WorkMap } from "@shared/schema";

// ───────────── flowchart model (deterministic, from the Work Map) ─────────────

export type FlowNode =
  | { kind: "step"; step: Step; decisions: Decision[]; guardrails: Guardrail[]; mistakes: WorkMap["commonMistakes"] }
  | { kind: "gate"; step: Step; question: string } // diamond before an optional step: yes → step, no → skip
  | { kind: "branch"; step: Step; outcomes: FlowOutcome[] }; // decision fan-out after a step: one pill per outcome, merging below

export interface FlowOutcome { label: string; when: string; decisionId: Id; fallback: boolean }

export function flowModel(wm: WorkMap): FlowNode[] {
  const out: FlowNode[] = [];
  const steps = [...wm.steps].sort((a, b) => a.order - b.order);
  for (const s of steps) {
    if (s.optional) out.push({ kind: "gate", step: s, question: s.whenText ? `${s.whenText}?` : `Does "${s.title}" apply?` });
    const decisions = wm.decisions.filter((d) => s.decisionIds.includes(d.id));
    const guardrails = wm.guardrails.filter((g) => s.guardrailIds.includes(g.id));
    const mistakes = wm.commonMistakes.filter((m) => m.relatedIds.some((r) => r === s.id || s.decisionIds.includes(r) || s.guardrailIds.includes(r)));
    out.push({ kind: "step", step: s, decisions, guardrails, mistakes });
    // decisions fan out where they are decided (decision.stepId). Several decisions on one step merge into one
    // fan-out: each decision's specific options, then a single shared "otherwise" (e.g. Hold · Route to Weber · Book).
    const here = decisions.filter((d) => d.stepId === s.id && d.options.length >= 2);
    if (here.length) {
      const outcomes: FlowOutcome[] = [];
      const anyWhen = here.some((d) => d.options.some((o) => o.when));
      for (const d of here) {
        // specific options: those with a machine condition (or, if the LLM gave none, all but the last option)
        const specific = anyWhen ? d.options.filter((o) => o.when) : d.options.slice(0, -1);
        for (const o of specific) outcomes.push({ label: o.option, when: o.whenText ?? "", decisionId: d.id, fallback: false });
      }
      // one shared "otherwise": the last decision's first unconditioned option
      const last = here[here.length - 1];
      const fbOpt = anyWhen ? last.options.find((o) => !o.when) : last.options[last.options.length - 1];
      if (fbOpt) outcomes.push({ label: fbOpt.option, when: here.length > 1 ? "otherwise" : fbOpt.whenText ?? "otherwise", decisionId: last.id, fallback: true });
      if (outcomes.length >= 2) out.push({ kind: "branch", step: s, outcomes });
    }
  }
  return out;
}

// ───────────── quotes: show the self-correction ─────────────

export type QuotePart = { text: string; style?: "struck" | "fix" | "marker" };

const MARKER = /\b(?:(?:no,?\s*wait|wait,?\s*no|sorry|i mean|actually|no,?\s*no)\b[,.!]?\s*)+/i;
const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();

/**
 * "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand."
 *  → "Equipment over [three thousand → struck] euros is always capex. [No, wait, sorry,] [five thousand. → fix]"
 * Only when the claim actually has a correction in its history; otherwise the quote is shown as-is.
 */
export function quoteParts(q: Quote, corrected: boolean): QuotePart[] {
  if (!corrected) return [{ text: q.text }];
  const m = MARKER.exec(q.text);
  if (!m || m.index === 0) return [{ text: q.text }];
  const before = q.text.slice(0, m.index), marker = m[0], after = q.text.slice(m.index + marker.length);
  const fixWords = clean(after).split(/\s+/).filter(Boolean);
  if (!fixWords.length || fixWords.length > 6) return [{ text: before }, { text: marker, style: "marker" }, { text: after, style: "fix" }];
  // find, in `before`, the phrase of the same length that ends with the same last word ("three thousand" ↔ "five thousand")
  const re = /\S+/g;
  const toks: Array<{ a: number; b: number; w: string }> = [];
  for (let x; (x = re.exec(before)); ) toks.push({ a: x.index, b: x.index + x[0].length, w: clean(x[0]) });
  const last = fixWords.at(-1)!;
  for (let i = toks.length - 1; i >= 0; i--) {
    if (toks[i].w !== last) continue;
    const start = i - (fixWords.length - 1);
    if (start < 0) break;
    const a = toks[start].a, b = toks[i].b;
    return [{ text: before.slice(0, a) }, { text: before.slice(a, b), style: "struck" }, { text: before.slice(b) }, { text: marker, style: "marker" }, { text: after, style: "fix" }];
  }
  return [{ text: before }, { text: marker, style: "marker" }, { text: after, style: "fix" }];
}

// ───────────── conditions in plain English ─────────────

const FIELD: Record<string, string> = {
  "invoice.amount": "amount", "invoice.category": "category", "invoice.costCenter": "cost center", "invoice.assetNo": "asset number",
  "invoice.status": "status", "invoice.approver": "approver", "invoice.month": "month", "invoice.duplicateDeliveryNote": "delivery note already paid",
  "invoice.comment": "comment", "invoice.currency": "currency", "invoice.date": "date", "invoice.key": "invoice",
  "supplier.name": "supplier", "supplier.group": "supplier group", "supplier.isNew": "new supplier",
};
const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const val = (field: string, v: unknown): string => {
  if (field === "invoice.month" && typeof v === "number") return MONTHS[v] ?? String(v);
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (Array.isArray(v)) return v.map((x) => val(field, x)).join(" or ");
  if (v === true) return "yes";
  if (v === false) return "no";
  return String(v);
};

export function conditionText(c: Condition): string {
  switch (c.op) {
    case "and": return c.all.map(conditionText).join(" and ");
    case "or": return c.all.length > 1 ? `(${c.all.map(conditionText).join(" or ")})` : conditionText(c.all[0]);
    case "not":
      if (c.c.op === "in") return `${FIELD[c.c.field] ?? c.c.field} is not ${val(c.c.field, c.c.value)}`;
      return `not ${conditionText(c.c)}`;
  }
  const f = FIELD[c.field] ?? c.field;
  if (c.field === "supplier.isNew" || c.field === "invoice.duplicateDeliveryNote") {
    const yes = (c.op === "eq" && c.value === true) || (c.op === "neq" && c.value === false);
    return yes ? f : `not ${f}`;
  }
  switch (c.op) {
    case "missing": return `no ${f}`;
    case "eq": return `${f} is ${val(c.field, c.value)}`;
    case "neq": return `${f} is not ${val(c.field, c.value)}`;
    case "gt": return `${f} over ${val(c.field, c.value)}`;
    case "gte": return `${f} at least ${val(c.field, c.value)}`;
    case "lt": return `${f} under ${val(c.field, c.value)}`;
    case "lte": return `${f} at most ${val(c.field, c.value)}`;
    case "in": return `${f} is ${val(c.field, c.value)}`;
    case "contains": return `${f} contains ${val(c.field, c.value)}`;
  }
}

// ───────────── provenance labels ─────────────

export const PROV: Record<string, { label: string; icon: string }> = {
  observed: { label: "seen on screen", icon: "👁" },
  stated_live: { label: "said while working", icon: "🎙" },
  stated_debrief: { label: "said in debrief", icon: "💬" },
  teachback_correction: { label: "corrected in teach-back", icon: "✎" },
  inferred: { label: "inferred, unconfirmed", icon: "?" },
};

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ───────────── agent-ready export (brief stretch goal) ─────────────

export function agentInstructions(wm: WorkMap): string {
  const L: string[] = [];
  L.push(`# ${wm.task.title}: operating procedure`, "");
  L.push(`Learned from ${wm.expert.displayName} (${wm.expert.role}) by the AI Apprentice. Work Map ${wm.id} v${wm.version}, status: ${wm.status}.`, "");
  L.push("Follow these steps in order. Where a STOP rule fires, do not save; do the required action or hand over to the named person.", "");
  L.push("## Steps", "");
  for (const s of [...wm.steps].sort((a, b) => a.order - b.order)) {
    L.push(`${s.order}. **${s.title}**${s.optional ? ` _(only when: ${s.whenText ?? (s.when ? conditionText(s.when) : "it applies")})_` : ""}`);
    L.push(`   ${s.instructions}`);
    for (const d of wm.decisions.filter((x) => s.decisionIds.includes(x.id) && x.stepId === s.id)) {
      L.push(`   - Decide: ${d.question}`);
      for (const o of d.options) L.push(`     - ${o.option}${o.whenText ? `: when ${o.whenText}` : o.when ? `: when ${conditionText(o.when)}` : ""}`);
      L.push(`     - Why (in ${wm.expert.displayName}'s words): "${d.reason.text}"`);
    }
  }
  L.push("", "## STOP rules (check before every save)", "");
  for (const g of wm.guardrails) {
    L.push(`- **${g.statement}** (${g.severity === "block" ? "blocking" : g.severity})`);
    if (g.condition) L.push(`  - Fires when: ${conditionText(g.condition)}`);
    L.push(`  - Do instead: ${g.requiredAction}${g.escalateTo ? ` (escalate to ${g.escalateTo.role}${g.escalateTo.name ? `, ${g.escalateTo.name}` : ""})` : ""}`);
    L.push(`  - Scope: ${g.scope}`);
  }
  if (wm.commonMistakes.length) {
    L.push("", "## Known mistakes", "");
    for (const m of wm.commonMistakes) L.push(`- Don't: ${m.description}. Do: ${m.correctBehavior}.`);
  }
  if (wm.glossary.length) {
    L.push("", "## Glossary", "");
    for (const g of wm.glossary) L.push(`- **${g.term}**: ${g.meaning}`);
  }
  L.push("", "## When the rules don't cover a case", "", "Do not guess. Stop and ask a person, and record the case so the expert can be asked about it.");
  return L.join("\n");
}

export function machineGuardrails(wm: WorkMap) {
  return {
    workMapId: wm.id, version: wm.version, status: wm.status,
    guardrails: wm.guardrails.map((g) => ({ id: g.id, statement: g.statement, severity: g.severity, violatedWhen: g.condition ?? null, requiredAction: g.requiredAction, escalateTo: g.escalateTo ?? null })),
  };
}

/** Event ids → claim ids, so clicking a marker on the session strip can select the claim it fed. */
export function claimsByEvent(wm: WorkMap): Map<Id, Id> {
  const m = new Map<Id, Id>();
  const add = (eventIds: Id[], id: Id) => eventIds.forEach((e) => m.has(e) || m.set(e, id));
  for (const g of wm.guardrails) { add(g.history.map((h) => h.correctionEventId), g.id); g.evidence.moments.forEach((x) => add(x.eventIds, g.id)); }
  for (const d of wm.decisions) { add(d.history.map((h) => h.correctionEventId), d.id); d.evidence.moments.forEach((x) => add(x.eventIds, d.id)); }
  for (const s of wm.steps) { add(s.history.map((h) => h.correctionEventId), s.id); add(s.actionIds, s.id); }
  for (const x of wm.commonMistakes) add([x.correctionEventId, ...x.moment.eventIds], x.id);
  return m;
}
