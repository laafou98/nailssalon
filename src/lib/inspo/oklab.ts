// OKLab colour space (Björn Ottosson, 2020): perceptually even, so Euclidean
// distance ≈ visible colour difference. Pure functions, no browser APIs.

export interface Lab {
  L: number; // 0 (black) – 1 (white)
  a: number; // green (−) – red (+)
  b: number; // blue (−) – yellow (+)
}

/** sRGB byte → linear light, precomputed for all 256 values. */
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const s = i / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});

const toByte = (linear: number) => {
  const c = Math.min(1, Math.max(0, linear));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
};

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = LINEAR[r], lg = LINEAR[g], lb = LINEAR[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Back to sRGB bytes, clipped to the gamut. */
export function oklabToRgb({ L, a, b }: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export const chroma = ({ a, b }: Lab) => Math.hypot(a, b);

export const deltaE = (p: Lab, q: Lab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export const oklabToHex = (lab: Lab) => rgbToHex(...oklabToRgb(lab));

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const hexToOklab = (hex: string): Lab => rgbToOklab(...hexToRgb(hex));

/** A whole image in OKLab, one plane per channel (the layout the region and cluster code expects). */
export interface LabImage {
  width: number;
  height: number;
  L: Float32Array;
  a: Float32Array;
  b: Float32Array;
}

export function toLabImage(rgba: Uint8ClampedArray, width: number, height: number): LabImage {
  const n = width * height;
  const img: LabImage = { width, height, L: new Float32Array(n), a: new Float32Array(n), b: new Float32Array(n) };
  for (let p = 0, k = 0; p < n; p++, k += 4) {
    const c = rgbToOklab(rgba[k], rgba[k + 1], rgba[k + 2]);
    img.L[p] = c.L;
    img.a[p] = c.a;
    img.b[p] = c.b;
  }
  return img;
}

export const labAt = (img: LabImage, p: number): Lab => ({ L: img.L[p], a: img.a[p], b: img.b[p] });
