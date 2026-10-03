# AI Apprentice — Architecture & Data Contract

Owners: **Capture** (person A) · **Map** (person B) · **Teach** (whoever is free first, probably A, since it reuses Capture). Guides: [docs/capture.md](docs/capture.md) · [docs/map.md](docs/map.md) · [docs/teach.md](docs/teach.md)
The types live in [`shared/schema.ts`](shared/schema.ts). That file is the contract. Change it only by agreement.

---

## 1. The one big idea: the Session Log

Capture does not make a summary. It writes an **append-only, timestamped log of everything**: frames, vision output, speech, agent turns, silences, pauses, markers. Map **never talks to the live pipeline**. It reads a finished (or streaming) **Session Bundle** and derives the Work Map from it.

```
            ┌──────────── CAPTURE (A) ────────────┐                ┌──────────── MAP (B) ─────────────┐
 screen ──► │ frame sampler ─► vision ─► actions  │                │ segmenter ─► steps/cases          │
 mic ─────► │ Scribe RT ─► utterances (word-timed)│  Session       │ decision/guardrail extractor      │
 sandbox ─► │ app instrumentation (ground truth)  │──Bundle───────►│ gap finder ─► DEBRIEF agent ──┐   │
 agent ◄──► │ ElevenAgents (interviewer)          │  (events.jsonl │ teach-back ─► confirm/correct │   │
            │ pause detector ─► question picker   │   + blobs)     │        ▲ writes events back ──┘   │
            └─────────────────────────────────────┘                │ Work Map JSON + clickable UI      │
                                                                   └──────────────┬────────────────────┘
                                                                                  │ WorkMap JSON
                                                                   ┌──────────────▼────────────────────┐
                                                                   │ TEACH: tutor agent + same capture │
                                                                   │ pipeline on the new hire's screen │
                                                                   └───────────────────────────────────┘
```

Why we do it this way:
- **Decoupled work.** Person B can build the whole of Map from a hand-written fixture bundle on day 1, before Capture works.
- **Reprocessable.** Every raw frame, audio file and model response is kept. If Map needs something Capture didn't extract, B can re-run vision or STT offline with a better prompt. Nothing is lost.
- **Evidence by construction.** The brief requires every step and guardrail to link to a screen moment and the expert's own words. Every event has an `id` and a `t`, so every derived claim cites event IDs.
- **Teach reuses Capture.** The new hire's session is just another session of `kind: "teach"`, with the same events and the same pipeline.

## 2. Principles: collect everything, decide later

1. **Append-only.** Never mutate an event. Corrections are new events that reference the old one (`supersedes`).
2. **One clock.** `t` = ms since session start, from `performance.now()`. Wall-clock time is stored too. Every stream (video, frames, audio, transcript, agent) is aligned to `t`, which is what makes "screen moment ↔ quote" links possible.
3. **Keep raw and derived side by side.** Raw (frame PNG/WebP, audio, video, raw model JSON) → observation (vision output, utterance) → interpretation (action, question, answer link). Each layer points down via `causedBy` / refs.
4. **Log every model call** with prompt version, inputs (refs), raw output, latency and tokens. That makes it debuggable and reprocessable.
5. **Record what didn't happen too.** Skipped turns, rejected candidate questions, why the agent stayed silent, low-confidence observations. Map uses these to find gaps, and the demo needs them to answer "when to ask / what to ask".
6. **Distinguish judgment vs habit vs mistake.** `knowledge.correction` events (from speech, hotkey, debrief or teach-back) plus answer classification. The brief calls out that this is what recordings miss.
7. **Privacy at the boundary.** Redaction runs before anything leaves the capture machine. Off-record spans are **not recorded at all**; only a marker remains.

## 3. Capture pipeline (person A)

| Stream | How | Event types | Rate |
|---|---|---|---|
| Continuous screen video | `getDisplayMedia` + `MediaRecorder` (WebM, chunked 10 s) | `media.chunk` | continuous. Needed for **replay of screen moments** in Map/Teach |
| Frames | canvas grab from the same stream | `frame.captured` | 1 fps **always stored**, plus a perceptual-hash diff score |
| Vision | changed frames (diff > threshold, or every 5 s heartbeat) → vision LLM with previous frame + recent action context | `screen.observed`, `model.call` | ~0.5–1 Hz |
| Semantic actions | normalize observations to `{verb, entity, field, from, to}` | `screen.action` | on change |
| **Sandbox instrumentation** (strongly recommended) | we build the sandbox ERP ourselves and it emits exact field changes, clicks and focus via `postMessage`/WebSocket | `app.event`, `input.activity` | per interaction |
| Mic audio | `MediaRecorder` raw, separate from the agent | `media.chunk` | continuous |
| Live transcript | Scribe v2 Realtime: partial + final, word timestamps, VAD | `speech.vad`, `utterance` | real time |
| Agent | ElevenAgents (`@elevenlabs/react`). Screen events go in via `sendContextualUpdate`. Client tools: `get_recent_screen_events`, `mark_question_asked`. System tool `skip_turn` to stay quiet | `agent.context_pushed`, `agent.turn`, `agent.tool_call`, `agent.skipped_turn` | per turn |
| Pause detector | fuses typing activity, VAD, screen diff and case boundaries | `pause.detected` with decision `ask`/`hold`/`skip` and reason | on signal |
| Question picker | candidates scored by "would the screen already answer this?" and guardrail value. Budget: 3–5 per 10 min, the rest queued for the debrief | `agent.question` (with rejected candidates), `question.deferred` | on pause |
| Expert controls | hotkey/voice: "off the record", "bookmark", "next invoice" | `marker.*` | user-driven |
| Correction detector | every final utterance + last ~60 s of speech + recent actions → "is this a self-correction, and of what?" | `knowledge.correction` | per utterance |
| Redaction | Presidio on text; PII bboxes from vision get blurred in stored frames | `redaction.applied` | inline |

Why instrument the sandbox app: vision is noisy. If the ERP is our own web app, we get **ground-truth** "cost_center 4711 → 0400 on invoice 4471" plus real typing/idle signals for pause detection. Vision then becomes the generic layer that also works on arbitrary apps. Keep both, and store both.

Post-session (still Capture's job, cheap and valuable): run **batch STT** on the full mic recording for a clean, word-timed transcript (`utterance` events with `transcriptVersion: 2`, same `utteranceId`s where possible), and emit `session.ended`.

### 3a. The expert is always listened to, and can correct themselves

- **The mic transcript never stops**, whether the agent is speaking, skipping its turn or waiting. Scribe runs on the mic independently of the ElevenAgents turn-taking. Every `utterance` has `t`/`tEnd` (ms since session start) and **per-word** `words[{w,t,tEnd,conf}]`, so any quote can be clipped to the exact second. `addressedTo` separates answers from thinking aloud ("Same delivery note. Again."), and both are evidence.
- **Self-corrections are first-class `knowledge.correction` events.** They can be detected from:
  - speech: "no wait, five thousand, not three", "oh no, that's wrong", "about what I said earlier…"
  - the screen: a value reverted within ~30 s; combined with speech this is a strong signal
  - the debrief ("that's just a habit") and the teach-back ("not the AP lead, the controller")

  Each correction says **what** it targets (an action, an earlier utterance or answer, or a Work Map claim) and gives `before` → `after`.
- **Two detectors, same event:** Capture flags corrections live, so the agent can acknowledge them ("Got it, five thousand"). Map re-scans the whole transcript afterwards, which catches corrections that point minutes back.
- **How Map applies them:** in `seq` order, latest wins. The old version goes to the claim's `history` (never deleted). A mistaken action becomes a `commonMistakes` entry instead of a step, which turns it into teaching material for Teach. Any claim touched by a correction is re-checked in the teach-back.

## 4. Map pipeline (person B)

1. **Segment** the log into **cases** (invoice 4471, 4472, …) and **steps** using `marker.case_boundary`, `screen.action` clusters and entity changes.
2. **Link Q↔A.** Each `agent.question` → answer utterances → verbatim quote (`answer.linked`).
3. **Extract** decisions (with structured conditions, e.g. `amount > 5000 AND category = equipment`), guardrails (limit / exception / stop-and-ask / never / approval), glossary (4711 = opex) and entities (suppliers, subsidiaries).
4. **Apply corrections** (`knowledge.correction`, see 3a). Then **classify** every non-trivial action as `rule` | `judgment` | `habit` | `mistake` | `unknown`.
5. **Find gaps**: unexplained deviations, unknown scope ("every supplier or just this one?"), unseen cases, thresholds without a number, conflicts, and `question.deferred` items from Capture. Rank them.
6. **Debrief** (voice; the same ElevenAgents stack, a different agent/prompt): ask the top gaps (≥3), write the answers back into the **same session log** with `phase: "debrief"`, re-extract, and stop when no high-priority gaps remain or the expert says done.
7. **Teach-back**: generate a <60 s explanation from the Work Map, split into segments that map to steps. The expert confirms or corrects each one (`teachback.verdict`). Corrections patch the map with `provenance: "teachback_correction"`. Status becomes `confirmed`.
8. **Work Map UI**: a timeline. Clicking a step shows the video clip at `screenMoment.t`, the decision, the quote (with play-audio) and the guardrails.
9. **Export**: the Work Map JSON goes to Teach. Stretch goal: agent-ready instructions (markdown/MCP).

## 5. Teach (later)

A `kind: "teach"` session uses the same Capture pipeline on the new hire's screen. The tutor agent loads the WorkMap (knowledge base + a client tool `lookup_guardrail(condition)`). Guardrail conditions are **structured**, so the tutor can evaluate them against live `app.event`s **before save** (`tutor.intervention`). It replays `screenMoment` from the expert's video. At the end, `mastery` is computed per step and guardrail.

## 6. Backend: Firebase

The bundle format stays the same; Firebase is only where it lives. `fixtures/demo-session/` is the same shape exported to disk.

**Plan: Blaze (pay-as-you-go), with a $5 budget alert.** Since 3 Feb 2026, Cloud Storage requires Blaze, and so do Cloud Functions. At our volume we stay inside the no-cost quotas, so the expected bill is $0 to a few cents. Budget alerts **notify but don't cap**, so keep an eye on them.

```
Firestore
  sessions/{sessionId}                         Session + nextSeq counter
  sessions/{sessionId}/chunks/{seqFrom:08d}    { seqFrom, seqTo, tFrom, tTo, writer, types[], events: Event[] }
  sessions/{sessionId}/report/mastery          MasteryReport (teach sessions)
  workmaps/{workMapId}                         { latestVersion, status, sourceSessionIds, updatedAt }
  workmaps/{workMapId}/versions/{v}            full WorkMap JSON (immutable)
Cloud Storage  (bucket in us-central1 → Always Free tier)
  sessions/{sessionId}/{uri}                   uri exactly as in events: frames/frm_0012.webp, media/screen-003.webm, model_calls/mc_0042.json
Cloud Functions (2nd gen; secrets in Secret Manager)
  api (europe-west1)  POST /llm {task,input} (vision | pick_question | detect_correction | link_answer | extract_workmap | plan_debrief | teachback | tutor_explain)
                      POST /voice-token (ElevenLabs signed agent URL / Scribe token) · GET /health
  redact (TODO)       Python + Presidio: PERSON, PHONE_NUMBER, EMAIL_ADDRESS, IBAN
Hosting            the web app (/capture, /map/:id, /teach) + the MiniERP sandbox
Auth               Google sign-in for the team, anonymous auth for judges; rules: request.auth != null
```

**Events are written as chunks, not one document per event.** The Firestore no-cost quota is **per day**: 20K writes and 50K reads. One document per event would mean ~3k writes per session and ~3k reads every time Map reloads, and the quota would run out after a few dev sessions. Instead, each writer flushes a chunk every 2 s, or at 200 events, or at 500 KB (the document limit is 1 MiB). That's ~100 writes per session and ~30 reads per load.

**`seq` allocation.** Capture, Map's debrief and Teach all write to the same session. On each flush a writer reserves a block of seq numbers with one transaction on `sessions/{id}.nextSeq`. Consumers use `seq` to apply corrections and `(t, seq)` to order the timeline. All of this lives in the shared writer `shared/eventlog.ts`.

**Live and offline access.** Map and Teach can subscribe with `onSnapshot(chunks orderBy seqFrom)`. For heavy iteration, `scripts/pull_session` (to build, owned by Capture) exports Firestore + Storage into the fixture folder layout, so the validator and Map run offline with no quota burn.

| No-cost quota | Our usage (≈80 MB, ~3k events per 10-min session) | Verdict |
|---|---|---|
| Firestore 1 GiB stored, 20K writes/day, 50K reads/day, 10 GiB egress/month | ~100 writes and ~30 reads per load | OK, *because of chunking* |
| Storage (us-central1) 5 GB-months, 100 GB egress/month, 5K uploads (Class A) and 50K downloads (Class B) per month | 600 frame uploads per session → past ~8 sessions/month, ~$0.005 per 1K uploads | Cents. Delete junk runs |
| Functions 2M invocations, 400K GB-s/month | ≤1 vision call/s → ~600 per session | OK. Set `minInstances: 1` on `llm` during the demo to avoid cold starts (small idle cost) |
| Hosting 10 GB stored, 360 MB/day transfer | static app | OK |

**Current state (set up via the service account):** Firestore in `eur3`, Storage bucket `hacknation11labs.firebasestorage.app` in `us-east1` (Always Free region), web app `apprentice-web` registered (`web/src/lib/firebase-config.json`), anonymous auth enabled, rules deployed (`npm run deploy:rules`), demo fixture seeded (`npm run seed:fixture`). The service account **cannot** deploy Cloud Functions or create secrets, so `tools/src/dev-api.ts` serves the same handlers locally (`npm run api`). Deploy `functions/` from an Owner account when keys exist.

**Never commit secrets.** The Firebase web config is fine to commit. LLM and ElevenLabs keys live only in Secret Manager or `.env.local` (gitignored). The repo is public.

## 6a. Ground rules for all three parts

1. **`shared/schema.ts` is the contract.** Change it only by agreement, in a PR that also regenerates the fixture (`python3 scripts/make_fixture.py`) and keeps both checks green: the TS typecheck and `scripts/validate_bundle.py`.
2. **Append-only.** Never edit or delete an event; fix things with a new event (`supersedes` / `knowledge.correction`).
3. **One clock.** `t` = ms since session start from `performance.now()`. `Date.now()` goes only into `wall`.
4. **Every writer uses `shared/eventlog.ts`** (chunking, seq reservation, retries). Nobody writes Firestore event docs by hand.
5. **Evidence or it didn't happen.** Every derived claim cites event IDs, frames and verbatim quotes. Code (not the LLM) verifies quotes and frames exist.
6. **Privacy at the boundary.** Raw unredacted frames, audio and text never leave the browser. Off-record means nothing is persisted.
7. **No API keys in the browser.** All model calls go through Functions.
8. **Done = validator green** for your part on the fixture **and** on a real recorded session.

Part guides: [Capture](docs/capture.md) · [Map](docs/map.md) · [Teach](docs/teach.md)

## 7. First 2 hours together

1. ✅ Schema agreed: `shared/schema.ts`.
2. ✅ Fixture: [`fixtures/demo-session/`](fixtures/demo-session/README.md), generated by `scripts/make_fixture.py`, with `expected_workmap.json` as the oracle. ✅ Validator: `scripts/validate_bundle.py`. ✅ Guardrail reference evaluator + Teach test cases: `scripts/eval_guardrails.py`.
3. Firebase project on Blaze + budget alert, bucket in us-central1, both of you added as project Owners (Firebase has no free-tier member limit).
4. A: `shared/eventlog.ts` + a script that replays the fixture into Firestore, so B can build against the *live* listener on day 1.
5. Split: A follows [docs/capture.md](docs/capture.md), B follows [docs/map.md](docs/map.md). Teach ([docs/teach.md](docs/teach.md)) starts when Capture's M5 or Map's M3 is done.
