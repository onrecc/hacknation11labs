/**
 * End-to-end simulation of the debrief + teach-back runner, no browser, no Firebase, no LLM:
 * a fake CaptureHub replays the fixture's capture phase, a scripted "Sabine" answers like in the fixture,
 * and the resulting log + Work Map must pass scripts/validate_bundle.py and scripts/eval_guardrails.py.
 *
 *   cd web && node --import tsx --experimental-test-module-mocks --test src/map/debrief.sim.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, symlinkSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Event, Session, Utterance, WorkMap } from "../../../shared/schema";
import { LogIndex } from "../../../shared/logindex";
import { proposalFromWorkMap } from "../../../shared/workmap";

const root = new URL("../../../", import.meta.url).pathname;
const fx = join(root, "fixtures/demo-session");
const session0 = JSON.parse(readFileSync(join(fx, "session.json"), "utf8")) as Session;
const allEvents = readFileSync(join(fx, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Event);
const oracle = JSON.parse(readFileSync(join(fx, "expected_workmap.json"), "utf8")) as WorkMap;
const fullIx = new LogIndex(session0.id, allEvents);

// ── scripted expert
const ANSWERS: Array<[RegExp, string]> = [
  [/just Hofmann|other suppliers|specific to Hofmann/i, "Mostly Hofmann. Oh, and Schreiber Logistik since last year, they did the same thing in 2025. For everyone else, December is normal."],
  [/release/i, "I release it myself once the credit note is there. If it's over ten thousand, the AP lead, Jonas, has to sign off the release."],
  [/asset number/i, "Then I stop. I ask the controller to create the asset first. I never book capex without an asset number, it breaks the depreciation run."],
  [/Brno.*five thousand|equipment over/i, "Then both. Capex with an asset number, and it still goes to Weber."],
  [/history|every invoice/i, "Only for the December ones from those two, and for new suppliers. Otherwise no, that's just a habit from Hofmann."],
];
const WRONG = "Anything from Brno, our Czech subsidiary, goes to the AP lead for a second approval, whatever the amount.";
const FIXED = "Anything from Brno, our Czech subsidiary, goes to the controller, Weber, for a second approval, whatever the amount.";
const GR = "gr_intercompany_approval";
const GR_FIXED = "Brno (Czech subsidiary) invoices always need the controller, Weber, as second approver, whatever the amount.";

type PlanGap = { kind: string; description: string; proposedQuestion: string; priority: number; aboutActionIds: string[] };
const PLAN: PlanGap[] = [
  { kind: "deferred_question", description: "December hold scope", proposedQuestion: "You held the Hofmann invoice because they double-bill in December. Is that just Hofmann, or do you do it for other suppliers too?", priority: 0.9, aboutActionIds: ["evt_0063"] },
  { kind: "who_decides", description: "who releases", proposedQuestion: "Once it's on hold, who decides to release it, and does the amount change that?", priority: 0.85, aboutActionIds: [] },
  { kind: "unseen_case", description: "no asset number", proposedQuestion: "On the Krauss invoice you entered an asset number. What would you do if there wasn't one?", priority: 0.8, aboutActionIds: ["evt_0014"] },
  { kind: "conflict", description: "Brno capex", proposedQuestion: "What if an invoice from Brno is equipment over five thousand euros?", priority: 0.7, aboutActionIds: [] },
  { kind: "habit_vs_rule", description: "history search", proposedQuestion: "You searched Hofmann's history before deciding. Do you do that on every invoice, or only some?", priority: 0.6, aboutActionIds: ["evt_0052"] },
  { kind: "missing_threshold", description: "low value", proposedQuestion: "Is there a small amount below which you skip all checks?", priority: 0.3, aboutActionIds: [] },
];

/** Per-test knobs: what the planner returns and how the scripted expert answers. */
interface Scenario {
  plan: PlanGap[];
  debriefReply?: (question: string) => string | undefined;
  teachbackReply?: (prompt: string) => string | undefined;
}
let sc: Scenario = { plan: PLAN };

// ── LLM + persistence mocks (installed before importing the runner)
const saved: WorkMap[] = [];
const llmCalls: string[] = [];
mock.module(new URL("../lib/api.ts", import.meta.url).href, {
  namedExports: {
    llm: async (task: string, input: Record<string, unknown>) => {
      llmCalls.push(task);
      if (task === "plan_debrief") return { gaps: sc.plan };
      if (task === "extract_workmap") return proposalFromWorkMap(oracle, fullIx.ofType("knowledge.correction"), fullIx);
      if (task === "teachback") return { segments: oracle.teachBack.segments.map((s) => ({ text: s.id === "tb_4" ? WRONG : s.text, stepIds: s.stepIds })) };
      if (task === "teachback_verdict") {
        const reply = String(input.reply);
        if (/not the AP lead|still not right/i.test(reply)) return { verdict: "corrected", correction: reply, correctedText: FIXED };
        return { verdict: "confirmed", correction: "", correctedText: "" };
      }
      if (task === "patch_claim") {
        const i = input as { claims: Array<{ id: string }>; replyUtterances: Array<{ id: string; text: string }> };
        const u = i.replyUtterances[0];
        return {
          patches: i.claims.some((c) => c.id === GR) ? [{ id: GR, field: "statement", value: GR_FIXED }, { id: GR, field: "conditionJson", value: JSON.stringify({ op: "eq", field: "invoice.mood", value: "bad" }) }] : [],
          quotes: u ? [{ utteranceId: u.id, quote: u.text.split(/(?<=[.!?])\s+/)[0] }] : [],
        };
      }
      throw new Error(`unexpected task ${task}`);
    },
  },
});
mock.module(new URL("../lib/sessions.ts", import.meta.url).href, {
  namedExports: {
    loadWorkMap: async () => null,
    saveWorkMapVersion: async (wm: WorkMap) => void saved.push(structuredClone(wm)),
    updateSession: async () => {},
  },
});

// ── fake CaptureHub over the capture phase of the fixture
class FakeHub {
  session: Session = { ...session0, workMapId: undefined };
  events: Event[];
  state = { phase: "capture" as Event["phase"] };
  private t: number;
  private seq: number;
  private n = 0;
  spoken: string[] = [];
  constructor() {
    const cut = allEvents.findIndex((e) => e.type === "phase.changed");
    this.events = allEvents.slice(0, cut);
    this.t = Math.max(...this.events.map((e) => e.tEnd ?? e.t)) + 2000;
    this.seq = Math.max(...this.events.map((e) => e.seq));
  }
  now() { return (this.t += 300); }
  emit(e: Record<string, unknown>) {
    const ev = { id: `sim_${++this.n}`, sessionId: this.session.id, seq: ++this.seq, wall: new Date().toISOString(), phase: this.state.phase, ...e } as Event;
    this.events.push(ev);
    return ev;
  }
  setPhase(to: Event["phase"]) {
    const from = this.state.phase;
    if (from === to) return;
    this.emit({ t: this.now(), type: "phase.changed", source: "system", phase: to, payload: { from, to } });
    this.state.phase = to;
  }
  private utter(speaker: "agent" | "expert", text: string): Utterance {
    const words = text.split(/\s+/);
    const t0 = this.now();
    const ws = words.map((w, i) => ({ w, t: t0 + i * 300, tEnd: t0 + i * 300 + 250 }));
    this.t = t0 + words.length * 300;
    return this.emit({ t: t0, tEnd: this.t, type: "utterance", source: speaker === "agent" ? "agent" : "stt", payload: { utteranceId: `utt_sim_${this.n + 1}`, speaker, text, words: ws, language: "en", transcriptVersion: 1, sttModel: "sim", addressedTo: speaker === "agent" ? "other_person" : "agent" } }) as Utterance;
  }
  async agentSay(text: string) {
    this.spoken.push(text);
    this.utter("agent", text);
    return text;
  }
  async ask(text: string, opts: { category?: string; gapId?: string; actionIds?: string[] } = {}) {
    const questionId = `q_sim_${this.n + 1}`;
    if (opts.category) this.emit({ t: this.now(), type: "agent.question", source: "question_picker", payload: { questionId, text, category: opts.category, about: { actionIds: opts.actionIds ?? [] }, ...(opts.gapId ? { gapId: opts.gapId } : {}), scores: { infoGain: 0, screenAlreadyAnswers: 0, guardrailValue: 0 }, rejectedCandidates: [] } });
    await this.agentSay(text);
    let reply: string;
    if (this.state.phase === "debrief" || opts.gapId) reply = sc.debriefReply?.(text) ?? ANSWERS.find(([re]) => re.test(text))?.[1] ?? "I'm not sure.";
    else if (sc.teachbackReply?.(text)) reply = sc.teachbackReply(text)!;
    else if (text.includes("AP lead")) reply = "Not the AP lead, the controller, Weber. The AP lead is only for releasing the big held invoices.";
    else if (text.startsWith("So that's the whole process")) reply = "Yes. That's how it works.";
    else reply = "Yes, that's right.";
    const u = this.utter("expert", reply);
    // like link_answer: a non-answer comes back as "deflected"
    const completeness = /not sure|don'?t know/i.test(reply) ? "deflected" : "full";
    if (opts.category) this.emit({ t: this.now(), type: "answer.linked", source: "agent", payload: { questionId, utteranceIds: [u.payload.utteranceId], quote: reply, quoteSpan: { t: u.t, tEnd: u.tEnd }, summary: reply, completeness, needsFollowUp: false } });
    return { questionId, replies: [u] };
  }
}

async function run(scenario: Partial<Scenario> = {}, opts?: Partial<typeof import("./debrief").DEBRIEF>) {
  const { runDebrief, DEBRIEF } = await import("./debrief");
  sc = { plan: PLAN, ...scenario };
  saved.length = 0;
  const hub = new FakeHub();
  const statuses: string[] = [];
  let last: import("./debrief").DebriefStatus | null = null;
  const wm = await runDebrief(hub as never, (s) => { last = s; statuses.push(`${s.stage}:${s.gapsOpen}`); }, { ...DEBRIEF, ...opts });
  assert.ok(wm, `runner returned null; statuses: ${statuses.join(" ")}`);
  assert.equal(statuses.some((s) => s.startsWith("error")), false, statuses.join(" "));
  const debriefQs = hub.events.flatMap((e) => (e.type === "agent.question" && e.phase === "debrief" ? [e.payload] : []));
  const gapQs = (gapId: string) => hub.events.filter((e) => e.type === "agent.question" && e.payload.gapId === gapId);
  return { hub, wm, debriefQs, gapQs, last: last as import("./debrief").DebriefStatus | null };
}

test("debrief + teach-back simulation passes the validator", async () => {
  const { hub, wm } = await run();
  const oldStatement = oracle.guardrails.find((g) => g.id === GR)!.statement;

  const debriefQs = hub.events.filter((e) => e.type === "agent.question" && e.phase === "debrief");
  assert.ok(debriefQs.length >= 3, `only ${debriefQs.length} debrief questions`);
  const texts = debriefQs.map((q) => (q.type === "agent.question" ? q.payload.text : ""));
  assert.equal(new Set(texts).size, texts.length, "a debrief question was asked twice");
  assert.equal(texts.some((t) => /small amount below/.test(t)), false, "low-priority gap should not be asked");

  // the corrected teach-back part is re-stated and then confirmed
  assert.ok(hub.spoken.some((s) => s.startsWith("So: ") && s.includes("controller, Weber")), "corrected part not re-stated");
  const verdicts = hub.events.filter((e) => e.type === "teachback.verdict");
  assert.ok(verdicts.some((v) => v.type === "teachback.verdict" && v.payload.verdict === "corrected"));
  const tbCorr = hub.events.find((e) => e.type === "knowledge.correction" && e.payload.detectedBy === "teachback");
  assert.ok(tbCorr && tbCorr.type === "knowledge.correction" && tbCorr.payload.targets.workMapRefs?.some((r) => r.id === "gr_intercompany_approval"));

  assert.equal(wm.status, "confirmed");
  assert.equal(wm.teachBack.confirmationQuote?.text, "Yes. That's how it works.");
  // the correction rewrote the claim itself (verified patch), the old text lives in its history
  const gr = wm.guardrails.find((g) => g.id === GR)!;
  assert.equal(gr.statement, GR_FIXED);
  assert.deepEqual(gr.condition, oracle.guardrails.find((g) => g.id === GR)!.condition, "unverifiable condition patch dropped");
  assert.ok(gr.history.some((h) => h.phase === "teachback" && h.before.includes(oldStatement) && h.after.includes(GR_FIXED)), JSON.stringify(gr.history));
  assert.ok(gr.provenance.includes("teachback_correction"));
  assert.ok(llmCalls.includes("patch_claim"));
  assert.ok(wm.steps.every((s) => s.confirmedByExpert));
  // versions are strictly increasing
  assert.deepEqual(saved.map((v) => v.version), saved.map((_, i) => i + 1));

  // validator on the simulated bundle
  const dir = mkdtempSync(join(tmpdir(), "sim-"));
  copyFileSync(join(fx, "session.json"), join(dir, "session.json"));
  writeFileSync(join(dir, "events.jsonl"), hub.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  symlinkSync(join(fx, "frames"), join(dir, "frames"));
  writeFileSync(join(dir, "workmap.json"), JSON.stringify(wm, null, 1));
  let out = "";
  try {
    out = execFileSync("python3", ["scripts/validate_bundle.py", dir, "--part", "map", "--workmap", join(dir, "workmap.json")], { cwd: root, encoding: "utf8" });
  } catch (e) {
    out = String((e as { stdout?: string }).stdout ?? e);
  }
  assert.match(out, / 0 errors/, out);
  const g = execFileSync("python3", ["scripts/eval_guardrails.py", join(dir, "workmap.json")], { cwd: root, encoding: "utf8" });
  assert.doesNotMatch(g, /FAIL/);
});

test("a segment still corrected after the last retry blocks the final confirmation", async () => {
  const { hub, wm } = await run({ teachbackReply: (p) => (p.includes("AP lead") || p.startsWith("So: ") ? "No, that's still not right, it's Weber." : undefined) });
  const restated = hub.spoken.filter((s) => s.startsWith("So: "));
  assert.equal(restated.length, 2, "re-asked after each correction until retries ran out");
  const verdicts = hub.events.flatMap((e) => (e.type === "teachback.verdict" ? [e.payload] : []));
  const seg = wm.teachBack.segments.find((s) => verdicts.some((v) => v.segmentId === s.id && v.verdict === "corrected"))!;
  assert.equal(seg.verdict, "corrected");
  assert.notEqual(wm.status, "confirmed");
  assert.notEqual(wm.teachBack.status, "confirmed");
});

test("a non-answer does not resolve a gap: re-asked once, then left open and blocking", async () => {
  const { wm, debriefQs } = await run({ debriefReply: (q) => (/release/i.test(q) ? "I'm not sure." : undefined) });
  const gap = wm.gaps.find((g) => /release/i.test(g.proposedQuestion))!;
  assert.notEqual(gap.status, "resolved");
  assert.notEqual(gap.status, "wont_fix");
  assert.equal(debriefQs.filter((q) => q.gapId === gap.id).length, 2, "asked, then re-asked exactly once");
  const texts = debriefQs.map((q) => q.text);
  assert.equal(new Set(texts).size, texts.length, "the re-ask is phrased differently");
  assert.notEqual(wm.status, "confirmed", "an unresolved high-priority gap blocks confirmation");
});

test("fewer than 3 gaps still yields 3 debrief questions", async () => {
  const { debriefQs } = await run({ plan: [] });
  assert.ok(debriefQs.length >= 3, `only ${debriefQs.length} debrief questions`);
  assert.ok(debriefQs.every((q) => q.gapId), "every question is backed by a gap");
  assert.ok(debriefQs.some((q) => /exact amount|who do you ask|who should they ask|stop and ask someone|apply to every/.test(q.text)), debriefQs.map((q) => q.text).join(" | "));
  const texts = debriefQs.map((q) => q.text);
  assert.equal(new Set(texts).size, texts.length);
});

test("gaps the question cap left open are asked once more before the final question; answered, the map is confirmed", async () => {
  const { wm, debriefQs, gapQs, last } = await run({}, { maxQuestions: 4 });
  assert.equal(debriefQs.length, 4);
  const late = wm.gaps.filter((g) => g.priority >= 0.5 && !debriefQs.some((q) => q.gapId === g.id));
  assert.ok(late.length > 0, "the cap left high-priority gaps for later");
  for (const g of late) {
    assert.equal(gapQs(g.id).length, 1, `asked exactly once before the final question: ${g.proposedQuestion}`);
    assert.equal(gapQs(g.id)[0].phase, "teachback");
    assert.equal(g.status, "resolved");
  }
  assert.equal(wm.gaps.find((g) => g.priority < 0.5)!.status, "wont_fix", "leftover low-priority gaps may be dropped (with a reason)");
  assert.equal(wm.status, "confirmed");
  assert.equal(last?.stage, "confirmed");
});

test("a gap still unanswered after the last chance blocks confirmation, and Ada says what is missing", async () => {
  const { hub, wm, gapQs, last } = await run({ debriefReply: (q) => (/release/i.test(q) ? "I'm not sure." : undefined) });
  const gap = wm.gaps.find((g) => /release/i.test(g.proposedQuestion))!;
  assert.equal(gapQs(gap.id).length, 3, "asked, re-asked, and asked once more before the final question");
  assert.equal(gap.status, "asked");
  assert.equal(wm.status, "teachback_pending");
  assert.ok(hub.spoken.some((s) => s.includes(gap.proposedQuestion) && /can't mark this as confirmed yet/.test(s)), hub.spoken.slice(-3).join(" | "));
  assert.equal(last?.stage, "not_confirmed");
  assert.equal(last?.detail, "Not confirmed: 1 open question");
});
