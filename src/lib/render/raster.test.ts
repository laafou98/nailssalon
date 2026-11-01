import { describe, expect, it } from "vitest";
import { gaussianBlur, paintMask, rankFilter, toLab } from "./raster";

// Straightforward reference versions: the fast ones must give the same numbers.
function naiveRank(src: Float32Array, w: number, h: number, size: number, pick: (a: number, b: number) => number, edge: number) {
  const r = size >> 1;
  const pass = (input: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = input[y * w + x];
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
          v = pick(v, xx < 0 || yy < 0 || xx >= w || yy >= h ? edge : input[yy * w + xx]);
        }
        out[y * w + x] = v;
      }
    return out;
  };
  return pass(pass(src, true), false);
}

function naiveBlur(src: Float32Array, w: number, h: number, sigma: number) {
  const r = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const pass = (input: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k));
          v += (input[yy * w + xx] * kernel[k + r]) / sum;
        }
        out[y * w + x] = v;
      }
    return out;
  };
  return pass(pass(src, true), false);
}

function random(seed: number) {
  let a = seed;
  return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
}

describe("rankFilter", () => {
  it("matches a plain min/max filter on 0/1 masks, edges included", () => {
    const next = random(7);
    for (const [w, h] of [[37, 23], [5, 40], [3, 3]]) {
      const mask = Float32Array.from({ length: w * h }, () => (next() < 0.4 ? 1 : 0));
      for (const size of [1, 3, 5, 9])
        for (const pick of [Math.min, Math.max])
          for (const edge of [0, 1]) expect(rankFilter(mask, w, h, size, pick, edge)).toEqual(naiveRank(mask, w, h, size, pick, edge));
    }
  });
});

describe("gaussianBlur", () => {
  it("matches a plain separable blur with edge clamping", () => {
    const next = random(3);
    for (const [w, h] of [[41, 29], [6, 50]]) {
      const src = Float32Array.from({ length: w * h }, () => next() * 255);
      for (const sigma of [0.6, 1.5, 4]) {
        const fast = gaussianBlur(src, w, h, sigma), slow = naiveBlur(src, w, h, sigma);
        for (let i = 0; i < src.length; i++) expect(fast[i]).toBeCloseTo(slow[i], 2);
      }
    }
  });
});

describe("paintMask", () => {
  const W = 120, H = 120;
  type RGB = [number, number, number];
  const raster = (paint: (x: number, y: number) => RGB) => {
    const data = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(paint(x, y), (y * W + x) * 3);
    return toLab(data, W * H);
  };
  const SKIN: RGB = [200, 150, 130], BACK: RGB = [235, 228, 215], BARE: RGB = [225, 170, 170], PINK: RGB = [236, 150, 168];
  const finger = (x: number) => x >= 40 && x < 80;
  // A finger up the middle; its bare nail at the top; a long press-on covering the nail and reaching past it.
  const hand = raster((x, y) => (!finger(x) ? BACK : y >= 20 && y < 45 ? BARE : y < 20 ? BACK : SKIN));
  const coverage = (mask: Float32Array, x0: number, x1: number, y0: number, y1: number) => {
    let on = 0, all = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, all++) on += mask[y * W + x];
    return on / all;
  };

  it("takes in a press-on over a natural nail of nearly its colour, whole", () => {
    const render = raster((x, y) => (finger(x) && y >= 0 && y < 45 ? PINK : !finger(x) ? BACK : SKIN));
    const { mask } = paintMask(hand, render, W, H);
    expect(coverage(mask, 44, 76, 2, 18)).toBe(1); // past the nail, over the background
    expect(coverage(mask, 44, 76, 22, 43)).toBe(1); // over the pink natural nail
    expect(coverage(mask, 44, 76, 50, 110)).toBe(0); // the finger below stays skin
  });

  it("ignores edges the render shifted by a pixel or two", () => {
    const shifted = raster((x, y) => (x >= 42 && x < 82 ? (y >= 20 && y < 45 ? BARE : y < 20 ? BACK : SKIN) : BACK));
    const { mask } = paintMask(hand, shifted, W, H);
    expect(coverage(mask, 0, W, 0, H)).toBe(0);
  });
});
