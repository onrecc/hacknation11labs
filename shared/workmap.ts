/**
 * Map core (docs/map.md): deterministic draft → LLM proposal → verified Work Map.
 * Everything that can be checked in code is checked here; the LLM only proposes.
 */
import type {
  Claim, Condition, Event, Gap, Guardrail, Id, Provenance, Quote, ScreenMoment, Session, Step, Decision, WorkMap,
} from "./schema";
import type { ExtractionProposal } from "./llm";
import { FACT_PATHS } from "./llm";
import { LogIndex, fmtT } from "./logindex";
import { newId } from "./ids";

/** Condensed, id-tagged log for the LLM. Off-record content never exists in the log, so it can't leak. */
export function condenseLog(ix: LogIndex): string {
  const lines: Array<[number, string]> = [];
  for (const e of ix.events) {
    const t = `[${fmtT(e.t)} ${e.phase}]`;
    switch (e.type) {
      case "marker.case_boundary":
        lines.push([e.t, `${t} CASE ${e.payload.state.toUpperCase()} ${e.payload.case.kind} ${e.payload.case.key} ${e.payload.outcome ?? ""}`]);
        break;
      case "screen.action":
        lines.push([e.t, `${t} ACTION ${e.id}: ${e.payload.description}`]);
        break;
      case "utterance":
        lines.push([e.t, `${t} ${e.payload.speaker.toUpperCase()} ${e.payload.utteranceId} (${e.payload.addressedTo}${e.payload.inReplyToQuestionId ? `, reply to ${e.payload.inReplyToQuestionId}` : ""}): "${e.payload.text}"`]);
        break;
      case "agent.question":
        lines.push([e.t, `${t} QUESTION ${e.payload.questionId} [${e.payload.category}] about ${e.payload.about.actionIds.join(",")}`]);
        break;
      case "question.deferred":
        lines.push([e.t, `${t} DEFERRED QUESTION: ${e.payload.text}`]);
        break;
      case "knowledge.correction":
        lines.push([e.t, `${t} CORRECTION ${e.id} (${e.payload.kind}): "${e.payload.before}" -> "${e.payload.after}"`]);
        break;
      case "marker.off_record":
        lines.push([e.t, `${t} OFF RECORD ${e.payload.state} (no content recorded)`]);
        break;
      case "teachback.verdict":
        lines.push([e.t, `${t} TEACHBACK ${e.payload.segmentId}: ${e.payload.verdict}${e.payload.correction ? ` (${e.payload.correction})` : ""}`]);
        break;
    }
  }
  return lines.sort((a, b) => a[0] - b[0]).map((l) => l[1]).join("\n");
}

/** Draft Work Map from the log alone: cases, gaps, common mistakes. Steps etc. come from `assemble`. */
export function buildDraft(session: Session, events: Event[], workMapId: Id = session.workMapId ?? newId("wm")): WorkMap {
  const ix = new LogIndex(session.id, events);
  const now = new Date().toISOString();
  const starts = new Map<Id, Event & { type: "marker.case_boundary" }>();
  const cases: WorkMap["cases"] = [];
  for (const e of ix.ofType("marker.case_boundary")) {
    if (e.payload.state === "start") starts.set(e.payload.case.id, e);
    else {
      const s = starts.get(e.payload.case.id);
      cases.push({ id: e.payload.case.id, kind: e.payload.case.kind, key: e.payload.case.key, outcome: e.payload.outcome, t: s?.t ?? e.t, tEnd: e.t, sessionId: session.id });
    }
  }
  const answered = new Set(ix.ofType("answer.linked").map((a) => a.payload.questionId));
  const gaps: Gap[] = [
    ...ix.ofType("question.deferred").map((d): Gap => ({
      id: newId("gap"), kind: "deferred_question", description: d.payload.text, about: { eventIds: [d.id, ...d.payload.about.actionIds] },
      proposedQuestion: d.payload.text, priority: 0.8, status: "open",
    })),
    ...ix.ofType("agent.question").filter((q) => !answered.has(q.payload.questionId)).map((q): Gap => ({
      id: newId("gap"), kind: "unexplained_action", description: `Unanswered: ${q.payload.text}`, about: { eventIds: [q.id, ...q.payload.about.actionIds] },
      proposedQuestion: q.payload.text, priority: 0.7, status: "open",
    })),
  ];
  const commonMistakes: WorkMap["commonMistakes"] = [];
  for (const c of ix.ofType("knowledge.correction")) {
    if (c.payload.kind !== "action_was_mistake") continue;
    const a = c.payload.targets.actionIds?.[0];
    const act = a ? ix.byId.get(a) : undefined;
    const m = act ? ix.moment(act.t, [act.id, ...(c.payload.undoneBy ?? [])]) : null;
    const q = ix.quote(c.payload.utteranceIds, c.payload.quote);
    if (m && q) commonMistakes.push({ id: newId("mis"), description: c.payload.before ?? "", correctBehavior: c.payload.after ?? "", relatedIds: [], moment: m, quote: q, correctionEventId: c.id });
  }
  return {
    id: workMapId, version: 0, status: "draft", createdAt: now, updatedAt: now, sourceSessionIds: [session.id],
    expert: session.participant, task: session.task, summary: "", cases, steps: [], decisions: [], guardrails: [], glossary: [], gaps,
    teachBack: { segments: [], status: "pending" },
    stats: {
      liveQuestions: ix.ofType("agent.question").filter((q) => q.phase === "capture").length,
      debriefQuestions: ix.ofType("agent.question").filter((q) => q.phase === "debrief").length,
      judgmentCalls: 0, guardrails: 0,
    },
    commonMistakes, changelog: [],
  };
}

export interface AssembleProblem {
  where: string;
  problem: string;
}

/**
 * Turn an LLM proposal into Work Map claims with VERIFIED evidence.
 * Drops quotes that aren't verbatim, conditions that use unknown fields, and claims without any evidence.
 */
export function assemble(draft: WorkMap, proposal: ExtractionProposal, ix: LogIndex): { workmap: WorkMap; problems: AssembleProblem[] } {
  const problems: AssembleProblem[] = [];
  const corrections = ix.ofType("knowledge.correction");
  const verdictConfirmed = ix.ofType("teachback.verdict").some((v) => v.payload.verdict !== "unclear");

  const momentsFor = (actionIds: Id[], where: string): ScreenMoment[] => {
    const ms: ScreenMoment[] = [];
    for (const id of actionIds) {
      const a = ix.byId.get(id);
      if (!a) {
        problems.push({ where, problem: `unknown action ${id}` });
        continue;
      }
      const field = a.type === "screen.action" ? a.payload.field : undefined;
      const obs = ix.ofType("screen.observed").find((o) => a.type === "screen.action" && a.payload.evidence.observedIds.includes(o.id));
      const bbox = obs?.payload.changes.find((c) => c.field === field)?.bbox;
      const m = ix.moment(a.t, [id], bbox);
      if (m) ms.push(m);
    }
    return ms;
  };
  const quoteFor = (uid: Id, text: string, where: string): Quote | null => {
    const u = ix.utterances.get(uid);
    const q = ix.quote([uid], text, u?.payload.inReplyToQuestionId);
    if (!q) problems.push({ where, problem: `quote not verbatim in ${uid}: "${text.slice(0, 60)}"` });
    return q;
  };
  const provenanceOf = (moments: ScreenMoment[], quotes: Quote[]): Provenance[] => {
    const p = new Set<Provenance>();
    if (moments.length) p.add("observed");
    for (const q of quotes) p.add(q.phase === "debrief" ? "stated_debrief" : q.phase === "teachback" ? "teachback_correction" : "stated_live");
    if (!p.size) p.add("inferred");
    return [...p];
  };
  const historyOf = (quotes: Quote[], actionIds: Id[], refId?: Id): Claim["history"] =>
    corrections
      .filter((c) =>
        c.payload.targets.workMapRefs?.some((r) => r.id === refId) ||
        c.payload.utteranceIds.some((u) => quotes.some((q) => q.utteranceIds.includes(u))) ||
        c.payload.targets.utteranceIds?.some((u) => quotes.some((q) => q.utteranceIds.includes(u))) ||
        c.payload.targets.actionIds?.some((a) => actionIds.includes(a)))
      .filter((c) => c.payload.kind !== "action_was_mistake")
      .map((c) => ({ before: c.payload.before ?? "", after: c.payload.after ?? "", correctionEventId: c.id, at: c.t, phase: c.phase }));
  const claim = (moments: ScreenMoment[], quotes: Quote[], history: Claim["history"]): Claim => {
    const provenance = provenanceOf(moments, quotes);
    const inferredOnly = provenance.length === 1 && provenance[0] === "inferred";
    return { confidence: inferredOnly ? 0.4 : 0.85, provenance, confirmedByExpert: verdictConfirmed && !inferredOnly, history, evidence: { moments, quotes } };
  };

  const decisionId = new Map<string, Id>();
  const guardrailId = new Map<string, Id>();
  proposal.decisions.forEach((d) => decisionId.set(d.key, `dec_${slug(d.key)}`));
  proposal.guardrails.forEach((g) => guardrailId.set(g.key, `gr_${slug(g.key)}`));

  const steps: Step[] = proposal.steps.map((s, i) => {
    const id = `st_${i + 1}`;
    const moments = momentsFor(s.actionIds, `step ${i + 1}`);
    if (!moments.length) problems.push({ where: `step ${i + 1}`, problem: "no screen moment" });
    return {
      id, order: i + 1, title: s.title, goal: s.goal, instructions: s.instructions, screenMoment: moments[0], actionIds: s.actionIds,
      decisionIds: s.decisionKeys.map((k) => decisionId.get(k)).filter((x): x is Id => !!x),
      guardrailIds: s.guardrailKeys.map((k) => guardrailId.get(k)).filter((x): x is Id => !!x),
      appliesToCaseKinds: [...new Set(draft.cases.map((c) => c.kind))], optional: s.optional,
      observedInCases: [...new Set(s.actionIds.map((a) => ix.byId.get(a)?.caseId).filter((x): x is Id => !!x))],
      ...claim(moments, [], historyOf([], s.actionIds)),
    };
  });
  const stepOf = (key: string, kind: "decision" | "guardrail") =>
    proposal.steps.findIndex((s) => (kind === "decision" ? s.decisionKeys : s.guardrailKeys).includes(key));

  const decisions: Decision[] = [];
  for (const d of proposal.decisions) {
    const id = decisionId.get(d.key)!;
    const reason = quoteFor(d.reasonUtteranceId, d.reasonQuote, `decision ${d.key}`);
    if (!reason) continue; // a decision without the expert's words is not admitted
    const moments = momentsFor(d.actionIds, `decision ${d.key}`);
    const si = stepOf(d.key, "decision");
    decisions.push({
      id, stepId: si >= 0 ? `st_${si + 1}` : "", kind: d.kind, question: d.question, observedChoice: d.observedChoice,
      options: d.options.map((o) => ({ option: o.option, whenText: o.whenText })), reason, reasonSummary: d.reasonSummary,
      ...claim(moments, [reason], historyOf([reason], d.actionIds, id)),
    });
  }

  const guardrails: Guardrail[] = [];
  for (const g of proposal.guardrails) {
    const id = guardrailId.get(g.key)!;
    const quotes = g.quotes.map((q) => quoteFor(q.utteranceId, q.quote, `guardrail ${g.key}`)).filter((q): q is Quote => !!q);
    if (!quotes.length) {
      problems.push({ where: `guardrail ${g.key}`, problem: "dropped: no verbatim quote" });
      continue;
    }
    let condition: Condition | undefined;
    if (g.conditionJson) {
      try {
        condition = JSON.parse(g.conditionJson) as Condition;
        const bad = conditionFields(condition).filter((f) => !(FACT_PATHS as readonly string[]).includes(f));
        if (bad.length) {
          problems.push({ where: `guardrail ${g.key}`, problem: `condition uses unknown fields ${bad.join(", ")}` });
          condition = undefined;
        }
      } catch {
        problems.push({ where: `guardrail ${g.key}`, problem: "condition is not valid JSON" });
      }
    }
    const moments = momentsFor(g.actionIds, `guardrail ${g.key}`);
    guardrails.push({
      id, kind: g.kind, statement: g.statement, ...(condition ? { condition } : {}), requiredAction: g.requiredAction,
      ...(g.escalateToRole ? { escalateTo: { role: g.escalateToRole } } : {}), scope: g.scope,
      severity: condition ? g.severity : g.severity === "block" ? "warn" : g.severity, // un-checkable rules can't block
      stepIds: proposal.steps.map((s, i) => (s.guardrailKeys.includes(g.key) ? `st_${i + 1}` : "")).filter(Boolean),
      ...claim(moments, quotes, historyOf(quotes, g.actionIds, id)),
    });
  }

  const workmap: WorkMap = {
    ...draft,
    steps, decisions, guardrails,
    glossary: proposal.glossary.map((g) => ({ term: g.term, meaning: g.meaning })),
    stats: { ...draft.stats, judgmentCalls: decisions.length, guardrails: guardrails.length },
    updatedAt: new Date().toISOString(),
  };
  return { workmap, problems };
}

function conditionFields(c: Condition): string[] {
  if ("all" in c) return c.all.flatMap(conditionFields);
  if ("c" in c) return conditionFields(c.c);
  return [c.field];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "x";

/** Next immutable version of a Work Map with a changelog entry. */
export function nextVersion(prev: WorkMap | null, next: WorkMap, by: "map" | "expert", note: string, eventIds: Id[] = []): WorkMap {
  const version = (prev?.version ?? 0) + 1;
  const at = new Date().toISOString();
  return { ...next, version, updatedAt: at, changelog: [...(prev?.changelog ?? []), { version, at, by, note, eventIds }] };
}
