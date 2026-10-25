// Pixel helpers shared by the render post-passes (composite.ts, realism.ts): plain arrays, no I/O.

import { rgbToOklab } from "@/lib/inspo/oklab";

export interface Raster {
  width: number;
  height: number;
  /** RGB, 3 bytes per pixel, row-major. */
  data: Uint8Array;
}

// --- colour ---

export function toLab(rgb: Uint8Array, n: number): Float32Array {
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const { L, a, b } = rgbToOklab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    lab[i * 3] = L;
    lab[i * 3 + 1] = a;
    lab[i * 3 + 2] = b;
  }
  return lab;
}

export const labDist = (p: Float32Array, q: Float32Array, i: number) =>
  Math.hypot(p[i * 3] - q[i * 3], p[i * 3 + 1] - q[i * 3 + 1], p[i * 3 + 2] - q[i * 3 + 2]);

/** OKLab → linear sRGB, unclipped (oklab.ts only offers clipped bytes). */
export function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function linearToSrgb(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

export const clampByte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

// --- masks ---

/** Square min or max filter (erode / dilate), separable. `edge` is the value assumed outside the image. */
export function rankFilter(
  src: Float32Array, w: number, h: number, size: number, pick: (a: number, b: number) => number, edge: number,
): Float32Array {
  const r = size >> 1;
  const pass = (input: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = input[y * w + x];
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
          v = pick(v, xx < 0 || yy < 0 || xx >= w || yy >= h ? edge : input[yy * w + xx]);
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3);
  const kernel = Float32Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  const pass = (input: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -r; k <= r; k++) {
          // Clamp to the edge, like PIL's GaussianBlur.
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k));
          v += input[yy * w + xx] * kernel[k + r];
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

/** 4-connected components of a 0/1 mask; labels start at 1, 0 = background. */
export function components(mask: Float32Array, w: number, h: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h);
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < w * h; start++) {
    if (mask[start] < 0.5 || labels[start]) continue;
    labels[start] = ++count;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
        if (j >= 0 && j < w * h && mask[j] >= 0.5 && !labels[j]) {
          labels[j] = count;
          stack.push(j);
        }
      }
    }
  }
  return { labels, count };
}

/** Spreads labels into unlabelled neighbours `steps` times, so the soft fringe knows its nail. */
export function growLabels(labels: Int32Array, w: number, h: number, steps: number): Int32Array {
  let cur = labels;
  for (let s = 0; s < steps; s++) {
    const next = new Int32Array(cur);
    for (let i = 0; i < w * h; i++) {
      if (cur[i]) continue;
      const x = i % w;
      for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
        if (j >= 0 && j < w * h && cur[j]) {
          next[i] = cur[j];
          break;
        }
      }
    }
    cur = next;
  }
  return cur;
}
