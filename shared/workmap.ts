/**
 * Map core (docs/map.md, MAP-PLAN.md §4): deterministic draft → LLM proposal → verified Work Map.
 * Everything that can be checked in code is checked here; the LLM only proposes.
 *
 *  - quotes must be verbatim (exact, else a punctuation/case-insensitive token match mapped back to the exact text)
 *  - quote times come from word timestamps
 *  - screen moments: the frame ~1 s after the canonical action (the change is visible), never inside off-record
 *  - conditions may only use CaseFacts paths (FACT_PATHS)
 *  - correction history is copied from the correction events, never rewritten by the LLM
 *  - ids are stable slugs (st_/dec_/gr_) so gaps, teach-back and Teach keep pointing at the same claims across versions
 */
import type {
  Claim, Condition, Decision, Event, Gap, Guardrail, Id, KnowledgeCorrection, Provenance, Quote, ScreenMoment, Session, Step, WorkMap,
} from "./schema";
import type { ExtractionProposal, LlmOutput } from "./llm";
import { FACT_PATHS } from "./llm";
import { LogIndex, fmtT } from "./logindex";
import { newId } from "./ids";

// ───────────────────────── condensed log for the LLM ─────────────────────────

/** Condensed, id-tagged log for the LLM. Off-record content never exists in the log, so it can't leak. */
export function condenseLog(ix: LogIndex): string {
  const lines: Array<[number, number, string]> = [];
  const push = (e: Event, s: string) => lines.push([e.t, e.seq, `[${fmtT(e.t)} ${e.phase}] ${s}`]);
  for (const e of ix.events) {
    switch (e.type) {
      case "marker.case_boundary":
        push(e, `CASE ${e.payload.state.toUpperCase()} ${e.payload.case.kind} ${e.payload.case.key}${e.payload.outcome ? ` → ${e.payload.outcome}` : ""}`);
        break;
      case "screen.action":
        push(e, `ACTION ${e.id}: ${e.payload.description}${e.payload.field ? ` [field ${e.payload.field}: ${fmtV(e.payload.from)} → ${fmtV(e.payload.to)}]` : ""}`);
        break;
      case "utterance":
        push(e, `${e.payload.speaker.toUpperCase()} ${e.payload.utteranceId} (${e.payload.addressedTo}${e.payload.inReplyToQuestionId ? `, reply to ${e.payload.inReplyToQuestionId}` : ""}): "${e.payload.text}"`);
        break;
      case "agent.question":
        push(e, `QUESTION ${e.payload.questionId} [${e.payload.category}] about ${e.payload.about.actionIds.join(",") || "-"}: "${e.payload.text}"`);
        break;
      case "answer.linked":
        push(e, `ANSWER to ${e.payload.questionId}: "${e.payload.quote}" (${e.payload.completeness})`);
        break;
      case "question.deferred":
        push(e, `DEFERRED QUESTION [${e.payload.category}]: "${e.payload.text}"`);
        break;
      case "knowledge.correction":
        push(e, `CORRECTION ${e.id} (${e.payload.kind}, ${e.payload.detectedBy}${e.payload.targets.actionIds?.length ? `, actions ${e.payload.targets.actionIds.join(",")}` : ""}): "${e.payload.before ?? ""}" → "${e.payload.after ?? ""}"`);
        break;
      case "marker.off_record":
        push(e, `OFF RECORD ${e.payload.state} (nothing recorded in between)`);
        break;
      case "teachback.verdict":
        push(e, `TEACHBACK ${e.payload.segmentId}: ${e.payload.verdict}${e.payload.correction ? ` ("${e.payload.correction}")` : ""}`);
        break;
    }
  }
  return lines.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((l) => l[2]).join("\n");
}

const fmtV = (v: unknown) => (v === null || v === undefined || v === "" ? "∅" : String(v));

// ───────────────────────── draft (no LLM) ─────────────────────────

/** Draft Work Map from the log alone: cases, gaps from deferred/unanswered questions, common mistakes. */
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
      id: `gap_${d.id}`, kind: "deferred_question", description: d.payload.text, about: { eventIds: [d.id, ...d.payload.about.actionIds] },
      proposedQuestion: d.payload.text, priority: 0.9, status: "open",
    })),
    ...ix.ofType("agent.question").filter((q) => q.phase === "capture" && !answered.has(q.payload.questionId)).map((q): Gap => ({
      id: `gap_${q.id}`, kind: "unexplained_action", description: `Unanswered: ${q.payload.text}`, about: { eventIds: [q.id, ...q.payload.about.actionIds] },
      proposedQuestion: q.payload.text, priority: 0.7, status: "open",
    })),
  ];
  const commonMistakes: WorkMap["commonMistakes"] = [];
  for (const c of ix.ofType("knowledge.correction")) {
    if (c.payload.kind !== "action_was_mistake") continue;
    const a = c.payload.targets.actionIds?.[0];
    const act = a ? ix.byId.get(a) : undefined;
    const m = act ? momentAt(ix, act.t, [act.id, ...(c.payload.undoneBy ?? [])], bboxOf(ix, act.id)) : null;
    const q = verbatimQuote(ix, c.payload.utteranceIds, c.payload.quote);
    if (m && q) commonMistakes.push({ id: `mis_${c.id}`, description: c.payload.before ?? "", correctBehavior: c.payload.after ?? "", relatedIds: [], moment: m, quote: q, correctionEventId: c.id });
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

// ───────────────────────── evidence helpers (pure, exported for tests/UI) ─────────────────────────

/**
 * Screen moment for an action at `t`: the last frame at or before t+1 s (shows the result of the change),
 * skipping frames inside off-record spans. `t` of the moment = the frame's time.
 */
export function momentAt(ix: LogIndex, t: number, eventIds: Id[], bbox?: ScreenMoment["bbox"]): ScreenMoment | null {
  let f = ix.frameAt(t + 1000) ?? ix.frameAt(t);
  while (f && ix.inOffRecord(f.t)) f = ix.frameAt(f.t - 1);
  // No screenshots (no screen share, vision off: the MiniERP bridge still gives exact actions): keep the
  // moment as a timestamped action without a thumbnail rather than dropping every step that cites it.
  if (!f) return ix.inOffRecord(t) ? null : { sessionId: ix.sessionId, t, frameId: "", eventIds, ...(bbox ? { bbox } : {}) };
  return { sessionId: ix.sessionId, t: f.t, frameId: f.payload.frameId, eventIds, ...(bbox ? { bbox } : {}) };
}

/** Field highlight for an action: from the vision observation linked to it, if any. */
export function bboxOf(ix: LogIndex, actionId: Id): ScreenMoment["bbox"] | undefined {
  const a = ix.byId.get(actionId);
  if (!a || a.type !== "screen.action" || !a.payload.field) return undefined;
  for (const oid of a.payload.evidence.observedIds) {
    const o = ix.byId.get(oid);
    if (o?.type !== "screen.observed") continue;
    const ch = o.payload.changes.find((c) => c.field === a.payload.field && c.bbox);
    if (ch?.bbox) return ch.bbox;
    const ent = o.payload.visibleEntities.find((v) => v.fields && a.payload.field && a.payload.field in v.fields && v.bbox);
    if (ent?.bbox) return ent.bbox;
    if (o.payload.focus?.field === a.payload.field && o.payload.focus.bbox) return o.payload.focus.bbox;
  }
  return undefined;
}

const norm = (w: string) => w.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Find `needle` in `hay`: exact first, then a token match that ignores case and punctuation.
 * Returns the EXACT substring of `hay` (so stored quotes are always verbatim) or null.
 */
export function findVerbatim(hay: string, needle: string): string | null {
  const n = needle.trim();
  if (!n) return null;
  if (hay.includes(n)) return n;
  const toks: Array<{ w: string; a: number; b: number }> = [];
  const re = /\S+/g;
  for (let m; (m = re.exec(hay)); ) if (norm(m[0])) toks.push({ w: norm(m[0]), a: m.index, b: m.index + m[0].length });
  const want = n.split(/\s+/).map(norm).filter(Boolean);
  if (!want.length) return null;
  for (let i = 0; i + want.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length && ok; j++) ok = toks[i + j].w === want[j];
    if (ok) return hay.slice(toks[i].a, toks[i + want.length - 1].b);
  }
  return null;
}

/** Verified quote with word-accurate timing, or null if the text isn't (near-)verbatim in those utterances. */
export function verbatimQuote(ix: LogIndex, utteranceIds: Id[], text: string, questionId?: Id): Quote | null {
  for (const uid of utteranceIds) {
    const u = ix.utterances.get(uid);
    if (!u) continue;
    const exact = findVerbatim(u.payload.text, text);
    if (!exact) continue;
    const q = ix.quote([uid], exact, questionId ?? u.payload.inReplyToQuestionId);
    if (q) return q;
  }
  return null;
}

// ───────────────────────── assemble (proposal → verified Work Map) ─────────────────────────

export interface AssembleProblem {
  where: string;
  problem: string;
}

export interface AssembleOptions {
  /** Previous version: keeps gaps, teach-back, status, createdAt, and lets confirmations carry over. */
  prev?: WorkMap | null;
}

/** Map an LLM key to a stable id with the right prefix: "capex" → "dec_capex", "dec_capex" → "dec_capex". */
export function stableId(prefix: "st" | "dec" | "gr", key: string): Id {
  const k = key.trim();
  if (k.startsWith(`${prefix}_`)) return `${prefix}_${slug(k.slice(prefix.length + 1))}`;
  return `${prefix}_${slug(k)}`;
}

/**
 * Turn an LLM proposal into Work Map claims with VERIFIED evidence.
 * Drops quotes that aren't verbatim, conditions that use unknown fields, and claims without required evidence.
 */
export function assemble(draft: WorkMap, proposal: ExtractionProposal, ix: LogIndex, opts: AssembleOptions = {}): { workmap: WorkMap; problems: AssembleProblem[] } {
  const problems: AssembleProblem[] = [];
  const prev = opts.prev ?? null;
  const corrections = [...ix.ofType("knowledge.correction")].sort((a, b) => a.seq - b.seq);
  const correctionById = new Map(corrections.map((c) => [c.id, c]));

  // ids: dedupe keys within each kind
  const idMaps = { st: new Map<string, Id>(), dec: new Map<string, Id>(), gr: new Map<string, Id>() };
  const used = new Set<Id>();
  const assign = (prefix: "st" | "dec" | "gr", key: string) => {
    let id = stableId(prefix, key);
    for (let i = 2; used.has(id); i++) id = `${stableId(prefix, key)}_${i}`;
    used.add(id);
    idMaps[prefix].set(key, id);
    return id;
  };
  proposal.steps.forEach((s) => assign("st", s.key || s.title));
  proposal.decisions.forEach((d) => assign("dec", d.key));
  proposal.guardrails.forEach((g) => assign("gr", g.key));
  const refId = (key: string): Id | undefined => idMaps.st.get(key) ?? idMaps.dec.get(key) ?? idMaps.gr.get(key)
    ?? [...used].find((id) => id === key || id === stableId("st", key) || id === stableId("dec", key) || id === stableId("gr", key));

  const validActions = (ids: Id[], where: string): Id[] =>
    ids.filter((id) => {
      const ok = ix.byId.get(id)?.type === "screen.action" || ix.byId.get(id)?.type === "app.event";
      if (!ok && id) problems.push({ where, problem: `unknown action ${id}` });
      return ok;
    });
  const momentsFor = (actionIds: Id[]): ScreenMoment[] =>
    actionIds.map((id) => momentAt(ix, ix.byId.get(id)!.t, [id], bboxOf(ix, id))).filter((m): m is ScreenMoment => !!m);
  const quoteFor = (uid: Id, text: string, where: string): Quote | null => {
    const q = verbatimQuote(ix, [uid], text);
    if (!q) problems.push({ where, problem: `quote not verbatim in ${uid}: "${text.slice(0, 60)}"` });
    else if (ix.utterances.get(uid)?.payload.speaker !== "expert") {
      problems.push({ where, problem: `quote ${uid} is not the expert's words` });
      return null;
    }
    return q;
  };
  const parseCondition = (json: string, where: string): Condition | undefined => {
    const r = checkCondition(json);
    if (r.problem) problems.push({ where, problem: r.problem });
    return r.condition;
  };

  // correction → claim ids (LLM mapping ∪ explicit workMapRefs ∪ evidence overlap), mistakes excluded
  const llmTargets = new Map<Id, Set<Id>>();
  for (const ct of proposal.correctionTargets ?? []) {
    if (!correctionById.has(ct.correctionEventId)) {
      problems.push({ where: "correctionTargets", problem: `unknown correction ${ct.correctionEventId}` });
      continue;
    }
    const s = llmTargets.get(ct.correctionEventId) ?? new Set<Id>();
    ct.keys.map(refId).forEach((id) => id && s.add(id));
    llmTargets.set(ct.correctionEventId, s);
  }
  const historyOf = (id: Id, quotes: Quote[], actionIds: Id[]): Claim["history"] =>
    corrections
      .filter((c) => c.payload.kind !== "action_was_mistake")
      .filter((c) =>
        llmTargets.get(c.id)?.has(id) ||
        c.payload.targets.workMapRefs?.some((r) => r.id === id) ||
        c.payload.utteranceIds.some((u) => quotes.some((q) => q.utteranceIds.includes(u))) ||
        c.payload.targets.utteranceIds?.some((u) => quotes.some((q) => q.utteranceIds.includes(u))) ||
        c.payload.targets.actionIds?.some((a) => actionIds.includes(a)))
      .map((c) => ({ before: c.payload.before ?? "", after: c.payload.after ?? "", correctionEventId: c.id, at: c.t, phase: c.phase }));

  // teach-back confirmation carries over from the previous version (segments → step ids); a part that was corrected
  // but never re-confirmed doesn't count
  const confirmedSteps = new Set<Id>((prev?.teachBack.segments ?? []).filter((s) => s.verdict === "confirmed").flatMap((s) => s.stepIds));
  const wholeMapConfirmed = prev?.teachBack.status === "confirmed";

  const claim = (id: Id, moments: ScreenMoment[], quotes: Quote[], actionIds: Id[], stepIds: Id[]): Claim => {
    const history = historyOf(id, quotes, actionIds);
    const p = new Set<Provenance>();
    if (moments.length) p.add("observed");
    for (const q of quotes) p.add(q.phase === "debrief" ? "stated_debrief" : q.phase === "teachback" ? "teachback_correction" : "stated_live");
    if (history.some((h) => h.phase === "teachback")) p.add("teachback_correction");
    if (history.some((h) => h.phase === "debrief")) p.add("stated_debrief");
    if (!p.size) p.add("inferred");
    const provenance = [...p];
    const inferredOnly = provenance.length === 1 && provenance[0] === "inferred";
    const confirmed = !inferredOnly && (wholeMapConfirmed || stepIds.some((s) => confirmedSteps.has(s)));
    const confidence = inferredOnly ? 0.4 : quotes.length && moments.length ? 0.95 : quotes.length ? 0.85 : 0.75;
    return { confidence, provenance, confirmedByExpert: confirmed, history, evidence: { moments, quotes } };
  };

  // ── guardrails first (steps reference them)
  const guardrails: Guardrail[] = [];
  for (const g of proposal.guardrails) {
    const id = idMaps.gr.get(g.key)!;
    const where = `guardrail ${id}`;
    const quotes = g.quotes.map((q) => quoteFor(q.utteranceId, q.quote, where)).filter((q): q is Quote => !!q);
    if (!quotes.length) {
      problems.push({ where, problem: "dropped: no verbatim quote in the expert's words" });
      continue;
    }
    const actionIds = validActions(g.actionIds, where);
    const moments = momentsFor(actionIds);
    if (!moments.length) problems.push({ where, problem: "no screen moment (no valid action)" });
    const condition = parseCondition(g.conditionJson, where);
    const stepIds = proposal.steps.filter((s) => s.guardrailKeys.includes(g.key)).map((s) => idMaps.st.get(s.key || s.title)!);
    guardrails.push({
      id, kind: g.kind, statement: g.statement, ...(condition ? { condition } : {}), requiredAction: g.requiredAction,
      ...(g.escalateToRole ? { escalateTo: { role: g.escalateToRole, ...(g.escalateToName ? { name: g.escalateToName } : {}) } } : {}),
      scope: g.scope,
      severity: condition ? g.severity : g.severity === "block" ? "warn" : g.severity, // un-checkable rules can't block
      stepIds,
      ...claim(id, moments, quotes, actionIds, stepIds),
    });
  }
  const grIds = new Set(guardrails.map((g) => g.id));

  // ── decisions
  const decisions: Decision[] = [];
  for (const d of proposal.decisions) {
    const id = idMaps.dec.get(d.key)!;
    const where = `decision ${id}`;
    const reason = quoteFor(d.reasonUtteranceId, d.reasonQuote, where);
    if (!reason) {
      problems.push({ where, problem: "dropped: no verbatim reason in the expert's words" });
      continue;
    }
    const actionIds = validActions(d.actionIds, where);
    const moments = momentsFor(actionIds);
    if (!moments.length) problems.push({ where, problem: "no screen moment (no valid action)" });
    const step = proposal.steps.find((s) => s.decisionKeys.includes(d.key));
    const stepId = step ? idMaps.st.get(step.key || step.title)! : "";
    decisions.push({
      id, stepId, kind: d.kind, question: d.question, observedChoice: d.observedChoice,
      options: d.options.map((o, i) => {
        const when = parseCondition(o.whenJson, `${where} option ${i + 1}`);
        return { option: o.option, ...(when ? { when } : {}), ...(o.whenText ? { whenText: o.whenText } : {}) };
      }),
      reason, reasonSummary: d.reasonSummary,
      ...claim(id, moments, [reason], actionIds, stepId ? [stepId] : []),
    });
  }
  const decIds = new Set(decisions.map((d) => d.id));

  // ── steps
  const steps: Step[] = [];
  proposal.steps.forEach((s, i) => {
    const id = idMaps.st.get(s.key || s.title)!;
    const where = `step ${id}`;
    const actionIds = validActions(s.actionIds, where);
    const canonical = validActions(s.momentActionId ? [s.momentActionId] : [], where)[0] ?? actionIds[0];
    const moments = momentsFor(canonical ? [canonical, ...actionIds.filter((a) => a !== canonical)] : []);
    if (!moments.length) {
      problems.push({ where, problem: "dropped: no screen moment (every step needs one)" });
      return;
    }
    const when = s.optional ? parseCondition(s.whenJson, `${where} when`) : undefined;
    const decisionIds = s.decisionKeys.map((k) => idMaps.dec.get(k)).filter((x): x is Id => !!x && decIds.has(x));
    const guardrailIds = s.guardrailKeys.map((k) => idMaps.gr.get(k)).filter((x): x is Id => !!x && grIds.has(x));
    steps.push({
      id, order: i + 1, title: s.title, goal: s.goal, instructions: s.instructions, screenMoment: moments[0], actionIds,
      decisionIds, guardrailIds,
      appliesToCaseKinds: [...new Set(draft.cases.map((c) => c.kind))], optional: s.optional,
      ...(when ? { when } : {}), ...(s.optional && s.whenText ? { whenText: s.whenText } : {}),
      observedInCases: [...new Set(actionIds.map((a) => ix.byId.get(a)?.caseId).filter((x): x is Id => !!x))],
      ...claim(id, moments, [], actionIds, [id]),
    });
  });
  steps.forEach((s, i) => (s.order = i + 1));
  // decisions/guardrails pointing at dropped steps
  const stIds = new Set(steps.map((s) => s.id));
  for (const d of decisions) if (d.stepId && !stIds.has(d.stepId)) d.stepId = "";
  for (const g of guardrails) g.stepIds = g.stepIds.filter((s) => stIds.has(s));

  // ── common mistakes: draft (from corrections) + LLM's teaching text and related claims
  const commonMistakes = draft.commonMistakes.map((m) => {
    const p = (proposal.mistakes ?? []).find((x) => x.correctionEventId === m.correctionEventId);
    if (!p) return m;
    return {
      ...m,
      description: p.description || m.description,
      correctBehavior: p.correctBehavior || m.correctBehavior,
      relatedIds: p.relatedKeys.map(refId).filter((x): x is Id => !!x && (decIds.has(x) || grIds.has(x) || stIds.has(x))),
    };
  });

  // ── gaps: keep the previous version's (debrief state), add new draft gaps; claims with no explanation become gaps
  const gaps: Gap[] = (prev?.gaps ?? []).map((g) => ({ ...g, about: { ...g.about } }));
  const haveGap = (id: Id) => gaps.some((g) => g.id === id);
  // a draft gap is the same gap as an existing one if it comes from the same source event (e.g. the deferred question)
  for (const g of draft.gaps) if (!haveGap(g.id) && !gaps.some((x) => x.kind === g.kind && x.about.eventIds.some((id) => g.about.eventIds.includes(id)))) gaps.push(g);
  // latest gap.status in the log wins (the debrief writes these)
  for (const e of ix.ofType("gap.status")) {
    const g = gaps.find((x) => x.id === e.payload.gapId);
    if (g) g.status = e.payload.status;
  }
  for (const s of steps) {
    const explained = s.decisionIds.length || s.guardrailIds.length || s.provenance.some((p) => p.startsWith("stated"));
    const gid = `gap_why_${s.id}`;
    if (!explained && s.observedInCases.length === 1 && !haveGap(gid) && s.optional) {
      gaps.push({ id: gid, kind: "unexplained_action", description: `Seen once, never explained: ${s.title}`, about: { stepId: s.id, eventIds: s.actionIds }, proposedQuestion: `Why did you ${lowerFirst(s.title)} on that one, and when do you do it?`, priority: 0.6, status: "open" });
    }
  }

  const workmap: WorkMap = {
    ...draft,
    ...(prev ? { id: prev.id, createdAt: prev.createdAt, status: prev.status, teachBack: prev.teachBack } : {}),
    summary: proposal.summary || draft.summary,
    steps, decisions, guardrails,
    glossary: proposal.glossary.map((g) => ({ term: g.term, meaning: g.meaning })),
    gaps,
    commonMistakes,
    stats: { ...draft.stats, judgmentCalls: decisions.filter((d) => d.kind === "rule" || d.kind === "judgment").length, guardrails: guardrails.length },
    updatedAt: new Date().toISOString(),
  };
  // corrections that ended up nowhere → visible problem (validator warns on the same thing)
  const applied = new Set([...steps, ...decisions, ...guardrails].flatMap((c) => c.history.map((h) => h.correctionEventId)));
  commonMistakes.forEach((m) => applied.add(m.correctionEventId));
  for (const c of corrections) if (!applied.has(c.id)) problems.push({ where: `correction ${c.id}`, problem: `not reflected in any claim (${c.payload.kind}: ${(c.payload.after ?? "").slice(0, 60)})` });
  return { workmap, problems };
}

/** One call: draft + assemble + next immutable version. */
export function buildWorkMap(session: Session, events: Event[], proposal: ExtractionProposal, prev: WorkMap | null, note: string, by: "map" | "expert" = "map", eventIds: Id[] = []) {
  const ix = new LogIndex(session.id, events);
  const draft = buildDraft(session, events, prev?.id ?? session.workMapId);
  const { workmap, problems } = assemble(draft, proposal, ix, { prev });
  return { workmap: nextVersion(prev, workmap, by, note, eventIds), problems };
}

/** Ids of the previous version, passed to the LLM so it reuses them. */
export function existingIds(wm: WorkMap | null): Array<{ id: Id; kind: "step" | "decision" | "guardrail"; title: string }> {
  if (!wm) return [];
  return [
    ...wm.steps.map((s) => ({ id: s.id, kind: "step" as const, title: s.title })),
    ...wm.decisions.map((d) => ({ id: d.id, kind: "decision" as const, title: d.question })),
    ...wm.guardrails.map((g) => ({ id: g.id, kind: "guardrail" as const, title: g.statement })),
  ];
}

/**
 * The proposal a perfect LLM would return for an existing Work Map. Used by tests (assemble must reproduce the
 * oracle) and as a deterministic "replay" when no LLM is available.
 */
export function proposalFromWorkMap(wm: WorkMap, corrections: KnowledgeCorrection[] = [], ix?: LogIndex): ExtractionProposal {
  // steps observed without their own action (e.g. "review the invoice") anchor on the last action before their moment
  const anchor = (m: ScreenMoment): Id[] => {
    if (m.eventIds.length || !ix) return m.eventIds;
    const before = ix.ofType("screen.action").filter((a) => a.t <= m.t).at(-1);
    return before ? [before.id] : [];
  };
  const cj = (c?: Condition) => (c ? JSON.stringify(c) : "");
  const corrTargets = new Map<Id, Set<string>>();
  for (const c of [...wm.steps, ...wm.decisions, ...wm.guardrails]) for (const h of c.history) {
    const s = corrTargets.get(h.correctionEventId) ?? new Set<string>();
    s.add(c.id);
    corrTargets.set(h.correctionEventId, s);
  }
  const mistakeIds = new Set(wm.commonMistakes.map((m) => m.correctionEventId));
  return {
    summary: wm.summary,
    steps: wm.steps.map((s) => ({
      key: s.id, title: s.title, goal: s.goal, instructions: s.instructions,
      actionIds: s.actionIds.length ? s.actionIds : anchor(s.screenMoment),
      momentActionId: anchor(s.screenMoment)[0] ?? "",
      decisionKeys: s.decisionIds, guardrailKeys: s.guardrailIds, optional: s.optional, whenJson: cj(s.when), whenText: s.whenText ?? "",
    })),
    decisions: wm.decisions.map((d) => ({
      key: d.id, kind: d.kind, question: d.question, observedChoice: d.observedChoice,
      options: d.options.map((o) => ({ option: o.option, whenText: o.whenText ?? "", whenJson: cj(o.when) })),
      reasonUtteranceId: d.reason.utteranceIds[0], reasonQuote: d.reason.text, reasonSummary: d.reasonSummary,
      actionIds: d.evidence.moments.flatMap((m) => m.eventIds),
    })),
    guardrails: wm.guardrails.map((g) => ({
      key: g.id, kind: g.kind, statement: g.statement, conditionJson: cj(g.condition), requiredAction: g.requiredAction,
      escalateToRole: g.escalateTo?.role ?? "", escalateToName: g.escalateTo?.name ?? "", scope: g.scope, severity: g.severity,
      quotes: g.evidence.quotes.map((q) => ({ utteranceId: q.utteranceIds[0], quote: q.text })),
      actionIds: g.evidence.moments.flatMap((m) => m.eventIds),
    })),
    glossary: wm.glossary.map((g) => ({ term: g.term, meaning: g.meaning })),
    mistakes: wm.commonMistakes.map((m) => ({ correctionEventId: m.correctionEventId, description: m.description, correctBehavior: m.correctBehavior, relatedKeys: m.relatedIds })),
    correctionTargets: corrections.filter((c) => !mistakeIds.has(c.id) && corrTargets.has(c.id)).map((c) => ({ correctionEventId: c.id, keys: [...corrTargets.get(c.id)!] })),
  };
}

/** Parse an LLM condition; only FACT_PATHS fields pass ("" = no condition). */
function checkCondition(json: string): { condition?: Condition; problem?: string } {
  if (!json || !json.trim()) return {};
  try {
    const c = JSON.parse(json) as Condition;
    const badOps = conditionOps(c).filter((op) => !(KNOWN_OPS as readonly string[]).includes(op));
    if (badOps.length) return { problem: `condition uses unknown operator ${[...new Set(badOps)].join(", ")}` };
    const bad = conditionFields(c).filter((f) => !(FACT_PATHS as readonly string[]).includes(f));
    return bad.length ? { problem: `condition uses unknown fields ${bad.join(", ")}` } : { condition: c };
  } catch {
    return { problem: "condition is not valid JSON" };
  }
}

// ───────────────────────── teach-back patches (LLM rewrite → verified claim text) ─────────────────────────

export type ClaimKind = "step" | "decision" | "guardrail";
type AnyClaim = Step | Decision | Guardrail;

/** Fields a teach-back correction may rewrite, per claim kind; evidence, ids and links stay as extracted. */
export const PATCHABLE: Readonly<Record<ClaimKind, readonly string[]>> = {
  step: ["title", "goal", "instructions", "whenText", "whenJson"],
  decision: ["question", "observedChoice", "reasonSummary"],
  guardrail: ["statement", "requiredAction", "scope", "escalateToRole", "escalateToName", "conditionJson"],
};

export interface ClaimChange {
  ref: { kind: ClaimKind; id: Id };
  before: string;
  after: string;
}

const findClaim = (wm: WorkMap, id: Id): { kind: ClaimKind; claim: AnyClaim } | null => {
  const s = wm.steps.find((x) => x.id === id);
  if (s) return { kind: "step", claim: s };
  const d = wm.decisions.find((x) => x.id === id);
  if (d) return { kind: "decision", claim: d };
  const g = wm.guardrails.find((x) => x.id === id);
  return g ? { kind: "guardrail", claim: g } : null;
};

function readField(c: AnyClaim, field: string): string {
  if (field === "whenJson") return "when" in c && c.when ? JSON.stringify(c.when) : "";
  if (field === "conditionJson") return "condition" in c && c.condition ? JSON.stringify(c.condition) : "";
  if (field === "escalateToRole") return ("escalateTo" in c && c.escalateTo?.role) || "";
  if (field === "escalateToName") return ("escalateTo" in c && c.escalateTo?.name) || "";
  const v = (c as unknown as Record<string, unknown>)[field];
  return typeof v === "string" ? v : "";
}

function writeField<C extends AnyClaim>(c: C, field: string, value: string, condition?: Condition): C {
  if (field === "whenJson") return { ...c, when: condition };
  if (field === "conditionJson") return { ...c, condition };
  if (field === "escalateToRole" || field === "escalateToName") {
    const e = "escalateTo" in c ? c.escalateTo : undefined;
    const role = field === "escalateToRole" ? value : e?.role ?? "";
    const name = field === "escalateToName" ? value : e?.name;
    return { ...c, escalateTo: { role, ...(name ? { name } : {}) } };
  }
  return { ...c, [field]: value };
}

/** Current patchable fields of the given claims (the patch_claim input). */
export function claimFields(wm: WorkMap, ids: Id[]): Array<{ kind: ClaimKind; id: Id; fields: Array<{ field: string; value: string }> }> {
  return ids.flatMap((id) => {
    const f = findClaim(wm, id);
    return f ? [{ kind: f.kind, id, fields: PATCHABLE[f.kind].map((field) => ({ field, value: readField(f.claim, field) })) }] : [];
  });
}

/**
 * Apply an LLM rewrite of claims after a teach-back correction, verified like an extraction: at least one quote
 * verbatim in the expert's words (else nothing changes), only claims of the corrected part, only PATCHABLE fields,
 * conditions on FACT_PATHS only. Returns a new Work Map (not a new version) and what changed, for the correction
 * events that put the old text into each claim's history.
 */
export function applyClaimPatch(wm: WorkMap, out: LlmOutput<"patch_claim">, ix: LogIndex, allowedIds: Id[]): { workmap: WorkMap; changes: ClaimChange[]; quote: Quote | null; problems: AssembleProblem[] } {
  const problems: AssembleProblem[] = [];
  const where = "patch_claim";
  const quote = out.quotes
    .map((q) => (ix.utterances.get(q.utteranceId)?.payload.speaker === "expert" ? verbatimQuote(ix, [q.utteranceId], q.quote) : null))
    .find((q): q is Quote => !!q) ?? null;
  if (!quote) {
    problems.push({ where, problem: "dropped: no verbatim quote in the expert's reply" });
    return { workmap: wm, changes: [], quote: null, problems };
  }
  const patched = new Map<Id, { kind: ClaimKind; claim: AnyClaim; before: string[]; after: string[] }>();
  for (const p of out.patches) {
    const value = p.value.trim();
    const f = findClaim(wm, p.id);
    if (!allowedIds.includes(p.id) || !f) {
      problems.push({ where, problem: `${p.id} is not a claim of the corrected part` });
      continue;
    }
    if (!PATCHABLE[f.kind].includes(p.field)) {
      problems.push({ where: `${f.kind} ${p.id}`, problem: `field ${p.field} can't be patched` });
      continue;
    }
    if (!value) continue;
    const cond = p.field === "conditionJson" || p.field === "whenJson" ? checkCondition(value) : {};
    if (cond.problem) {
      problems.push({ where: `${f.kind} ${p.id}`, problem: cond.problem });
      continue;
    }
    const cur = patched.get(p.id) ?? { kind: f.kind, claim: f.claim, before: [], after: [] };
    const old = readField(cur.claim, p.field);
    if (old === value) continue;
    patched.set(p.id, { ...cur, claim: writeField(cur.claim, p.field, value, cond.condition), before: [...cur.before, `${p.field}: ${old}`], after: [...cur.after, `${p.field}: ${value}`] });
  }
  const pick = <C extends AnyClaim>(c: C): C => (patched.get(c.id)?.claim as C | undefined) ?? c;
  const label = (xs: string[]) => (xs.length === 1 ? xs[0].replace(/^\w+: /, "") : xs.join(" · "));
  return {
    workmap: { ...wm, steps: wm.steps.map(pick), decisions: wm.decisions.map(pick), guardrails: wm.guardrails.map(pick) },
    changes: [...patched.entries()].map(([id, p]) => ({ ref: { kind: p.kind, id }, before: label(p.before), after: label(p.after) })),
    quote,
    problems,
  };
}

const KNOWN_OPS = ["and", "or", "not", "eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "missing"] as const;

/** Every `op` in an (untrusted, parsed) condition tree; a node without a string op reports "(none)". */
function conditionOps(c: unknown): string[] {
  if (c === null || typeof c !== "object") return ["(none)"];
  const node = c as { op?: unknown; all?: unknown; c?: unknown };
  const op = typeof node.op === "string" ? node.op : "(none)";
  const kids = Array.isArray(node.all) ? node.all.flatMap(conditionOps) : node.c !== undefined ? conditionOps(node.c) : [];
  return [op, ...kids];
}

function conditionFields(c: Condition): string[] {
  if ("all" in c) return c.all.flatMap(conditionFields);
  if ("c" in c) return conditionFields(c.c);
  return [c.field];
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "x";
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Next immutable version of a Work Map with a changelog entry. */
export function nextVersion(prev: WorkMap | null, next: WorkMap, by: "map" | "expert", note: string, eventIds: Id[] = []): WorkMap {
  const version = (prev?.version ?? 0) + 1;
  const at = new Date().toISOString();
  return { ...next, version, updatedAt: at, changelog: [...(prev?.changelog ?? []), { version, at, by, note, eventIds }] };
}
