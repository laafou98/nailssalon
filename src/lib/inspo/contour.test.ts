import { describe, expect, it } from "vitest";
import { simplifyPolygon, smoothOutline, smoothPolygon, traceOutline } from "./contour";
import type { Point } from "./region";
import { inEllipse } from "./synthetic.test-helpers";

const shoelace = (p: Point[]) => Math.abs(p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0) / 2);

describe("traceOutline", () => {
  it("walks round a rectangle once, enclosing its area", () => {
    const W = 8, H = 6;
    const mask = new Uint8Array(W * H);
    for (let y = 1; y < 3; y++) for (let x = 1; x < 4; x++) mask[y * W + x] = 1;
    const loop = traceOutline(mask, W, H);
    expect(loop.length).toBe(10); // 3 + 2 + 3 + 2 edges
    expect(shoelace(loop)).toBe(6);
    expect(Math.min(...loop.map((p) => p.x))).toBe(1);
    expect(Math.max(...loop.map((p) => p.x))).toBe(4);
    expect(Math.min(...loop.map((p) => p.y))).toBe(1);
    expect(Math.max(...loop.map((p) => p.y))).toBe(3);
  });

  it("follows an ellipse's outer edge and ignores a smaller blob", () => {
    const W = 80, H = 80;
    const mask = new Uint8Array(W * H);
    let area = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (inEllipse(x, y, 40, 40, 12, 25)) {
          mask[y * W + x] = 1;
          area++;
        }
        if (inEllipse(x, y, 10, 10, 4, 4)) mask[y * W + x] = 1;
      }
    const loop = traceOutline(mask, W, H);
    expect(Math.abs(shoelace(loop) - area)).toBeLessThan(2);
    expect(loop.every((p) => p.x >= 27 && p.x <= 53)).toBe(true);
    const smooth = smoothOutline(mask, W, H);
    expect(smooth.length).toBeLessThan(loop.length * 2);
    expect(Math.abs(shoelace(smooth) - area) / area).toBeLessThan(0.08);
  });

  it("returns nothing for an empty mask", () => {
    expect(traceOutline(new Uint8Array(16), 4, 4)).toEqual([]);
  });
});

describe("smoothPolygon / simplifyPolygon", () => {
  it("rounds corners and thins staircase points", () => {
    const square = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
    const round = smoothPolygon(square, 1);
    expect(round.length).toBe(8);
    expect(round.some((p) => p.x === 0 && p.y === 0)).toBe(false);
    const stairs = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyPolygon(stairs, 3).map((p) => p.x)).toEqual([0, 3, 6, 9]);
  });
});
