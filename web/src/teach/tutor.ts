/**
 * Tutor engine (docs/teach.md). Runs on a CaptureHub in teach mode.
 *  - MiniERP (CaseFacts): deterministic guardrail checks — nudge on change, BLOCK on save (beforeSave).
 *  - Any other website (extension): Gemini `check_guardrails` on the visible form before Save/Submit/Approve.
 *  - Interventions: overlay card with the expert's quote + screen moment, and the ElevenAgents tutor
 *    asks Socratically first ([INTERVENE]), then explains in the expert's words.
 *  - Predictions: when a case opens that hits a guardrail, the tutor asks the new hire to predict ([PREDICT]).
 *  - Mastery report at the end.
 */
import { doc, setDoc } from "firebase/firestore";
import type { CaseFacts, Guardrail, Id, MasteryReport, WorkMap } from "@shared/schema";
import { violations } from "@shared/conditions";
import { col } from "@shared/paths";
import { fmtT } from "@shared/logindex";
import { db } from "../lib/firebase";
import { llm } from "../lib/api";
import { blobUrl } from "../lib/sessions";
import { listen, send, type BridgeMsg, type PageSnapshot } from "../lib/bridge";
import type { CaptureHub } from "../capture/hub";
import type { AgentOptions } from "../voice/voice";
import { workMapForPrompt } from "./tutor-prompt";

export { workMapForPrompt };

export interface TutorCard {
  tone: "block" | "nudge" | "info" | "predict";
  title: string;
  text: string;
  guardrail?: Guardrail;
  quote?: { text: string; who: string; when: string };
  imageUrl?: string;
  bbox?: { x: number; y: number; w: number; h: number };
}

const NUDGE_COOLDOWN_MS = 30_000;
const GENERIC_CONFIDENCE = 0.7;

export class Tutor {
  facts: CaseFacts | null = null;
  page: PageSnapshot | null = null;
  readonly caught = new Set<Id>();
  readonly respected = new Set<Id>();
  readonly relevant = new Map<string, Set<Id>>(); // case key → guardrails that applied when it opened
  predictions = { asked: 0, correct: 0 };
  private nudged = new Map<Id, number>();
  private predicted = new Set<string>();
  private pendingPrediction: { guardrail: Guardrail; question: string } | null = null;
  private off: (() => void) | null = null;

  constructor(readonly wm: WorkMap, readonly onCard: (c: TutorCard) => void) {}

  hub!: CaptureHub;
  attach(hub: CaptureHub) {
    this.hub = hub;
    this.off = listen((m) => void this.onBridge(m));
  }
  detach() {
    this.off?.();
  }

  /** Voice options for the ElevenAgents tutor. */
  voiceOptions(agentId: string, learner: string): AgentOptions {
    return {
      agentId,
      dynamicVariables: { learner_name: learner, expert_name: this.wm.expert.displayName.split(" ")[0], work_map: workMapForPrompt(this.wm) },
      clientTools: {
        lookup_guardrail: ({ query }) => {
          const q = String(query ?? "").toLowerCase();
          const hits = this.wm.guardrails.filter((g) => `${g.statement} ${g.scope} ${g.requiredAction}`.toLowerCase().split(/\W+/).some((w) => w.length > 3 && q.includes(w)));
          return (hits.length ? hits : this.wm.guardrails).map((g) => `[${g.id}] ${g.statement} → ${g.requiredAction}. "${g.evidence.quotes[0]?.text ?? ""}"`).join("\n");
        },
        replay_moment: async ({ id }) => {
          const g = this.wm.guardrails.find((x) => x.id === id) ?? this.wm.guardrails.find((x) => x.stepIds.includes(String(id)));
          const s = this.wm.steps.find((x) => x.id === id);
          const moment = g?.evidence.moments[0] ?? s?.screenMoment;
          if (!moment) return "No screen moment for that.";
          await this.showCard({ tone: "info", title: `${this.expert}'s screen at ${fmtT(moment.t)}`, text: g?.statement ?? s?.title ?? "", ...(g ? { guardrail: g } : {}) }, moment);
          return "Showing it in the overlay now.";
        },
        get_case_facts: () => JSON.stringify(this.facts ?? this.page ?? "No case open."),
        grade_prediction: async ({ answer }) => this.gradePrediction(String(answer ?? "")),
      },
    };
  }

  get expert() {
    return this.wm.expert.displayName.split(" ")[0];
  }

  // ───────────── bridge ─────────────
  private async onBridge(m: BridgeMsg) {
    if (m.kind === "beforeSave") {
      this.facts = m.facts;
      const block = violations(this.wm, m.facts).filter((g) => g.severity === "block");
      send({ kind: "beforeSaveResult", reqId: m.reqId, allow: !block.length, guardrailIds: block.map((g) => g.id), message: block[0] ? `Hold on: ${block[0].statement}` : undefined });
      if (block[0]) void this.intervene(block[0], true, m.facts.invoice.key);
      else this.markRespected(m.facts);
    } else if (m.kind === "beforeAction") {
      this.page = m.page;
      const out = await this.checkGeneric(m.page, m.action);
      send({ kind: "beforeActionResult", reqId: m.reqId, allow: !out.length, guardrailIds: out.map((g) => g.id), message: out[0] ? `Hold on: ${out[0].statement}` : undefined });
      if (out[0]) void this.intervene(out[0], true, m.page.title);
    } else if (m.kind === "case" && m.state === "start" && m.facts) {
      this.facts = m.facts;
      const rel = violations(this.wm, m.facts).filter((g) => g.severity !== "info");
      this.relevant.set(m.facts.invoice.key, new Set(rel.map((g) => g.id)));
      if (rel[0]) void this.predict(rel[0], m.facts);
    } else if (m.kind === "app" && m.facts) {
      this.facts = m.facts;
      if (m.payload.action === "change") this.nudge(m.facts);
    } else if (m.kind === "app" && m.page) {
      this.page = m.page;
    }
  }

  private markRespected(f: CaseFacts) {
    for (const id of this.relevant.get(f.invoice.key) ?? []) if (!this.caught.has(id)) this.respected.add(id);
  }

  private nudge(f: CaseFacts) {
    for (const g of violations(this.wm, f)) {
      if (Date.now() - (this.nudged.get(g.id) ?? -1e12) < NUDGE_COOLDOWN_MS) continue;
      this.nudged.set(g.id, Date.now());
      this.caught.add(g.id); // caught early, before it reached a save
      void this.showCard({ tone: "nudge", title: "Heads-up", text: g.statement, guardrail: g }, g.evidence.moments[0]);
      this.hub.emit({
        t: this.hub.now(), type: "tutor.intervention", source: "tutor",
        payload: { guardrailId: g.id, triggerAppEventId: this.lastAppEventId(), beforeSave: false, newHireAction: describeFacts(f), expectedAction: g.requiredAction, spokenText: `Careful: ${g.statement}`, outcome: "pending" },
      });
      return;
    }
  }

  private async checkGeneric(page: PageSnapshot, action: string): Promise<Guardrail[]> {
    try {
      const out = await llm("check_guardrails", {
        guardrails: this.wm.guardrails.map((g) => ({ id: g.id, statement: g.statement, requiredAction: g.requiredAction, scope: g.scope })),
        page: { url: page.url, title: page.title }, fields: page.fields, action,
      });
      return out.violations
        .filter((v) => v.confidence >= GENERIC_CONFIDENCE)
        .map((v) => this.wm.guardrails.find((g) => g.id === v.guardrailId))
        .filter((g): g is Guardrail => !!g && g.severity === "block");
    } catch {
      return []; // never block on an error
    }
  }

  // ───────────── interventions ─────────────
  async intervene(g: Guardrail, beforeSave: boolean, caseLabel: string) {
    this.caught.add(g.id);
    const quote = g.evidence.quotes[0]?.text ?? g.statement;
    const moment = g.evidence.moments[0];
    const socratic = `${this.expert} would stop here. Why do you think?`;
    await this.showCard({ tone: "block", title: `Save held: ${g.statement}`, text: socratic, guardrail: g }, moment);
    const t = this.hub.now();
    this.pendingPrediction = null; // an intervention supersedes an open prediction
    if (this.intervening) {
      this.logIntervention(g, beforeSave, socratic, moment, caseLabel, t, false);
      return;
    }
    this.intervening = true;
    try {
      // Agent voice: one control message; the agent asks, listens and explains. Other voices: we do it in two steps.
      const agentVoice = this.hub.voice?.name === "elevenagents";
      const { replies } = await this.hub.ask(socratic, { intent: "intervention", timeoutMs: 15_000, control: `[INTERVENE] ${g.statement} | ${quote}` });
      let spoken = socratic;
      if (!agentVoice) {
        const ex = await llm("tutor_explain", { expertName: this.expert, guardrail: g, quote, facts: this.facts ?? emptyFacts(caseLabel), socratic: false }).catch(() => ({ spoken: `${this.expert} says: "${quote}". ${g.requiredAction}.` }));
        spoken = ex.spoken;
        await this.hub.agentSay(spoken, "intervention");
      }
      await this.showCard({ tone: "block", title: `Save held: ${g.statement}`, text: spoken === socratic ? `${this.expert}: "${quote}". ${g.requiredAction}.` : spoken, guardrail: g }, moment);
      this.logIntervention(g, beforeSave, spoken, moment, caseLabel, t, replies.length > 0);
    } finally {
      this.intervening = false;
    }
  }

  private intervening = false;
  private logIntervention(g: Guardrail, beforeSave: boolean, spoken: string, moment: Guardrail["evidence"]["moments"][number] | undefined, caseLabel: string, t: number, answered: boolean) {
    this.hub.emit({
      t, type: "tutor.intervention", source: "tutor",
      payload: {
        guardrailId: g.id, triggerAppEventId: this.lastAppEventId(), beforeSave, newHireAction: this.facts ? describeFacts(this.facts) : caseLabel,
        expectedAction: g.requiredAction, spokenText: spoken, ...(moment ? { replayedScreenMoment: moment } : {}), outcome: answered ? "argued" : "pending",
      },
    });
  }

  // ───────────── predictions ─────────────
  async predict(g: Guardrail, f: CaseFacts) {
    const key = `${f.invoice.key}:${g.id}`;
    if (this.predicted.has(key) || this.intervening) return;
    this.predicted.add(key);
    const question = `Before you work on INV-${f.invoice.key} (${f.supplier.name}, ${f.invoice.amount.toLocaleString("en")} ${f.invoice.currency}, ${f.invoice.category}): what would ${this.expert} do here, and why?`;
    this.pendingPrediction = { guardrail: g, question };
    this.predictions.asked++;
    await this.showCard({ tone: "predict", title: "Predict the decision", text: question });
    {
      const { replies } = await this.hub.ask(question, { intent: "question", timeoutMs: 25_000, control: `[PREDICT] ${question}` });
      // agent voice grades through its grade_prediction tool; other voices: grade here
      if (this.pendingPrediction && replies.length && this.hub.voice?.name !== "elevenagents") {
        const feedback = await this.gradePrediction(replies.map((r) => r.payload.text).join(" "));
        await this.hub.agentSay(feedback, "other");
      }
    }
  }

  async gradePrediction(answer: string): Promise<string> {
    const p = this.pendingPrediction;
    if (!p) return "There is no open prediction.";
    this.pendingPrediction = null;
    const quote = p.guardrail.evidence.quotes[0]?.text ?? p.guardrail.statement;
    const out = await llm("grade_prediction", { question: p.question, expected: `${p.guardrail.requiredAction} (${p.guardrail.statement})`, reason: quote, answer })
      .catch(() => ({ correct: false, feedback: `${this.expert} says: "${quote}"` }));
    if (out.correct) this.predictions.correct++;
    const decision = this.wm.decisions.find((d) => p.guardrail.stepIds.includes(d.stepId));
    const answerU = [...this.hub.events].reverse().find((e) => e.type === "utterance" && e.payload.speaker === "newhire");
    this.hub.emit({
      t: this.hub.now(), type: "tutor.prediction", source: "tutor",
      payload: { decisionId: decision?.id ?? p.guardrail.id, question: p.question, answerUtteranceIds: answerU?.type === "utterance" ? [answerU.payload.utteranceId] : [], correct: out.correct },
    });
    void this.showCard({ tone: out.correct ? "info" : "nudge", title: out.correct ? "Spot on" : "Not quite", text: out.feedback, guardrail: p.guardrail }, out.correct ? undefined : p.guardrail.evidence.moments[0]);
    return out.feedback;
  }

  // ───────────── overlay ─────────────
  private async showCard(c: TutorCard, moment?: { sessionId: Id; frameId: Id; t: number; bbox?: TutorCard["bbox"] }) {
    let imageUrl: string | undefined;
    if (moment) {
      imageUrl = await blobUrl(moment.sessionId, `frames/${moment.frameId}.webp`).catch(() => blobUrl(moment.sessionId, `frames/${moment.frameId}.svg`)).catch(() => undefined);
    }
    const q = c.guardrail?.evidence.quotes[0];
    const card: TutorCard = {
      ...c,
      ...(q ? { quote: { text: q.text, who: this.wm.expert.displayName, when: fmtT(q.t) } } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(moment?.bbox ? { bbox: moment.bbox } : {}),
    };
    this.onCard(card);
    send({ kind: "tutorCard", tone: card.tone, title: card.title, text: card.text, ...(card.quote ? { quote: card.quote } : {}), ...(card.imageUrl ? { imageUrl: card.imageUrl } : {}), ...(card.bbox ? { bbox: card.bbox } : {}) });
  }

  private lastAppEventId(): Id {
    return [...this.hub.events].reverse().find((e) => e.type === "app.event")?.id ?? "";
  }

  // ───────────── report ─────────────
  async report(): Promise<MasteryReport> {
    const g = (id: Id): MasteryReport["perGuardrail"][number]["status"] => (this.caught.has(id) ? "caught_by_tutor" : this.respected.has(id) ? "respected" : "not_triggered");
    const rep: MasteryReport = {
      sessionId: this.hub.session.id, workMapId: this.wm.id, learner: this.hub.session.participant,
      perGuardrail: this.wm.guardrails.map((x) => ({ guardrailId: x.id, status: g(x.id) })),
      perStep: this.wm.steps.map((s) => {
        const st = s.guardrailIds.map(g);
        return { stepId: s.id, status: st.includes("caught_by_tutor") ? "assisted" : st.length && st.every((x) => x === "respected") ? "mastered" : "not_seen" };
      }),
      predictions: this.predictions,
      practiceNext: this.wm.guardrails.filter((x) => this.caught.has(x.id)).map((x) => x.statement),
    };
    await setDoc(doc(db, col.report(this.hub.session.id), "mastery"), rep);
    return rep;
  }
}

function describeFacts(f: CaseFacts) {
  return `INV-${f.invoice.key}: ${f.invoice.category} ${f.invoice.amount} ${f.invoice.currency}, cost center ${f.invoice.costCenter}, asset ${f.invoice.assetNo ?? "-"}, status ${f.invoice.status}, approver ${f.invoice.approver ?? "-"}`;
}

function emptyFacts(label: string): CaseFacts {
  return {
    invoice: { key: label, amount: 0, currency: "EUR", date: "", month: 0, category: "", costCenter: "", assetNo: null, status: "", approver: null, comment: "", duplicateDeliveryNote: false },
    supplier: { name: "", group: "", isNew: false },
  };
}
