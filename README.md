# AI Apprentice: ElevenLabs × Hack-Nation (7th Global AI Hackathon)

An apprentice, not a recorder. It watches an expert do real screen work and asks *why* at natural pauses (ElevenLabs voice agent). It turns the session into a clickable **Work Map** of steps, decisions and guardrails in the expert's own words. Then it **tutors the next new hire** and catches mistakes before they are saved.

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
ANTHROPIC_API_KEY=        # empty = mock LLM (every flow still works)
ELEVENLABS_API_KEY=       # empty = browser speech fallback (Chrome Web Speech + speechSynthesis)
ELEVENLABS_AGENT_ID=
```

Run (two terminals):

```bash
npm run api
```

```bash
npm run dev
```

Open http://localhost:5173:
- **Map:** `/map/ses_demo_sabine_01` is the seeded demo session with its confirmed Work Map (live from Firestore).
- **Teach:** `/teach` → pick the Work Map → start. MiniERP opens in teach mode. Open INV-4490 (€7,200 equipment) and press Approve on cost center 4711. The tutor holds the save and quotes Sabine.
- **Capture:** `/capture` → start a session → listen / share screen → open MiniERP and work. The agent asks at pauses, then End task → debrief → teach-back.

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
functions/         `api` Cloud Function: LLM tasks (Claude) + ElevenLabs tokens; keys never in the browser
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
firebase functions:secrets:set ANTHROPIC_API_KEY
```

```bash
npm run deploy:functions
```

Stack: ElevenAgents + Scribe v2 Realtime · Claude (`claude-opus-5-5` by default, `LLM_MODEL` to override) · Firebase. All data is fictional sandbox data.
