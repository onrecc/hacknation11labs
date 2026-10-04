/**
 * English meaning of an expert's quote, computed at display time (the stored quote stays verbatim: it is evidence).
 * Cached per text; undefined when the quote is already English or translation failed.
 */
import { useEffect, useState } from "react";
import { needsTranslation } from "@shared/i18n";
import { llm } from "./api";

const cache = new Map<string, Promise<string | undefined>>();

export function translateQuote(text: string, lang?: string): Promise<string | undefined> {
  if (!text || !needsTranslation(lang)) return Promise.resolve(undefined);
  const key = `${lang}\u0000${text}`;
  let p = cache.get(key);
  if (!p) {
    p = llm("translate", { text, from: lang ?? "", to: "en" }).then((o) => o.text.trim() || undefined, () => {
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
