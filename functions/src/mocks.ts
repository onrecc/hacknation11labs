/**
 * Canned outputs so every flow works without API keys (LLM_MOCK=1 or no CLAUDE_KEY).
 * Deliberately simple and deterministic. Replace with real calls as soon as keys exist.
 */
import type { LlmTask, LlmInput, LlmOutput } from "../../shared/llm";

export function mockOutput<T extends LlmTask>(task: T, input: LlmInput<T>): LlmOutput<T> {
  const out: { [K in LlmTask]: (i: LlmInput<K>) => LlmOutput<K> } = {
    vision: (i) => ({
      summary: `(mock) screen after: ${i.recentActions.at(-1) ?? "nothing yet"}`,
      app: { name: "MiniERP", view: "unknown" },
      visibleEntities: [], changes: [], activityGuess: "unknown", piiRegions: [], confidence: 0.1,
    }),
    pick_question: (i) => {
      const last = i.recentActions.at(-1);
      const q = last ? `You just did "${last.description}". What made you do that?` : "";
      const ask = !!last && i.liveBudgetLeft > 0 && !i.askedQuestions.includes(q);
      return {
        ask, question: q, category: "why", aboutActionIds: last ? [last.id] : [],
        scores: { infoGain: 0.6, screenAlreadyAnswers: 0.2, guardrailValue: 0.5 }, rejected: [], deferInstead: !ask && !!last,
      };
    },
    detect_correction: (i) => {
      const m = /\b(no,? wait|actually|that's wrong|i mean|sorry)\b/i.exec(i.utterance.text);
      return {
        isCorrection: !!m, kind: "statement_revised", quote: m ? i.utterance.text : "", targetActionIds: [], targetUtteranceIds: m ? [i.utterance.id] : [],
        before: "", after: m ? i.utterance.text : "", appliesTo: "always", confidence: m ? 0.7 : 0,
      };
    },
    link_answer: (i) => {
      const text = i.utterances[0]?.text ?? "";
      const quote = text.split(/(?<=[.!?])\s+/)[0] ?? text;
      const deflected = !text.trim() || /\b(not sure|don'?t know|no idea|can'?t say|skip|pass)\b/i.test(text);
      return { quote, summary: quote, completeness: deflected ? "deflected" : "partial", needsFollowUp: deflected };
    },
    extract_workmap: () => ({ summary: "", steps: [], decisions: [], guardrails: [], glossary: [], mistakes: [], correctionTargets: [] }),
    plan_debrief: (i) => ({
      gaps: [
        ...i.deferredQuestions.map((q) => ({ kind: "deferred_question", description: q, proposedQuestion: q, priority: 0.8, aboutActionIds: [] })),
        { kind: "unseen_case", description: "(mock) unseen case", proposedQuestion: "What would you do if a case didn't fit any of the rules you used today?", priority: 0.7, aboutActionIds: [] },
        { kind: "who_decides", description: "(mock) escalation", proposedQuestion: "Who do you ask when you're unsure, and how quickly?", priority: 0.6, aboutActionIds: [] },
        { kind: "missing_threshold", description: "(mock) limits", proposedQuestion: "Is there an amount above which you always stop and check?", priority: 0.55, aboutActionIds: [] },
      ],
    }),
    teachback: (i) => ({ segments: i.workmap.steps.map((s) => ({ text: `${s.title}. ${s.instructions}`, stepIds: [s.id] })) }),
    label_task: (i) => ({
      title: i.currentTitle || `Work in ${i.app}`, domain: i.department, summary: `(mock) ${i.actions.length} actions in ${i.app}`,
      isNewTask: false, newTaskStartsAtActionId: "", sameAsKnownTask: "", confidence: 0.3,
    }),
    compare_workmaps: (i) => ({
      summary: `(mock) ${i.a.expert} and ${i.b.expert} compared.`,
      items: [{ topic: "(mock) suspected duplicates", kind: "different", severity: "important", aSays: "puts them on hold", bSays: "sends them to the AP lead", questionForA: `${i.b.expert} does it differently. Why do you do it your way?`, questionForB: `${i.a.expert} does it differently. Why do you do it your way?` }],
    }),
    resolve_difference: () => ({ verdict: "escalate", note: "(mock) Ask the team lead which way is the rule.", condition: "" }),
    check_guardrails: () => ({ violations: [] }),
    grade_prediction: (i) => ({ correct: i.answer.toLowerCase().includes(i.expected.toLowerCase().split(" ")[0] ?? ""), feedback: `${i.reason}` }),
    teachback_verdict: (i) => {
      const r = i.reply.trim();
      if (!r) return { verdict: "unclear", correction: "", correctedText: "" };
      const yes = /^\s*(yes|yeah|yep|right|correct|exactly|mm-?hm|that'?s right)\b/i.test(r);
      const change = /\b(but|not|no|except|actually|instead|wrong)\b/i.test(r);
      // no rewritten text: the runner re-states the part from the patched claims (patch_claim)
      return yes && !change ? { verdict: "confirmed", correction: "", correctedText: "" } : { verdict: "corrected", correction: r, correctedText: "" };
    },
    patch_claim: (i) => {
      // the first guardrail (else decision, else step) the part speaks for takes the expert's first sentence
      const u = i.replyUtterances[0];
      const quote = u?.text.split(/(?<=[.!?])\s+/)[0] ?? "";
      const c = ["guardrail", "decision", "step"].map((k) => i.claims.find((x) => x.kind === k)).find(Boolean);
      const field = c?.kind === "guardrail" ? "statement" : c?.kind === "decision" ? "reasonSummary" : "instructions";
      return c && quote ? { patches: [{ id: c.id, field, value: quote }], quotes: [{ utteranceId: u.id, quote }] } : { patches: [], quotes: [] };
    },
    tutor_explain: (i) => ({
      spoken: i.socratic
        ? `${i.expertName} would stop here. Why do you think?`
        : `${i.expertName} said: "${i.quote}". ${i.guardrail.requiredAction}.`,
    }),
  };
  return (out[task] as (i: LlmInput<T>) => LlmOutput<T>)(input);
}
