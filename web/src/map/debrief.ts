/**
 * Debrief + teach-back (docs/map.md rules 12–18, MAP-PLAN.md §6–8). Map owns WHAT is said; it runs on the
 * CaptureHub's voice + transcript so every turn lands in the same session log (phase "debrief" / "teachback").
 *
 * Order matters (MAP-PLAN F3/F4): a Work Map version WITH the open gaps is written before the first gap.status
 * event, so the log never points at gaps that don't exist yet.
 */
import type { Gap, Id, QuestionCategory, Utterance, WorkMap } from "@shared/schema";
import { LogIndex } from "@shared/logindex";
import { buildDraft, buildWorkMap, condenseLog, existingIds, nextVersion, proposalFromWorkMap } from "@shared/workmap";
import { FACT_PATHS } from "@shared/llm";
import { newId } from "@shared/ids";
import { llm } from "../lib/api";
import { loadWorkMap, saveWorkMapVersion, updateSession } from "../lib/sessions";
import type { CaptureHub } from "../capture/hub";

export interface DebriefStatus {
  stage: "planning" | "asking" | "extracting" | "teachback" | "confirmed" | "error";
  detail: string;
  /** Open gaps with priority ≥ 0.5: the debrief ends when this reaches 0 (Apprentice Test Q3). */
  gapsOpen: number;
  gaps?: Array<Pick<Gap, "id" | "proposedQuestion" | "priority" | "status" | "kind">>;
  asked?: number;
  segment?: { id: Id; text: string };
  segments?: Array<{ id: Id; text: string; verdict?: "confirmed" | "corrected" | "unclear" }>;
  workMapVersion?: number;
  problems?: string[];
}

export const DEBRIEF = { maxQuestions: 8, minQuestions: 3, stopBelowPriority: 0.5, maxTeachbackRetries: 2 };

const DONE = /\b(that'?s (all|it|everything)|nothing else|we'?re done|i'?m done|no more)\b/i;

const CATEGORY: Record<string, QuestionCategory> = {
  deferred_question: "scope", unknown_scope: "scope", who_decides: "who_decides", unseen_case: "stop_and_ask",
  conflict: "counterfactual", habit_vs_rule: "frequency", low_confidence: "frequency", missing_threshold: "guardrail_limit",
  unexplained_action: "why",
};
const GAP_KIND: Record<string, Gap["kind"]> = {
  deferred_question: "deferred_question", unknown_scope: "unknown_scope", who_decides: "who_decides", unseen_case: "unseen_case",
  conflict: "conflict", habit_vs_rule: "low_confidence", low_confidence: "low_confidence", missing_threshold: "missing_threshold",
  unexplained_action: "unexplained_action",
};

/** Rough "same question" test so the debrief never repeats a live question (validator rule) or asks twice. */
function similar(a: string, b: string): boolean {
  const toks = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9äöüß ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let n = 0;
  A.forEach((w) => B.has(w) && n++);
  return n / Math.min(A.size, B.size) >= 0.7;
}

const openHigh = (gaps: Gap[]) => gaps.filter((g) => g.status === "open" && g.priority >= DEBRIEF.stopBelowPriority).length;
const gapView = (gaps: Gap[]) => gaps.map((g) => ({ id: g.id, proposedQuestion: g.proposedQuestion, priority: g.priority, status: g.status, kind: g.kind }));

export async function runDebrief(hub: CaptureHub, onStatus: (s: DebriefStatus) => void, opts = DEBRIEF): Promise<WorkMap | null> {
  const session = hub.session;
  let problems: string[] = [];
  try {
    if (hub.state.phase !== "debrief") hub.setPhase("debrief");

    // ── 1. plan: draft gaps (deferred / unanswered) + LLM gaps, deduped against live questions
    onStatus({ stage: "planning", detail: "Finding what I still don't understand…", gapsOpen: 0 });
    let ix = new LogIndex(session.id, hub.events);
    const prevSaved = session.workMapId ? await loadWorkMap(session.workMapId) : null;
    const draft = buildDraft(session, hub.events, prevSaved?.id);
    const liveTexts = ix.ofType("agent.question").map((q) => q.payload.text);
    let planned: Gap[] = [];
    try {
      const plan = await llm("plan_debrief", {
        log: condenseLog(ix),
        workmapSummary: draft.cases.map((c) => `${c.kind} ${c.key}: ${c.outcome ?? "?"}`).join("; "),
        deferredQuestions: ix.ofType("question.deferred").map((d) => d.payload.text),
      });
      planned = plan.gaps.map((g): Gap => ({
        id: newId("gap"), kind: GAP_KIND[g.kind] ?? "unknown_scope", description: g.description,
        about: { eventIds: g.aboutActionIds.filter((id) => ix.byId.has(id)) }, proposedQuestion: g.proposedQuestion,
        priority: Math.max(0, Math.min(1, g.priority)), status: "open",
      }));
    } catch (err) {
      problems.push(`plan_debrief failed: ${(err as Error).message}`);
    }
    const gaps: Gap[] = [];
    for (const g of [...draft.gaps, ...planned].sort((a, b) => b.priority - a.priority)) {
      if (liveTexts.some((t) => similar(t, g.proposedQuestion))) continue; // already asked live
      if (gaps.some((x) => similar(x.proposedQuestion, g.proposedQuestion))) continue; // duplicate
      gaps.push(g);
    }
    const plan = gaps.slice(0, opts.maxQuestions);

    // write the plan into a version before any gap.status event
    let wm: WorkMap = nextVersion(prevSaved, { ...(prevSaved ?? draft), ...draft, gaps: plan, status: "debrief", ...(prevSaved ? { steps: prevSaved.steps, decisions: prevSaved.decisions, guardrails: prevSaved.guardrails, glossary: prevSaved.glossary } : {}) }, "map", `Debrief plan: ${plan.length} gaps`);
    await saveWorkMapVersion(wm);
    if (!session.workMapId) await updateSession(session.id, { workMapId: wm.id });
    session.workMapId = wm.id;

    // ── 2. ask in priority order until no open gap ≥ threshold, the expert is done, or the cap
    await hub.agentSay("Thanks, that was really helpful. I have a few things I couldn't work out from the screen.", "other");
    let asked = 0;
    for (const g of plan) {
      const status: DebriefStatus = { stage: "asking", detail: g.proposedQuestion, gapsOpen: openHigh(plan), gaps: gapView(plan), asked, workMapVersion: wm.version };
      if (asked >= opts.maxQuestions) break;
      if (asked >= opts.minQuestions && openHigh(plan) === 0) break;
      if (asked >= opts.minQuestions && g.priority < opts.stopBelowPriority) break;
      onStatus(status);
      const { questionId, replies } = await hub.ask(g.proposedQuestion, { category: CATEGORY[g.kind] ?? "scope", gapId: g.id, actionIds: g.about.eventIds.filter((id) => ix.byId.get(id)?.type === "screen.action"), intent: "follow_up" });
      asked++;
      g.status = replies.length ? "resolved" : "asked";
      if (replies.length) {
        const link = [...hub.events].reverse().find((e) => e.type === "answer.linked" && e.payload.questionId === questionId);
        if (link) g.resolvedBy = { questionId, answerEventId: link.id };
      }
      hub.emit({ t: hub.now(), type: "gap.status", source: "map", payload: { gapId: g.id, status: g.status } });
      onStatus({ ...status, gapsOpen: openHigh(plan), gaps: gapView(plan), asked });
      if (asked >= opts.minQuestions && replies.some((r) => DONE.test(r.payload.text))) break;
    }
    for (const g of plan) if (g.status === "open" && g.priority < opts.stopBelowPriority) g.status = "wont_fix";

    // ── 3. extract the Work Map from everything so far (ids reused from the previous version)
    onStatus({ stage: "extracting", detail: "Building the Work Map…", gapsOpen: openHigh(plan), gaps: gapView(plan), asked });
    ({ wm, problems } = await extract(hub, wm, `Debrief: ${asked} questions`, problems));
    wm = { ...wm, gaps: mergeGaps(wm.gaps, plan), status: "teachback_pending" };
    await saveWorkMapVersion(wm);

    // ── 4. teach-back: one segment at a time, corrections patch the map and get re-confirmed
    hub.setPhase("teachback");
    let segmentsIn: Array<{ text: string; stepIds: Id[] }> = [];
    try {
      segmentsIn = (await llm("teachback", { workmap: { steps: wm.steps, decisions: wm.decisions, guardrails: wm.guardrails, glossary: wm.glossary } })).segments;
    } catch (err) {
      problems.push(`teachback failed: ${(err as Error).message}`);
    }
    if (!segmentsIn.length) segmentsIn = wm.steps.map((s) => ({ text: `${s.title}. ${s.instructions}`, stepIds: [s.id] }));
    const segments: WorkMap["teachBack"]["segments"] = segmentsIn.map((s) => ({ id: newId("tb"), text: s.text, stepIds: s.stepIds.filter((id) => wm.steps.some((x) => x.id === id)) }));
    const tbStatus = (seg?: { id: Id; text: string }): DebriefStatus => ({ stage: "teachback", detail: "Teach-back", gapsOpen: 0, gaps: gapView(wm.gaps), asked, segment: seg, segments: segments.map((s) => ({ id: s.id, text: s.text, verdict: s.verdict })), workMapVersion: wm.version, problems });
    await hub.agentSay("Let me explain the whole process back to you. Tell me where I've got it wrong.", "teachback");

    for (const seg of segments) {
      let text = seg.text;
      for (let attempt = 0; attempt <= opts.maxTeachbackRetries; attempt++) {
        onStatus(tbStatus({ id: seg.id, text }));
        const prompt = attempt === 0 ? `${text} Is that right?` : `So: ${text} Is that right now?`;
        const { replies } = await hub.ask(prompt, { intent: "teachback", timeoutMs: 20_000 });
        const v = await verdictFor(text, replies, wm);
        const ve = hub.emit({
          t: hub.now(), type: "teachback.verdict", source: "map",
          payload: { segmentId: seg.id, verdict: v.verdict, utteranceIds: replies.map((r) => r.payload.utteranceId), ...(v.verdict === "corrected" ? { correction: v.correctedText } : {}) },
        });
        seg.verdict = v.verdict;
        seg.verdictEventId = ve.id;
        if (v.verdict === "confirmed") break;
        if (v.verdict === "unclear") {
          if (attempt >= 1) break; // asked twice; leave it and move on (shown as unclear in the UI)
          continue;
        }
        // corrected → correction event targeting the segment's claims → rebuild → re-state
        const reply = replies.find((r) => r.payload.text.includes(v.correction)) ?? replies[0];
        const refs = claimRefs(wm, seg.stepIds);
        hub.emit({
          t: hub.now(), type: "knowledge.correction", source: "map", causedBy: [ve.id],
          payload: {
            correctionId: newId("cor"), detectedBy: "teachback", kind: "statement_revised", utteranceIds: reply ? [reply.payload.utteranceId] : [],
            quote: reply && v.correction && reply.payload.text.includes(v.correction) ? v.correction : reply?.payload.text ?? "",
            targets: { workMapRefs: refs, ...(reply ? { utteranceIds: [reply.payload.utteranceId] } : {}) },
            before: text, after: v.correctedText || text, appliesTo: "always", confidence: 0.85,
          },
        });
        ({ wm, problems } = await extract(hub, { ...wm, teachBack: { ...wm.teachBack, segments, status: "in_progress" } }, "Teach-back correction", problems, "expert"));
        wm = { ...wm, gaps: mergeGaps(wm.gaps, plan), status: "teachback_pending" };
        await saveWorkMapVersion(wm);
        text = v.correctedText || text;
        seg.text = text;
      }
    }

    // ── 5. final confirmation
    onStatus(tbStatus());
    const final = await hub.ask("So that's the whole process. Is that how it works?", { intent: "teachback", timeoutMs: 20_000 });
    const fv = await verdictFor("That is the whole process.", final.replies, wm);
    const ix2 = new LogIndex(session.id, hub.events);
    const yesU = fv.verdict === "confirmed" ? final.replies[0] : undefined;
    const confirmationQuote = yesU ? ix2.quote([yesU.payload.utteranceId], yesU.payload.text) ?? undefined : undefined;
    const confirmed = !!confirmationQuote && segments.every((s) => s.verdict !== "unclear") && openHigh(wm.gaps) === 0;
    const teachBack: WorkMap["teachBack"] = {
      segments, status: confirmed ? "confirmed" : "in_progress",
      ...(confirmed ? { confirmedAt: new Date().toISOString(), confirmationQuote } : {}),
    };
    // re-assemble from the same claims so confirmedByExpert reflects the teach-back (no LLM call)
    ix = new LogIndex(session.id, hub.events);
    const replay = proposalFromWorkMap(wm, ix.ofType("knowledge.correction"), ix);
    const built = buildWorkMap(session, hub.events, replay, { ...wm, teachBack, status: confirmed ? "confirmed" : "teachback_pending" }, confirmed ? "Teach-back confirmed" : "Teach-back incomplete", "expert", yesU ? [yesU.id] : []);
    wm = { ...built.workmap, gaps: mergeGaps(built.workmap.gaps, plan), teachBack, status: confirmed ? "confirmed" : "teachback_pending" };
    await saveWorkMapVersion(wm);
    hub.setPhase("review");
    onStatus({ ...tbStatus(), stage: confirmed ? "confirmed" : "teachback", detail: confirmed ? "Work Map confirmed" : "Teach-back not confirmed: review it in /map", workMapVersion: wm.version });
    return wm;
  } catch (err) {
    onStatus({ stage: "error", detail: (err as Error).message, gapsOpen: 0, problems });
    return null;
  }
}

/** Re-extract with the LLM, reusing ids; on failure keep the previous claims (never write a broken version). */
async function extract(hub: CaptureHub, prev: WorkMap, note: string, problems: string[], by: "map" | "expert" = "map"): Promise<{ wm: WorkMap; problems: string[] }> {
  const ix = new LogIndex(hub.session.id, hub.events);
  try {
    const proposal = await llm("extract_workmap", { log: condenseLog(ix), factPaths: [...FACT_PATHS], existingIds: existingIds(prev) });
    const { workmap, problems: p } = buildWorkMap(hub.session, hub.events, proposal, prev, note, by);
    if (!workmap.steps.length && prev.steps.length) throw new Error("extraction returned no steps (mock LLM?) — kept the previous claims");
    return { wm: workmap, problems: [...problems, ...p.map((x) => `${x.where}: ${x.problem}`)] };
  } catch (err) {
    return { wm: nextVersion(prev, prev, by, `${note} (extraction failed: ${(err as Error).message})`), problems: [...problems, `extract_workmap: ${(err as Error).message}`] };
  }
}

async function verdictFor(segment: string, replies: Utterance[], wm: WorkMap) {
  const reply = replies.map((r) => r.payload.text).join(" ").trim();
  if (!reply) return { verdict: "unclear" as const, correction: "", correctedText: "" };
  try {
    return await llm("teachback_verdict", { segment, reply, workmapContext: wm.summary });
  } catch {
    const yes = /^\s*(yes|yeah|yep|right|correct|exactly|that'?s (right|how it works))\b/i.test(reply) && !/\b(but|not|except|actually|instead|wrong)\b/i.test(reply);
    return yes ? { verdict: "confirmed" as const, correction: "", correctedText: "" } : { verdict: "corrected" as const, correction: reply, correctedText: `${segment} (Correction: ${reply})` };
  }
}

/** Every claim a teach-back segment speaks for: its steps plus their decisions and guardrails. */
function claimRefs(wm: WorkMap, stepIds: Id[]) {
  const steps = wm.steps.filter((s) => stepIds.includes(s.id));
  return [
    ...steps.map((s) => ({ kind: "step" as const, id: s.id })),
    ...[...new Set(steps.flatMap((s) => s.decisionIds))].map((id) => ({ kind: "decision" as const, id })),
    ...[...new Set(steps.flatMap((s) => s.guardrailIds))].map((id) => ({ kind: "guardrail" as const, id })),
  ];
}

/** Debrief plan state wins over what assemble carried over (same ids). */
function mergeGaps(fromMap: Gap[], plan: Gap[]): Gap[] {
  const out = plan.map((g) => ({ ...g }));
  for (const g of fromMap) if (!out.some((x) => x.id === g.id)) out.push(g);
  return out;
}
