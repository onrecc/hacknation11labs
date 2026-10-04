/**
 * English meaning of an expert's quote, computed at display time (the stored quote stays verbatim: it is evidence).
 * Cached per text; undefined when the quote is already English or translation failed.
 */
import { useEffect, useState } from "react";
import { needsTranslation, sttLanguage } from "@shared/i18n";
import { llm } from "./api";

const cache = new Map<string, Promise<string | undefined>>();

export function translateQuote(text: string, lang?: string, to = "en"): Promise<string | undefined> {
  if (!text || sttLanguage(lang) === sttLanguage(to)) return Promise.resolve(undefined);
  const key = `${lang}\u0000${to}\u0000${text}`;
  let p = cache.get(key);
  if (!p) {
    p = llm("translate", { text, from: lang ?? "en", to }).then((o) => o.text.trim() || undefined, () => {
      cache.delete(key); // retry next time; the original quote still shows
      return undefined;
    });
    cache.set(key, p);
  }
  return p;
}

export function useQuoteTranslation(text: string, lang?: string): string | undefined {
  const [out, setOut] = useState<string | undefined>();
  useEffect(() => {
    let live = true;
    setOut(undefined);
    void translateQuote(text, lang).then((t) => live && setOut(t));
    return () => { live = false; };
  }, [text, lang]);
  return out;
}

/** UI/tutor text (written in English) in the learner's language; the English text when that fails or isn't needed. */
export async function inLanguage(text: string, to?: string): Promise<string> {
  if (!text || !needsTranslation(to)) return text;
  return (await translateQuote(text, "en", to)) ?? text;
}
