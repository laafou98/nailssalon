import { describe, expect, it } from "vitest";
import { DESIGN_LIMITS, NATURAL_ASPECT, artWindow, designSize, nailDesign, tipDirection } from "./design";
import { toLabImage } from "./oklab";
import { nailRegion, prepareImage } from "./region";
import { inEllipse, scene } from "./synthetic.test-helpers";

describe("designSize", () => {
  const within = ({ width, height }: { width: number; height: number }) => {
    expect(width).toBeGreaterThanOrEqual(DESIGN_LIMITS.minWidth);
    expect(width).toBeLessThanOrEqual(DESIGN_LIMITS.maxWidth);
    expect(height).toBeGreaterThanOrEqual(DESIGN_LIMITS.minHeight);
    expect(height).toBeLessThanOrEqual(DESIGN_LIMITS.maxHeight);
  };

  it("keeps a nail's proportions inside YouCam's limits", () => {
    const s = designSize(800, 400);
    within(s);
    expect(s.height / s.width).toBeCloseTo(2, 1);
  });

  it("upscales small nails to the minimum and caps very long ones", () => {
    within(designSize(60, 30));
    within(designSize(3000, 300));
    within(designSize(100, 200)); // wider than long: stretched to the minimum height
  });

  it("widens short nails instead of stretching them to the minimum height", () => {
    const s = designSize(130, 100);
    expect(s.height).toBe(DESIGN_LIMITS.minHeight);
    expect(s.height / s.width).toBeCloseTo(1.3, 1);
  });

  it("shrinks for the 1 MB retry", () => {
    expect(designSize(1200, 600, 0.8).width).toBeLessThan(designSize(1200, 600).width);
  });
});

describe("artWindow", () => {
  it("keeps the whole nail for the full fit, or when it is already short", () => {
    expect(artWindow([1, 1, 1], 60, 20, "full")).toEqual({ from: 30, to: -30 });
    expect(artWindow([1, 1, 1], 24, 20, "natural")).toEqual({ from: 12, to: -12 });
  });

  it("slides a short-nail window to where the art is", () => {
    // 60 long, 20 wide → a 26-long window; all the art sits in the cuticle-side quarter.
    const profile = [...Array(36).fill(0), ...Array(12).fill(10)];
    const w = artWindow(profile, 60, 20, "natural");
    expect(w.from - w.to).toBeCloseTo(20 * NATURAL_ASPECT);
    expect(w.to).toBeCloseTo(-30, 0);
  });

  it("stays centred when the art is spread evenly", () => {
    const w = artWindow(Array(48).fill(5), 60, 20, "natural");
    expect(Math.abs((w.from + w.to) / 2)).toBeLessThanOrEqual(60 / 48); // within one bin of the centre
  });
});

describe("tipDirection", () => {
  const regionOf = (paint: (x: number, y: number) => boolean) => {
    const sc = scene(120, 120, (x, y) => (paint(x, y) ? [30, 90, 60] : [224, 184, 160]));
    return nailRegion(prepareImage(toLabImage(sc.rgba, 120, 120)), { x: 60, y: 60 });
  };

  it("points up the photo for a nail with no tapered end", () => {
    const r = regionOf((x, y) => inEllipse(x, y, 60, 60, 14, 30));
    expect(tipDirection(r, 120).y).toBeCloseTo(-1, 1);
    expect(tipDirection(r, 120, true).y).toBeCloseTo(1, 1);
  });

  it("points at the narrow end of an almond nail lying sideways", () => {
    // Wide rounded cuticle on the left, tapering to a point on the right.
    const r = regionOf((x, y) => x >= 28 && x <= 96 && Math.abs(y - 60) <= 16 * Math.min(1, Math.sqrt((96 - x) / 40)) * Math.sqrt(Math.max(0, 1 - ((Math.min(x, 60) - 60) / 32) ** 2)));
    expect(tipDirection(r, 120).x).toBeCloseTo(1, 1);
  });
});

describe("nailDesign", () => {
  // An upright green nail with a thin white line near its top, on skin.
  const s = scene(120, 120, (x, y) =>
    inEllipse(x, y, 60, 60, 14, 30) ? (y >= 42 && y <= 43 ? [240, 240, 240] : [30, 90, 60]) : [224, 184, 160],
  );
  const lab = toLabImage(s.rgba, 120, 120);
  const region = nailRegion(prepareImage(lab), { x: 60, y: 70 });
  const src = { data: s.rgba, width: 120, height: 120 };
  const at = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) =>
    Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

  it("cuts the nail out upright with the art near the tip and no skin", () => {
    const out = nailDesign(src, 1, region, 120, "#1E5A3C");
    expect(out.width).toBeGreaterThanOrEqual(DESIGN_LIMITS.minWidth);
    expect(out.height).toBeGreaterThanOrEqual(DESIGN_LIMITS.minHeight);
    // Find the white band: it should sit in the top half (tip up).
    const whiteRows = [];
    for (let y = 0; y < out.height; y++) if (at(out, out.width >> 1, y)[0] > 200) whiteRows.push(y);
    expect(whiteRows.length).toBeGreaterThan(0);
    expect(Math.max(...whiteRows)).toBeLessThan(out.height / 2);
    // Corners are outside the nail: filled with the base colour, never skin.
    expect(at(out, 0, 0)).toEqual([30, 90, 60]);
    expect(at(out, out.width - 1, out.height - 1)).toEqual([30, 90, 60]);
  });

  it("puts the art at the bottom when flipped", () => {
    const out = nailDesign(src, 1, region, 120, "#1E5A3C", { flipped: true });
    const whiteRows = [];
    for (let y = 0; y < out.height; y++) if (at(out, out.width >> 1, y)[0] > 200) whiteRows.push(y);
    expect(Math.min(...whiteRows)).toBeGreaterThan(out.height / 2);
  });

  it("cuts natural-length art at short-nail proportions", () => {
    const out = nailDesign(src, 1, region, 120, "#1E5A3C", { fit: "natural" });
    expect(out.height / out.width).toBeCloseTo(NATURAL_ASPECT, 1);
    // The window follows the white line near the tip.
    let white = 0;
    for (let y = 0; y < out.height; y++) if (at(out, out.width >> 1, y)[0] > 200) white++;
    expect(white).toBeGreaterThan(0);
  });

  it("leaves outside the outline see-through for press-ons", () => {
    const out = nailDesign(src, 1, region, 120, "#1E5A3C", { transparent: true });
    expect(out.data[3]).toBe(0);
    const mid = ((out.height >> 1) * out.width + (out.width >> 1)) * 4;
    expect(out.data[mid + 3]).toBe(255);
  });

  it("reads from a higher-resolution copy of the photo", () => {
    const big = scene(240, 240, (x, y) => [s.rgba[((y >> 1) * 120 + (x >> 1)) * 4], s.rgba[((y >> 1) * 120 + (x >> 1)) * 4 + 1], s.rgba[((y >> 1) * 120 + (x >> 1)) * 4 + 2]]);
    const out = nailDesign({ data: big.rgba, width: 240, height: 240 }, 2, region, 120, "#1E5A3C");
    expect(at(out, out.width >> 1, Math.round(out.height * 0.75))).toEqual([30, 90, 60]);
  });
});
