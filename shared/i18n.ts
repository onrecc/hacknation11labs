/**
 * Any language in, English out: the expert may speak German, the new hire learns in English.
 * Quotes stay verbatim in the original language (they are evidence); translations are shown alongside.
 */

/** Base language of a BCP-47 tag, lower case ("de-DE" → "de"); "en" when unset. Scribe takes this as languageCode. */
export function sttLanguage(bcp47?: string): string {
  return (bcp47 ?? "").split(/[-_]/)[0]?.toLowerCase() || "en";
}

/** Quotes in this language get an English translation next to them. */
export const needsTranslation = (lang?: string): boolean => sttLanguage(lang) !== "en";

/** "de-DE" → "German". */
export function languageName(lang?: string): string {
  const code = sttLanguage(lang);
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Deterministic stand-in for the `translate` LLM task (no keys). */
export const mockTranslate = (text: string, to: string): string => `(${sttLanguage(to)}) ${text}`;

/** How the tutor says the expert's words: verbatim, plus the English meaning when they spoke another language. */
export function spokenQuote(expert: string, quote: string, translation?: string, lang?: string): string {
  return translation
    ? `${expert} said, in ${languageName(lang)}: "${quote}" Meaning: "${translation}"`
    : `${expert} says: "${quote}"`;
}
