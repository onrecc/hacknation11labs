# Part 2: Map

**Owner:** B · **Brief module:** 2 (Map) · **Contract:** [`shared/schema.ts`](../shared/schema.ts) · **Oracle:** [`fixtures/demo-session/expected_workmap.json`](../fixtures/demo-session/expected_workmap.json)

> Turn the Session Log into a **Work Map**: steps, decisions, guardrails, each linked to a screen moment and the expert's own words. Close the gaps in a spoken debrief, then explain it all back until the expert says "yes, that's how it works".

## You own

| Thing | Notes |
|---|---|
| `buildWorkMap` (Function or a local Node script) | Session Log → WorkMap version. Run it live as a draft during capture (nice to have) and as the final pass afterwards |
| Gap finder + **debrief plan** | Ranked `Gap[]` with proposed questions; includes Capture's `question.deferred` |
| Debrief agent (ElevenAgents config + prompt) | Runs in Capture's side panel after `phase.changed capture→debrief` |
| Teach-back | Generate segments, speak them, record `teachback.verdict`s, apply corrections, re-confirm |
| Correction application | Both kinds: live `knowledge.correction`s plus your own post-session transcript re-scan |
| `/map/:id` UI | Clickable timeline. This is what judges look at |
| WorkMap storage + export | `workmaps/{id}/versions/{v}`; stretch: agent-ready markdown |

## Input → Output

- **In:** the Session Log, either live from Firestore or from a local bundle (start with `fixtures/demo-session`).
- **Out:**
  - WorkMap versions
  - debrief + teach-back events written **into the same session** via `shared/eventlog.ts` (`phase: "debrief" | "teachback"`)
  - Checks to pass:
    ```bash
    python3 scripts/validate_bundle.py <bundle> --part map --workmap <your_workmap.json>
    python3 scripts/eval_guardrails.py <your_workmap.json>   # your guardrail conditions must pass Teach's cases
    ```

## Hard constraints

**Evidence**
1. Every Step has ≥ 1 screen moment. Every Decision and Guardrail has ≥ 1 moment **and** ≥ 1 verbatim Quote.
2. Quote text must be an exact substring of the cited utterances. Take `t`/`tEnd` from `words[]`. **The LLM proposes; code verifies.** Reject any quote that isn't verbatim.
3. Every claim carries `provenance`. A claim whose only provenance is `inferred` can never be `confirmedByExpert`. It becomes a Gap and gets asked.
4. Nothing from inside an off-record span may appear in the map, not even reconstructed from context.

**Corrections**

5. Apply `knowledge.correction` events in `seq` order; the latest wins. The old version moves to the claim's `history`. Never delete.
6. A mistaken action (`action_was_mistake`) goes to `commonMistakes`, **never** into a step.
7. After the session, re-scan the whole transcript for corrections the live detector missed, e.g. "about what I said earlier…". Emit them as `knowledge.correction` with `source: "map"`.

**Structure**

8. Steps generalize across cases: one step per *kind of work*, not one per click. Aim for 5–9 steps.
9. Classify every decision as `rule` / `judgment` / `habit` / `mistake`. **Habits are not guardrails.**
10. Every guardrail gets a machine-checkable `condition` over `CaseFacts` paths, written as a **violation predicate** (true = saving now breaks it). Teach depends on this. If a rule can't be expressed that way, use `severity: "info" | "warn"` and a clear `statement`.
11. Keep the vocabulary stable: field paths from `CaseFacts`; glossary terms for codes (4711 = Opex).

**Debrief (brief requirement)**

12. Ask **≥ 3 questions**, none of which were answered during the task. Never repeat a live question (the validator checks).
13. Ask in priority order. Stop when no open gap has `priority ≥ 0.5`, the expert says they're done, or after ~8 questions.
14. Questions are short and name the concrete case ("the Hofmann invoice"). Cover these gap types: scope, who decides, unseen case, rule conflict, rule vs habit.
15. Every debrief turn is written to the session log. The debrief is evidence too.

**Teach-back (brief requirement)**

16. ≤ 90 s spoken, split into segments that each map to steps. Every segment gets a `teachback.verdict`.
17. When a segment is corrected: emit a `knowledge.correction` (`detectedBy: "teachback"`), write a new WorkMap version, re-state the corrected part, and ask for confirmation again.
18. `status: "confirmed"` only after an explicit final confirmation (`teachBack.confirmationQuote`) and with no open high-priority gaps.

**Versioning**

19. WorkMap versions are immutable. Every change gets a new version and a `changelog` entry with the event IDs behind it.

**UI (`/map/:id`)**

20. A timeline of steps. Clicking a step shows:
    - the frame at `screenMoment` (and a video clip from t−3 s to t+5 s when media exists)
    - the field highlighted via `bbox`
    - the decision and the quote, with audio playback (mic chunk + word times)
    - the guardrails
21. Badges: provenance (seen / said live / said in debrief / corrected in teach-back) and a "corrected" marker that opens the `history`.
22. Must work without media files (the fixture has none) and render a *live draft* while capture is running.

## Suggested pipeline

1. **Code:** split by `marker.case_boundary`; cluster `screen.action`s by verb, field and entity across cases into step candidates.
2. **Code:** apply corrections (rule 5).
3. **LLM (Opus 5.5):** step titles and instructions, decision/guardrail extraction with conditions, glossary, all from actions + answers + thinking-aloud utterances.
4. **Code:** verify quotes and frames, attach evidence, compute provenance and stats.
5. **LLM:** gap finding → debrief plan. Then teach-back script → segments.
6. **Code:** run `validate_bundle.py` and `eval_guardrails.py` as a gate before writing the version.

## Milestones

| | Deliverable | Check |
|---|---|---|
| M0 | `/map/:id` renders `expected_workmap.json` from the fixture | UI unblocked from hour 2 |
| M1 | `buildWorkMap` on the fixture | Validator 0 errors; 7±2 steps, 3 decisions, 4 guardrails, 1 common mistake |
| M2 | Gap finder + debrief agent in the side panel | ≥ 3 debrief questions on a real run |
| M3 | Teach-back + verdicts → confirmed version | Corrected segment re-confirmed |
| M4 | Live draft via Firestore listener while capture runs | Map grows during the demo |
| M5 (stretch) | Agent-ready export (markdown/MCP): steps + guardrails with "stop and ask" points | |

## Definition of done
- [ ] Validator (`--part map --workmap`) and `eval_guardrails.py` pass on the fixture **and** on the real demo session.
- [ ] Every one of the 5 corrections in the fixture is visible in the UI (history, or common mistakes).
- [ ] The demo shows "how the debrief decides it's done": open gaps go to zero, then teach-back confirmation.
