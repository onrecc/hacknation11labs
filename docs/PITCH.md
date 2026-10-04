# Pitch, videos and submission (AI Apprentice)

Deadline: **Sun Oct 4, 15:00 CEST** (late = not judged). Local pitch in Stockholm 15:30–16:00.
Judging: technical depth 33% · communication 33% · innovation 33%.
Story and screenshots: [BRAG.md](BRAG.md) · shots in [brag/](brag/).

Each video is ≤ 60 s. That's about 140 spoken words, so read at a calm pace. Record the screen first, then narrate over it. Burn in captions (judges often watch muted).

---

## 0. Video production plan (from the hack #6 winners)

**What the winners did.** Demo: founder on camera states the problem (8 s), then AI-generated cinematic footage (10 s), logo, then "let's jump straight into the demo" and **~35 s of the real product** in a browser frame on a gradient background, word-by-word captions with key words highlighted, a hard number, then a tagline end card. Team: group shot + "MEET THE TEAM" banner, each person with a name/role banner, one playful moment, group finale, logo end card, light music.

**Our rule:** AI-generated footage only for the *problem* and transitions. The product part must be our real app. Judges score technical depth, and an all-AI demo looks like a mock-up.

### Demo (60 s)
| Time | Shot | Source |
|---|---|---|
| 0–8 s | Toivo + Rene walking a Stockholm street, Toivo to camera: "Sabine has done accounts payable for 24 years. In 18 months she retires, and everything she knows walks out with her." | phone, outside |
| 8–17 s | Cinematic: an empty desk with a retirement card · a new hire staring at an invoice screen · "11,200 people retire every day" | AI video |
| 17–19 s | Logo card "AI Apprentice: an apprentice, not a recorder" | AI / end-card PNG |
| 19–52 s | **Real app** in a browser frame: Sabine works in MiniERP → Ada asks *why* (**real ElevenLabs voice audible**) → Work Map with the struck-through self-correction + screen moment → Lena codes €7,200 as opex → **Save held** + Sabine's quote | Playwright screen recordings (Toivo's agent) + Ada voice clips |
| 52–60 s | "Before 24 years of judgment walk out the door." + URL | end card |

Narration: the demo script below (scenes 2–6), voiced by an **ElevenLabs voice** (fits the sponsor) or Toivo.

### Tech (60 s) (no example; keep it simple)
Talking head at the laptop in Espresso House (or outside if it's loud), cut with screen inserts: architecture diagram → event log → Map provenance (quote ↔ transcript, screen moment) → tutor holding a save. Must cover **how we built it, what worked, what didn't, key tools**:
- Tools: ElevenAgents (interviewer + tutor), Scribe v2 Realtime, ElevenLabs TTS, Claude, Firebase, React, Chrome/Firefox extension.
- Worked: verified Work Map (every quote verbatim, every rule checkable), save held before it lands.
- Didn't: Gemini's free tier ran out mid-hackathon → switched to Claude; voice tested with a synthetic mic plus one real rehearsal; no personal-data scrubbing of transcripts yet.

### Team (60 s)
Espresso House table or the street. Phone landscape, 1080p/4K 30 fps, phone close (café noise!). Shots: (1) both + "MEET THE TEAM" banner, (2) Rene alone + name banner, (3) Toivo alone + name banner, (4) playful line: "we came in late because we were busy winning another hackathon", (5) both: tagline, (6) logo end card. Banners/captions added by AI editing or CapCut auto-captions.

### Who does what (now → 14:45)
- **Toivo's agent (now):** clean 1440×900 screen recordings of every product scene from the hosted site, Ada's lines as ElevenLabs audio, narration audio, captions (.srt), logo end card + name-banner PNGs. Served for download from a preview URL.
- **Toivo + Rene, 13:00–13:30:** street intro (3 takes), team video clips, team picture, tech talking head.
- **13:30–14:30:** AI-generated problem footage, assembly + captions (CapCut or AI editor), export 1080p, check each ≤ 60 s.
- **14:30–14:45:** upload (Drive "anyone with link"), submit **HackOS + Google Form**.

---

## 1. Demo video (≤ 60 s): what we built

| Time | Screen | Voice-over |
|---|---|---|
| 0–6 s | `/login`: Sabine's card | "Sabine has run accounts payable for twenty-four years. She retires in eighteen months. Lena started on Monday." |
| 6–16 s | `/day` → MiniERP, Sabine codes the Krauss invoice | "Sabine just works. Our ElevenLabs agent, Ada, watches the screen and stays quiet…" |
| 16–26 s | Ada's question at a pause + Sabine's spoken answer | "…until a natural pause. Then it asks *why*. 'You moved that to capex. What made you do that?'" |
| 26–38 s | `/map/demo`: the self-corrected quote with strikethrough, the screen moment, the decision | "Every answer becomes a Work Map: steps, decisions and guardrails in her own words, linked to the exact screen moment. Even her self-correction: three thousand… no, five." |
| 38–52 s | `/erp?mode=teach`: Lena codes €7,200 as opex → **Save held** → tutor card with Sabine's quote | "Then Ada becomes Lena's tutor. On a case Sabine never showed, Lena makes the classic mistake, and the save is held before it lands, explained with Sabine's quote and screen." |
| 52–60 s | Closing card: logo + "An apprentice, not a recorder." + URL | "AI Apprentice. Before twenty-four years of judgment walk out the door." |

Captions: on-screen lines from BRAG.md (scenes 2–6).

---

## 2. Tech video (≤ 60 s): how we built it, what was hard

Screen: architecture sketch (event log → Work Map → tutor), then quick cuts of code / the Map's provenance.

> "Everything Ada sees and hears goes into one append-only event log: screen actions, Scribe v2 Realtime transcripts with word timestamps, questions, answers and corrections.
>
> Two ElevenAgents run on top of it. The interviewer only speaks at real pauses: no typing, no speech, right after a save. The tutor runs in Teach mode.
>
> The hard part was **trust**. An LLM summary would make up rules. So the model only *proposes* the map, and our code verifies every claim: each quote must match the transcript word for word, each screen moment must point to a real frame, and each guardrail must be a checkable condition on the invoice. Whatever can't be verified is thrown out.
>
> Before anything is saved, Ada explains the map back by voice. Sabine's corrections are patched in deterministically and re-confirmed.
>
> Limits: transcripts aren't scrubbed for personal data yet, and so far we've tested with one expert per task."

(If the Claude switch is live by recording time: "LLM: Claude for extraction and guardrail checks". Otherwise say "an LLM".)

---

## 3. Team video (≤ 60 s): who we are

Both on camera, Stockholm hub in the background. Loose, not read.

> **Rene:** "I'm Rene. I built Capture and Teach: the voice agents, the browser extension, and the tutor that stops a bad save."
>
> **Toivo:** "I'm Toivo. I built the Work Map: turning a messy session into verified steps, rules and the expert's own words."
>
> **Rene:** "We came in late. We'd just won another hackathon the same weekend."
>
> **Toivo:** "Two people, one weekend, voice to map to tutor, live at hacknation11labs.web.app."
>
> **Both:** "AI Apprentice: an apprentice, not a recorder."

(Swap in anything true and personal: school, why knowledge loss matters to you. Judges score this on personality.)

---

## 4. Live pitch (2 min, NABC)

- **Need (20 s):** Every day, 11,200 Americans turn 65. In Germany, 30% of the workforce passes retirement age by 2036. What makes experts good is judgment, and judgment was never written down. Screen recordings show *what*, never *why*.
- **Approach (50 s):** Live demo, three beats. (1) Sabine works and Ada asks why at a pause. (2) The Work Map, with the self-corrected quote and the screen moment. (3) Lena makes the mistake and the save is held, with Sabine's words.
- **Benefit (25 s):** Onboarding from shadowing for weeks to learning on real cases from day one. Every rule traceable to the expert's own quote, so compliance can audit it. It works in any web app via the extension.
- **Competitors (15 s):** Scribe/Tango record clicks, not reasons. LMS courses go stale. Wikis nobody writes. We're the only one that *asks*, and then *enforces*.
- **Close (10 s):** Moonshot slide.

### Moonshot slide
> **The always-on apprentice.**
> Every expert's workday quietly becomes a living Work Map. Ada only asks about what's *new*. When two experts disagree, the team settles a rule. When a rule changes, every new hire's tutor knows the same day.
> *Turn every retirement party into a Work Map.*

---

## 5. Submission checklist (both HackOS **and** the Google Form)

- [ ] Team name, all members' name + email + affiliation (Rene Saarikko, Toivo)
- [ ] Challenge: 01 ElevenLabs
- [ ] Demo / tech / team video links, **open access** (YouTube unlisted or Drive "anyone with link"), each ≤ 60 s
- [ ] Repo public, with README setup + description: `github.com/onrecc/hacknation11labs`
- [ ] Hosted demo: https://hacknation11labs.web.app (redeploy Hosting + the function after the Claude switch)
- [ ] Team picture
- [x] MIT `LICENSE` in the repo
- [ ] Before submitting, check that `/map/demo` and the nav status dot show "Live"

## Recording plan (start ~13:00)
1. 13:00 Freeze `main`, deploy, run the golden path once on the hosted site.
2. 13:15 Screen-record the demo flow (Rene drives voice, Toivo records). Two takes max.
3. 13:45 Tech video: screen + voice-over.
4. 14:05 Team video + team picture outside.
5. 14:20 Edit/caption, upload, fill in **both** forms. Done by 14:45, with 15 min buffer.
