# Part 3: Teach

**Owner:** whoever is free first (probably A, since it reuses Capture's pipeline + MiniERP) · **Brief module:** 3 (Teach) · **Contract:** [`shared/schema.ts`](../shared/schema.ts) · **Reference:** [`scripts/eval_guardrails.py`](../scripts/eval_guardrails.py)

> A voice tutor that watches the new hire work a case **the expert never showed**. It explains each step the way the expert did, asks them to predict decisions, and **stops them before a guardrail is broken**, quoting the expert and replaying her screen moment.

## You own

| Thing | Notes |
|---|---|
| `/teach` route | MiniERP in teach mode + tutor side panel. Runs the Capture pipeline with `Session.kind = "teach"` |
| **Guardrail engine** | Port of `evaluate()` from `scripts/eval_guardrails.py` to TS, applied to `CaseFacts`. Deterministic, no LLM |
| Save hold | The extension holds Save/Approve-like clicks on any site (`beforeAction`); MiniERP no longer holds its own saves |
| Tutor agent (ElevenAgents) | Confirmed WorkMap as the `{{work_map}}` prompt variable. Client tools: `lookup_guardrail`, `replay_moment`, `get_case_facts`, `grade_prediction` |
| Moment replay | Shows the expert's frame at `screenMoment` (video clip planned, not yet implemented) |
| Mastery report | `MasteryReport` at `sessions/{id}/report/mastery` + an end screen |

## Input → Output

- **In:**
  - the latest WorkMap with `status: "confirmed"`
  - MiniERP (teach mode) with the test cases seeded
  - the new hire's screen + mic through the Capture pipeline
- **Out:** a teach session with `tutor.intervention` and `tutor.prediction` events, plus a `MasteryReport`. Checks to pass:
  ```bash
  python3 scripts/validate_bundle.py <teach_bundle> --part teach
  python3 scripts/eval_guardrails.py <workmap.json>
  ```

## Where the code is (status 2026-10-04)

| What | File | Status |
|---|---|---|
| Guardrail engine | `shared/conditions.ts` (+ `conditions.test.ts` = T1–T5) | ✅ |
| Tutor engine: predict on case open, nudge on change, block before save, Socratic `[INTERVENE]` → expert quote + screen moment, mastery report | `web/src/teach/tutor.ts` | ✅ T1 verified in the browser (first on Gemini; the golden path on Claude also holds the wrong save); `validate_bundle --part teach` → 0 errors |
| Generic web apps | Claude `check_guardrails` on the visible form before Save/Submit (extension or embed) | ✅ ProcureX demo: held on opex, allowed once fixed |
| Tutor voice | ElevenAgents Tutor with the Work Map as `{{work_map}}`, client tools `lookup_guardrail`, `replay_moment`, `get_case_facts`, `grade_prediction` | ✅ protocol verified (`npm run agent-test -w tools`) |
| Overlay | `extension/src/overlay.ts`, always from the extension (Chrome + Firefox), on every site incl. MiniERP | ✅ e2e (extension + teach-voice) |
| Predictions | `[PREDICT]` + `grade_prediction` → `tutor.prediction` | ✅ |

## Hard constraints

1. **Teach only from the Work Map.** Never invent rules. If the case hits a situation the map doesn't cover, say so ("Sabine didn't cover this; ask the controller") and log it as a new open `Gap`. That gap feeds back to Map: the "living company memory" moonshot. *Status:* logging Gaps from Teach is planned, not yet implemented.
2. **Guardrail checks are code, not LLM.** Evaluate `Guardrail.condition` (a violation predicate) on `CaseFacts`. The LLM only phrases the explanation.
3. **Catch it before it's saved** (brief requirement). On Save or Approve, `beforeSave` evaluates all guardrails within ≤ 500 ms. Any `severity: "block"` violation means `{allow: false}`, the save is held, and the tutor speaks.
4. **Nudge early, block late.** When a field change *would* violate a guardrail (e.g. cost center left on 4711 for €7,200 equipment), nudge once. Block only on save.
5. **Socratic first.** "Sabine would stop here. Why do you think?" Wait for the answer, then explain with the expert's **verbatim** `reason` quote and offer `replay_moment(screenMoment)`.
6. **Don't nag.** At most one prediction prompt per decision and one intervention per field per 30 s. Use the same pause rules as Capture: no talking while the new hire types, unless a block is pending.
7. Use `commonMistakes` as a watch-list. For example, approving Brno directly gets a pre-emptive hint. *Status:* planned, not yet implemented (Map shows `commonMistakes`; the tutor doesn't use them yet).
8. Same trust rules as Capture: off-record, redaction (regex on transcripts, masking/blurring on screen; no Presidio), no keys in the browser.
9. End with a `MasteryReport`: per-step status (`mastered`/`assisted`/`failed`/`not_seen`), per-guardrail status (`respected`/`caught_by_tutor`/`violated`/`not_triggered`), prediction accuracy and what to practice next. A step with rules counts as mastered only when one of its rules was met on a case and followed without help (not after any unrelated save). TeachPage shows it as a card (`MasteryCard.tsx`, logic in `mastery.ts`): rules as chips (✓ Followed / ⚠ Caught before save / – Not practised), the prediction score, and "Practice next" buttons that start a fresh session and open the matching MiniERP case (`/erp?mode=teach&case=4490` resets that invoice to its seed state).

## Test cases

Seed these in MiniERP. Each must give the expected violations at save time; `scripts/eval_guardrails.py` already encodes them.

| Case | Setup | Expected |
|---|---|---|
| **T1** (the judge's case in the brief) | INV-4490, new supplier *Gerätebau Schmidt KG*, €7,200 "hydraulic press tooling", `category: equipment`, cost center prefilled 4711 | Save on 4711 → **`gr_capex_threshold`** held, quote "…five thousand", replay 4471 moment. Re-code to 0400 without asset no. → **`gr_asset_number`** held. With asset no. → allowed |
| **T2** | INV-4491, Brno Precision, €9,800 equipment | Approve directly on 4711 → **both** `gr_capex_threshold` + `gr_intercompany_approval` (rule stacking from the debrief) |
| **T3** | INV-4492, Hofmann, December, duplicate delivery note | Approve → `gr_december_hold`; on hold → allowed |
| **T4** | INV-4493, Würth, €312 consumables | **No intervention.** Tests for false positives |
| **T5** (second judge case, a different rule) | INV-4494, Brno Precision, €2,400 spare parts | Approve (or save) without a second approver → only **`gr_intercompany_approval`**; Weber as approver + send for approval → allowed |

Block and nudge cards carry a severity label ("Blocked before save" / "Heads-up") and a provenance line derived from the guardrail's first screen moment and the Work Map's recorded cases (`web/src/teach/provenance.ts`), e.g. "Sabine never worked this invoice. Rule learned from INV-4471 at 00:28." If the learner's case is one the expert recorded, the line says so instead.

## Milestones

| | Deliverable | Check |
|---|---|---|
| M0 | TS guardrail engine + unit tests mirroring `eval_guardrails.py` | T1–T5 green |
| M1 | `beforeSave` hook holds the save in MiniERP | T1 is blocked with no voice yet |
| M2 | Tutor voice: Socratic prompt + expert quote | T1 end-to-end |
| M3 | Moment replay in the panel | Sabine's 0400 moment plays |
| M4 | Predictions + mastery report | End screen |

## Definition of done
- [ ] A judge playing a new hire runs T1 and is stopped **before save**, and the explanation uses Sabine's words (brief requirement).
- [ ] T4 produces no interruption.
- [ ] `validate_bundle.py --part teach` → 0 errors on a recorded teach session.
