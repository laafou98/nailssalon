import { describe, expect, it } from "vitest";
import { kMeans, nailColours } from "./colours";
import { deltaE, hexToOklab, type Lab, toLabImage } from "./oklab";
import { type RGB, inEllipse, noise, scene } from "./synthetic.test-helpers";

const close = (hex: string, target: string, tolerance = 0.04) => deltaE(hexToOklab(hex), hexToOklab(target)) < tolerance;

function measure(paint: (x: number, y: number) => RGB, mask = (x: number, y: number) => inEllipse(x, y, 40, 40, 20, 34)) {
  const s = scene(80, 80, (x, y) => {
    const [r, g, b] = paint(x, y);
    const n = noise(x, y) * 3;
    return [r + n, g + n, b + n];
  });
  const m = new Uint8Array(80 * 80);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) m[y * 80 + x] = mask(x, y) ? 1 : 0;
  return nailColours(toLabImage(s.rgba, 80, 80), m)!;
}

describe("nailColours", () => {
  it("finds a dark green base with a white line accent", () => {
    const c = measure((x, y) => (Math.abs(y - 30 - (x - 40) / 3) <= 2.5 ? [232, 230, 224] : [30, 75, 52]));
    expect(close(c.base.hex, "#1E4B34")).toBe(true);
    expect(c.accents).toHaveLength(1);
    expect(close(c.accents[0].hex, "#E8E6E0", 0.05)).toBe(true);
    expect(c.separation).toBeGreaterThan(3);
  });

  it("treats gloss shading as one colour", () => {
    // Lightness ramps across the nail (one side in shadow), the hue doesn't change.
    const c = measure((x) => {
      const k = 0.75 + (x - 20) / 80;
      return [176 * k, 18 * k, 58 * k];
    });
    expect(c.accents).toHaveLength(0);
  });

  it("ignores glare and the skin the outline caught at its edge", () => {
    const skin: RGB = [224, 184, 160];
    const c = measure(
      (x, y) => (inEllipse(x, y, 34, 30, 3, 4) ? [255, 255, 255] : inEllipse(x, y, 40, 40, 17, 31) ? [176, 18, 58] : skin),
      (x, y) => inEllipse(x, y, 40, 40, 20, 34), // outline 3 px too big
    );
    expect(close(c.base.hex, "#B0123A")).toBe(true);
    expect(c.accents).toHaveLength(0);
  });

  it("measures on a higher-resolution copy when given a scale", () => {
    const s = scene(40, 40, () => [30, 75, 52]);
    const mask = new Uint8Array(20 * 20).fill(1);
    const c = nailColours(toLabImage(s.rgba, 40, 40), mask, 2)!;
    expect(c.pixelCount).toBeGreaterThan(1000);
    expect(close(c.base.hex, "#1E4B34", 0.01)).toBe(true);
  });
});

describe("kMeans", () => {
  it("is deterministic and separates distinct colours", () => {
    const pixels: Lab[] = [];
    for (let i = 0; i < 200; i++) pixels.push(hexToOklab(i % 4 === 0 ? "#FFFFFF" : "#1E4B34"));
    const a = kMeans(pixels, 2);
    const b = kMeans(pixels, 2);
    expect(a.centres).toEqual(b.centres);
    expect(new Set(a.labels).size).toBe(2);
  });
});
