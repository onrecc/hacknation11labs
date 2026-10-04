import { test } from "node:test";
import assert from "node:assert/strict";
import { languageName, mockTranslate, needsTranslation, spokenQuote, sttLanguage } from "./i18n";

test("sttLanguage reduces a BCP-47 tag to the ISO 639-1 code Scribe expects", () => {
  assert.equal(sttLanguage("de-DE"), "de");
  assert.equal(sttLanguage("en-US"), "en");
  assert.equal(sttLanguage("FR"), "fr");
});

test("sttLanguage falls back to English when no language is set", () => {
  assert.equal(sttLanguage(undefined), "en");
  assert.equal(sttLanguage(""), "en");
});

test("needsTranslation is false for any English variant and for unknown", () => {
  assert.equal(needsTranslation("en"), false);
  assert.equal(needsTranslation("en-GB"), false);
  assert.equal(needsTranslation(undefined), false);
});

test("needsTranslation is true for non-English languages", () => {
  assert.equal(needsTranslation("de-DE"), true);
  assert.equal(needsTranslation("de"), true);
});

test("languageName names the language in English", () => {
  assert.equal(languageName("de-DE"), "German");
  assert.equal(languageName("fr"), "French");
});

test("mockTranslate is deterministic and marks the target language", () => {
  assert.equal(mockTranslate("Über fünftausend ist das Capex.", "en"), "(en) Über fünftausend ist das Capex.");
  assert.equal(mockTranslate("x", "en-US"), "(en) x");
});

test("spokenQuote attributes an English quote plainly", () => {
  assert.equal(spokenQuote("Sabine", "Over five thousand is capex."), `Sabine says: "Over five thousand is capex."`);
});

test("spokenQuote gives the original words plus their English meaning", () => {
  const s = spokenQuote("Jürgen", "Ab fünftausend ist das Capex.", "From five thousand it is capex.", "de-DE");
  assert.equal(s, `Jürgen said, in German: "Ab fünftausend ist das Capex." Meaning: "From five thousand it is capex."`);
});
