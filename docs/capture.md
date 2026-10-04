# Part 1: Capture

**Owner:** A · **Brief module:** 1 (Capture) · **Contract:** [`shared/schema.ts`](../shared/schema.ts) · **Oracle:** [`fixtures/demo-session`](../fixtures/demo-session/README.md)

> Watch the expert work, listen to everything they say, ask *why* at the right moments, and write a complete, evidence-linked Session Log. **Don't summarize; record.**

## You own

| Thing | Notes |
|---|---|
| `/capture` web app | Screen share, side panel with the voice agent, controls (off-record, bookmark, end task) |
| **MiniERP sandbox** | Small AP app with seeded invoices, instrumented: emits `app.event` and implements `window.apprentice` (`ApprenticeBridge`). Teach reuses it |
| `shared/eventlog.ts` | The only event writer: chunking, seq reservation, retries, Storage uploads. Map's debrief and Teach use it too |
| Pipelines | frames → vision → `screen.observed` → `screen.action`; mic → Scribe → `utterance`; pause detector; question picker; answer linker; correction detector; redaction; off-record |
| Interviewer agent | ElevenAgents config + prompt (curious, patient, brief; Expressive Mode) |
| `scripts/pull_session` | Exports Firestore + Storage to the fixture folder layout |
| Function `api` (`/llm`, `/voice-token`, `/tts`) | Shared with Map/Teach; you set them up first. Transcript redaction runs in the browser (`shared/redact.ts`); there is no `redact` function and no Presidio |

## Input → Output

- **In:** the expert's screen (`getDisplayMedia`), mic, MiniERP instrumentation.
- **Out:** `sessions/{id}` + event chunks + blobs in Storage. When pulled to disk, the bundle must pass:
  ```bash
  python3 scripts/validate_bundle.py <bundle> --part capture
  ```

## Where the code is (status 2026-10-04)

| What | File | Status |
|---|---|---|
| Session orchestration: pause detector, question picker, answer linking, corrections, off-record, echo filter | `web/src/capture/hub.ts` (`CaptureHub`, tunables in `PAUSE`) | ✅ golden path on Claude all green (`npm run golden -w tools`): ≥3 live questions at pauses, ≥1 in a guardrail category, debrief, confirmed Work Map. Verbatim answers and an `action_was_mistake` correction were verified in an earlier full MiniERP run on Gemini, before the switch to Claude |
| Voice | `web/src/voice/voice.ts`: ElevenAgents Interviewer (`[ASK]`/`[SAY]`, mic muted while working) → ElevenLabs TTS → browser | ✅ protocol verified (`npm run agent-test -w tools`); TTS verified in browser |
| Always-on STT | `web/src/capture/transcriber.ts`: Scribe v2 Realtime (word timestamps verified with `npm run scribe-test -w tools`) → Web Speech; typed fallback | ✅ |
| Frames | screen share (`screen.ts`) **or** extension tab screenshots (`frame` bridge messages) → Claude vision (was Gemini until 2026-10-04) | ✅ both |
| Any web app | `extension/` (MV3) + `web/public/apprentice-embed.js`; demo app `/demo/procurex.html` | ✅ embed in browser + **real extension e2e** (`npm run e2e:extension -w tools`: relay, DOM capture, tab screenshots) |
| MiniERP structured feed (case facts) + bridge | `web/src/erp/`, `shared/bridge.ts`, `web/src/lib/bridge.ts`; overlay, controls and save hold come from the extension | ✅ |
| ElevenAgents config | `tools/src/setup-elevenlabs.ts` (prompts, voices, tools) | ✅ |
| Redaction | Transcripts: regex redactor (`shared/redact.ts`, session `config.redaction.engine: "regex"`) on every utterance before it is logged or sent to an LLM, `redaction.applied` per hit, count in `HubState.redactedCount`. IBAN masked in MiniERP UI, sensitive fields masked by the extension, vision `piiRegions` blurred on later frames | ⚠️ no Presidio/NER (only names of the app's user profiles); mic audio not redacted |

## Hard constraints

**Data**
1. Emit only event types from `shared/schema.ts`. A new type or field means a schema PR first (see ground rules in ARCHITECTURE §6a).
2. Store a frame **every second**, even when it isn't sent to vision. WebP, ≤1280 px wide, quality ≈0.7. Also keep continuous screen video and mic as 10 s chunks (`media.chunk`).
3. Every `screen.action` links its evidence: `appEventIds` (ground truth) and/or `observedIds` (vision). Set `sourceAgreement`.
4. Log every model call as `model.call`: prompt version, input refs, and the full request/response saved to `model_calls/{id}.json`. *Today:* `model.call` has purpose, input refs, latency and errors; saving `model_calls/*.json` is planned, not yet implemented.
5. **Record the negative space.** Emit `pause.detected` for *every* pause decision (`ask`/`hold`/`skip` with a reason), plus `rejectedCandidates` and `question.deferred` (all emitted today). `agent.skipped_turn` is planned, not emitted yet. This is how we answer the brief's "when to ask / what to ask".

**Listening**

6. **The mic transcript never stops**: not while the agent talks, not on skip-turn. Scribe runs on the mic independently of the agent's turn-taking.
7. Every `utterance` has `t`, `tEnd`, word-level `words[]` and `addressedTo` (`agent` / `self` / `other_person`).
8. Run the correction detector on every final expert utterance, using the last ~60 s of speech and recent actions as context. Emit a `knowledge.correction` with concrete `targets` and `before` → `after`. Also flag value reverts within 30 s (a screen action undone). The agent briefly acknowledges a correction ("Got it, five thousand").

**Asking**

9. Ask **only** when `pause.detected.decision = "ask"`:
   - no keystroke for ≥ 1.5 s
   - no expert speech for ≥ 1.2 s (VAD)
   - screen diff below threshold for ≥ 1 s, **or** a save or case boundary just happened
   - never while the expert is speaking (the validator checks this)
10. Every question is about something on screen (`about.actionIds` non-empty) and must not be answerable from the screen: `screenAlreadyAnswers < 0.5`. Example: don't ask "why on hold?" when the comment already says it.
11. **Budget: 3–5 live questions per 10 min.** Everything else becomes `question.deferred` for the debrief. Demo minimum: **≥ 3 live questions, ≥ 1 in a guardrail category** (`guardrail_limit`, `exception`, `stop_and_ask`, `never_do`).
12. Questions are ≤ 25 words, one at a time, with at most one live follow-up.

**Trust & privacy**

13. **Off the record** (voice "off the record" or hotkey) immediately stops frames, video and mic chunks, vision calls and transcript persistence. Only the two `marker.off_record` events are stored. When triggered by voice, the in-progress mic chunk (which holds the spoken command) is discarded instead of saved; audio from a chunk that already closed before the transcript arrived (STT latency) is still kept. The agent confirms ("Okay, not recording") and resumes on "back on the record" or the hotkey.
14. **Redact before upload.** Every utterance (expert and agent) is redacted in the browser before the `utterance` event is logged, so answer linking, correction detection, question picking, Map and storage only see placeholders. What is redacted: IBANs → `[IBAN]`; emails, written or spoken ("s.keller at krauss dot de") → `[EMAIL]`; phone numbers starting with `+` or `0` (8+/9+ digits) → `[PHONE]`; card numbers that pass the Luhn check → `[CARD]`; the names of the app's user profiles (full, first or last name) → `[PERSON]`. Word timings are merged so the words still spell the redacted text. Kept on purpose: invoice keys (INV-4471), amounts (7,200.00), cost centers (4711/0400), dates, approver names (escalation targets). Each hit logs a `redaction.applied` event (entity types and placeholder spans, never the original). **Not redacted:** names outside that list (no Presidio/NER), numbers spelled out as words, mic audio chunks (uploaded as recorded), what the ElevenLabs agent hears. Frames get a blur over vision's `piiRegions` only (frames before the first vision result are stored unblurred); MiniERP masks IBAN in its UI and the extension masks passwords, IBANs and card numbers.
15. No API keys in the browser.

**Performance**

16. Frame → `screen.observed` in p50 < 3 s. Vision runs at ≤ 1 Hz, only on changed frames or a 5 s heartbeat. Pause → question audio starts in < 2.5 s.

## The interviewer agent (ElevenAgents)

- **System prompt essentials:** "You are an apprentice learning this job. Stay silent unless told to ask. Ask short, concrete *why / limit / exception / when-would-you-stop* questions about what just happened on screen. Never ask what the screen already shows."
- **Screen context:** push a one-line contextual update per `screen.action` (`agent.context_pushed`).
- **Client tools:** `get_recent_screen_events` (`mark_question_asked` was planned; not implemented).
- **System tool:** `skip_turn`, so the agent stays quiet on thinking-aloud speech.
- **Our question picker decides *when* and *what*; the agent only voices it.** ⚠️ Check in the ElevenAgents docs how best to make the agent speak a chosen question immediately (contextual update + user-message nudge, or dynamic variables). Do this on day 1.
- **Debrief:** when the task ends, emit `phase.changed capture→debrief` and switch the side panel to Map's debrief agent and plan (see [map.md](map.md)). Capture owns the panel; Map owns what is said.

## MiniERP requirements (also used by Teach)

- **Seed data:**
  - the 3 demo invoices from the fixture (4471, 4472, 4473), plus filler rows
  - Teach's cases T1–T4 (see [teach.md](teach.md#test-cases))
  - supplier history, including Hofmann's paid INV-4431 with DN-88213
- **Fields:** at least those in `CaseFacts` (`category`, `costCenter`, `assetNo`, `status`, `approver`, `comment`, supplier `group`, …).
- **Events:** on every change emit `app.event` (`field`, `oldValue`, `newValue`). On save emit `app.event` (`action: "save"`) with a full `snapshot`. Typing, clicks and idle feed `input.activity` (counts only, 2 s windows).
- **Save hold:** done by the extension on any site (MiniERP included): Save/Approve-like clicks wait for the hub's `beforeActionResult` in teach mode. MiniERP pages are marked as a "feed" app, so the extension skips its generic DOM capture there (MiniERP already reports structured events).

## Milestones

| | Deliverable | Check |
|---|---|---|
| M0 | `shared/eventlog.ts` + script replaying the fixture into Firestore | B can `onSnapshot` the fixture |
| M1 | Screen share, 1 fps frames, video chunks, MiniERP with `app.event` | Frames + actions visible in Firestore |
| M2 | Always-on Scribe transcript + agent connected + contextual updates | Word-timed utterances appear |
| M3 | Pause detector + question picker + answer linking | 3 well-timed questions on a real run |
| M4 | Correction detector, off-record, redaction | Re-run fixture scenarios live |
| M5 | `pull_session` + record the real demo session | `validate_bundle.py --part capture` → 0 errors |

## Definition of done
- [ ] The validator passes on a real recording (`--part capture`).
- [ ] The demo can show *why* the agent asked when it did: `pause.detected` reasons plus rejected candidates.
- [ ] Off-record demonstrably leaves a gap: no frames or transcript.
- [ ] A spoken self-correction ("no wait, five thousand") shows up as a `knowledge.correction`.
