import { test } from "node:test";
import assert from "node:assert/strict";
import type { Word } from "./schema";
import { luhnValid, redact, redactWords } from "./redact";

const NAMES = ["Sabine Keller", "Jürgen Brandt", "Lena Vogt"];

test("the doc example: IBAN and phone become placeholders", () => {
  const out = redact("my IBAN is DE75 5121 0800 1245 1261 99, call me on 0171 2345678");
  assert.equal(out.text, "my IBAN is [IBAN], call me on [PHONE]");
  assert.deepEqual(out.counts, { IBAN: 1, PHONE_NUMBER: 1 });
});

test("IBAN without spaces and in lower case (STT output) is redacted", () => {
  assert.equal(redact("it's DE89370400440532013000 there").text, "it's [IBAN] there");
  assert.equal(redact("iban cz65 0800 0000 1920 0014 5399.").text, "iban [IBAN].");
});

test("email addresses, written and spoken, are redacted", () => {
  assert.equal(redact("mail sabine.keller@example.com today").text, "mail [EMAIL] today");
  assert.equal(redact("write to s.keller at krauss dot de please").text, "write to [EMAIL] please");
  assert.deepEqual(redact("a@b.de and c@d.com").counts, { EMAIL_ADDRESS: 2 });
});

test("phone numbers: international, slash and dash formats", () => {
  assert.equal(redact("ring +49 711 5550192 now").text, "ring [PHONE] now");
  assert.equal(redact("0711/555-0192").text, "[PHONE]");
  assert.equal(redact("(0711) 555 0192").text, "[PHONE]");
});

test("card numbers are redacted only when the Luhn check passes", () => {
  assert.equal(redact("card 4111 1111 1111 1111 expires").text, "card [CARD] expires");
  assert.equal(redact("card 4111-1111-1111-1111").counts.CREDIT_CARD, 1);
  // same shape, wrong check digit: left alone
  assert.equal(redact("ref 4111 1111 1111 1112").text, "ref 4111 1111 1111 1112");
});

test("luhnValid", () => {
  assert.equal(luhnValid("4111111111111111"), true);
  assert.equal(luhnValid("5500005555555559"), true);
  assert.equal(luhnValid("1234567812345678"), false);
});

test("person names from the provided list, full or partial, any case, with possessive", () => {
  const out = redact("Sabine Keller said ask jürgen, and Lena's invoice is next", { names: NAMES });
  assert.equal(out.text, "[PERSON] said ask [PERSON], and [PERSON]'s invoice is next");
  assert.deepEqual(out.counts, { PERSON: 3 });
});

test("names are matched on word boundaries only", () => {
  assert.equal(redact("Kellerman and Vogtland stay", { names: NAMES }).text, "Kellerman and Vogtland stay");
});

test("no names are redacted when no list is given", () => {
  assert.equal(redact("Sabine Keller").text, "Sabine Keller");
});

test("business numbers survive: invoices, amounts, cost centers, dates, delivery notes", () => {
  const text = "INV-4471 for 7,200.00 EUR, cost center 4711/0400, due 2026-12-02, DN-CZ-5530, invoice 4490, 12.500,00 euro, 10,000 EUR, asset 0400";
  const out = redact(text, { names: NAMES });
  assert.equal(out.text, text);
  assert.deepEqual(out.counts, {});
  assert.deepEqual(out.entities, []);
});

test("entities carry the placeholder span in the redacted text", () => {
  const out = redact("call 0171 2345678 or mail a@b.de");
  assert.equal(out.text, "call [PHONE] or mail [EMAIL]");
  assert.deepEqual(out.entities, [
    { type: "PHONE_NUMBER", replacement: "[PHONE]", charSpan: [5, 12] },
    { type: "EMAIL_ADDRESS", replacement: "[EMAIL]", charSpan: [21, 28] },
  ]);
  for (const e of out.entities) assert.equal(out.text.slice(e.charSpan[0], e.charSpan[1]), e.replacement);
});

test("redaction is deterministic and idempotent", () => {
  const once = redact("DE75 5121 0800 1245 1261 99 Sabine", { names: NAMES });
  assert.deepEqual(redact("DE75 5121 0800 1245 1261 99 Sabine", { names: NAMES }), once);
  assert.equal(redact(once.text, { names: NAMES }).text, once.text);
});

const w = (texts: string[]): Word[] => texts.map((x, i) => ({ w: x, t: i * 100, tEnd: i * 100 + 90 }));

test("redactWords merges a multi-word entity into one placeholder word spanning its timing", () => {
  const out = redactWords(w(["call", "me", "on", "0171", "2345678,", "Sabine"]), { names: NAMES });
  assert.deepEqual(out, [
    { w: "call", t: 0, tEnd: 90 },
    { w: "me", t: 100, tEnd: 190 },
    { w: "on", t: 200, tEnd: 290 },
    { w: "[PHONE],", t: 300, tEnd: 490 },
    { w: "[PERSON]", t: 500, tEnd: 590 },
  ]);
});

test("redactWords leaves clean words untouched (same objects)", () => {
  const words = w(["invoice", "4471", "cost", "center", "4711"]);
  assert.deepEqual(redactWords(words), words);
});

test("redactWords keeps the text of words joined consistent with redact()", () => {
  const text = "my IBAN is DE75 5121 0800 1245 1261 99, call me on 0171 2345678";
  const words = redactWords(w(text.split(" ")));
  assert.equal(words.map((x) => x.w).join(" "), redact(text).text);
});
