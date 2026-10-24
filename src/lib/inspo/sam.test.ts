import { describe, expect, it } from "vitest";
import { toLabImage } from "./oklab";
import { prepareImage, regionFromMask } from "./region";
import { SAM_SIDE, chooseSamMask, samMasks, samPixels, samPoint, samSize } from "./sam";
import { inEllipse, scene } from "./synthetic.test-helpers";

const area = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);

describe("samPixels", () => {
  it("normalises per channel and pads right and bottom with zeros", () => {
    const rgba = new Uint8ClampedArray([255, 0, 124, 255, 0, 0, 0, 255]); // 2×1
    const t = samPixels(rgba, 2, 1);
    const plane = SAM_SIDE * SAM_SIDE;
    expect(t.length).toBe(3 * plane);
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
    expect(t[plane]).toBeCloseTo((0 - 0.456) / 0.224, 4);
    expect(t[2 * plane]).toBeCloseTo((124 / 255 - 0.406) / 0.225, 4);
    expect(t[2]).toBe(0); // padding
    expect(t[SAM_SIDE]).toBe(0);
  });

  it("sizes the input to a 1024 long side", () => {
    expect(samSize(736, 1104)).toEqual({ width: 683, height: 1024 });
    expect(() => samPixels(new Uint8ClampedArray(4), 2000, 1)).toThrow();
  });
});

describe("samMasks / samPoint", () => {
  it("maps the 256² logits over the padded input onto the working image", () => {
    // Working 200×100 drawn into SAM at 1024×512: one working pixel = 5.12 SAM px = 1.28 mask cells.
    const logits = new Float32Array(3 * 256 * 256).fill(-1);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) logits[y * 256 + x] = 5; // guess 0: top-left 256² of 1024²
    const [m0, m1] = samMasks(logits, 1024, 200, 100);
    expect(m0.length).toBe(200 * 100);
    expect(m0[10 * 200 + 10]).toBe(1);
    expect(m0[60 * 200 + 10]).toBe(0);
    expect(area(m0)).toBeGreaterThan(48 * 48);
    expect(area(m0)).toBeLessThan(52 * 52);
    expect(area(m1)).toBe(0);
    expect(samPoint({ x: 10, y: 20 }, 1024, 200)).toEqual([10.5 * 5.12, 20.5 * 5.12]);
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
