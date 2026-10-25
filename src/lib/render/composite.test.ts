import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inEllipse, noise } from "@/lib/inspo/synthetic.test-helpers";
import { deltaE, hexToRgb, rgbToOklab } from "@/lib/inspo/oklab";
import { designSpecSchema, solidSpec } from "@/lib/spec/types";
import { type NailTarget, type Raster, compositeTargets, trueColourComposite } from "./composite";
import { finishRender } from "./composite-image";

type RGB = [number, number, number];
const W = 120, H = 80;
const SKIN: RGB = [214, 170, 140];

function raster(paint: (x: number, y: number) => RGB, w = W, h = H): Raster {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set(paint(x, y).map((v) => Math.max(0, Math.min(255, Math.round(v)))), (y * w + x) * 3);
  return { width: w, height: h, data };
}

/** Noisy skin, like a phone photo. */
const handPx = (x: number, y: number): RGB => SKIN.map((c) => c + noise(x, y) * 6) as RGB;
const hand = raster(handPx);

/** YouCam-like render: crisp, noise-free nails (with a highlight band) over the hand. */
function render(nails: { cx: number; cy: number; rgb: RGB }[], extra?: (x: number, y: number) => RGB | null): Raster {
  return raster((x, y) => {
    const e = extra?.(x, y);
    if (e) return e;
    for (const n of nails) {
      if (inEllipse(x, y, n.cx, n.cy, 10, 14)) return x - n.cx > 3 && x - n.cx < 6 ? (n.rgb.map((c) => c + 40) as RGB) : n.rgb;
    }
    return handPx(x, y);
  });
}

const px = (r: Raster, x: number, y: number): RGB => [...r.data.subarray((y * r.width + x) * 3, (y * r.width + x) * 3 + 3)] as RGB;
const labOf = (rgb: RGB) => rgbToOklab(...rgb);
/** Median colour of a 5×5 patch (median by lightness), robust to grain. */
function patch(r: Raster, cx: number, cy: number): RGB {
  const all: RGB[] = [];
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) all.push(px(r, x, y));
  return all.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]))[12];
}

const CORAL = "#F0645A";
const DRIFTED_RED: RGB = [214, 30, 36]; // what YouCam's chrome made of the coral

describe("trueColourComposite", () => {
  it("swaps a drifted nail to the requested colour and leaves the rest of the render alone", () => {
    const r = render([{ cx: 40, cy: 40, rgb: DRIFTED_RED }]);
    const { image, nails, recoloured } = trueColourComposite(hand, r, { targets: [{ hex: CORAL }] });
    expect({ nails, recoloured }).toEqual({ nails: 1, recoloured: 1 });

    const target = labOf(hexToRgb(CORAL));
    expect(deltaE(labOf(patch(image, 36, 40)), target)).toBeLessThan(0.03);
    expect(deltaE(labOf(patch(r, 36, 40)), target)).toBeGreaterThan(0.1);
    // The highlight band stays lighter than the body of the nail.
    expect(labOf(px(image, 44, 40)).L).toBeGreaterThan(labOf(patch(image, 36, 40)).L + 0.03);
    // Away from the nail the output is the render, byte for byte.
    expect(px(image, 100, 10)).toEqual(px(r, 100, 10));
  });

  it("adds the photo's grain to the flat nail", () => {
    const flat = render([{ cx: 40, cy: 40, rgb: DRIFTED_RED }]);
    const { image } = trueColourComposite(hand, flat, { targets: [{ hex: CORAL }] });
    const reds = [];
    for (let x = 33; x <= 38; x++) reds.push(px(image, x, 40)[0]);
    expect(Math.max(...reds) - Math.min(...reds)).toBeGreaterThan(3);
  });

  it("keeps YouCam's paint where it can't find a nail (a pale polish close to the bare nail)", () => {
    const pale: RGB = [SKIN[0] + 6, SKIN[1] + 8, SKIN[2] + 8];
    const r = render([{ cx: 40, cy: 40, rgb: pale }]);
    const { image, recoloured } = trueColourComposite(hand, r, { targets: [{ hex: "#E2D7C9" }] });
    expect(recoloured).toBe(0);
    expect(image.data).toEqual(r.data);
  });

  it("ignores thin slivers from YouCam's 1 px edge shift", () => {
    const r = render([], (x, y) => (x === 70 && y > 10 && y < 70 ? [120, 20, 30] : null));
    const { image, nails } = trueColourComposite(hand, r, { targets: [{ hex: CORAL }] });
    expect(nails).toBe(0);
    expect(image.data).toEqual(r.data);
  });

  it("gives each nail its own finger's colour by the nearest fingertip, even when colours are close", () => {
    // Two dark greens, rendered the wrong way round (a nearest-colour match would swap them).
    const r = render([
      { cx: 30, cy: 40, rgb: [32, 52, 40] },
      { cx: 90, cy: 40, rgb: [26, 42, 32] },
    ]);
    const targets: NailTarget[] = [
      { hex: "#1B2D21", tip: { x: 30 / W, y: 30 / H } },
      { hex: "#3F5648", tip: { x: 90 / W, y: 30 / H } },
    ];
    const { image } = trueColourComposite(hand, r, { targets });
    expect(deltaE(labOf(patch(image, 26, 40)), labOf(hexToRgb("#1B2D21")))).toBeLessThan(0.03);
    expect(deltaE(labOf(patch(image, 86, 40)), labOf(hexToRgb("#3F5648")))).toBeLessThan(0.03);
  });

  it("refuses mismatched sizes", () => {
    expect(() => trueColourComposite(hand, raster(handPx, W + 1, H), { targets: [{ hex: CORAL }] })).toThrow();
  });
});

describe("compositeTargets", () => {
  const landmarks = Array.from({ length: 21 }, (_, i) => ({ x: i / 100, y: i / 50, z: 0 }));

  it("maps each finger to its colour and MediaPipe fingertip", () => {
    const targets = compositeTargets(solidSpec("#F0645A", "metallic"), landmarks)!;
    expect(targets).toHaveLength(5);
    expect(targets[0]).toEqual({ hex: "#F0645A", tip: { x: 0.04, y: 0.08 } }); // thumb tip = landmark 4
    expect(targets[4].tip).toEqual({ x: 0.2, y: 0.4 }); // pinky tip = landmark 20
  });

  it("works without landmarks (colour matching instead)", () => {
    expect(compositeTargets(solidSpec("#F0645A"), null)!.every((t) => !t.tip)).toBe(true);
  });

  it("skips specs with design fingers", () => {
    const spec = solidSpec("#F0645A");
    const withDesign = designSpecSchema.parse({
      ...spec,
      fingers: { ...spec.fingers, ring: { ...spec.fingers.ring, kind: "design", designImageId: "3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f" } },
    });
    expect(compositeTargets(withDesign, landmarks)).toBeNull();
  });
});

describe("finishRender", () => {
  const png = (r: Raster) =>
    sharp(Buffer.from(r.data), { raw: { width: r.width, height: r.height, channels: 3 } }).png().toBuffer();
  const decode = async (bytes: Uint8Array): Promise<Raster> => ({
    width: W, height: H, data: new Uint8Array(await sharp(bytes).removeAlpha().raw().toBuffer()),
  });

  it("returns a JPEG of the composite", async () => {
    const out = await finishRender(await png(hand), await png(render([{ cx: 40, cy: 40, rgb: DRIFTED_RED }])), {
      targets: [{ hex: CORAL }],
    });
    expect(out).toMatchObject({ ok: true, nails: 1, recoloured: 1 });
    if (out.ok) {
      expect((await sharp(out.bytes).metadata()).format).toBe("jpeg");
      expect(deltaE(labOf(patch(await decode(out.bytes), 36, 40)), labOf(hexToRgb(CORAL)))).toBeLessThan(0.04);
    }
  });

  it("finishes design renders too, without recolouring them", async () => {
    const r = render([{ cx: 40, cy: 40, rgb: DRIFTED_RED }]);
    const out = await finishRender(await png(hand), await png(r), { targets: null });
    expect(out).toMatchObject({ ok: true, nails: 1, recoloured: 0 });
    // YouCam's colour stays (the red is not pulled towards anything).
    if (out.ok) expect(deltaE(labOf(patch(await decode(out.bytes), 36, 40)), labOf(DRIFTED_RED))).toBeLessThan(0.04);
  });

  it("keeps YouCam's image when nothing was painted (the mock returns the hand photo)", async () => {
    const bytes = await png(hand);
    expect(await finishRender(bytes, bytes, { targets: [{ hex: CORAL }] })).toEqual({ ok: false, reason: "no_nails_found" });
    expect(await finishRender(bytes, bytes, { targets: null })).toEqual({ ok: false, reason: "no_nails_found" });
  });

  it("refuses a render with a different shape", async () => {
    const out = await finishRender(await png(hand), await png(raster(handPx, H, W)), { targets: [{ hex: CORAL }] });
    expect(out).toEqual({ ok: false, reason: "aspect_mismatch" });
  });
});
