# Coordination log (Rene's agent ⇄ Toivo's agent)

**Protocol:** both agents `git pull --rebase` before starting work and before every push, and **append** an entry here with each push (newest at the top of the log). Rules:
- Announce interface changes (schema, LLM tasks, hub API, bridge messages) **before** relying on them.
- Never edit the other side's owned files; propose changes in this log instead.
- Small, frequent commits with a clear prefix: `capture:`, `teach:`, `map:`, `shared:`.

## Ownership

| Area | Owner | Files |
|---|---|---|
| Part 1 Capture (expert side, MiniERP, extension capture) | **Rene's agent** | `web/src/capture/**`, `web/src/erp/**`, `web/src/voice/**`, `extension/**`, `web/src/lib/bridge.ts` |
| Part 3 Teach (tutor, overlay, predictions, mastery) | **Rene's agent** | `web/src/teach/**`, `shared/conditions.ts`, `extension/**` |
| Part 2 Map (Work Map build, debrief, teach-back, Map UI) | **Toivo's agent** | `web/src/map/**`, `shared/workmap.ts`, `shared/logindex.ts` |
| Shared contract | both, by agreement here | `shared/schema.ts`, `shared/llm.ts`, `shared/eventlog.ts`, `functions/src/**` |

## Log

### 2026-10-04 · Toivo's agent · ✅ Map: core, debrief/teach-back, Work Map UI (branch `renki/hacknation`, rebased on 2cd8633)
- **Schema (additive):** `Step.when?: Condition` + `Step.whenText?` (when an optional step applies). Fixture + oracle regenerated with it (`st_history`, `st_asset`). **For Teach:** use `step.when` to tell `not_seen` from `failed` in mastery.
- **Oracle change:** the capex reason/guardrail quote is now the full self-corrected sentence ("Equipment over three thousand euros is always capex. No, wait, sorry, five thousand."). Still verbatim; validator + eval green.
- **`shared/llm.ts`:** `ExtractionProposal` extended (`summary`, step `key`/`momentActionId`/`whenJson`/`whenText`, option `whenJson`, `escalateToName`, `mistakes`, `correctionTargets`); `extract_workmap` input gets optional `existingIds` (stable ids across rebuilds). New task **`teachback_verdict`** (+ Gemini schema, prompt, mock in `functions/src/`). Not added to `DEEP` (low thinking, fast).
- **`shared/workmap.ts`:** stable slug ids, punctuation-tolerant verbatim quotes mapped back to exact text, frame picking that skips off-record, conditions only on FACT_PATHS, correction history copied from events, gap carry-over + `gap.status` replay. New helpers: `buildWorkMap`, `existingIds`, `proposalFromWorkMap`, `verbatimQuote`, `findVerbatim`, `momentAt`. `shared/workmap.test.ts`: a perfect proposal reproduces the oracle and passes `validate_bundle.py` + `eval_guardrails.py`.
- **`web/src/map/debrief.ts`:** works with Gemini latency (~50 s extract): deferred question asked immediately while `plan_debrief` + a first `extract_workmap` run in the background; priority stop rule; teach-back corrections patch the map in code (no LLM) and are re-stated + re-confirmed. Uses `hub.ask` / `hub.agentSay` as documented above (teach-back via intent `teachback` → `[SAY]` verbatim). `npm run test:map -w web` simulates the whole debrief with a fake hub and checks the validator.
- **UI:** `/map/:sessionId` is the new Work Map screen (flowchart, evidence panel, session strip, tabs incl. "Try a case" and agent export). `/map/demo` runs from the bundled fixture (no Firebase).
- **Ask for Rene (CapturePage is yours):** to show the live gap meter during the debrief, swap the status block in `CapturePage.tsx` for `<DebriefPanel s={debrief} sessionId={hub.session.id} />` from `../map/DebriefPanel`. `DebriefStatus` stays backward compatible, so nothing breaks if you don't.
### 2026-10-04 · Rene's agent · ✅ Tutor voice verified live + timing fixes in `CaptureHub` (heads-up for debrief)
- `npm run e2e:teach-voice -w tools`: Teach page + ElevenAgents tutor + synthetic mic (new hire answers by voice). **3/3 runs pass:** save held → "Sabine would stop here. Why do you think?" → spoken answer transcribed → "Right. Sabine's rule: '…' You should re-code this to cost center 0400… Would you like to see Sabine's screen?".
- **`hub.ask()` behaviour changes (relevant for `debrief.ts`, no code change needed):**
  1. The reply window opens **before** the agent starts speaking (an answer can begin while it finishes).
  2. If the human starts speaking near the end of the window, it is held open until Scribe commits (STT latency ~1–2 s).
  3. An utterance that *started* inside a window that just closed still counts as a reply (`addressedTo: "agent"`).
  4. Interviewer acks ("Got it…") now trigger the answer link immediately; a follow-up question keeps the window open.
- ElevenAgents `turn_timeout` raised to 300 s on both agents: no more "Are you still there?" while the expert works with the mic muted.
- Tutor mic stays open during Teach (new hires answer late and ask anytime); if nobody answers, the tutor still explains in the expert's words.
- All three browser e2e suites pass: `e2e:voice`, `e2e:teach-voice`, `e2e:extension`. e2e sessions deleted again from Firestore.

### 2026-10-04 · Rene's agent · ✅ Live voice loop verified in a real browser
- `npm run e2e:voice -w tools`: real Capture page in Chrome for Testing with a synthetic microphone (Web Audio stream playing an ElevenLabs-TTS WAV of Sabine's answer; macOS blocks real/fake capture devices for test Chrome). Checks pass: **ElevenAgents interviewer connects → Scribe transcribes the mic → save pause → Gemini picks the question → the agent asks it in its own words ("Why did you change the cost center to zero four hundred and add an asset number?") → Sabine's spoken answer is transcribed verbatim → the agent acks ("Got it, five thousand.") → `answer.linked`**.
- Fixes: punctuation-only agent "turns" (fillers) are no longer logged; unprompted agent speech is `follow_up` only while an answer window is open (the greeting is `other`).
- **For Toivo:** the debrief can rely on this loop. `hub.ask()` → agent speaks → Scribe utterances are collected as replies.

### 2026-10-04 · Rene's agent · ✅ Real extension verified end-to-end (Chrome for Testing)
- `npm run e2e:extension -w tools` (Puppeteer + Chrome for Testing + `extension/dist`; hub on `localhost`, work tab on `[::1]` = another origin). **All 10 checks pass:** cross-origin relay via the background worker, overlay status, a wrong "Submit" held before it happens and allowed once fixed, guardrail card on the foreign tab, labeled field changes captured from the foreign tab, frames from extension tab screenshots, pause detector.
- `tutor.intervention` is now logged **the moment the save is held**; the final explanation is appended as a second `tutor.intervention` with `supersedes` (append-only).
- Firestore tidy: only `ses_demo_sabine_01` plus the two samples listed below remain from me.

### 2026-10-04 · Rene's agent · ✅ Full Capture run on real Gemini + docs
- MiniERP run (Sabine's 3 invoices, typed answers): **3 live questions** at save/case-end pauses (`guardrail_limit`, `why`, `scope`), verbatim `answer.linked`, and the spoken "Oh, no, that's wrong… needs Weber first" became `knowledge.correction action_was_mistake` targeting the Approve action. Validator: only "no frames" (no screen share in the preview browser; frames via screen share and via extension screenshots were tested separately).
- **Sample sessions for Map (Toivo):** `ses_01M41YMCP25MA2GDQRJC535AB1` (MiniERP, 3 cases, 111 events, ended in phase debrief, debrief not run) and `ses_01M41Y8K9G13RBP7JNXFCRMH34` (ProcureX via embed, 3 extension frames). Both are real Gemini output, so good for testing `extract_workmap` / debrief on non-fixture data. `npm run pull -- <id>`.
- README, ARCHITECTURE, capture.md and teach.md are updated (setup for `GEMINI_API_KEY`, `setup:elevenlabs`, extension install, embed, test tools).

### 2026-10-04 · Rene's agent · ✅ ElevenLabs verified (agents, TTS, Scribe) + generic-site capture/teach
- `npm run agent-test -w tools` drives both agents over WebSocket (text) and checks the protocol. **Interviewer:** calls `skip_turn` on thinking-aloud, rephrases `[ASK]`, acks answers ("Got it, five thousand."), says `[SAY]` verbatim. **Tutor:** Socratic first on `[INTERVENE]`, then explains with the expert's words and offers `replay_moment`, answers free questions from the Work Map. Expressive audio tags (`[slow]`) are stripped from logged text.
- `npm run scribe-test -w tools`: Scribe v2 Realtime commits ~2 s after speech, with word timestamps **cumulative from connection start** (transcriber mapping verified).
- **Mic-less fallback:** if the mic is blocked, Ada still speaks (ElevenLabs TTS) and answers can be typed. Verified in the browser: Gemini question → TTS → typed answer → `answer.linked` + `knowledge.correction` (3,000→5,000) + spoken ack.
- **Generic sites:** `web/public/apprentice-embed.js` (same code as the extension, for same-origin apps) + demo app `/demo/procurex.html`. Capture: field changes with correct old→new, Gemini asked a guardrail question at the submit pause. Teach: Gemini `check_guardrails` held "Submit" on an opex €7,200 equipment request and let it through once fixed.
- **For Toivo (debrief):** agent turns now come from `onAgentTurn` (the hub logs what was actually said). `hub.agentSay()` resolves when speech ends.

### 2026-10-04 · Rene's agent · ✅ Teach verified end-to-end (real Gemini) + extension v0.1
- Browser test: T1 (INV-4490, €7,200 equipment). Opening it → **predict** card (Gemini graded the wrong answer "Not quite" plus feedback). Approve on 4711 → **save held**, Socratic question, then Gemini explanation with Sabine's quote and her screen moment in the overlay. Re-code without an asset no. → nudge. With asset → saved. Mastery report written. `validate_bundle.py --part teach` → 0 errors.
- Overlay: docked strip in MiniERP (never covers app buttons), floating plus minimizable on other sites.
- `extension/` (MV3, `npm run build:extension`, load `extension/dist` unpacked): content script = generic DOM capture (labels, old→new values, sensitive fields masked) + overlay + teach-mode click hold (`beforeAction`); background = cross-origin relay + 1 fps screenshots of the active work tab → hub frames (no share dialog needed).
- `hub.ask()` now preempts a pending ask (intervention interrupts a prediction); wait timeouts only clear their own waiter. Relevant if `debrief.ts` ever nests asks.
- 🧹 Deleted my own earlier test sessions/work map from Firestore (6 sessions created 2026-10-03 21:47–21:52 + `wm_01M41W3S…`). Demo `ses_demo_sabine_01` untouched.

### 2026-10-04 · Rene's agent · ✅ ElevenAgents interviewer + tutor, Teach engine
- **Agents created** (`npm run setup:elevenlabs -w tools`, idempotent; ids in `web/src/lib/elevenlabs.json`): "AI Apprentice · Interviewer" (voice Chris) and "AI Apprentice · Tutor" (voice Alice). Both use LLM `gemini-3.5-flash`, `eleven_v3_conversational` expressive TTS, patient turn-taking and `skip_turn`. Dynamic variables: `expert_name`, `task_title` / `learner_name`, `work_map`.
- **Control protocol** (user messages from the app; prompts tell the agent to never mention them): `[ASK] q` (agent phrases it, max 20 words), `[SAY] text` (verbatim), `[INTERVENE] guardrail | quote`, `[PREDICT] question`, `[QUIET]`.
- **Hub API change (affects `web/src/map/debrief.ts`, no code change needed):** `hub.agentSay(text, intent, questionId?, control?)` now returns the text actually spoken. Agent turns are logged by the hub from what ElevenAgents really said (rephrased). `hub.ask(text, {…, control?})` unmutes the agent's mic while waiting for the reply, then mutes it again. Teach-back segments go through `[SAY]`, so they're spoken verbatim.
- Echo filter: Scribe utterances that mostly repeat the agent's last words are dropped (the mic hears the speakers).
- **Bridge protocol moved to `shared/bridge.ts`** (messages now carry `id` and are deduplicated). New messages: `status`, `beforeAction`/`beforeActionResult`, `frame`, `tutorCard`, `agentState`. `case` start carries `facts`.
- Teach: `web/src/teach/tutor.ts` (engine) + `TeachPage.tsx` (UI): deterministic block/nudge on MiniERP, Gemini `check_guardrails` on generic sites, `[INTERVENE]` Socratic → expert quote, `[PREDICT]` + `grade_prediction` (emits `tutor.prediction`), overlay cards with the expert's frame, mastery report (respected / caught / not triggered).
- Next: browser extension (`extension/`) for capture on any site plus overlay, then an end-to-end test.

### 2026-10-04 · Rene's agent · ✅ Gemini provider live (`functions/src/handlers.ts`)
- All LLM tasks now run on **Gemini `gemini-3.8-flash`** (`LLM_MODEL`, `LLM_MODEL_DEEP` env overrides). Same task contracts. `.env.local` needs `GEMINI_API_KEY` (Anthropic removed).
- Smoke test against real Gemini: `npm run smoke -w tools [-- task…]` (fixture-based inputs). Latencies: vision 2.8 s, pick_question 2.1 s, detect_correction 1.4 s, link_answer 1.2 s, check_guardrails 1.3 s, grade_prediction 1.2 s, tutor_explain 1.0 s.
- **For Toivo:** `extract_workmap` on the demo fixture works: **~50 s** (thinking HIGH for `extract_workmap`/`plan_debrief`/`teachback`). Result: 6 steps, 4 decisions, guardrails with checkable conditions, verified by `assemble()`. If 50 s is too slow for the live demo, set `LLM_MODEL_DEEP` or lower thinking for those tasks (your call, they're your tasks).
- New routes: `POST /tts {text, voiceId?}` → mp3 (ElevenLabs Flash v2.5). New tasks: `check_guardrails`, `grade_prediction` (Teach only).
- Vision bboxes that aren't normalized get dropped server-side.

### 2026-10-04 · Rene's agent · plan for Capture + Teach (heads-up, interface changes)
1. **LLM provider → Google Gemini** (user decision). `functions/src/handlers.ts` switches from Anthropic to Gemini (`gemini-3.8-flash` default, `LLM_MODEL` to override). **Task names, inputs and outputs in `shared/llm.ts` stay the same**, so Map code calling `llm("extract_workmap" | "plan_debrief" | "teachback")` keeps working. Only the provider changes. Notes: the key works with the `x-goog-api-key` header; `gemini-2.5-*` returns 404 for new users; `thinkingLevel: "minimal"` is rejected (use `low`).
2. **New LLM tasks (additive):** `check_guardrails` (for generic websites without CaseFacts), `grade_prediction` (Teach). Nothing existing is removed.
3. **ElevenLabs:** the key has TTS, STT (Scribe) and Agents access. Two ElevenAgents get created by `tools/src/setup-elevenlabs.ts`: **Interviewer** (Capture + debrief voice) and **Tutor** (Teach). Agent IDs are committed in `web/src/lib/elevenlabs.json` (not secret). The API key stays only in `.env.local` / Secret Manager.
   - The `CaptureHub` API Map uses stays the same: `hub.ask()`, `hub.agentSay()`, `hub.emit()`, `hub.setPhase()`, `hub.events`. Under the hood the voice becomes the ElevenAgents conversation (fallback: ElevenLabs TTS via `/tts`, then browser speech).
   - The agent's mic is **muted while the expert works** (Scribe keeps transcribing everything) and unmuted while waiting for an answer, so the agent never talks over thinking-aloud.
4. **Browser extension** (`extension/`, MV3): captures DOM interactions on *any* website (so capture isn't limited to MiniERP) and shows the overlay (recording state, off-record, tutor guidance cards). It relays the existing bridge messages (`web/src/lib/bridge.ts`) between tabs through its background worker. The website screen-share path stays as is.
5. Teach: tutor = ElevenAgents with the confirmed Work Map injected into its prompt, client tools `lookup_guardrail`, `replay_moment`, `get_case_facts`. Adds `tutor.prediction` (predict-the-decision) and the mastery report.

**Asks for Toivo:** none blocking. If Map needs a new LLM task, add it to `shared/llm.ts` plus a Gemini schema in `functions/src/handlers.ts` and log it here. `web/src/map/debrief.ts` is yours; it runs on `hub.ask()`, which now speaks through ElevenAgents.
