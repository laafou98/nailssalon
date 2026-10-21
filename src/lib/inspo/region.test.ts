import { describe, expect, it } from "vitest";
import { toLabImage } from "./oklab";
import { fillHoles, hullArea, nailRegion, orientedBox, prepareImage } from "./region";
import { type RGB, inEllipse, noise, scene } from "./synthetic.test-helpers";

const SKIN: RGB = [224, 184, 160];
const GREEN: RGB = [30, 75, 52];
const jitter = ([r, g, b]: RGB, x: number, y: number, amount = 4): RGB => {
  const n = noise(x, y) * amount;
  return [r + n, g + n, b + n];
};

/** A 240×240 photo with one upright nail (radii 18 × 34) in the middle. */
function nailScene(nail: (x: number, y: number) => RGB, background: (x: number, y: number) => RGB = () => SKIN) {
  const s = scene(240, 240, (x, y) => jitter(inEllipse(x, y, 120, 120, 18, 34) ? nail(x, y) : background(x, y), x, y));
  return prepareImage(toLabImage(s.rgba, s.width, s.height));
}
const ELLIPSE_AREA = Math.PI * 18 * 34;

describe("nailRegion", () => {
  it("outlines a plain nail and finds its long axis", () => {
    const r = nailRegion(nailScene(() => GREEN), { x: 120, y: 120 });
    expect(r.area).toBeGreaterThan(ELLIPSE_AREA * 0.85);
    expect(r.area).toBeLessThan(ELLIPSE_AREA * 1.15);
    expect(Math.abs(Math.sin(r.box.angle))).toBeGreaterThan(0.99); // vertical
    expect(r.box.length).toBeGreaterThan(62);
    expect(r.box.width).toBeLessThan(42);
    expect(r.convexity).toBeGreaterThan(0.9);
  });

  it("isn't cut in two by a thin painted line", () => {
    const r = nailRegion(
      nailScene((x, y) => (Math.abs(y - 112) <= 1 ? [245, 245, 240] : GREEN)),
      { x: 120, y: 135 },
    );
    expect(r.area).toBeGreaterThan(ELLIPSE_AREA * 0.85);
  });

  it("merges a white French tip into a nude nail", () => {
    const nude: RGB = [236, 190, 186];
    const r = nailRegion(
      nailScene((_, y) => (y < 102 ? [248, 246, 244] : nude), () => [196, 140, 116]),
      { x: 120, y: 130 },
    );
    expect(r.mergedTip).toBe(true);
    expect(r.area).toBeGreaterThan(ELLIPSE_AREA * 0.85);
    expect(r.box.length).toBeGreaterThan(62);
  });

  it("stays on a dark nail against a dark, similar-coloured background", () => {
    const sweater: RGB = [40, 58, 50];
    const rim = (x: number, y: number) => inEllipse(x, y, 120, 120, 21, 37);
    const s = scene(240, 240, (x, y) =>
      jitter(inEllipse(x, y, 120, 120, 18, 34) ? GREEN : rim(x, y) ? [15, 20, 18] : sweater, x, y, 6),
    );
    const r = nailRegion(prepareImage(toLabImage(s.rgba, 240, 240)), { x: 120, y: 120 });
    expect(r.area).toBeGreaterThan(ELLIPSE_AREA * 0.8);
    expect(r.area).toBeLessThan(ELLIPSE_AREA * 1.3);
  });

  it("never grows past the size cap", () => {
    const flat = scene(240, 240, (x, y) => jitter(SKIN, x, y));
    const r = nailRegion(prepareImage(toLabImage(flat.rgba, 240, 240)), { x: 120, y: 120 }, { expectedArea: 500 });
    expect(r.area).toBeLessThanOrEqual(1100);
  });
});

describe("mask helpers", () => {
  const w = 10;
  const h = 10;
  const ring = new Uint8Array(w * h);
  for (let y = 2; y <= 7; y++) for (let x = 2; x <= 7; x++) ring[y * w + x] = x === 2 || x === 7 || y === 2 || y === 7 ? 1 : 0;

  it("fills enclosed holes", () => {
    const filled = fillHoles(ring, w, h);
    expect(filled.reduce((s, v) => s + v, 0)).toBe(36);
  });

  it("measures convex hulls and oriented boxes", () => {
    const square = fillHoles(ring, w, h);
    expect(hullArea(square, w, h)).toBe(36);
    const box = orientedBox(square, w);
    expect(box.cx).toBeCloseTo(4.5);
    expect(box.cy).toBeCloseTo(4.5);
    expect(box.length * box.width).toBeCloseTo(36);
  });
});
