# AI Apprentice: ElevenLabs × Hack-Nation (7th Global AI Hackathon)

An apprentice, not a recorder. It watches an expert do real screen work, asks *why* at natural pauses (ElevenLabs voice agent), turns the session into a clickable **Work Map** of steps, decisions and guardrails in the expert's own words, and then **tutors the next new hire**, catching mistakes before they're saved.

| Part | What | Guide |
|---|---|---|
| 1. Capture | Screen share + always-on transcript + interviewer agent → Session Log | [docs/capture.md](docs/capture.md) |
| 2. Map | Session Log → Work Map, spoken debrief, teach-back | [docs/map.md](docs/map.md) |
| 3. Teach | Voice tutor on the new hire's screen, guardrails enforced before save | [docs/teach.md](docs/teach.md) |

Start with **[ARCHITECTURE.md](ARCHITECTURE.md)**. The data contract is **[shared/schema.ts](shared/schema.ts)**.

## Repo

```
ARCHITECTURE.md              architecture, principles, Firebase layout, ground rules
docs/                        one guide per part: constraints, milestones, definition of done
shared/schema.ts             THE contract: Event types, Session, WorkMap, CaseFacts, ApprenticeBridge
fixtures/demo-session/       realistic 7-min session (3 invoices) + expected Work Map (test oracle)
scripts/make_fixture.py      regenerates the fixture (edit the SCRIPT section)
scripts/validate_bundle.py   contract + challenge-requirement checks (--part capture|map|teach)
scripts/eval_guardrails.py   reference guardrail evaluator + Teach test cases T1–T4
```

## Checks (no dependencies besides Python 3 and npx)

```bash
python3 scripts/make_fixture.py
npx -y -p typescript tsc --noEmit --strict --target es2022 fixtures/demo-session/.typecheck.ts
python3 scripts/validate_bundle.py fixtures/demo-session --workmap fixtures/demo-session/expected_workmap.json
python3 scripts/eval_guardrails.py
```

Stack: ElevenAgents + Scribe v2 Realtime · Claude (vision, extraction) · Firebase (Firestore, Storage, Functions, Hosting).
All data in this repo is fictional sandbox data.
