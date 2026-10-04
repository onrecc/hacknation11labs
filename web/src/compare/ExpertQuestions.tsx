/**
 * On the expert's My day page: Ada's "why?" questions from comparisons with another expert.
 * Answer by typing, or aloud when the day is running (asked through the hub, so it lands in today's log too).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { User } from "../lib/users";
import type { CaptureHub } from "../capture/hub";
import { answerQuestion, openQuestionsFor, type OpenQuestion } from "./compare";
import { toast } from "../components/toast";

export function ExpertQuestions({ user, hub }: { user: User; hub?: CaptureHub | null }) {
  const [qs, setQs] = useState<OpenQuestion[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const reload = (): void => void openQuestionsFor(user).then(setQs).catch((e: unknown) => toast.error(e, reload, "Couldn't load Ada's questions"));
  useEffect(reload, [user.id]);
  if (!qs.length) return null;

  async function submit(q: OpenQuestion, text: string) {
    if (!text.trim()) return;
    setBusy(q.itemId);
    try {
      await answerQuestion(q, text.trim());
      setDrafts(({ [q.itemId]: _sent, ...rest }) => rest);
      reload();
    } catch (e) {
      toast.error(e, () => void submit(q, text), "Couldn't save your answer");
    } finally {
      setBusy(null);
    }
  }

  async function aloud(q: OpenQuestion) {
    if (!hub) return;
    setBusy(q.itemId);
    try {
      const { replies } = await hub.ask(q.question, { category: "why", intent: "question", timeoutMs: 30_000 });
      const text = replies.map((r) => r.payload.text).join(" ");
      if (text) await answerQuestion(q, text);
      reload();
    } catch (e) {
      toast.error(e, () => void aloud(q), "Couldn't record your answer");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card expert-questions">
      <h3>Ada has {qs.length === 1 ? "a question" : `${qs.length} questions`} for you</h3>
      <p className="muted small">She compared how you and {[...new Set(qs.map((q) => q.other))].join(", ")} do the same work. <Link to="/compare">See the comparison</Link></p>
      {qs.map((q) => (
        <div key={q.itemId} className="eq">
          <div className="muted small">{q.topic}</div>
          <p>“{q.question}”</p>
          <div className="row">
            <input placeholder="Your answer" value={drafts[q.itemId] ?? ""} onChange={(e) => setDrafts({ ...drafts, [q.itemId]: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && void submit(q, drafts[q.itemId] ?? "")} />
            <button disabled={busy === q.itemId} onClick={() => void submit(q, drafts[q.itemId] ?? "")}>Answer</button>
            {hub && <button disabled={busy === q.itemId} onClick={() => void aloud(q)}>Answer aloud</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
