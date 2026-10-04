/**
 * Regex text redactor (engine "regex"): runs in the browser on every transcript utterance before it is stored
 * or sent to an LLM. Pure and deterministic; no Presidio, no model.
 *
 * Detects: IBAN, email (written and spoken "x at y dot de"), phone numbers (leading + or 0), card numbers
 * (Luhn-checked) and person names from a caller-supplied list. Business numbers the Work Map needs
 * (invoice keys, amounts, cost centers like 4711/0400, dates) are deliberately not matched.
 * Limits: names outside the list ("Mrs. Bauer") and numbers spelled out as words are not caught.
 */
import type { Word } from "./schema";

export type RedactionEntityType = "IBAN" | "EMAIL_ADDRESS" | "PHONE_NUMBER" | "CREDIT_CARD" | "PERSON";

export const PLACEHOLDER: Readonly<Record<RedactionEntityType, string>> = {
  IBAN: "[IBAN]", EMAIL_ADDRESS: "[EMAIL]", PHONE_NUMBER: "[PHONE]", CREDIT_CARD: "[CARD]", PERSON: "[PERSON]",
};

export const REDACTED_ENTITY_TYPES: readonly RedactionEntityType[] = ["IBAN", "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD", "PERSON"];

export interface RedactOptions {
  /** Person names to redact (full names; each part of 3+ letters is matched on its own too). */
  readonly names?: readonly string[];
}

export interface RedactedEntity {
  readonly type: RedactionEntityType;
  readonly replacement: string;
  /** Where the placeholder sits in the REDACTED text (the original span is never kept). */
  readonly charSpan: [number, number];
}

export interface RedactResult {
  readonly text: string;
  readonly counts: Partial<Record<RedactionEntityType, number>>;
  readonly entities: readonly RedactedEntity[];
}

interface Match { readonly type: RedactionEntityType; readonly start: number; readonly end: number }

const NOT_ALNUM_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_ALNUM_AFTER = "(?![\\p{L}\\p{N}])";
const TLDS = "com|de|org|net|eu|io|cz|at|ch|co|uk|fr|it|nl";

/** Country code + check digits, then 11–30 upper-case alphanumerics, optionally grouped by single spaces. */
const IBAN_RE = new RegExp(`${NOT_ALNUM_BEFORE}[A-Za-z]{2}\\d{2}(?: ?[A-Z0-9]){11,30}${NOT_ALNUM_AFTER}`, "gu");
const EMAIL_RE = new RegExp(`${NOT_ALNUM_BEFORE}[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)*\\.[A-Za-z]{2,}${NOT_ALNUM_AFTER}`, "gu");
const SPOKEN_EMAIL_RE = new RegExp(`${NOT_ALNUM_BEFORE}[\\p{L}\\p{N}._-]+ at [\\p{L}\\p{N}-]+(?: dot [\\p{L}\\p{N}-]+)* dot (?:${TLDS})${NOT_ALNUM_AFTER}`, "giu");
const CARD_RE = new RegExp(`${NOT_ALNUM_BEFORE}\\d(?:[ -]?\\d){12,18}${NOT_ALNUM_AFTER}`, "gu");
/** Starts with + or 0 (or "(0"): amounts, cost centers and invoice keys never do. Not after / . , - (4711/0400, 7,200.00). */
const PHONE_RE = /(?<![\p{L}\p{N}+/.,-])(?:\+\d|\(0|0)[\d ()/-]*\d(?![\p{L}\p{N}])/gu;
const PHONE_MIN_DIGITS = { international: 8, national: 9 };
const PHONE_MAX_DIGITS = 15;
const NAME_PART_MIN = 3;

/** Luhn checksum over the digits of `s` (separators ignored). */
export function luhnValid(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  if (!digits.length) return false;
  const sum = [...digits].reverse().reduce((acc, ch, i) => {
    const d = Number(ch) * (i % 2 ? 2 : 1);
    return acc + (d > 9 ? d - 9 : d);
  }, 0);
  return sum % 10 === 0;
}

const isPhone = (s: string): boolean => {
  const n = s.replace(/\D/g, "").length;
  return n <= PHONE_MAX_DIGITS && n >= (s.startsWith("+") ? PHONE_MIN_DIGITS.international : PHONE_MIN_DIGITS.national);
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function nameRegex(names: readonly string[]): RegExp | null {
  const parts = names.flatMap((n) => [n.trim(), ...n.split(/\s+/).filter((p) => p.length >= NAME_PART_MIN)]).filter(Boolean);
  const unique = [...new Set(parts)].sort((a, b) => b.length - a.length);
  if (!unique.length) return null;
  return new RegExp(`${NOT_ALNUM_BEFORE}(?:${unique.map(escapeRe).join("|")})${NOT_ALNUM_AFTER}`, "giu");
}

function collect(text: string, re: RegExp, type: RedactionEntityType, accept: (s: string) => boolean = () => true): Match[] {
  return [...text.matchAll(re)].filter((m) => accept(m[0])).map((m) => ({ type, start: m.index, end: m.index + m[0].length }));
}

/** All entity spans in `text` (original offsets), non-overlapping: earliest first, longest wins a tie. */
export function findEntities(text: string, opts: RedactOptions = {}): Match[] {
  const names = nameRegex(opts.names ?? []);
  const candidates = [
    ...collect(text, EMAIL_RE, "EMAIL_ADDRESS"),
    ...collect(text, SPOKEN_EMAIL_RE, "EMAIL_ADDRESS"),
    ...collect(text, IBAN_RE, "IBAN"),
    ...collect(text, CARD_RE, "CREDIT_CARD", luhnValid),
    ...collect(text, PHONE_RE, "PHONE_NUMBER", isPhone),
    ...(names ? collect(text, names, "PERSON") : []),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  return candidates.reduce<Match[]>((kept, m) => (kept.length && m.start < kept[kept.length - 1].end ? kept : [...kept, m]), []);
}

/** Replace `matches` (offsets relative to `text`, sorted, non-overlapping) with their placeholders. */
function apply(text: string, matches: readonly Match[]): RedactResult {
  const init = { text: "", cursor: 0, entities: [] as RedactedEntity[] };
  const out = matches.reduce((acc, m) => {
    const head = acc.text + text.slice(acc.cursor, m.start);
    const replacement = PLACEHOLDER[m.type];
    const entity: RedactedEntity = { type: m.type, replacement, charSpan: [head.length, head.length + replacement.length] };
    return { text: head + replacement, cursor: m.end, entities: [...acc.entities, entity] };
  }, init);
  const counts = out.entities.reduce<Partial<Record<RedactionEntityType, number>>>((c, e) => ({ ...c, [e.type]: (c[e.type] ?? 0) + 1 }), {});
  return { text: out.text + text.slice(out.cursor), counts, entities: out.entities };
}

export function redact(text: string, opts: RedactOptions = {}): RedactResult {
  return apply(text, findEntities(text, opts));
}

/**
 * Redact per-word transcript timing consistently with redact(): words are joined with single spaces, and the
 * words an entity touches collapse into one word carrying the placeholder, timed from the first to the last.
 */
export function redactWords(words: readonly Word[], opts: RedactOptions = {}): Word[] {
  const starts = words.reduce<number[]>((acc, w, i) => [...acc, i ? acc[i - 1] + words[i - 1].w.length + 1 : 0], []);
  const joined = words.map((w) => w.w).join(" ");
  const wordAt = (offset: number): number => starts.findLastIndex((s) => s <= offset);
  type Group = { first: number; last: number; matches: Match[] };
  const groups = findEntities(joined, opts).reduce<Group[]>((gs, m) => {
    const first = wordAt(m.start);
    const last = wordAt(m.end - 1);
    const prev = gs[gs.length - 1];
    if (prev && first <= prev.last) return [...gs.slice(0, -1), { ...prev, last: Math.max(prev.last, last), matches: [...prev.matches, m] }];
    return [...gs, { first, last, matches: [m] }];
  }, []);
  if (!groups.length) return [...words];
  const merged = groups.map((g) => {
    const base = starts[g.first];
    const slice = joined.slice(base, starts[g.last] + words[g.last].w.length);
    const shifted = g.matches.map((m) => ({ ...m, start: m.start - base, end: m.end - base }));
    return { ...g, word: { w: apply(slice, shifted).text, t: words[g.first].t, tEnd: words[g.last].tEnd } };
  });
  return words.flatMap((w, i) => {
    const g = merged.find((x) => i >= x.first && i <= x.last);
    if (!g) return [w];
    return i === g.first ? [g.word] : [];
  });
}
