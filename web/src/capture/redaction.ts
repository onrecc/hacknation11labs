/**
 * Transcript redaction at the capture boundary: every utterance is passed through shared/redact (engine
 * "regex") before it is logged, stored or sent to an LLM. Names come from the fixed user profiles; MiniERP
 * seed data has no supplier contact persons. Approver names ("M. Weber", "Jonas") are left in on purpose:
 * guardrails need them as escalation targets.
 */
import type { Session, Word } from "@shared/schema";
import { redact, redactWords, REDACTED_ENTITY_TYPES, type RedactedEntity } from "@shared/redact";
import { USERS } from "../lib/users";

export const REDACTION_NAMES: readonly string[] = USERS.map((u) => u.name);

/** Session config for the transcript redactor (CapturePage / TeachPage / workday). */
export const REDACTION_CONFIG: Session["config"]["redaction"] = { enabled: true, engine: "regex", entityTypes: [...REDACTED_ENTITY_TYPES] };

export interface RedactedUtterance {
  readonly text: string;
  readonly words: Word[];
  readonly entities: readonly RedactedEntity[];
}

export function redactUtterance(text: string, words: readonly Word[]): RedactedUtterance {
  const opts = { names: REDACTION_NAMES };
  const r = redact(text, opts);
  return { text: r.text, words: redactWords(words, opts), entities: r.entities };
}
