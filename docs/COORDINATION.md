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
