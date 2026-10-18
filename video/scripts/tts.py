"""Generate narration + speech clips with word timings via ElevenLabs /with-timestamps.
   python3 video/scripts/tts.py   (reads ELEVENLABS_API_KEY from .env.local)"""
import base64, json, os, re, subprocess, urllib.request, pathlib
root = pathlib.Path(__file__).resolve().parents[2]
for line in (root / ".env.local").read_text().splitlines():
    if line.startswith("ELEVENLABS_API_KEY="): KEY = line.split("=", 1)[1].strip().strip('"')
OUT = pathlib.Path(os.environ["OUT"]) if os.environ.get("OUT") else root / "video" / "public"
GEORGE, CHRIS, MATILDA = os.environ.get("NARRATOR", "JBFqnCBsd6RMkjVDRZzb"), "iP95p4xoKVk53GoZ742B", "XrExE9yKIg1WjnnlVkGX"  # NARRATOR=pFZP5JQG7iQjIQuC4Bku → Lily
CLIPS = {
  "i1": (GEORGE, "Screen recordings show what she clicked. Never why."),
  "hook": (GEORGE, "Sabine has run accounts payable in Hamburg for twenty-four years, and retires next year. Her replacement, Olena from Kharkiv, doesn't speak German yet."),
  "i2": (GEORGE, "So we built Protégé. It stops a new hire's mistake before it's saved."),
  "n1": (GEORGE, "When Sabine pauses after a change, our ElevenLabs agent Ada asks why."),
  "n2": (GEORGE, "Every rule needs her exact words and a real screenshot, or it's thrown out."),
  "n3": (GEORGE, "Then Ada's cards coach Olena in Ukrainian. The wrong save is held. Sabine's words, word for word, now in Olena's language. Nothing lost in translation."),
  "end": (GEORGE, "And the rules that teach Olena export as a procedure for AI agents, with the same stop points."),
  "cold": ("Xb7hH8MSUJpSbSDYk0k2", "Sabine would stop here. Why do you think?"),  # Alice = the tutor agent's voice
  "ada-q1": (CHRIS, "You moved that one to capex. What made you do that?"),
  "t1": (GEORGE, "Everything Ada sees and hears goes into one append-only event log: screen actions, and ElevenLabs Scribe transcripts with word timestamps. Two ElevenAgents run on top: an interviewer that speaks only at real pauses, and a tutor."),
  "t2": (GEORGE, "The hard part was trust. So Claude only proposes the Work Map, and our code verifies every claim: each quote must match the transcript word for word, each screen moment must be a real frame, each guardrail a checkable condition. Anything unverifiable is dropped. Then Sabine confirms the map by voice."),
  "t3": (GEORGE, "What didn't work yet: voice is only tested with a synthetic mic. Firefox builds, but only Chrome is tested end to end. And redaction is rule-based, so names are only caught from a list."),
  "t4": (GEORGE, "Stack: React, Firebase, Cloud Functions, a Chrome extension, ElevenLabs and Claude."),
  "sabine-a1": (MATILDA, "Equipment over three thousand euros is always capex. No, wait, sorry... five thousand."),
}
_sp, _dp = float(os.environ.get("TSPEED", "1.12")), float(os.environ.get("DSPEED", "1.0")); SPEED = {"t1": _sp, "t2": _sp, "t3": _sp, "t4": _sp, "n1": _dp, "n2": _dp, "n3": _dp, "i2": _dp, "end": _dp, "hook": _dp}
SAY = {k: v for k, v in [x.split("=", 1) for x in os.environ.get("SAY", "").split(";") if "=" in x]}  # e.g. SAY="Protégé=Pro-teh-zhay"
def spoken(text):
    for k, v in SAY.items(): text = text.replace(k, v)
    return text
def tts(voice, text, name=""):
    body = json.dumps({"text": spoken(text), "model_id": "eleven_multilingual_v2", "voice_settings": {"stability": 0.55, "similarity_boost": 0.8, "style": 0.25, "speed": SPEED.get(name, 1.0)}}).encode()
    req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128", body, {"xi-api-key": KEY, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))
timing = {}
for name, (voice, text) in CLIPS.items():
    if (OUT / f"{name}.json").exists() and name not in os.environ.get("FORCE", "").split(","):
        d = json.loads((OUT / f"{name}.json").read_text()); timing[name] = d["dur"]; continue
    r = tts(voice, text, name)
    (OUT / f"{name}.mp3").write_bytes(base64.b64decode(r["audio_base64"]))
    a = r["alignment"]; chars, st, en = a["characters"], a["character_start_times_seconds"], a["character_end_times_seconds"]
    words, cur, s = [], "", None
    for c, cs, ce in zip(chars, st, en):
        if c.isspace():
            if cur: words.append({"w": cur, "s": s, "e": prev_e}); cur = ""
            continue
        if not cur: s = cs
        cur += c; prev_e = ce
    if cur: words.append({"w": cur, "s": s, "e": prev_e})
    # « » are spoken-text hints only (they make the voice say Protégé in French): drop them, glue stray punctuation back on
    merged = []
    for w in words:
        t = w["w"].replace("«", "").replace("»", "")
        if not t: continue
        if merged and all(not c.isalnum() for c in t): merged[-1]["w"] += t; merged[-1]["e"] = w["e"]; continue
        merged.append({**w, "w": t})
    words = merged
    shown = text.split()  # captions always show the written text (Protégé), not the TTS spelling
    if len(shown) == len(words):
        for w, t in zip(words, shown): w["w"] = t
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(OUT / f"{name}.mp3")]).decode())
    (OUT / f"{name}.json").write_text(json.dumps({"text": text, "words": words, "dur": round(dur, 3)}))
    timing[name] = round(dur, 3); print(name, round(dur, 2), "s")
(OUT / "timing.json").write_text(json.dumps({"ada": timing["ada-q1"], "sabine": timing["sabine-a1"], **timing}, indent=1))
print(timing)
