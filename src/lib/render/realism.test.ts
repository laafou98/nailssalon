import { describe, expect, it } from "vitest";
import { inEllipse, noise } from "@/lib/inspo/synthetic.test-helpers";
import { deltaE, rgbToOklab } from "@/lib/inspo/oklab";
import { type FingerAxis, fingerAxes, realismPass } from "./realism";
import { type Raster } from "./raster";

type RGB = [number, number, number];
const W = 120, H = 100;
const SKIN: RGB = [214, 170, 140];
const NAIL = { cx: 60, cy: 40, rx: 10, ry: 14 };
const BROWN: RGB = [90, 60, 55];
const RED: RGB = [150, 20, 40];

function raster(paint: (x: number, y: number) => RGB): Raster {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) data.set(paint(x, y).map((v) => Math.max(0, Math.min(255, Math.round(v)))), (y * W + x) * 3);
  return { width: W, height: H, data };
}

/** A grainy phone photo of skin, scaled by `light` (1 = well lit). */
const handPx = (light = 1) => (x: number, y: number): RGB => SKIN.map((c) => c * light + noise(x, y) * 10) as RGB;
const inNail = (x: number, y: number) => inEllipse(x, y, NAIL.cx, NAIL.cy, NAIL.rx, NAIL.ry);

/** YouCam-like render: a crisp, noise-free nail with a hard edge, optionally with a white stripe of gloss. */
function render(hand: Raster, nail: (x: number, y: number) => RGB = () => BROWN): Raster {
  return raster((x, y) => (inNail(x, y) ? nail(x, y) : px(hand, x, y)));
}

const px = (r: Raster, x: number, y: number): RGB => [...r.data.subarray((y * r.width + x) * 3, (y * r.width + x) * 3 + 3)] as RGB;
const lab = (rgb: RGB) => rgbToOklab(...rgb);

/** Mean and spread of the red channel over the nail's middle. */
function nailStats(r: Raster) {
  const values: number[] = [];
  for (let y = NAIL.cy - 6; y <= NAIL.cy + 6; y++) for (let x = NAIL.cx - 4; x <= NAIL.cx + 4; x++) values.push(px(r, x, y)[0]);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean, sd };
}

/** Fingers pointing up the image: tip above the last joint. */
const UP: FingerAxis[] = [{ tip: { x: NAIL.cx / W, y: (NAIL.cy - 10) / H }, joint: { x: NAIL.cx / W, y: (NAIL.cy + 30) / H } }];

describe("realismPass", () => {
  const hand = raster(handPx());

  it("adds grain at about the photo's level and keeps YouCam's colour", () => {
    const r = render(hand);
    const { image, nails } = realismPass(hand, r);
    expect(nails).toBe(1);
    expect(nailStats(r).sd).toBe(0);
    const after = nailStats(image);
    expect(after.sd).toBeGreaterThan(2.5);
    expect(after.sd).toBeLessThan(10);
    expect(Math.abs(after.mean - BROWN[0])).toBeLessThan(1.5);
  });

  it("leaves the photo away from the nails byte for byte", () => {
    const r = render(hand);
    const { image } = realismPass(hand, r, { fingers: UP, shadow: 0.25 });
    for (const [x, y] of [[5, 5], [110, 90], [20, 70], [NAIL.cx, NAIL.cy - NAIL.ry - 8]]) expect(px(image, x, y)).toEqual(px(r, x, y));
  });

  it("softens the hard edge: the outline pixels fall between nail and skin", () => {
    const r = render(hand);
    const { image } = realismPass(hand, r);
    const x = NAIL.cx + NAIL.rx - 1; // the nail's last column on rows 1–4 below its centre
    const meanL = (img: Raster, col: number) => {
      let sum = 0;
      for (let y = NAIL.cy + 1; y <= NAIL.cy + 4; y++) sum += lab(px(img, col, y)).L;
      return sum / 4;
    };
    expect(px(r, x, NAIL.cy + 4)).toEqual(BROWN);
    expect(px(r, x + 1, NAIL.cy + 4)).toEqual(px(hand, x + 1, NAIL.cy + 4));
    expect(meanL(image, x)).toBeGreaterThan(lab(BROWN).L + 0.03);
    expect(meanL(image, x + 1)).toBeLessThan(meanL(hand, x + 1) - 0.02);
  });

  it("tones down gloss far brighter than anything in a dim photo, much less in a bright one", () => {
    const stripe = (x: number): boolean => x >= NAIL.cx + 2 && x <= NAIL.cx + 4;
    const glossy = (x: number): RGB => (stripe(x) ? [255, 255, 255] : RED);
    const dim = raster(handPx(0.35));
    const dimOut = realismPass(dim, render(dim, glossy)).image;
    const brightOut = realismPass(hand, render(hand, glossy)).image;
    const stripeL = (r: Raster) => lab(px(r, NAIL.cx + 3, NAIL.cy)).L;
    expect(stripeL(dimOut)).toBeLessThan(0.85);
    expect(stripeL(dimOut)).toBeGreaterThan(lab(RED).L + 0.15); // still a highlight
    expect(stripeL(brightOut)).toBeGreaterThan(0.85);
    expect(stripeL(brightOut)).toBeGreaterThan(stripeL(dimOut) + 0.15);
  });

  it("darkens the skin behind the cuticle edge only, and only with the finger's direction", () => {
    const r = render(hand);
    const below = (img: Raster) => lab(px(img, NAIL.cx, NAIL.cy + NAIL.ry + 1)).L; // cuticle side
    const above = (img: Raster) => lab(px(img, NAIL.cx, NAIL.cy - NAIL.ry - 2)).L; // tip side
    const shaded = realismPass(hand, r, { fingers: UP, shadow: 0.25 });
    const plain = realismPass(hand, r, { shadow: 0.25 });
    expect(shaded.shadowed).toBe(1);
    expect(below(shaded.image)).toBeLessThan(below(plain.image) - 0.03);
    expect(Math.abs(above(shaded.image) - above(plain.image))).toBeLessThan(0.005);
    expect(plain.shadowed).toBe(0);
  });

  it("treats a design nail whose art matches the photo in places as one whole nail", () => {
    // A band across the nail that YouCam happened to paint in the photo's own colours.
    const r = render(hand, (x, y) => (Math.abs(y - NAIL.cy) <= 2 ? px(hand, x, y) : BROWN));
    const { nails, image } = realismPass(hand, r);
    expect(nails).toBe(1);
    expect(nailStats(image).sd).toBeGreaterThan(2.5);
  });

  it("is deterministic", () => {
    const r = render(hand);
    expect(realismPass(hand, r, { fingers: UP, shadow: 0.2 }).image.data).toEqual(realismPass(hand, r, { fingers: UP, shadow: 0.2 }).image.data);
  });

  it("leaves the render alone when it isn't the photo plus nails", () => {
    expect(realismPass(hand, hand)).toMatchObject({ nails: 0, image: hand });
    const other = raster(() => [20, 200, 20]);
    expect(realismPass(hand, other)).toMatchObject({ nails: 0, image: other });
  });

  it("keeps the recoloured image's colours when YouCam's own render finds the nails", () => {
    const youcam = render(hand);
    const recoloured = render(hand, () => [240, 100, 90]);
    const { image, nails } = realismPass(hand, recoloured, { youcam });
    expect(nails).toBe(1);
    expect(deltaE(lab(px(image, NAIL.cx, NAIL.cy)), lab([240, 100, 90]))).toBeLessThan(0.05);
  });

  it("refuses mismatched sizes", () => {
    const small = { width: W - 1, height: H, data: new Uint8Array((W - 1) * H * 3) };
    expect(() => realismPass(hand, small)).toThrow();
  });
});

describe("fingerAxes", () => {
  it("pairs each fingertip with its last joint", () => {
    const landmarks = Array.from({ length: 21 }, (_, i) => ({ x: i / 100, y: i / 50, z: 0 }));
    const axes = fingerAxes(landmarks)!;
    expect(axes).toHaveLength(5);
    expect(axes[0]).toEqual({ tip: { x: 0.04, y: 0.08 }, joint: { x: 0.03, y: 0.06 } }); // thumb 4 and 3
    expect(axes[4]).toEqual({ tip: { x: 0.2, y: 0.4 }, joint: { x: 0.19, y: 0.38 } }); // pinky 20 and 19
  });

  it("is undefined without a full set of landmarks", () => {
    expect(fingerAxes(null)).toBeUndefined();
    expect(fingerAxes([{ x: 0, y: 0 }])).toBeUndefined();
  });
});
