import { describe, expect, it } from "vitest";
import { laplacianVariance, lumaStats } from "./pixels";

const image = (width: number, height: number, value: (x: number, y: number) => number) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      data.fill(value(x, y), k, k + 3);
      data[k + 3] = 255;
    }
  return data;
};

describe("lumaStats", () => {
  it("measures mean brightness and blown highlights", () => {
    expect(lumaStats(image(4, 4, () => 100))).toEqual({ meanLuma: 100, clippedFraction: 0 });
    const half = lumaStats(image(4, 4, (x) => (x < 2 ? 0 : 255)));
    expect(half.meanLuma).toBeCloseTo(127.5);
    expect(half.clippedFraction).toBe(0.5);
  });
});

describe("laplacianVariance", () => {
  it("is zero for a flat image and high for fine detail", () => {
    expect(laplacianVariance(image(32, 32, () => 128), 32, 32)).toBe(0);
    const sharp = laplacianVariance(image(32, 32, (x, y) => ((x + y) % 2 ? 200 : 50)), 32, 32);
    const soft = laplacianVariance(image(32, 32, (x) => 50 + x * 4), 32, 32);
    expect(sharp).toBeGreaterThan(1000);
    expect(soft).toBeLessThan(1);
  });
});
