# Brag brief: AI Apprentice (for the `/brag` launch video)

Everything the brag skill needs to make a short launch video: the story, the scenes with their exact routes and screenshots, verified claims, brand, and what not to claim. Screenshots are in `docs/brag/` (1440×900 @2x, regenerate with `npm run brag:shots -w tools`).

## One-liner
**AI Apprentice turns a retiring expert's workday into a Work Map and a voice tutor, so the next new hire learns the judgment calls, not just the clicks.**

Tagline options: "An apprentice, not a recorder." · "Before 24 years of judgment walk out the door." · "Ada asks why."

## The problem (numbers from the ElevenLabs × Hack-Nation brief)
- 11,200 Americans turn 65 every day. In Germany, 12.9 million workers (almost 30%) pass retirement age by 2036.
- What makes experts good was never written down. Screen recordings show *what*, not *why*. Guardrails are invisible until a new hire breaks one.
- Sabine has run accounts payable for 24 years and retires in 18 months. Lena started on Monday.

## Story (≈ 60–75 s, 7 scenes)
| # | Scene | Show | Route / asset | On-screen line |
|---|---|---|---|---|
| 1 | Who's working today | Demo login: 3 experts, 3 new hires | `/login` · `docs/brag/01-login.png` | "Experts teach. New hires practice." |
| 2 | Sabine starts her day | "Start my day". Ada listens and splits the day into tasks | `/day` · `02-my-day.png` | "Work as usual. Ada stays quiet." |
| 3 | Ada asks why | At a pause after a save: "You moved that one to capex. What made you do that?" | live (`/day` + `/erp?mode=capture`) | "Asks at natural pauses, about what's on screen." |
| 4 | The self-correction | "…three thousand… no wait, five thousand." The correction is struck through in the Work Map | `/map/demo` · `03-work-map.png` | "Every rule in the expert's own words." |
| 5 | The Work Map | Steps, rules, the screen moment, the 27 s off the record kept out | `/map/demo` · `03-work-map-full.png` | "Steps. Decisions. Guardrails. Proof." |
| 6 | Lena on a case Sabine never showed | €7,200 equipment invoice coded as opex → **save held** → "Sabine would stop here. Why do you think?" + Sabine's quote + her screen | `/erp?mode=teach` · `04-teach-save-held.png`, `05-tutor-panel.png` | "Catches the mistake before it's saved." |
| 7 | Any web app | Browser extension (Chrome + Firefox) puts Ada on any tool, e.g. a procurement form | `/demo/procurex.html` · `06-any-web-app-overlay.png` | "Works where the work happens." |
| ⭐ | Moonshot | A living company memory: every expert's workday becomes a Work Map that stays current; Ada only asks about what's new | (closing card) | "Turn every retirement party into a Work Map." |

Optional scene (when Gemini billing is on, see "Retakes"): **Two experts, one task**: `/compare` shows where Sabine and Ilse differ ("hold duplicates" vs "send to Jonas") and the team rule after both explain why.

## Verified claims (safe to say)
- **3 live questions per task at natural pauses, at least one about a guardrail** (pause detector: no typing for 1.5 s, no speech for 1.2 s, after a save or a finished case; max 5 per 10 min).
- **Talks with ElevenLabs:** two ElevenAgents (interviewer "Ada" + tutor), expressive v3 voices, Scribe v2 Realtime transcription with word timestamps. Verified live in a real browser.
- **Self-corrections become part of the map** ("no wait, five thousand" → rule updated, old version kept in its history).
- **Blocks a wrong decision before it's saved** and explains it with the expert's quote and screen moment (brief's own test case).
- **Whole workday → tasks automatically** (app switch, a break, a new kind of work, or "New task").
- **Any web app** via the browser extension; **off the record** by voice or button; passwords, IBANs and card numbers masked.
- AI: Google Gemini (`gemini-3.8-flash`) for vision, question picking, extraction, guardrail checks.

## Don't claim (yet)
- Firefox: lint-verified (0 errors, 0 warnings), not run end-to-end here. Chrome is e2e-verified.
- Voice was tested with a synthetic microphone; real-room rehearsal pending.
- Comparisons and task names need live Gemini (the free tier ran out today; screens show "Mock AI" until billing is on).
- No personal-data scrubbing of transcripts yet (masking and blurring only).

## Brand
- App UI: neutral black/white system (Inter, 1px borders, Vercel-like), accent green status dot. Dark background in the app shots.
- Demo apps: **MiniERP** navy `#1f3a5f` (accounts payable), **ProcureX** brown `#7a3e1d` (procurement).
- Tutor overlay: red card for "save held", blue for "predict", amber for nudges; pill "Ada is coaching" (green) / "Ada is learning from …" (navy).
- Voices: interviewer "Chris" (calm, curious), tutor "Alice" (clear educator), both ElevenLabs.
- Tone: calm, respectful of senior expertise. Ada is the apprentice, never the boss.

## Project facts
- Team: Rene (Capture + Teach), Toivo (Map). ElevenLabs × Hack-Nation, 7th Global AI Hackathon, Challenge 01 "The AI Apprentice".
- Repo: `onrecc/hacknation11labs` (React + Vite, Firebase, Chrome/Firefox MV3 extension).
- Run locally: `npm run api` + `npm run dev`, open http://localhost:5173. `/map/demo` works without any backend.

## Retakes when Gemini billing is on
Run the golden path; it writes real screenshots into `docs/brag/`:
```bash
EXPERT=sabine npm run golden -w tools
```
```bash
EXPERT=ilse SKIP_TEACH=1 npm run golden -w tools
```
Then compare Sabine vs Ilse on `/compare` and retake `npm run brag:shots -w tools` (the nav then shows "Live" instead of "Mock AI").
