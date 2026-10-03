/**
 * Debrief + teach-back (docs/map.md rules 12–18). Map owns WHAT is said; it runs on the CaptureHub's
 * voice + transcript so every turn lands in the same session log (phase "debrief" / "teachback").
 */
import type { Id, Utterance, WorkMap } from "@shared/schema";
import { LogIndex } from "@shared/logindex";
import { assemble, buildDraft, condenseLog, nextVersion } from "@shared/workmap";
import { FACT_PATHS } from "@shared/llm";
import { newId } from "@shared/ids";
import { llm } from "../lib/api";
import { loadWorkMap, saveWorkMapVersion, updateSession } from "../lib/sessions";
import type { CaptureHub } from "../capture/hub";

export interface DebriefStatus {
  stage: "planning" | "asking" | "extracting" | "teachback" | "confirmed" | "error";
  detail: string;
  gapsOpen: number;
  segment?: { id: Id; text: string };
  problems?: string[];
}

const DONE = /\b(that'?s (all|it)|nothing else|we'?re done|no more)\b/i;
const YES = /^\s*(yes|yeah|yep|right|correct|exactly|that'?s right|that'?s how it works)\b/i;

export async function runDebrief(hub: CaptureHub, onStatus: (s: DebriefStatus) => void, opts = { maxQuestions: 8, minQuestions: 3 }): Promise<WorkMap | null> {
  const session = hub.session;
  try {
    // 1. plan
    onStatus({ stage: "planning", detail: "Finding gaps…", gapsOpen: 0 });
    let ix = new LogIndex(session.id, hub.events);
    const draft = buildDraft(session, hub.events);
    const deferred = ix.ofType("question.deferred").map((d) => d.payload.text);
    const plan = await llm("plan_debrief", { log: condenseLog(ix), workmapSummary: draft.cases.map((c) => `${c.kind} ${c.key}: ${c.outcome}`).join("; "), deferredQuestions: deferred });
    const liveTexts = new Set(ix.ofType("agent.question").map((q) => q.payload.text));
    const gaps = plan.gaps.filter((g) => !liveTexts.has(g.proposedQuestion)).sort((a, b) => b.priority - a.priority).map((g) => ({ ...g, id: newId("gap") }));

    // 2. ask (≥ minQuestions, then while priority ≥ 0.5)
    await hub.agentSay("Thanks, that was really helpful. I have a few things I couldn't work out from the screen.", "other");
    let asked = 0;
    for (const g of gaps) {
      if (asked >= opts.maxQuestions || (asked >= opts.minQuestions && g.priority < 0.5)) break;
      onStatus({ stage: "asking", detail: g.proposedQuestion, gapsOpen: gaps.length - asked });
      const { replies } = await hub.ask(g.proposedQuestion, { category: "scope", gapId: g.id, actionIds: g.aboutActionIds, intent: "follow_up" });
      asked++;
      hub.emit({ t: hub.now(), type: "gap.status", source: "map", payload: { gapId: g.id, status: replies.length ? "resolved" : "asked" } });
      if (replies.some((r) => DONE.test(r.payload.text)) && asked >= opts.minQuestions) break;
    }

    // 3. extract the Work Map
    onStatus({ stage: "extracting", detail: "Building the Work Map…", gapsOpen: 0 });
    ix = new LogIndex(session.id, hub.events);
    const proposal = await llm("extract_workmap", { log: condenseLog(ix), factPaths: [...FACT_PATHS] });
    const { workmap, problems } = assemble(buildDraft(session, hub.events, draft.id), proposal, ix);
    workmap.gaps = gaps.map((g, i) => ({ id: g.id, kind: "unknown_scope", description: g.description, about: { eventIds: g.aboutActionIds }, proposedQuestion: g.proposedQuestion, priority: g.priority, status: i < asked ? "resolved" : "open" }));
    const prev = await loadWorkMap(workmap.id);
    let wm = nextVersion(prev, { ...workmap, status: "teachback_pending" }, "map", `Draft after debrief (${asked} questions)`);
    await saveWorkMapVersion(wm);
    await updateSession(session.id, { workMapId: wm.id });

    // 4. teach-back
    hub.setPhase("teachback");
    const tb = await llm("teachback", { workmap: { steps: wm.steps, decisions: wm.decisions, guardrails: wm.guardrails, glossary: wm.glossary } });
    await hub.agentSay("Let me explain the whole process back to you. Tell me where I'm wrong.", "teachback");
    const segments: WorkMap["teachBack"]["segments"] = [];
    for (const s of tb.segments) {
      const id = newId("tb");
      onStatus({ stage: "teachback", detail: "Teach-back", gapsOpen: 0, segment: { id, text: s.text }, problems: problems.map((p) => `${p.where}: ${p.problem}`) });
      let verdict = await segmentVerdict(hub, s.text, id);
      if (verdict.verdict === "unclear") verdict = await segmentVerdict(hub, "Sorry, was that part right?", id);
      segments.push({ id, text: s.text, stepIds: s.stepIds, verdict: verdict.verdict, verdictEventId: verdict.eventId });
    }
    const final = await hub.ask("Is that the whole process?", { intent: "teachback", timeoutMs: 20_000 });
    const confirmedU = final.replies.find((r) => YES.test(r.payload.text));
    const confirmed = !!confirmedU && segments.every((s) => s.verdict !== "unclear");
    const ix2 = new LogIndex(session.id, hub.events);
    wm = nextVersion(wm, {
      ...wm,
      status: confirmed ? "confirmed" : "teachback_pending",
      teachBack: {
        segments, status: confirmed ? "confirmed" : "in_progress",
        ...(confirmed && confirmedU ? { confirmedAt: new Date().toISOString(), confirmationQuote: ix2.quote([confirmedU.payload.utteranceId], confirmedU.payload.text) ?? undefined } : {}),
      },
      // corrections said during teach-back become claim history on re-extract; mark claims confirmed
      steps: wm.steps.map((s) => ({ ...s, confirmedByExpert: confirmed && !(s.provenance.length === 1 && s.provenance[0] === "inferred") })),
    }, "expert", confirmed ? "Teach-back confirmed" : "Teach-back incomplete");
    await saveWorkMapVersion(wm);
    hub.setPhase("review");
    onStatus({ stage: confirmed ? "confirmed" : "teachback", detail: confirmed ? "Work Map confirmed" : "Teach-back not confirmed: review in /map", gapsOpen: 0, problems: problems.map((p) => `${p.where}: ${p.problem}`) });
    return wm;
  } catch (err) {
    onStatus({ stage: "error", detail: (err as Error).message, gapsOpen: 0 });
    return null;
  }
}

async function segmentVerdict(hub: CaptureHub, text: string, segmentId: Id): Promise<{ verdict: "confirmed" | "corrected" | "unclear"; eventId: Id }> {
  const { replies } = await hub.ask(text, { intent: "teachback", timeoutMs: 15_000 });
  const said = replies.map((r) => r.payload.text).join(" ");
  const verdict = !replies.length ? "unclear" : YES.test(said) && !/\b(but|not|except|no)\b/i.test(said) ? "confirmed" : "corrected";
  const e = hub.emit({
    t: hub.now(), type: "teachback.verdict", source: "map",
    payload: { segmentId, verdict, utteranceIds: replies.map((r: Utterance) => r.payload.utteranceId), ...(verdict === "corrected" ? { correction: said } : {}) },
  });
  if (verdict === "corrected" && replies[0]) {
    hub.emit({
      t: hub.now(), type: "knowledge.correction", source: "map", causedBy: [e.id],
      payload: { correctionId: newId("cor"), detectedBy: "teachback", kind: "statement_revised", utteranceIds: [replies[0].payload.utteranceId], quote: replies[0].payload.text, targets: {}, before: text, after: said, appliesTo: "always", confidence: 0.8 },
    });
  }
  return { verdict, eventId: e.id };
}
