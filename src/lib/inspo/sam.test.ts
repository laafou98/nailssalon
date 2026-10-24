import { describe, expect, it } from "vitest";
import { toLabImage } from "./oklab";
import { prepareImage, regionFromMask } from "./region";
import { SAM_SIDE, chooseSamMask, samMasks, samPixels, samPrompt, samSize } from "./sam";
import { inEllipse, scene } from "./synthetic.test-helpers";

describe("samPixels / samSize", () => {
  it("packs RGBA into height × width × RGB at 0–255", () => {
    const rgba = new Uint8ClampedArray([255, 0, 124, 255, 1, 2, 3, 128]); // 2×1
    expect([...samPixels(rgba, 2, 1)]).toEqual([255, 0, 124, 1, 2, 3]);
    expect(() => samPixels(new Uint8ClampedArray(4), 2000, 1)).toThrow();
  });

  it("sizes the input to a 1024 long side", () => {
    expect(samSize(736, 1104)).toEqual({ width: 683, height: 1024 });
    expect(samSize(2000, 1000)).toEqual({ width: SAM_SIDE, height: 512 });
  });
});

describe("samPrompt / samMasks", () => {
  it("scales the tap to the encoder input and adds SAM's padding point", () => {
    const { coords, labels } = samPrompt({ x: 10, y: 20 }, 1024, 200);
    [10.5 * 5.12, 20.5 * 5.12, 0, 0].forEach((v, i) => expect(coords[i]).toBeCloseTo(v, 4));
    expect([...labels]).toEqual([1, -1]);
  });

  it("splits the decoder's logits into one binary mask per guess", () => {
    const logits = new Float32Array([1, -1, 0, 2, /* guess 2 */ -3, 4, 5, -6]);
    const [a, b] = samMasks(logits, 2, 2, 2);
    expect([...a]).toEqual([1, 0, 0, 1]);
    expect([...b]).toEqual([0, 1, 1, 0]);
  });
});

describe("chooseSamMask", () => {
  const box = (w: number, x0: number, y0: number, x1: number, y1: number) => {
    const m = new Uint8Array(w * w);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
    return m;
  };
  const W = 100;
  const tiny = box(W, 48, 48, 52, 52); // 16 px
  const nail = box(W, 40, 40, 60, 60); // 400 px
  const hand = box(W, 0, 0, 100, 100); // whole image

  it("takes the best-scored guess that contains the tap and is nail-sized", () => {
    expect(chooseSamMask([hand, nail, tiny], [0.99, 0.8, 0.95], { x: 50, y: 50 }, W, W)).toBe(1);
    expect(chooseSamMask([nail, box(W, 42, 42, 58, 58)], [0.7, 0.9], { x: 50, y: 50 }, W, W)).toBe(1);
  });

  it("refuses guesses that miss the tap or exceed the typical nail size", () => {
    expect(chooseSamMask([nail], [0.9], { x: 10, y: 10 }, W, W)).toBeNull();
    expect(chooseSamMask([nail], [0.9], { x: 50, y: 50 }, W, W, { expectedArea: 100 })).toBeNull();
  });
});

describe("regionFromMask", () => {
  it("keeps the tapped piece, drops a strand and fills holes", () => {
    const s = scene(120, 120, (x, y) => (inEllipse(x, y, 60, 60, 15, 28) ? [30, 75, 52] : [224, 184, 160]));
    const prepared = prepareImage(toLabImage(s.rgba, s.width, s.height));
    const outline = new Uint8Array(120 * 120);
    for (let y = 0; y < 120; y++)
      for (let x = 0; x < 120; x++) {
        const p = y * 120 + x;
        if (inEllipse(x, y, 60, 60, 15, 28) && !inEllipse(x, y, 60, 60, 4, 4)) outline[p] = 1; // nail with a glare hole
        if (y === 60 && x > 75) outline[p] = 1; // 1-px strand to the edge
        if (inEllipse(x, y, 15, 15, 6, 6)) outline[p] = 1; // a separate blob
      }
    const r = regionFromMask(prepared, outline, { x: 60, y: 50 });
    expect(r.mask[60 * 120 + 60]).toBe(1); // hole filled
    expect(r.mask[60 * 120 + 100]).toBe(0); // strand cut
    expect(r.mask[15 * 120 + 15]).toBe(0); // other blob dropped
    expect(r.area).toBeGreaterThan(Math.PI * 15 * 28 * 0.9);
    expect(r.edgeContrast).toBeGreaterThan(0.05);
    expect(r.convexity).toBeGreaterThan(0.9);
  });
});
