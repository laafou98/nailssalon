# Prototype (Oct 21): "true-colour composite" of a YouCam Nail VTO render.
# Keeps YouCam's nail mask and shading pattern, swaps in the exact requested polish colour (OKLab),
# drops the 1 px edge slivers from YouCam's slight resize, and adds the photo's own grain.
# Usage: python3 scripts/prototypes/true_colour_composite.py hand.jpg render.png out.png "#F0645A"
# Findings: fixes hue drift (chrome turned coral into red) and the too-clean look; scene-brightness and
# saturation guesses were unreliable, so they are disabled (sat = 1.0, no lightness scaling).

import sys
import numpy as np
from PIL import Image, ImageFilter

def to_lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def to_srgb(c): c = np.clip(c, 0, None); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])
def oklab(lin): return np.cbrt(lin @ M1.T) @ M2.T
def from_oklab(lab): return (lab @ np.linalg.inv(M2).T) ** 3 @ np.linalg.inv(M1).T
def blur(a, r): return np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), dtype=np.float64) / 255
def minf(a, s): return np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(s)), dtype=np.float64) / 255
def maxf(a, s): return np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(s)), dtype=np.float64) / 255

TYPICAL_SKIN_CHROMA = 0.055  # OKLab chroma of skin in a well-exposed, neutral photo

def run(hand_path, render_path, out_path, hexstr):
    hand_img = Image.open(hand_path).convert("RGB")
    hand = np.asarray(hand_img, dtype=np.float64) / 255
    render = np.asarray(Image.open(render_path).convert("RGB").resize(hand_img.size, Image.LANCZOS), dtype=np.float64) / 255
    h_lab, r_lab = oklab(to_lin(hand)), oklab(to_lin(render))

    # Paint mask from colour change (OKLab distance), opened to drop thin edge slivers from YouCam's 1 px shift.
    d = np.linalg.norm(r_lab - h_lab, axis=2)
    hard = (d > 0.08).astype(float)
    hard = maxf(minf(hard, 5), 5)          # opening: removes lines < ~5 px wide
    mask = blur(hard, 1.2)
    core = mask > 0.6

    # Scene colourfulness from the skin (hand pixels outside the nails, by lightness band).
    skin = (~core) & (h_lab[..., 0] > 0.55)
    skin_chroma = np.median(np.hypot(h_lab[..., 1], h_lab[..., 2])[skin])
    sat = 1.0  # v4: no scene-saturation guess

    target = oklab(to_lin(np.array([int(hexstr[i:i + 2], 16) for i in (1, 3, 5)]) / 255))
    tL, ta, tb = target
    # Keep YouCam's lightness *pattern* but centre it on the target polish lightness;
    # take hue from the target, chroma scaled to the scene.
    rL = r_lab[..., 0]
    L = tL + (rL - np.median(rL[core.astype(bool)])) * 0.8
    # Darker scene → darker polish: follow the skin's lightness against a typical 0.75.
    skin_L = np.median(h_lab[..., 0][skin])
    pass  # v4: no scene-lightness guess
    hi = np.clip((L - tL) / 0.25, 0, 1)    # highlights lose chroma, as real speculars do
    a = ta * sat * (1 - 0.7 * hi)
    b = tb * sat * (1 - 0.7 * hi)
    out_lin = from_oklab(np.stack([L, a, b], axis=2))

    grain = hand - np.stack([blur(hand[..., c], 1.5) for c in range(3)], axis=2)
    out = to_srgb(out_lin) + grain * 0.8
    m = mask[..., None]
    final = np.clip(out * m + hand * (1 - m), 0, 1)
    Image.fromarray((final * 255).round().astype(np.uint8)).save(out_path)
    print(f"scene saturation ×{sat:.2f}, skin L {skin_L:.2f}, nail px {int(core.sum())}")

run(*sys.argv[1:5])
