/**
 * Transcript masking before anything is saved: IBANs, emails and phone numbers (regex, written and spoken forms).
 * Next step: Microsoft Presidio (names, addresses, IDs) server-side; regex keeps the obvious cases out today.
 * Amounts, dates, invoice numbers and cost centers must survive untouched (the Work Map quotes them).
 */
import type { Word } from "@shared/schema";

type Kind = "IBAN" | "email" | "phone";
const digits = (s: string) => (s.match(/\d/g) ?? []).length;

const RULES: Array<{ kind: Kind; re: RegExp; ok?: (m: string) => boolean; trim?: (m: string) => string }> = [
  // DE89 3704 0044 0532 0130 00 / de89370400440532013000 (2 letters, 2 check digits, 11–30 more, mostly digits)
  // (letter-only groups occur inside IBANs, e.g. GB29 NWBK …, but a trailing one is the next spoken word: trimmed)
  { kind: "IBAN", re: /\b[a-z]{2}\d{2}(?:[ -]?[a-z0-9]{1,4}){3,8}\b/gi, trim: (m) => m.replace(/(?:[ -][a-z]+)+$/i, ""),
    ok: (m) => { const c = m.replace(/[ -]/g, ""); return c.length >= 15 && c.length <= 34 && digits(c) >= 10; } },
  { kind: "email", re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  // spoken: "jonas dot weber at example dot com"
  { kind: "email", re: /\b[a-z0-9]+(?: dot [a-z0-9]+)* at [a-z0-9-]+(?: dot [a-z0-9-]+)* dot (?:com|de|org|net|io|eu|cz|fi|at|ch|co|uk)\b/gi },
  // +49 151 2345 6789 / 0049 30 1234567 / 030/1234567 / plus 49 …: needs a + / 00 / leading 0 and ≥ 8 digits
  { kind: "phone", re: /(?:\+|\bplus\s|\b00|\b0)\d[\d\s\-/().]{5,}\d\b/gi, ok: (m) => digits(m) >= 8 && !/^\d{4}-\d{2}-\d{2}$/.test(m.trim()) },
];

/** Character ranges of personal data in `text`. */
function spans(text: string): Array<{ start: number; end: number; kind: Kind }> {
  const out: Array<{ start: number; end: number; kind: Kind }> = [];
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      const hit = r.trim ? r.trim(m[0]) : m[0];
      if (r.ok && !r.ok(hit)) continue;
      const start = m.index!, end = start + hit.length;
      if (out.some((o) => start < o.end && end > o.start)) continue; // first rule wins (IBAN before phone)
      out.push({ start, end, kind: r.kind });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function maskPii(text: string): string {
  let out = "", at = 0;
  for (const s of spans(text)) {
    out += `${text.slice(at, s.start)}[${s.kind}]`;
    at = s.end;
  }
  return out + text.slice(at);
}

/**
 * Same masking for word timings: the first word of a match becomes "[IBAN]" etc. (keeping its start time and
 * the last word's end), the rest of the match is removed. Joined words equal maskPii(joined text).
 */
export function maskWords(words: Word[]): Word[] {
  const joined = words.map((w) => w.w).join(" ");
  const found = spans(joined);
  if (!found.length) return words;
  const starts: number[] = [];
  let pos = 0;
  for (const w of words) {
    starts.push(pos);
    pos += w.w.length + 1;
  }
  const out: Word[] = [];
  words.forEach((w, i) => {
    const a = starts[i], b = a + w.w.length;
    const s = found.find((f) => a < f.end && b > f.start);
    if (!s) return void out.push(w);
    const first = words.findIndex((_, j) => starts[j] + words[j].w.length > s.start);
    if (i !== first) return;
    const last = words.findLastIndex((_, j) => starts[j] < s.end);
    const before = w.w.slice(0, Math.max(0, s.start - a)), after = words[last].w.slice(Math.max(0, s.end - starts[last]));
    out.push({ ...w, w: `${before}[${s.kind}]${after}`, tEnd: words[last].tEnd });
  });
  return out;
}
