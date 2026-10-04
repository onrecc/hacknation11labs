# Protégé: ElevenLabs × Hack-Nation (7th Global AI Hackathon)

An apprentice, not a recorder. It watches an expert do real screen work and asks *why* at natural pauses (ElevenLabs voice agent). It turns the session into a clickable **Work Map** of steps, decisions and guardrails in the expert's own words. Then it **tutors the next new hire** and catches mistakes before they are saved.

**▶ Live demo: https://hacknation11labs.web.app** (no install, no passwords). Pick **Sabine** to teach Ada, or **Lena** to train. **`/map/demo`** shows a finished Work Map instantly. In Training, open MiniERP, code invoice INV-4490 (€7,200 equipment) as opex and press Save: Ada holds it and explains with Sabine's own words. The browser extension is optional; it brings the same coaching to any website.

Team: Rene Saarikko (Capture + Teach), Wilmer (pitch + demo), Toivo (Work Map). Challenge 01, ElevenLabs "The AI Apprentice".

| Part | What | Guide | Code |
|---|---|---|---|
| 1. Capture | Screen + always-on transcript + interviewer agent → Session Log | [docs/capture.md](docs/capture.md) | `web/src/capture/`, `web/src/erp/` |
| 2. Map | Session Log → Work Map, spoken debrief, teach-back | [docs/map.md](docs/map.md) | `shared/workmap.ts`, `web/src/map/` |
| 3. Teach | Voice tutor on the new hire's screen, guardrails enforced before save | [docs/teach.md](docs/teach.md) | `shared/conditions.ts`, `web/src/teach/` |

Start with **[ARCHITECTURE.md](ARCHITECTURE.md)**. The contract is **[shared/schema.ts](shared/schema.ts)**.

## Quick start

```bash
npm install
cp web/.env.example web/.env.development
```

Create `.env.local` in the repo root. It is **gitignored and must never be committed**:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/hacknation11labs-firebase-adminsdk-....json   # ask the team, never commit
FIREBASE_PROJECT_ID=hacknation11labs
CLAUDE_KEY=               # Anthropic Claude (all LLM tasks); empty = mock LLM (every flow still works)
ELEVENLABS_API_KEY=       # needs Text to Speech, Speech to Text and Agents access; empty = browser speech fallback
```

Run (two terminals):

```bash
npm run api
```

```bash
npm run dev
```

First time only (creates/updates the two ElevenAgents and writes their ids to `web/src/lib/elevenlabs.json`):

```bash
npm run setup:elevenlabs -w tools
```

Firebase web config (never committed): run `npm run setup -w tools` (writes `web/.env.local`), or copy `web/.env.example` to `web/.env.local` and fill it in. Install the secret check as a pre-commit hook:

```bash
ln -s ../../scripts/check-secrets.sh .git/hooks/pre-commit
```

Open http://localhost:5173 and pick a person on the demo login (no passwords):
- **Experts** (Sabine, Ilse, Jürgen) → **My day**: "Start my day", then work as usual. Ada asks *why* at natural pauses, and the day is split into tasks automatically (app switch, "New task", a break, or Claude noticing a different kind of work). Each task gets its own Work Map; "Debrief now" per task.
- **Practicers** (Lena, Aylin, Tim) → **Training**: their department's confirmed Work Map is preselected.

- **Compare** (`/compare`): two experts, one task. Where Sabine and Ilse differ, Ada asks each of them why and turns the answers into a team rule.
- **Golden path** (whole scenario, real services): `EXPERT=sabine npm run golden -w tools`. **Launch video brief:** `docs/BRAG.md`.

Pages:
- **Map:** `/map/ses_demo_sabine_01` is the seeded demo session with its confirmed Work Map (live from Firestore).
- **Teach:** `/teach` → pick the Work Map → start. MiniERP opens in teach mode. Open INV-4490 (€7,200 equipment) and press Approve on cost center 4711. The tutor holds the save and quotes Sabine.
- **Capture:** `/capture` → start a session → **Start listening** (Ada = ElevenAgents interviewer, Scribe transcript) → share the screen *or* use the extension → work in MiniERP or any web app. Ada asks *why* at natural pauses, then End task → debrief → teach-back.
- **Any other web app:** `/demo/procurex.html` is a plain third-party-style form. With the extension (or the one-line embed it includes) Capture records its field changes and Teach holds a wrong "Submit for approval".

## Browser extension: Chrome + Firefox (coaching and capture on any site + tutor overlay)

Ada's coaching always runs in the extension, on every work app, MiniERP included: the overlay, the coaching cards and holding a wrong Save/Approve. MiniERP has no Ada UI of its own; it only publishes structured events (case facts) like an app integration would, so the save check there is exact instead of read off the screen. Without the extension, `/erp` loads the same overlay and save hold from `apprentice-embed.js` (that's how the hosted demo works with no install). Every build makes **both** targets (`dist/chrome`, `dist/firefox`), and `npm run check` lints the Firefox build with Mozilla's `web-ext lint`.

```bash
npm run build:extension
```

- **Chrome / Edge:** `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist/chrome`
- **Firefox (140+):** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `extension/dist/firefox/manifest.json`
- Zips for sharing: `npm run package -w extension` → `extension/dist/ai-apprentice-{chrome,firefox}.zip`

Then start a Capture or Teach session in the web app and work in any other tab:
- **Capture:** records field changes, clicks and navigation (passwords, IBANs and card numbers are masked). Screenshots the active work tab once per second as frames, so no screen-share dialog is needed. The overlay pill shows recording, with off-record and bookmark buttons.
- **Teach:** the overlay shows Ada's guidance cards with the expert's quote and screen moment. Save/Submit/Approve-like clicks are held until Claude has checked them against the Work Map's guardrails.
- Fallback for a same-origin demo page without the extension: `<script src="https://<host>/apprentice-embed.js" defer></script>` (same overlay code).

## Repo

```
shared/            contract + logic used everywhere (no framework code)
  schema.ts          THE contract: events, Session, WorkMap, CaseFacts, ApprenticeBridge
  eventlog.ts        the only event writer: batching into chunks, seq reservation, blob uploads
  logindex.ts        read helpers: frames at t, verified verbatim quotes, off-record spans
  workmap.ts         Map core: draft → LLM proposal → verified Work Map, versioning
  conditions.ts      deterministic guardrail engine (violation predicates over CaseFacts)
  llm.ts             typed contract of every LLM task (vision, pick_question, extract_workmap, …)
web/               Vite + React app: /capture /map /teach /erp (MiniERP sandbox)
functions/         `api` Cloud Function: LLM tasks (Claude) + ElevenLabs tokens/TTS; keys never in the browser
extension/         Chrome + Firefox MV3 extension: DOM capture on any site, overlay, cross-tab relay, tab screenshots
tools/             admin scripts: dev-api server, seed fixture, pull session, deploy rules, project setup
fixtures/          demo session + expected Work Map (test oracle)
scripts/           Python: fixture generator, bundle validator, guardrail reference evaluator
firestore.rules    append-only event chunks, immutable Work Map versions, signed-in users only
storage.rules      write-once session blobs
```

## Checks

```bash
npm run check                      # typecheck all workspaces + shared tests + fixture validation + guardrail cases
npm run pull -- <sessionId>        # export a session from Firebase to data/sessions/<id>
python3 scripts/validate_bundle.py data/sessions/<id> --part capture|map|teach
```

## Firebase project `hacknation11labs`

Firestore (`eur3`) and Storage (`us-east1`) are set up. A web app is registered, anonymous auth is enabled and the rules are deployed (`npm run deploy:rules`). Cloud Functions need an account with Functions + Secret Manager rights (the service account doesn't have them). Until then, `npm run api` serves the same handlers locally. To deploy them:

```bash
firebase functions:secrets:set CLAUDE_KEY
firebase functions:secrets:set ELEVENLABS_API_KEY
```

```bash
npm run deploy:functions
```

Stack: ElevenLabs (ElevenAgents interviewer + tutor on `eleven_v3_conversational` expressive voices, Scribe v2 Realtime, TTS fallback) · Anthropic Claude (Sonnet 5.5 for every live and offline task, Opus 5.5 only for the Work Map extraction; `LLM_MODEL` / `LLM_MODEL_MAP` to override; both ElevenAgents also run on Claude Sonnet 5.5) · Firebase · Chrome + Firefox MV3 extension. All data is fictional sandbox data.

Tool checks against the real services: `npm run smoke -w tools` (every Claude task), `npm run agent-test -w tools` (both agents' control protocol over WebSocket), `npm run scribe-test -w tools` (Scribe realtime with word timestamps), `npm run e2e:voice -w tools` / `npm run e2e:teach-voice -w tools` (live ElevenAgents interviewer / tutor + Scribe in a real browser with a synthetic mic), `npm run e2e:extension -w tools` (the real extension in Chrome for Testing; needs `npm run dev` + `npm run api`; first time: `npx puppeteer browsers install chrome`).

## License

[MIT](LICENSE)
