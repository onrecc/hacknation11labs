"""Lines that say "Protégé": English in the narrator voice + the word itself cut from a French sentence
   ("C'est Protégé.", same voice + eleven_multilingual_v2; the French context gives the French pronunciation).
   python3 video/scripts/splice.py   (needs video/voice/protege-fr.mp3; writes i2 + end with merged word timings)"""
import base64, json, os, subprocess, urllib.request, pathlib
root = pathlib.Path(__file__).resolve().parents[2]
KEY = next(l.split("=", 1)[1].strip() for l in (root / ".env.local").read_text().splitlines() if l.startswith("ELEVENLABS_API_KEY="))
OUT = pathlib.Path(os.environ.get("OUT", root / "video" / "public"))
VOICE = os.environ.get("NARRATOR", "gVAop54BusNm4YRoeTzF")  # "Protégé narrator" (Voice Design)
WORD = root / "video" / "voice" / "protege-fr.mp3"
SPEED = float(os.environ.get("DSPEED", "1.12"))
LINES = {"i2": ["So we built", WORD, "Expertise shouldn't be stuck in one person, one language, or one country."]}
dur = lambda p: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)]).decode())
def english(text, path):
    body = json.dumps({"text": text, "model_id": "eleven_multilingual_v2", "voice_settings": {"stability": 0.55, "similarity_boost": 0.8, "style": 0.25, "speed": SPEED}}).encode()
    req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128", body, {"xi-api-key": KEY, "Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req)); path.write_bytes(base64.b64decode(r["audio_base64"]))
    a = r["alignment"]; words, cur, s, pe = [], "", 0, 0
    for c, cs, ce in zip(a["characters"], a["character_start_times_seconds"], a["character_end_times_seconds"]):
        if c.isspace():
            if cur: words.append({"w": cur, "s": s, "e": pe}); cur = ""
            continue
        if not cur: s = cs
        cur += c; pe = ce
    if cur: words.append({"w": cur, "s": s, "e": pe})
    return words, words[0]["s"], pe
for name, parts in LINES.items():
    words, files, t = [], [], 0.0
    for i, part in enumerate(parts):
        wav = OUT / f"_{name}{i}.wav"
        if part == WORD:
            d = dur(WORD)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(WORD), "-af", "apad=pad_dur=0.3", "-ar", "44100", "-ac", "1", str(wav)], check=True)
            words.append({"w": "Protégé.", "s": round(t, 3), "e": round(t + d, 3)}); t += d + 0.3
        else:
            mp = OUT / f"_{name}{i}.mp3"
            w, start, last = english(part, mp)
            lead = max(0.0, start - 0.05); cut = last + 0.1
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp), "-ss", f"{lead:.3f}", "-to", f"{cut:.3f}", "-ar", "44100", "-ac", "1", str(wav)], check=True)
            words += [{"w": x["w"], "s": round(x["s"] - lead + t, 3), "e": round(x["e"] - lead + t, 3)} for x in w]
            t += cut - lead + (0.12 if i < len(parts) - 1 else 0); mp.unlink()
            if i < len(parts) - 1:  # a short breath before the French word
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-af", "apad=pad_dur=0.12", str(wav.with_suffix(".p.wav"))], check=True); wav.with_suffix(".p.wav").replace(wav)
        files.append(wav)
    inputs = sum([["-i", str(f)] for f in files], [])
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", f"concat=n={len(files)}:v=0:a=1", "-b:a", "128k", str(OUT / f"{name}.mp3")], check=True)
    for f in files: f.unlink()
    d = dur(OUT / f"{name}.mp3")
    (OUT / f"{name}.json").write_text(json.dumps({"text": " ".join(p if isinstance(p, str) else "Protégé." for p in parts), "words": words, "dur": round(d, 3)}))
    tj = json.loads((OUT / "timing.json").read_text()); tj[name] = round(d, 3); (OUT / "timing.json").write_text(json.dumps(tj, indent=1))
    print(name, round(d, 2), [(w["w"], w["s"]) for w in words][:6])
