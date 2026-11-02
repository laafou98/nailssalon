#!/usr/bin/env python3
"""Lay the phone recording on a 1920x1080 canvas with captions beside it.

Usage:
  python3 video/compose-demo.py INPUT.mp4 [-c video/demo-captions.json] [-o OUTPUT.mp4] [--preview]

demo-captions.json: "cuts" = [[from, to], ...] ranges of the ORIGINAL timeline to drop;
"captions" = {start, end, label, text} in ORIGINAL seconds (they are shifted past the cuts);
"footer" = small persistent line bottom-left. The text column never touches the phone.
"""
import argparse, json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
W, H, FPS = 1920, 1080, 30
BG = (20, 20, 20)
RED = (240, 58, 30)
PHONE_H = 1020
COL_X, COL_W = 150, 900          # text column
FADE = 0.3


def probe(path):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0",
                                   "-show_entries", "stream=width,height:format=duration",
                                   "-of", "json", path])
    d = json.loads(out)
    return int(d["streams"][0]["width"]), int(d["streams"][0]["height"]), float(d["format"]["duration"])


def shift(t, cuts):
    """Original time -> time in the cut video (None if inside a cut)."""
    off = 0.0
    for a, b in cuts:
        if t >= b:
            off += b - a
        elif t > a:
            return None
    return t - off


def wrap(draw, text, font, max_w):
    lines, cur = [], ""
    for w in text.split():
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=font) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines


def render_caption(label, text):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f_label = ImageFont.truetype(FONT, 30, index=1)    # Bold
    f_body = ImageFont.truetype(FONT, 46, index=10)    # Medium
    lines = wrap(d, text, f_body, COL_W)
    line_h = 60
    block_h = 30 + 28 + len(lines) * line_h
    y = (H - block_h) // 2 - 20
    d.text((COL_X, y), label.upper(), font=f_label, fill=RED + (255,))
    y += 30 + 28
    for l in lines:
        d.text((COL_X, y), l, font=f_body, fill=(255, 255, 255, 255))
        y += line_h
    return img


def render_footer(text):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, 24, index=0)
    d.text((COL_X, H - 60), text, font=f, fill=(150, 150, 150, 255))
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("-c", "--captions", default=os.path.join(os.path.dirname(__file__), "demo-captions.json"))
    ap.add_argument("-o", "--output")
    ap.add_argument("--preview", action="store_true")
    a = ap.parse_args()
    out = a.output or os.path.join(os.path.dirname(os.path.abspath(a.captions)), "demo-final.mp4")
    with open(a.captions) as f:
        cfg = json.load(f)
    cuts = sorted(cfg.get("cuts", []))
    sw, sh, src_dur = probe(a.input)
    ph_w = round(sw * PHONE_H / sh)
    ph_x, ph_y = W - ph_w - 260, (H - PHONE_H) // 2
    new_dur = shift(src_dur, cuts)
    tmp = tempfile.mkdtemp(prefix="demo-")

    # segments kept, in order
    keeps, t = [], 0.0
    for c0, c1 in cuts:
        keeps.append((t, c0)); t = c1
    keeps.append((t, src_dur))
    parts = []
    for i, (s, e) in enumerate(keeps):
        parts.append(f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[k{i}]")
    concat = "".join(f"[k{i}]" for i in range(len(keeps))) + f"concat=n={len(keeps)}:v=1:a=0"
    filters = parts + [
        f"{concat},fps={FPS},scale={ph_w}:{PHONE_H}:flags=lanczos[ph]",
        f"color=c=0x{BG[0]:02x}{BG[1]:02x}{BG[2]:02x}:s={W}x{H}:r={FPS}[bg]",
        f"[bg][ph]overlay={ph_x}:{ph_y}:shortest=1[base0]",
    ]
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-stats", "-y", "-i", a.input]
    n = 1
    last = "[base0]"
    if cfg.get("footer"):
        png = os.path.join(tmp, "footer.png"); render_footer(cfg["footer"]).save(png)
        cmd += ["-loop", "1", "-i", png]
        filters.append(f"{last}[{n}:v]overlay=0:0:eof_action=pass[b{n}]"); last = f"[b{n}]"; n += 1

    placed = []
    for c in cfg["captions"]:
        s, e = shift(c["start"], cuts), shift(c["end"], cuts)
        if s is None or e is None or e <= s:
            print(f"skipping caption inside a cut: {c['label']}", file=sys.stderr); continue
        e = min(e, new_dur)
        png = os.path.join(tmp, f"cap{n}.png"); render_caption(c["label"], c["text"]).save(png)
        dur = e - s
        cmd += ["-loop", "1", "-t", f"{dur:.3f}", "-i", png]
        filters.append(f"[{n}:v]format=rgba,fade=t=in:st=0:d={FADE}:alpha=1,"
                       f"fade=t=out:st={max(0, dur - FADE):.3f}:d={FADE}:alpha=1,"
                       f"setpts=PTS-STARTPTS+{s:.3f}/TB[c{n}]")
        filters.append(f"{last}[c{n}]overlay=0:0:eof_action=pass:enable='between(t,{s:.3f},{e:.3f})'[b{n}]")
        last = f"[b{n}]"; placed.append((s, e, c["label"])); n += 1
    filters.append(f"{last}format=yuv420p[vout]")
    cmd += ["-filter_complex", ";".join(filters), "-map", "[vout]", "-an",
            "-c:v", "h264_videotoolbox", "-b:v", "10M", "-profile:v", "high",
            "-movflags", "+faststart", out]
    print(f"{len(placed)} captions, cuts {cuts}, {src_dur:.1f}s -> {new_dur:.1f}s, phone {ph_w}x{PHONE_H} at {ph_x},{ph_y}\n-> {out}")
    subprocess.check_call(cmd)
    if a.preview:
        pdir = os.path.join(os.path.dirname(out), "preview"); os.makedirs(pdir, exist_ok=True)
        for f in os.listdir(pdir): os.remove(os.path.join(pdir, f))
        for i, (s, e, label) in enumerate(placed, 1):
            subprocess.check_call(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{(s+e)/2:.3f}",
                                   "-i", out, "-frames:v", "1", "-vf", "scale=960:-2", os.path.join(pdir, f"cap{i:02d}.jpg")])
        print(f"preview frames in {pdir}")


if __name__ == "__main__":
    main()
