/**
 * Two experts, one task (brief stretch goal): compare two confirmed Work Maps for the same kind of work,
 * ask each expert "why?" where they differ, and resolve into a team rule once both answered.
 */
import type { Comparison, Id, WorkMap } from "@shared/schema";
import { newId } from "@shared/ids";
import { llm } from "../lib/api";
import { getComparison, listComparisons, saveComparison } from "../lib/sessions";
import { workMapForPrompt } from "../teach/tutor-prompt";
import type { User } from "../lib/users";

export async function compareMaps(a: WorkMap, b: WorkMap): Promise<Comparison> {
  const out = await llm("compare_workmaps", {
    a: { expert: a.expert.displayName, map: workMapForPrompt(a) },
    b: { expert: b.expert.displayName, map: workMapForPrompt(b) },
  });
  const now = new Date().toISOString();
  const c: Comparison = {
    id: newId("cmp"), domain: a.task.domain, workMapIds: [a.id, b.id],
    experts: [{ userId: a.expert.id, name: a.expert.displayName }, { userId: b.expert.id, name: b.expert.displayName }],
    createdAt: now, updatedAt: now, summary: out.summary,
    items: out.items.map((i) => ({
      id: newId("cmpi"), topic: i.topic, kind: i.kind, severity: i.severity,
      ...(i.aSays ? { a: { says: i.aSays, refIds: [] } } : {}),
      ...(i.bSays ? { b: { says: i.bSays, refIds: [] } } : {}),
      questions: { ...(i.kind !== "same" && i.questionForA ? { a: i.questionForA } : {}), ...(i.kind !== "same" && i.questionForB ? { b: i.questionForB } : {}) },
      answers: {},
    })),
  };
  await saveComparison(c);
  return c;
}

export interface OpenQuestion {
  comparisonId: Id;
  itemId: Id;
  side: "a" | "b";
  topic: string;
  question: string;
  other: string;
}

/** Ada's open "why?" questions for this expert across all comparisons. */
export async function openQuestionsFor(user: User): Promise<OpenQuestion[]> {
  const out: OpenQuestion[] = [];
  for (const c of await listComparisons()) {
    const side = isMe(c.experts[0], user) ? "a" : isMe(c.experts[1], user) ? "b" : null;
    if (!side) continue;
    const other = c.experts[side === "a" ? 1 : 0].name;
    for (const it of c.items) {
      const q = it.questions[side];
      if (q && !it.answers[side]) out.push({ comparisonId: c.id, itemId: it.id, side, topic: it.topic, question: q, other });
    }
  }
  return out;
}

/** Save an expert's answer; when both sides have answered, resolve into a team rule. */
export async function answerQuestion(q: OpenQuestion, text: string): Promise<Comparison | null> {
  const c = await getComparison(q.comparisonId);
  if (!c) return null;
  const it = c.items.find((x) => x.id === q.itemId);
  if (!it) return null;
  it.answers[q.side] = { text, at: new Date().toISOString() };
  c.updatedAt = new Date().toISOString();
  const needsA = !!it.questions.a, needsB = !!it.questions.b;
  if ((!needsA || it.answers.a) && (!needsB || it.answers.b) && !it.resolution) {
    try {
      it.resolution = await llm("resolve_difference", {
        topic: it.topic,
        a: { expert: c.experts[0].name, says: it.a?.says ?? "(no rule)", why: it.answers.a?.text ?? "" },
        b: { expert: c.experts[1].name, says: it.b?.says ?? "(no rule)", why: it.answers.b?.text ?? "" },
      });
    } catch (err) {
      console.warn("resolve_difference failed", err);
    }
  }
  await saveComparison(c);
  return c;
}

/** Maps recorded via the login carry the user id; older/demo maps only the name ("Sabine K."). */
const isMe = (e: { userId?: Id; name: string }, user: User) =>
  e.userId === user.id || e.name === user.name || e.name.split(" ")[0] === user.short;
