# Prompt: make the three submission videos for Protégé

Paste everything below into Claude (Opus 5.5) on the Mac. It is self-contained.

---

You're helping a three-person hackathon team (**Rene Saarikko**, **Toivo** and **Wilmer**, who joined on the last day: give him the energetic on-camera parts: the demo's street hook and a slot in the team video) make their three submission videos for **Protégé** (pronounced *pro-teh-zhay*; always written with both accents), their entry to the **Hack-Nation 7th Global AI Hackathon**, Challenge 01 **ElevenLabs "The AI Apprentice"**. It's Sun Oct 4. **Hard deadline: 15:00 CEST** (late = not judged). Aim to have every video uploaded by **14:30**. They're at an Espresso House in Stockholm and can only film there or outside. Speed matters more than polish, but these videos carry a third of the score, so make them look professional.

## Submission rules (Google Form + HackOS, no re-submissions)
- **Demo video, max 60 s:** the project in action, clear narration or captions.
- **Tech video, max 60 s:** how we built it, what worked, what didn't, key tools.
- **Team video, max 60 s:** who we are.
- Plus: public GitHub repo with README (github.com/onrecc/hacknation11labs), hosted demo (https://hacknation11labs.web.app), team picture, all members listed, MIT license (done).
- Video links must be **open access** (Google Drive "anyone with the link", or YouTube unlisted). Export 1920×1080, H.264 MP4, 30 fps, and **check each is ≤ 60.0 s**.
- **Judging:** technical depth 33% · communication 33% · innovation/creativity 33%.

## The product (what to show)
Protégé captures a retiring expert's judgment and teaches it to the next hire. Three parts:
1. **Capture:** Sabine (accounts payable, 24 years, retires in 18 months) just works in her ERP. Ada, an **ElevenLabs voice agent**, watches the screen and stays quiet. At natural pauses (after a save, no typing, no speech) Ada asks *why*: "You moved that one to capex. What made you do that?" Sabine answers out loud and even corrects herself: "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand."
2. **Map:** the session becomes a **Work Map**: steps, decisions and guardrails in Sabine's own words. Every quote is verbatim from the transcript, linked to the exact screen moment, and the self-correction is kept (three thousand struck through → five thousand). Before saving, Ada explains the map back by voice and Sabine confirms or corrects it.
3. **Teach:** Lena, the new hire, gets a case Sabine never showed (a €7,200 equipment invoice). She codes it as opex, and **the save is held before it lands**. Ada (now the tutor) explains with Sabine's quote and screen: "Sabine would stop here. Why do you think?"
- Also: a Chrome/Firefox extension puts Ada on any web app; "off the record" by voice or button; passwords/IBANs/card numbers are masked.
- Taglines: "An apprentice, not a recorder." · "Before 24 years of judgment walk out the door." · "Turn every retirement party into a Work Map." (moonshot)
- Problem numbers (from the challenge brief): 11,200 Americans turn 65 every day. In Germany, 12.9 million workers (almost 30%) pass retirement age by 2036.

**Honest claims only.** Don't claim: Firefox tested end-to-end (only Chrome is); a real-room voice test (synthetic mic + rehearsal only); scrubbing of personal data (names etc.) from transcripts (not built).

## Style reference: the winning videos from the previous hackathon
- **Demo winner (60 s):** founder on camera states the problem (≈8 s), AI-generated cinematic footage of the problem (≈10 s), logo card, "Now let's jump straight into the demo", then **≈35 s of the real product** in a browser window on a soft dark gradient background with slow zooms, then a tagline end card over a cinematic shot. **Word-by-word captions throughout, key words in an accent colour.** Narration ≈130 words.
- **Team winner (60 s):** short cinematic opener, group shot with a "MEET THE TEAM" lower-third, then each person on their own with a name + role lower-third, one playful moment ("GOOD VIBES ONLY" tag), group finale, logo end card. Upbeat light music, captions with highlighted words.
- Our look: neutral black/white like Vercel (Inter font, thin 1px borders, dark background), accent green `#52e3a4`. Calm and respectful of senior expertise; Ada is the apprentice, never the boss.

## Video 1: Demo (≤ 60 s)
| Time | Shot | Voice-over / caption |
|---|---|---|
| 0–8 s | **Filmed:** Toivo + Rene walking a Stockholm street, Toivo to camera | "Sabine has done accounts payable for 24 years. In 18 months she retires, and everything she knows walks out with her." |
| 8–17 s | **AI-generated:** empty office desk with a retirement card · a new hire lost in front of an invoice screen · caption "11,200 people retire every day" | "Screen recordings show what she clicked. Never why." |
| 17–19 s | Logo card "Protégé" | "So we built Protégé." |
| 19–54 s | **Real product** in a browser frame on a dark gradient (see below) | narration below |
| 54–60 s | End card: "Protégé: an apprentice, not a recorder." + hacknation11labs.web.app | "Before twenty-four years of judgment walk out the door." |

Product section narration (≈35 s; ElevenLabs narrator voice "George" `JBFqnCBsd6RMkjVDRZzb`, model eleven_multilingual_v2, fits the sponsor):
- Capture: "Sabine just works. At a natural pause, our ElevenLabs agent, Ada, asks why." → **play Ada's real voice**: "You moved that one to capex. What made you do that?" → **Sabine's voice**: "Equipment over three thousand euros is always capex. No, wait, sorry, five thousand." Show these as speech cards with a small waveform; on Sabine's card, strike through "three thousand" and highlight "five thousand".
- Map: "Every answer becomes a Work Map. Steps, decisions and guardrails, in Sabine's own words, linked to the exact screen moment. Even her self-correction."
- Teach: "Then Ada tutors Lena, on a case Sabine never showed. Lena codes it as opex, and the save is held before it lands, explained in Sabine's own words."
- Scene chips at the top: "1 Capture", "2 Map", "3 Teach".

**How to build the product section: Remotion** (React video). A starter is in the repo at `video/` (`video/src/Product.tsx`): a browser frame with traffic lights + URL bar, slow zoom, word-by-word captions with highlighted keywords, Ada/Sabine speech cards with a waveform, scene chips. `cd video && npm i && npm run studio` to preview, `npm run render` to export. It expects in `video/public/`:
- `02-erp-capture.mp4`, `03-workmap.mp4`, `04-teach-held.mp4`: screen recordings, 1440×900. Ready-made clips are at **https://p3125.preview.internal/** (download them) if that server is up; otherwise record them yourself (QuickTime/Screen Studio, browser at 1440×900, dark mode):
  - Capture: log in as Sabine on https://hacknation11labs.web.app/login → My day → MiniERP → open INV-4471 Krauss → cost center 0400 → asset number → Save.
  - Map: https://hacknation11labs.web.app/map/demo opens on the self-corrected step; hover the struck-through quote, the screen moment, the decision; click Rules.
  - Teach: log in as Lena → Training → start on the demo map → open the €7,200 equipment invoice → code it opex → Save → **"Save held"** + tutor card. Hold that on screen ≥ 2 s.
- `n1.mp3`, `n2.mp3`, `n3.mp3` + `n1.json`… (narration + word timings): generate with the ElevenLabs `/v1/text-to-speech/{voice}/with-timestamps` endpoint and turn the character alignment into `{text, words:[{w,s,e}], dur}`. Also `ada-q1.mp3` (Ada's voice), `sabine-a1.mp3` (a mature female voice) and `timing.json` `{"ada": <s>, "sabine": <s>}`. The ElevenLabs key is in the repo's `.env.local` (never paste it into a chat or commit it).
Then put the street clip + AI footage + rendered product section + end card together (CapCut, iMovie or Remotion), add light music under the narration, and check the length is ≤ 60 s.

## Video 2: Tech (≤ 60 s)
No winner example; keep it simple: one of them talking at the laptop (or outside if the café is loud), cut with screen inserts (architecture diagram, the Work Map's quote ↔ transcript provenance, the tutor holding a save, a glimpse of code). Must cover **how we built it, what worked, what didn't, key tools**. Script (≈140 words):
> "Everything Ada sees and hears goes into one append-only event log: screen actions, ElevenLabs Scribe v2 Realtime transcripts with word timestamps, questions, answers and corrections. Two ElevenAgents run on top: the interviewer, which only speaks at real pauses, and the tutor.
> The hard part was trust. An LLM summary makes up rules. So Claude only *proposes* the Work Map, and our code verifies every claim: each quote must match the transcript word for word, each screen moment must point to a real frame, each guardrail must be a checkable condition. Whatever can't be verified is dropped. Then Ada explains the map back by voice, and corrections are patched in and re-confirmed.
> What didn't work: Gemini's free tier ran out mid-hackathon, so we switched to Claude. Voice is tested with a synthetic mic, and transcripts aren't scrubbed for personal data yet.
> Stack: React, Firebase, Cloud Functions, a Chrome extension, ElevenLabs and Claude."
Lower-third with the stack list; captions with highlighted words.

## Video 3: Team (≤ 60 s)
Film at the café table or on the street. Phone in landscape, 1080p/4K, 30 fps, **phone close to whoever is talking** (café noise), or use AirPods as the mic. Loose and natural, not read off a script. Shots:
1. Both on camera + lower-third "MEET THE TEAM · Protégé · Hack-Nation Stockholm".
2. Rene alone + "Rene Saarikko · Capture + Teach": "I built Capture and Teach: the voice agents, the browser extension, and the tutor that stops a bad save."
3. Toivo alone + "Toivo · Work Map": "I built the Work Map: turning a messy session into verified steps, rules and the expert's own words."
3b. Wilmer alone + "Wilmer · Pitch + demo": high energy, e.g. "I joined on the last day, and my job is to make sure you remember this one."
4. Playful moment: "We came in late because we were busy winning another hackathon." (tag: "GOOD VIBES ONLY" style)
5. Both: "Three people, one weekend, voice to map to tutor. Protégé: an apprentice, not a recorder."
6. End card.
Add something true and personal (school, why knowledge loss matters to you). Judges score this on personality. Light music, auto-captions (CapCut) with highlighted words.

Also take the **team picture** while filming.

## Final checklist
- [ ] All three ≤ 60 s, 1080p, captions burned in (judges often watch muted)
- [ ] Uploaded, links open in a private window without logging in
- [ ] Submit on **HackOS** *and* the **Google Form**: team name, both members (name, email, affiliation), challenge 01 ElevenLabs, three video links, repo, hosted demo, team picture
- [ ] Done by 14:45
