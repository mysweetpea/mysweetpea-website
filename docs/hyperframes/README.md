# HyperFrames sources

`moonfin-pin.html` is the composition behind `workers/dashboard/public/media/moonfin-pin.mp4`
(10 s, 1080×1080, silent — a UI demo, not a film).

Re-render after editing:

```bash
mkdir -p /tmp/hf && cp moonfin-pin.html /tmp/hf/index.html && cd /tmp/hf
npm init -y && npx hyperframes init . --force   # or drop the file into an existing project
npx hyperframes check      # must be 0 errors
npx hyperframes render -o moonfin-pin.mp4 --quality delivery
ffmpeg -y -ss 9.4 -i moonfin-pin.mp4 -frames:v 1 -q:v 3 moonfin-pin.jpg   # poster
```

Keep the placeholder values (`alex`, masked PIN, masked address tail): the clip is
served to every member and must never contain a real PIN or mount URL.
