/**
 * Judge mode (P0-2): subtle numbered markers ①–⑤ next to the UI that answers each Apprentice Test question.
 * Turned on with `?judge=1`, off with `?judge=0`; the choice is remembered in localStorage (best effort:
 * private mode or blocked storage just means it isn't remembered). Pure: the hook lives in JudgeMarker.tsx.
 */

export type JudgeQuestion = 1 | 2 | 3 | 4 | 5;

export interface JudgeQuestionInfo {
  readonly glyph: string;
  readonly label: string;
  /** one sentence: what the element next to the marker proves */
  readonly hint: string;
}

export const JUDGE_QUESTIONS: Readonly<Record<JudgeQuestion, JudgeQuestionInfo>> = {
  1: { glyph: "①", label: "When to ask", hint: "Ada asks only at a natural pause (save, case end, silence), and says which signal she used." },
  2: { glyph: "②", label: "What to ask", hint: "Each question targets a guardrail, exception or gap the screen alone doesn't explain; weaker candidates are dropped." },
  3: { glyph: "③", label: "When it has understood", hint: "The debrief ends when no important gap is open, then Ada explains the task back and the expert confirms or corrects each part." },
  4: { glyph: "④", label: "Whether the new hire learned", hint: "The mastery report shows, per expert rule, whether the new hire followed it, was caught before save, or hasn't practised it." },
  5: { glyph: "⑤", label: "Trust", hint: "The expert can go off the record at any time; names, IBANs, phone numbers, emails and card numbers are redacted before storage." },
};

export const JUDGE_KEY = "protege.judge";

/** The subset of Storage we use; `null` when storage isn't available at all. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** "① When to ask" */
export function judgeLabel(n: JudgeQuestion): string {
  const q = JUDGE_QUESTIONS[n];
  return `${q.glyph} ${q.label}`;
}

/** Applies `?judge=1|0` from the query string (and remembers it); otherwise returns the remembered choice. */
export function resolveJudgeFlag(search: string, store: KeyValueStore | null): boolean {
  const q = new URLSearchParams(search).get("judge");
  if (q === "1" || q === "0") {
    try {
      if (q === "1") store?.setItem(JUDGE_KEY, "1");
      else store?.removeItem(JUDGE_KEY);
    } catch { /* storage blocked: the flag still applies to this page view */ }
    return q === "1";
  }
  try {
    return store?.getItem(JUDGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** window.localStorage, or null where touching it throws (sandboxed iframes, some private modes). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
