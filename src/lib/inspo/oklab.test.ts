import { describe, expect, it } from "vitest";
import { deltaE, hexToOklab, oklabToHex, oklabToRgb, rgbToOklab, toLabImage } from "./oklab";

describe("OKLab", () => {
  it("matches the published reference values", () => {
    const white = rgbToOklab(255, 255, 255);
    expect(white.L).toBeCloseTo(1, 3);
    expect(white.a).toBeCloseTo(0, 3);
    expect(white.b).toBeCloseTo(0, 3);
    expect(rgbToOklab(0, 0, 0).L).toBeCloseTo(0, 6);
    const red = rgbToOklab(255, 0, 0);
    expect(red.L).toBeCloseTo(0.628, 3);
    expect(red.a).toBeCloseTo(0.2249, 3);
    expect(red.b).toBeCloseTo(0.1258, 3);
  });

  it("round-trips every channel value through sRGB", () => {
    for (let v = 0; v < 256; v += 5) {
      expect(oklabToRgb(rgbToOklab(v, 255 - v, (v * 7) % 256))).toEqual([v, 255 - v, (v * 7) % 256]);
    }
    expect(oklabToHex(hexToOklab("#B0123A"))).toBe("#B0123A");
  });

  it("measures perceptual distance", () => {
    expect(deltaE(hexToOklab("#808080"), hexToOklab("#808080"))).toBe(0);
    // A small hue step is a small distance; black vs white is about 1.
    expect(deltaE(hexToOklab("#B0123A"), hexToOklab("#B5163E"))).toBeLessThan(0.02);
    expect(deltaE(hexToOklab("#000000"), hexToOklab("#FFFFFF"))).toBeCloseTo(1, 2);
  });

  it("converts whole images into channel planes", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    const img = toLabImage(rgba, 2, 1);
    expect(img.L[0]).toBeCloseTo(1, 3);
    expect(img.L[1]).toBeCloseTo(0, 6);
  });
});
