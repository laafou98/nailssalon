# Demo video captions

Burns short caption pills onto the screen recording, timed to `docs/demo-video-script.md`.

1. Drop the recording here (or anywhere) and adjust the times in `captions.json` to the real cut.
2. Run:

    python3 video/caption-video.py path/to/demo.mp4 --preview

   Output is `demo-captioned.mp4` next to the input; `video/preview/` gets one frame per caption to check placement.

Needs Pillow (`pip3 install pillow`) and the Homebrew ffmpeg. Audio is copied untouched.
