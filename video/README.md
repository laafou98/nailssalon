# Demo video

The submitted demo is a phone screen recording of the live app, laid on a 1920×1080 canvas with captions beside the phone so no text covers the app.

- `demo-captions.json`: the cut list (ranges of the original recording to drop) and the captions, timed on the original recording; the script shifts them past the cuts.
- `compose-demo.py`: renders the final video. Needs Pillow (`pip3 install pillow`) and ffmpeg.

```bash
python3 video/compose-demo.py path/to/recording.mp4 --preview
```

Output is `video/demo-final.mp4` (git-ignored), with one preview frame per caption in `video/preview/`. The voice-over script is in `docs/demo-video-script.md`.
