# Submission videos (Remotion)

```bash
cd video && npm i
npx remotion studio src/index.ts        # preview everything
```

`public/` is gitignored. Regenerate it with these commands:
- `python3 scripts/tts.py`: narration + Ada/Sabine voices with word timings (ElevenLabs, key from `../.env.local`). `FORCE=n2,t1 python3 scripts/tts.py` regenerates only those clips.
- Screen clips: copy `scripts/rec-lib.mjs` + `scripts/record.mjs` into `tools/`, change `../public/` to `../video/public/`, then run `HUB=http://localhost:5173 node record.mjs [capture|map|teach]` with `npm run dev` + `npm run api` running. It creates real sessions in Firestore and prints their ids.

## 1. Demo (≤ 60 s)
Without the street intro: 51.4 s.
```bash
npx remotion render src/index.ts Demo out/demo.mp4
```
With the street clip: put it at `public/street.mp4` (≤ 8 s). Total ≈ 58 s.
```bash
npx remotion render src/index.ts Demo out/demo.mp4 --props='{"street":"street.mp4","streetDur":8}'
```

## 2. Tech (58.3 s)
```bash
npx remotion render src/index.ts Tech out/tech.mp4
```

## 3. Team
Put the phone clips in `public/team/` as `1-all.mp4`, `2-wilmer.mp4`, `3-rene.mp4`, `4-toivo.mp4`, `5-playful.mp4` and `6-all.mp4` (see `src/Team.tsx`, `teamDefault`). Each clip gets a lower-third or tag, and the end card is added automatically. The clips' own audio is kept. To change trims or durations, pass props like `{"shots":[{"src":"team/1-both.mp4","from":1.2,"dur":6,"title":"MEET THE TEAM","sub":"..."}]}`.
```bash
npx remotion render src/index.ts Team out/team.mp4
```

Check the length before uploading. It must be ≤ 60.0 s:
```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 out/demo.mp4
```
