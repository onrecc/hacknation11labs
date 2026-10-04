/**
 * Debrief + teach-back (docs/map.md rules 12–18, MAP-PLAN.md §6–8). Map owns WHAT is said; it runs on the
 * CaptureHub's voice + transcript so every turn lands in the same session log (phase "debrief" / "teachback").
 *
 * Latency: extract_workmap / plan_debrief take ~50 s on Claude with deep thinking, so nothing slow sits between
 * the expert and the next sentence:
 *  - the deferred question (known without an LLM) is asked immediately while plan_debrief runs in the background;
 *  - a first extraction starts at debrief start and runs while questions are asked;
 *  - teach-back corrections rewrite the part's claims with one small call (patch_claim, verified in code like an
 *    extraction), then the part is re-stated and asked again until the expert says yes or retries run out.
 *
 * A gap only counts as resolved when the reply addresses it (link_answer's completeness, token overlap as fallback).
 * Unresolved high-priority gaps stay open and block the final confirmation; only low-priority leftovers become wont_fix.
 *
 * Order matters (MAP-PLAN F3/F4): every gap is written into a Work Map version before its gap.status event.
 */
import type { Gap, Id, QuestionCategory, Session, Utterance, WorkMap } from "../../../shared/schema";
import { LogIndex } from "../../../shared/logindex";
import { applyClaimPatch, buildDraft, buildWorkMap, claimFields, condenseLog, existingIds, nextVersion, proposalFromWorkMap, type ClaimChange } from "../../../shared/workmap";
import { FACT_PATHS, type ExtractionProposal } from "../../../shared/llm";
import { newId } from "../../../shared/ids";
import { llm } from "../lib/api";
import { loadWorkMap, saveWorkMapVersion, updateSession } from "../lib/sessions";
import type { CaptureHub } from "../capture/hub";
import { blockingGaps, notConfirmedDetail, notConfirmedSentence } from "./confirmation";

export interface DebriefStatus {
  stage: "planning" | "asking" | "extracting" | "teachback" | "confirmed" | "not_confirmed" | "error";
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

export const DEBRIEF = { maxQuestions: 8, minQuestions: 3, stopBelowPriority: 0.5, maxTeachbackRetries: 2, extractWaitMs: 90_000 };

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

/** Word-overlap score (0..1) between two questions, ignoring short words. */
export function similarity(a: string, b: string): number {
  const toks = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9äöüß ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  let n = 0;
  A.forEach((w) => B.has(w) && n++);
  return n / Math.min(A.size, B.size);
}
/** "Same question" test so the debrief never repeats a live question (validator rule) or asks twice. */
export const similar = (a: string, b: string) => similarity(a, b) >= 0.6;

const NON_ANSWER = /^\W*(i'?m not sure|not sure|i don'?t know|no idea|dunno|pass|skip|no comment)\W*$/i;

const openHigh = (gaps: Gap[]) => gaps.filter((g) => g.status === "open" && g.priority >= DEBRIEF.stopBelowPriority).length;
/** High-priority gaps nobody answered yet (open or asked without an answer): these block "confirmed". */
const unresolvedHigh = (gaps: Gap[]) => blockingGaps(gaps, DEBRIEF.stopBelowPriority).length;
const gapView = (gaps: Gap[]) => gaps.map((g) => ({ id: g.id, proposedQuestion: g.proposedQuestion, priority: g.priority, status: g.status, kind: g.kind }));
function settle<T>(p: Promise<T>) {
  const s: { done: boolean; value?: T } = { done: false };
  p.then((v) => { s.done = true; s.value = v; }, () => { s.done = true; });
  return s;
}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<null>((r) => (timer = setTimeout(() => r(null), ms)))]).finally(() => clearTimeout(timer));
}

export async function runDebrief(hub: CaptureHub, onStatus: (s: DebriefStatus) => void, opts = DEBRIEF): Promise<WorkMap | null> {
  const session = hub.session;
  let problems: string[] = [];
  try {
    if (hub.state.phase !== "debrief") hub.setPhase("debrief");

    // ── 1. plan: draft gaps now; LLM gaps and a first extraction in the background
    onStatus({ stage: "planning", detail: "Finding what I still don't understand…", gapsOpen: 0 });
    const ix0 = new LogIndex(session.id, hub.events);
    const prevSaved = session.workMapId ? await loadWorkMap(session.workMapId) : null;
    const draft = buildDraft(session, hub.events, prevSaved?.id);
    const liveTexts = ix0.ofType("agent.question").map((q) => q.payload.text);

    const planP: Promise<Gap[]> = llm("plan_debrief", {
      log: condenseLog(ix0),
      workmapSummary: draft.cases.map((c) => `${c.kind} ${c.key}: ${c.outcome ?? "?"}`).join("; "),
      deferredQuestions: ix0.ofType("question.deferred").map((d) => d.payload.text),
    }).then((p) => p.gaps.map((g): Gap => ({
      id: newId("gap"), kind: GAP_KIND[g.kind] ?? "unknown_scope", description: g.description,
      about: { eventIds: g.aboutActionIds.filter((id) => ix0.byId.has(id)) }, proposedQuestion: g.proposedQuestion,
      priority: Math.max(0, Math.min(1, g.priority)), status: "open",
    }))).catch((err: Error) => { problems.push(`plan_debrief failed: ${err.message}`); return []; });
    const plan$ = settle(planP);
    const base: WorkMap = prevSaved ?? draft;
    const firstP = extractProposal(session, hub, base).catch((err: Error) => { problems.push(err.message); return null; });
    const first$ = settle(firstP);

    const plan: Gap[] = [];
    const addGaps = (gs: Gap[]) => {
      let added = 0;
      for (const g of [...gs].sort((a, b) => b.priority - a.priority)) {
        if (plan.length >= opts.maxQuestions + 2) break;
        if (liveTexts.some((t) => similar(t, g.proposedQuestion))) continue; // already asked live
        if (plan.some((x) => similar(x.proposedQuestion, g.proposedQuestion))) continue; // duplicate
        // the planner re-phrases deferred questions; the draft already holds them verbatim
        if (g.kind === "deferred_question" && plan.some((x) => x.kind === "deferred_question" && similarity(x.proposedQuestion, g.proposedQuestion) >= 0.4)) continue;
        plan.push(g);
        added++;
      }
      return added;
    };
    addGaps(draft.gaps);

    let wm: WorkMap = nextVersion(prevSaved, {
      ...base, ...draft, id: base.id, createdAt: base.createdAt, gaps: [...plan], status: "debrief",
      steps: base.steps, decisions: base.decisions, guardrails: base.guardrails, glossary: base.glossary, summary: base.summary || draft.summary,
    }, "map", `Debrief started: ${plan.length} gaps known`);
    await saveWorkMapVersion(wm);
    if (!session.workMapId) await updateSession(session.id, { workMapId: wm.id });
    session.workMapId = wm.id;
    let merged = false;
    const mergePlanned = async () => {
      if (merged || !plan$.done) return;
      merged = true;
      if (addGaps(plan$.value ?? [])) {
        wm = nextVersion(wm, { ...wm, gaps: [...plan] }, "map", "Debrief plan ready");
        await saveWorkMapVersion(wm); // gaps exist in a version before any gap.status about them
      }
    };

    /** Ask one gap; resolved when answered, else open again (mayRetry) or asked-but-unanswered. Logs gap.status. */
    const askGap = async (g: Gap, text: string, mayRetry: boolean) => {
      const actionIds = g.about.eventIds.filter((id) => hub.events.some((e) => e.id === id && e.type === "screen.action"));
      const { questionId, replies } = await hub.ask(text, { category: CATEGORY[g.kind] ?? "scope", gapId: g.id, actionIds, intent: "follow_up" });
      const a = answers(hub, g, questionId, replies);
      const retry = !a.ok && mayRetry;
      g.status = a.ok ? "resolved" : retry ? "open" : "asked";
      if (a.ok && a.linkId) g.resolvedBy = { questionId, answerEventId: a.linkId };
      const note = a.ok ? undefined : retry ? "not answered; asking once more" : "not answered; left for review";
      hub.emit({ t: hub.now(), type: "gap.status", source: "map", payload: { gapId: g.id, status: g.status, ...(note ? { note } : {}) } });
      return replies;
    };

    // ── 2. ask in priority order until no open gap ≥ threshold, the expert is done, or the cap
    await hub.agentSay("Thanks, that was really helpful. I have a few things I couldn't work out from the screen.", "other");
    let asked = 0;
    let toppedUp = false;
    const tries = new Map<Id, number>();
    while (asked < opts.maxQuestions) {
      await mergePlanned();
      const nextOpen = () => plan.filter((x) => x.status === "open").sort((a, b) => b.priority - a.priority)[0];
      let g = nextOpen();
      if (!g && !merged) {
        onStatus({ stage: "planning", detail: "Thinking about what else to ask…", gapsOpen: openHigh(plan), gaps: gapView(plan), asked, workMapVersion: wm.version });
        await planP;
        await mergePlanned();
        g = nextOpen();
      }
      if (!g && asked < opts.minQuestions && !toppedUp) {
        // the brief wants ≥ 3 questions: top up from the map (or the cases) when the planner found too little
        toppedUp = true;
        if (addGaps(topUpGaps(wm, first$.done ? first$.value ?? null : null, session.task.title))) {
          wm = nextVersion(wm, { ...wm, gaps: [...plan] }, "map", "Debrief topped up to the minimum number of questions");
          await saveWorkMapVersion(wm);
        }
        g = nextOpen();
      }
      if (!g) break;
      if (asked >= opts.minQuestions && (openHigh(plan) === 0 || g.priority < opts.stopBelowPriority)) break;
      const n = tries.get(g.id) ?? 0;
      const text = n ? `Sorry, I didn't quite get that. ${g.proposedQuestion}` : g.proposedQuestion;
      onStatus({ stage: "asking", detail: text, gapsOpen: openHigh(plan), gaps: gapView(plan), asked, workMapVersion: wm.version });
      // not answered: a high-priority gap is asked once more; after that it stays unresolved (blocks confirmation)
      const replies = await askGap(g, text, n === 0 && g.priority >= opts.stopBelowPriority);
      asked++;
      tries.set(g.id, n + 1);
      onStatus({ stage: "asking", detail: text, gapsOpen: openHigh(plan), gaps: gapView(plan), asked, workMapVersion: wm.version });
      if (asked >= opts.minQuestions && replies.some((r) => DONE.test(r.payload.text))) break;
    }
    // only low-priority leftovers are dropped; open high-priority gaps stay open for the final check and /map review
    for (const g of plan) {
      if (g.status !== "open" || g.priority >= opts.stopBelowPriority) continue;
      g.status = "wont_fix";
      hub.emit({ t: hub.now(), type: "gap.status", source: "map", payload: { gapId: g.id, status: "wont_fix", note: "below priority threshold" } });
    }

    // ── 3. extract with everything said in the debrief (the first extraction is the fallback)
    onStatus({ stage: "extracting", detail: "Putting it all together…", gapsOpen: openHigh(plan), gaps: gapView(plan), asked, workMapVersion: wm.version });
    const finalP = extractProposal(session, hub, wm).catch((err: Error) => { problems.push(err.message); return null; });
    void hub.agentSay("Give me a moment to put that together.", "other");
    const proposal = (await withTimeout(finalP, opts.extractWaitMs)) ?? (first$.done ? first$.value ?? null : null);
    if (proposal) {
      const built = buildWorkMap(session, hub.events, proposal, wm, `Debrief: ${asked} questions`);
      problems = [...problems, ...built.problems.map((x) => `${x.where}: ${x.problem}`)];
      wm = built.workmap.steps.length ? built.workmap : nextVersion(wm, wm, "map", "Extraction returned no steps; kept previous claims");
    } else {
      problems.push("extract_workmap: no result in time; kept the previous claims");
      wm = nextVersion(wm, wm, "map", "Extraction timed out");
    }
    wm = { ...wm, gaps: mergeGaps(wm.gaps, plan), status: "teachback_pending" };
    await saveWorkMapVersion(wm);

    // ── 4. teach-back: one part at a time; corrections patch the map in code and get re-confirmed
    hub.setPhase("teachback");
    let segmentsIn: Array<{ text: string; stepIds: Id[] }> = [];
    if (wm.steps.length) {
      const tbP = llm("teachback", { workmap: { steps: wm.steps, decisions: wm.decisions, guardrails: wm.guardrails, glossary: wm.glossary } })
        .then((r) => r.segments)
        .catch((err: Error) => { problems.push(`teachback failed: ${err.message}`); return [] as Array<{ text: string; stepIds: Id[] }>; });
      segmentsIn = (await withTimeout(tbP, 45_000)) ?? [];
    }
    if (!segmentsIn.length) segmentsIn = fallbackSegments(wm);
    const segments: WorkMap["teachBack"]["segments"] = segmentsIn.map((s) => ({ id: newId("tb"), text: s.text, stepIds: s.stepIds.filter((id) => wm.steps.some((x) => x.id === id)) }));
    const tbStatus = (seg?: { id: Id; text: string }): DebriefStatus => ({ stage: "teachback", detail: "Teach-back", gapsOpen: unresolvedHigh(wm.gaps), gaps: gapView(wm.gaps), asked, segment: seg, segments: segments.map((s) => ({ id: s.id, text: s.text, verdict: s.verdict })), workMapVersion: wm.version, problems });
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
          if (attempt >= 1) break; // asked twice; leave it (shown as unclear, blocks confirmation)
          continue;
        }
        // corrected → rewrite the part's claims (verified) → one correction per changed claim (old text → history) → re-state
        const refs = claimRefs(wm, seg.stepIds);
        const patch = await patchClaims(session, hub, wm, text, v.correction, replies, refs.map((r) => r.id));
        problems = [...problems, ...patch.problems.map((x) => `${x.where}: ${x.problem}`)];
        const corr = { detectedBy: "teachback" as const, kind: "statement_revised" as const, appliesTo: "always" as const, confidence: 0.85 };
        if (patch.quote && patch.changes.length) {
          for (const ch of patch.changes) {
            hub.emit({
              t: hub.now(), type: "knowledge.correction", source: "map", causedBy: [ve.id],
              payload: { ...corr, correctionId: newId("cor"), utteranceIds: patch.quote.utteranceIds, quote: patch.quote.text, targets: { workMapRefs: [ch.ref] }, before: ch.before, after: ch.after },
            });
          }
          wm = patch.workmap;
        } else {
          // nothing verifiable to rewrite: the correction is still on record for the whole part (history only)
          const reply = replies.find((r) => v.correction && r.payload.text.includes(v.correction)) ?? replies[0];
          hub.emit({
            t: hub.now(), type: "knowledge.correction", source: "map", causedBy: [ve.id],
            payload: {
              ...corr, correctionId: newId("cor"), utteranceIds: reply ? [reply.payload.utteranceId] : [],
              quote: reply && v.correction && reply.payload.text.includes(v.correction) ? v.correction : reply?.payload.text ?? "",
              targets: { workMapRefs: refs, ...(reply ? { utteranceIds: [reply.payload.utteranceId] } : {}) },
              before: text, after: v.correctedText || replies.map((r) => r.payload.text).join(" "),
            },
          });
        }
        wm = replayPatch(session, hub, { ...wm, teachBack: { ...wm.teachBack, segments, status: "in_progress" } }, "Teach-back correction", plan);
        await saveWorkMapVersion(wm);
        text = v.correctedText || restate(wm, patch.changes) || `${text} You said: ${replies.map((r) => r.payload.text).join(" ")}`;
        seg.text = text;
      }
    }

    // ── 5. last chance: every high-priority question still unanswered is asked once more before the final question
    const lastChance = blockingGaps(wm.gaps, opts.stopBelowPriority);
    if (lastChance.length) {
      await hub.agentSay(lastChance.length === 1 ? "Before we finish, one question is still open." : `Before we finish, ${lastChance.length} questions are still open.`, "teachback");
      for (const open of lastChance) {
        // the plan holds the live gap state (mergeGaps lets it win); gaps the extraction carried over join it here
        if (!plan.some((x) => x.id === open.id)) plan.push({ ...open });
        const g = plan.find((x) => x.id === open.id)!;
        onStatus({ ...tbStatus(), detail: `Still open: ${g.proposedQuestion}` });
        await askGap(g, g.proposedQuestion, false);
        asked++;
      }
      wm = { ...wm, gaps: mergeGaps(wm.gaps, plan) };
    }

    // ── 6. final confirmation (explicit yes, every part confirmed last, no unresolved high-priority gaps)
    onStatus(tbStatus());
    const final = await hub.ask("So that's the whole process. Is that how it works?", { intent: "teachback", timeoutMs: 20_000 });
    const fv = await verdictFor("That is the whole process.", final.replies, wm);
    const ix2 = new LogIndex(session.id, hub.events);
    const yesU = fv.verdict === "confirmed" ? final.replies[0] : undefined;
    const confirmationQuote = yesU ? ix2.quote([yesU.payload.utteranceId], yesU.payload.text) ?? undefined : undefined;
    const outcome = { finalYes: !!confirmationQuote, partsOpen: segments.filter((s) => s.verdict !== "confirmed").length, gaps: blockingGaps(wm.gaps, opts.stopBelowPriority) };
    const notConfirmed = notConfirmedDetail(outcome);
    const confirmed = notConfirmed === null;
    if (notConfirmed) problems.push(notConfirmed);
    const teachBack: WorkMap["teachBack"] = {
      segments, status: confirmed ? "confirmed" : "in_progress",
      ...(confirmed ? { confirmedAt: new Date().toISOString(), confirmationQuote } : {}),
    };
    wm = replayPatch(session, hub, { ...wm, teachBack, status: confirmed ? "confirmed" : "teachback_pending" }, confirmed ? "Teach-back confirmed" : "Teach-back incomplete", plan, "expert", yesU ? [yesU.id] : []);
    await saveWorkMapVersion(wm);
    hub.setPhase("review");
    // never a silent dead end: the expert hears what is missing, the panel shows it
    void hub.agentSay(confirmed ? "Great, thank you. I've got it." : notConfirmedSentence(outcome) ?? "I can't mark this as confirmed yet.", "other");
    onStatus({ ...tbStatus(), stage: confirmed ? "confirmed" : "not_confirmed", detail: notConfirmed ?? "Work Map confirmed", workMapVersion: wm.version });
    return wm;
  } catch (err) {
    onStatus({ stage: "error", detail: (err as Error).message, gapsOpen: 0, problems });
    return null;
  }
}

/** extract_workmap on the current log, reusing ids from `prev`. */
async function extractProposal(session: Session, hub: CaptureHub, prev: WorkMap): Promise<ExtractionProposal> {
  const ix = new LogIndex(session.id, hub.events);
  try {
    return await llm("extract_workmap", { log: condenseLog(ix), factPaths: [...FACT_PATHS], existingIds: existingIds(prev) });
  } catch (err) {
    throw new Error(`extract_workmap: ${(err as Error).message}`);
  }
}

/**
 * Re-assemble the current claims against the current log WITHOUT an LLM call: picks up new corrections
 * (history), teach-back confirmations and gap states. Used after teach-back corrections and the final yes.
 */
function replayPatch(session: Session, hub: CaptureHub, wm: WorkMap, note: string, plan: Gap[], by: "map" | "expert" = "expert", eventIds: Id[] = []): WorkMap {
  if (!wm.steps.length) return nextVersion(wm, wm, by, note, eventIds);
  const ix = new LogIndex(session.id, hub.events);
  const replay = proposalFromWorkMap(wm, ix.ofType("knowledge.correction"), ix);
  const built = buildWorkMap(session, hub.events, replay, wm, note, by, eventIds);
  return { ...built.workmap, gaps: mergeGaps(built.workmap.gaps, plan), teachBack: wm.teachBack, status: wm.status };
}

function fallbackSegments(wm: WorkMap): Array<{ text: string; stepIds: Id[] }> {
  if (!wm.steps.length) return [{ text: "I didn't manage to build the steps yet, so I can't explain them back properly.", stepIds: [] }];
  return wm.steps.map((s) => ({ text: `${s.title}. ${s.instructions}`, stepIds: [s.id] }));
}

async function verdictFor(segment: string, replies: Utterance[], wm: WorkMap) {
  const reply = replies.map((r) => r.payload.text).join(" ").trim();
  if (!reply) return { verdict: "unclear" as const, correction: "", correctedText: "" };
  // a plain "yes" needs no LLM round-trip
  if (/^\s*(yes|yeah|yep|right|correct|exactly|that'?s (right|correct|how it works))\b[\s.!,]*$/i.test(reply)) return { verdict: "confirmed" as const, correction: "", correctedText: "" };
  try {
    const out = await withTimeout(llm("teachback_verdict", { segment, reply, workmapContext: wm.summary }), 15_000);
    if (out) return out;
  } catch { /* fall through to the heuristic */ }
  const yes = /^\s*(yes|yeah|yep|right|correct|exactly|that'?s (right|how it works))\b/i.test(reply) && !/\b(but|not|except|actually|instead|wrong)\b/i.test(reply);
  // no rewritten text here: the part is re-stated from the patched claims
  return yes ? { verdict: "confirmed" as const, correction: "", correctedText: "" } : { verdict: "corrected" as const, correction: reply, correctedText: "" };
}

/** Did the reply address the gap? link_answer's judgement (logged by hub.ask); token overlap if that call failed. */
function answers(hub: CaptureHub, g: Gap, questionId: Id, replies: Utterance[]): { ok: boolean; linkId?: Id } {
  if (!replies.length) return { ok: false };
  const link = [...hub.events].reverse().find((e) => e.type === "answer.linked" && e.payload.questionId === questionId);
  if (link?.type === "answer.linked") return { ok: link.payload.completeness !== "deflected", linkId: link.id };
  const text = replies.map((r) => r.payload.text).join(" ");
  if (NON_ANSWER.test(text)) return { ok: false };
  return { ok: Math.max(similarity(text, g.proposedQuestion), similarity(text, g.description)) > 0 || text.split(/\s+/).length >= 6 };
}

/** patch_claim for the claims of a corrected part, verified in code; never throws. */
async function patchClaims(session: Session, hub: CaptureHub, wm: WorkMap, segment: string, correction: string, replies: Utterance[], ids: Id[]) {
  const none = (problem?: string) => ({ workmap: wm, changes: [] as ClaimChange[], quote: null, problems: problem ? [{ where: "patch_claim", problem }] : [] });
  if (!ids.length || !replies.length) return none();
  try {
    const out = await withTimeout(llm("patch_claim", {
      segment, correction, reply: replies.map((r) => r.payload.text).join(" "),
      replyUtterances: replies.map((r) => ({ id: r.payload.utteranceId, text: r.payload.text })),
      claims: claimFields(wm, ids), factPaths: [...FACT_PATHS],
    }), 20_000);
    return out ? applyClaimPatch(wm, out, new LogIndex(session.id, hub.events), ids) : none("no result in time; correction kept in history only");
  } catch (err) {
    return none(`${(err as Error).message}; correction kept in history only`);
  }
}

/** Re-statement of a corrected part from its rewritten claims ("" if nothing changed). */
function restate(wm: WorkMap, changes: ClaimChange[]): string {
  return changes.map(({ ref }) => {
    if (ref.kind === "step") {
      const s = wm.steps.find((x) => x.id === ref.id);
      return s ? `${s.title}. ${s.instructions}` : "";
    }
    if (ref.kind === "decision") {
      const d = wm.decisions.find((x) => x.id === ref.id);
      return d ? `${d.question} ${d.reasonSummary}` : "";
    }
    return wm.guardrails.find((x) => x.id === ref.id)?.statement ?? "";
  }).filter(Boolean).join(" ");
}

/**
 * Generic-but-specific gaps derived from the map (or, before any extraction, from the cases) so the debrief always
 * has ≥ 3 questions: limits without a number, rules without someone to ask, scope of what was seen on one case.
 * Priority stays below the stop threshold: they never block confirmation on their own.
 */
export function topUpGaps(wm: WorkMap, proposal: ExtractionProposal | null, task: string): Gap[] {
  const grs = proposal
    ? proposal.guardrails.map((g) => ({ statement: g.statement, limit: !!g.conditionJson, who: !!g.escalateToRole }))
    : wm.guardrails.map((g) => ({ statement: g.statement, limit: !!g.condition, who: !!g.escalateTo }));
  const decisions = proposal ? proposal.decisions.map((d) => d.question) : wm.decisions.map((d) => d.question);
  const bare = (s: string) => s.trim().replace(/[.?!]+$/, "");
  const c = wm.cases[0];
  const what = c ? `the ${c.kind} ${c.key}` : "this work";
  const templates: Array<Pick<Gap, "kind" | "description" | "proposedQuestion">> = [
    ...grs.filter((g) => !g.limit).map((g) => ({ kind: "missing_threshold" as const, description: `Rule without a checkable limit: ${g.statement}`, proposedQuestion: `You said "${bare(g.statement)}". Is there an exact amount or condition where that starts?` })),
    ...grs.filter((g) => !g.who).map((g) => ({ kind: "who_decides" as const, description: `Nobody named to ask: ${g.statement}`, proposedQuestion: `When "${bare(g.statement)}" applies and you're unsure, who do you ask?` })),
    ...decisions.map((q) => ({ kind: "who_decides" as const, description: `Who decides: ${q}`, proposedQuestion: `If a new colleague can't decide "${bare(q)}", who should they ask?` })),
    { kind: "unseen_case", description: `What would have stopped ${what}`, proposedQuestion: `On ${what}, what would have made you stop and ask someone before saving?` },
    { kind: "unknown_scope", description: `Scope of what was done on ${what}`, proposedQuestion: `Does what you did on ${what} apply to every case like it, or only some?` },
    { kind: "low_confidence", description: `Typical mistakes in: ${task}`, proposedQuestion: `When new people ${task ? `do "${bare(task)}"` : "do this"}, what do they most often get wrong?` },
  ];
  return templates.map((t, i) => ({ ...t, id: newId("gap"), about: { eventIds: [] }, priority: Math.max(0.1, 0.45 - i * 0.01), status: "open" }));
}

/** Every claim a teach-back part speaks for: its steps plus their decisions and guardrails. */
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
