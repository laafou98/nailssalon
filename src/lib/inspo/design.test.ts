import { describe, expect, it } from "vitest";
import {
  DESIGN_LIMITS, MIN_SHARPNESS, NATURAL_ASPECT, TIP_SHAPES, artWindow, cutoutDetail, cutoutSharpness, designSize, nailDesign, removeGlare, silhouetteHalfWidth, tipDirection,
} from "./design";
import { toLabImage } from "./oklab";
import { type NailRegion, nailRegion, prepareImage, separateTouching } from "./region";
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

  it("cuts press-ons to a clean silhouette on a transparent background", () => {
    const out = nailDesign(src, 1, region, 120, "#1E5A3C", { silhouette: "almond" });
    const alpha = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3];
    expect(alpha(0, 0)).toBe(0); // tip corner
    expect(alpha(out.width >> 1, out.height >> 1)).toBe(255);
    expect(alpha(out.width >> 1, 2)).toBeGreaterThan(0); // the almond point itself
    expect(alpha(0, out.height - 1)).toBe(0); // rounded cuticle corner
  });

  it("reads the art from the nail's body instead of padding it with the fill colour", () => {
    const out = nailDesign(src, 1, region, 120, "#FF00FF");
    // Mid-nail, the outermost columns are nail green, not the magenta fill.
    for (const x of [0, 1, out.width - 2, out.width - 1]) {
      const [r, g] = at(out, x, out.height >> 1);
      expect(g).toBeGreaterThan(r);
    }
  });

  it("reads from a higher-resolution copy of the photo", () => {
    const big = scene(240, 240, (x, y) => [s.rgba[((y >> 1) * 120 + (x >> 1)) * 4], s.rgba[((y >> 1) * 120 + (x >> 1)) * 4 + 1], s.rgba[((y >> 1) * 120 + (x >> 1)) * 4 + 2]]);
    const out = nailDesign({ data: big.rgba, width: 240, height: 240 }, 2, region, 120, "#1E5A3C");
    expect(at(out, out.width >> 1, Math.round(out.height * 0.75))).toEqual([30, 90, 60]);
  });
});

describe("silhouetteHalfWidth", () => {
  it("is full width mid-nail, rounded at the cuticle and shaped at the tip", () => {
    for (const tip of TIP_SHAPES) {
      expect(silhouetteHalfWidth(tip, 0.7)).toBe(1);
      expect(silhouetteHalfWidth(tip, 1)).toBeCloseTo(0);
    }
    // Pointier shapes are narrower near the tip.
    const at = (tip: (typeof TIP_SHAPES)[number]) => silhouetteHalfWidth(tip, 0.1);
    expect(at("stiletto")).toBeLessThan(at("almond"));
    expect(at("almond")).toBeLessThan(at("oval"));
    expect(at("oval")).toBeLessThan(at("square"));
  });
});

describe("cutoutDetail", () => {
  const region = (width: number, length: number, fill = 0.78, convexity = 0.95) =>
    ({ box: { cx: 0, cy: 0, angle: 0, width, length }, fill, convexity }) as NailRegion;
  // Dark lines on a pale nail: fine and crisp (every 12 px), or a few blurred into soft ramps.
  const art = (blur: number) => {
    const period = blur ? 260 : 12;
    const sc = scene(300, 600, (x) => {
      const d = Math.abs((x % period) - period / 2);
      const v = blur ? 200 - 120 * Math.max(0, 1 - d / blur) : d < 2 ? 80 : 200;
      return [v, v, v];
    });
    return { data: sc.rgba, width: 300, height: 600 };
  };

  it("accepts a face-on nail with crisp art", () => {
    expect(cutoutDetail(region(40, 80), art(0))).toMatchObject({ ok: true });
  });

  it("rejects art blown up into a blur", () => {
    expect(cutoutDetail(region(40, 80), art(120))).toMatchObject({ ok: false, reason: "blurry" });
    expect(cutoutSharpness(art(120))).toBeLessThan(MIN_SHARPNESS);
  });

  it("rejects a nail seen side-on (a thin sliver)", () => {
    expect(cutoutDetail(region(40, 200), art(0))).toMatchObject({ ok: false, reason: "side_on" });
  });

  it("rejects a partial nail: a mostly empty box or a far-from-convex outline", () => {
    expect(cutoutDetail(region(41, 77, 0.5, 0.73), art(0))).toMatchObject({ ok: false, reason: "partial" });
    expect(cutoutDetail(region(41, 77, 0.8, 0.7), art(0))).toMatchObject({ ok: false, reason: "partial" });
  });
});

describe("removeGlare", () => {
  const W = 300, H = 600;
  const NAIL = [120, 80, 90];
  const image = (white: (x: number, y: number) => boolean) => {
    const sc = scene(W, H, (x, y) => (white(x, y) ? [250, 250, 250] : (NAIL as [number, number, number])));
    return { data: sc.rgba, width: W, height: H };
  };
  const px = (img: { data: Uint8ClampedArray }, x: number, y: number) => Array.from(img.data.slice((y * W + x) * 4, (y * W + x) * 4 + 3));

  it("paints out a lengthwise highlight streak from the surrounding nail", () => {
    const out = removeGlare(image((x, y) => Math.abs(x - 150 - (y - 300) * 0.2) <= 3 && y > 150 && y < 450));
    expect(px(out, 150, 300)).toEqual(NAIL);
  });

  it("keeps crosswise lines, dots and wide white areas: those are art", () => {
    const line = image((x, y) => y >= 300 && y <= 304 && x > 40 && x < 260);
    expect(px(removeGlare(line), 150, 302)).toEqual([250, 250, 250]);
    const dot = image((x, y) => (x - 150) ** 2 + (y - 300) ** 2 <= 64);
    expect(px(removeGlare(dot), 150, 300)).toEqual([250, 250, 250]);
    const tip = image((_, y) => y < 120); // a French tip
    expect(px(removeGlare(tip), 150, 60)).toEqual([250, 250, 250]);
  });
});

describe("separateTouching", () => {
  const W = 120, H = 80;
  const maskOf = (inside: (x: number, y: number) => boolean) => {
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = inside(x, y) ? 1 : 0;
    return m;
  };
  const count = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);

  it("cuts a second nail off an outline that swallowed two touching nails", () => {
    const left = (x: number, y: number) => inEllipse(x, y, 38, 40, 18, 28);
    const right = (x: number, y: number) => inEllipse(x, y, 80, 40, 18, 28);
    const both = maskOf((x, y) => left(x, y) || right(x, y) || (x >= 54 && x <= 64 && Math.abs(y - 40) <= 2));
    const out = separateTouching(both, W, H, { x: 38, y: 40 });
    expect(out[40 * W + 80]).toBe(0);
    expect(count(out)).toBeGreaterThan(0.9 * count(maskOf(left)));
  });

  it("leaves a single nail alone", () => {
    const one = maskOf((x, y) => inEllipse(x, y, 60, 40, 18, 30));
    expect(separateTouching(one, W, H, { x: 60, y: 40 })).toEqual(one);
  });
});
