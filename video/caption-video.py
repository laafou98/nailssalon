#!/usr/bin/env python3
"""Burn caption pills onto a demo video.

Usage:
  python3 video/caption-video.py INPUT.mp4 [-c video/captions.json] [-o OUTPUT.mp4] [--preview]

Each caption in captions.json has "start", "end" (m:ss or seconds) and "text".
The ffmpeg here has no text renderer, so each caption is drawn with Pillow as a
transparent PNG and overlaid with a short fade in/out. Audio is copied untouched.
"""
import argparse, json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
FADE = 0.25          # seconds
BOTTOM = 0.10        # caption pill sits this fraction of the height above the bottom edge


def seconds(v):
    if isinstance(v, (int, float)):
        return float(v)
    parts = v.split(":")
    return sum(float(p) * 60 ** i for i, p in enumerate(reversed(parts)))


def probe(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration",
        "-of", "json", path])
    d = json.loads(out)
    s = d["streams"][0]
    return int(s["width"]), int(s["height"]), float(d["format"]["duration"])


def wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=font) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def render_pill(text, W, H, font_index=1):
    size = max(28, round(W * 0.038))
    font = ImageFont.truetype(FONT, size, index=font_index)  # index 1 = Bold in HelveticaNeue.ttc
    pad_x, pad_y = round(size * 0.9), round(size * 0.6)
    radius = round(size * 0.7)
    scratch = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    lines = wrap(scratch, text, font, W * 0.86 - 2 * pad_x)
    line_h = round(size * 1.25)
    text_w = max(scratch.textlength(l, font=font) for l in lines)
    pill_w = round(text_w + 2 * pad_x)
    pill_h = round(len(lines) * line_h + 2 * pad_y)
    img = Image.new("RGBA", (W, pill_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0 = (W - pill_w) // 2
    d.rounded_rectangle((x0, 0, x0 + pill_w, pill_h), radius=radius, fill=(12, 12, 14, 190))
    y = pad_y
    for l in lines:
        d.text((W / 2, y + line_h / 2), l, font=font, fill=(255, 255, 255, 255), anchor="mm")
        y += line_h
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("-c", "--captions", default=os.path.join(os.path.dirname(__file__), "captions.json"))
    ap.add_argument("-o", "--output")
    ap.add_argument("--preview", action="store_true", help="also save a frame per caption into video/preview/")
    ap.add_argument("--x264", action="store_true", help="encode with libx264 instead of VideoToolbox")
    a = ap.parse_args()

    out = a.output or os.path.splitext(a.input)[0] + "-captioned.mp4"
    W, H, duration = probe(a.input)
    with open(a.captions) as f:
        caps = json.load(f)
    caps = [dict(c, start=seconds(c["start"]), end=seconds(c["end"])) for c in caps]
    for c in caps:
        if c["end"] <= c["start"]:
            sys.exit(f"caption ends before it starts: {c}")
        if c["end"] > duration + 0.5:
            print(f"warning: caption runs past the video ({duration:.1f}s): {c['text'][:40]}", file=sys.stderr)

    tmp = tempfile.mkdtemp(prefix="captions-")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-stats", "-y", "-i", a.input]
    filters, last = [], "[0:v]"
    for i, c in enumerate(caps, start=1):
        img = render_pill(c["text"], W, H)
        png = os.path.join(tmp, f"cap{i}.png")
        img.save(png)
        dur = c["end"] - c["start"]
        y = H - round(H * BOTTOM) - img.height
        cmd += ["-loop", "1", "-t", f"{dur:.3f}", "-i", png]
        filters.append(
            f"[{i}:v]format=rgba,fade=t=in:st=0:d={FADE}:alpha=1,"
            f"fade=t=out:st={max(0, dur - FADE):.3f}:d={FADE}:alpha=1,"
            f"setpts=PTS-STARTPTS+{c['start']:.3f}/TB[c{i}]")
        filters.append(
            f"{last}[c{i}]overlay=0:{y}:eof_action=pass:"
            f"enable='between(t,{c['start']:.3f},{c['end']:.3f})'[v{i}]")
        last = f"[v{i}]"
    filters.append(f"{last}format=yuv420p[vout]")

    video_codec = ["-c:v", "libx264", "-preset", "medium", "-crf", "18"] if a.x264 else \
                  ["-c:v", "h264_videotoolbox", "-b:v", "14M", "-profile:v", "high"]
    cmd += ["-filter_complex", ";".join(filters), "-map", "[vout]", "-map", "0:a?",
            *video_codec, "-c:a", "copy", "-movflags", "+faststart", out]
    print(f"{len(caps)} captions, {W}x{H}, {duration:.1f}s -> {out}")
    subprocess.check_call(cmd)

    if a.preview:
        pdir = os.path.join(os.path.dirname(os.path.abspath(a.captions)), "preview")
        os.makedirs(pdir, exist_ok=True)
        for i, c in enumerate(caps, start=1):
            mid = (c["start"] + c["end"]) / 2
            subprocess.check_call(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                                   "-ss", f"{mid:.3f}", "-i", out, "-frames:v", "1",
                                   "-vf", "scale=540:-2", os.path.join(pdir, f"cap{i:02d}.jpg")])
        print(f"preview frames in {pdir}")


if __name__ == "__main__":
    main()
