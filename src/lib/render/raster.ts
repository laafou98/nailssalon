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

/** OKLab distance between pixel i of `p` and pixel j (default i) of `q`. */
export const labDist = (p: Float32Array, q: Float32Array, i: number, j = i) =>
  Math.hypot(p[i * 3] - q[j * 3], p[i * 3 + 1] - q[j * 3 + 1], p[i * 3 + 2] - q[j * 3 + 2]);

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

/**
 * Square min or max filter (erode / dilate) of a 0/1 mask, separable. `edge` is the value assumed outside the image.
 * Counts the ones in a sliding window, so the cost doesn't grow with `size`.
 */
export function rankFilter(
  src: Float32Array, w: number, h: number, size: number, pick: (a: number, b: number) => number, edge: number,
): Float32Array {
  const r = size >> 1;
  const span = 2 * r + 1;
  const isMax = pick === Math.max;
  // One line (a row or a column) at a time: `len` values from `at(k)`, written back with `put(k, v)`.
  const outside = edge >= 0.5 ? 1 : 0;
  const line = (len: number, at: (k: number) => number, put: (k: number, v: number) => void) => {
    const one = (k: number) => (k < 0 || k >= len ? outside : at(k) >= 0.5 ? 1 : 0);
    // The window at k is [k − r, k + r]; start with [−r, r − 1] and slide.
    let ones = 0;
    for (let k = -r; k < r; k++) ones += one(k);
    for (let k = 0; k < len; k++) {
      ones += one(k + r);
      if (k > 0) ones -= one(k - r - 1);
      put(k, isMax ? (ones > 0 ? 1 : 0) : ones === span ? 1 : 0);
    }
  };
  const mid = new Float32Array(w * h);
  for (let y = 0; y < h; y++) line(w, (k) => src[y * w + k], (k, v) => (mid[y * w + k] = v));
  const out = new Float32Array(w * h);
  for (let x = 0; x < w; x++) line(h, (k) => mid[k * w + x], (k, v) => (out[k * w + x] = v));
  return out;
}

/**
 * Separable Gaussian blur, clamping to the edge like PIL's GaussianBlur. Rows are filtered with a fast interior loop;
 * the vertical pass adds whole weighted rows, which keeps memory access sequential.
 */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3);
  const kernel = Float32Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;

  const mid = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      if (x >= r && x < w - r) {
        for (let k = 0, j = row + x - r; k <= 2 * r; k++, j++) v += src[j] * kernel[k];
      } else {
        for (let k = -r; k <= r; k++) v += src[row + Math.min(w - 1, Math.max(0, x + k))] * kernel[k + r];
      }
      mid[row + x] = v;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let k = -r; k <= r; k++) {
      const from = Math.min(h - 1, Math.max(0, y + k)) * w, wk = kernel[k + r];
      for (let x = 0; x < w; x++) out[row + x] += mid[from + x] * wk;
    }
  }
  return out;
}

/**
 * A wide Gaussian blur (σ of several pixels) for smooth fields: computed on a grid shrunk by a whole factor (block
 * means), blurred there and scaled back up bilinearly. Close to `gaussianBlur` for wide σ at a fraction of the cost;
 * small σ goes straight to it.
 */
export function wideBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const f = Math.floor(sigma / 3);
  if (f < 2) return gaussianBlur(src, w, h, sigma);
  const sw = Math.ceil(w / f), sh = Math.ceil(h / f);
  const small = new Float32Array(sw * sh), count = new Float32Array(sw * sh);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / f) * sw;
    for (let x = 0; x < w; x++) {
      const j = sy + Math.floor(x / f);
      small[j] += src[y * w + x];
      count[j]++;
    }
  }
  for (let j = 0; j < small.length; j++) small[j] /= count[j];
  // A block mean already blurs by about f/√12; take that off the blur still to do.
  const blurred = gaussianBlur(small, sw, sh, Math.sqrt(Math.max(0.25, sigma * sigma - (f * f) / 12)) / f);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const top = blurred[y0 * sw + x0] * (1 - tx) + blurred[y0 * sw + x1] * tx;
      const bottom = blurred[y1 * sw + x0] * (1 - tx) + blurred[y1 * sw + x1] * tx;
      out[y * w + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
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

// --- paint mask ---

/** OKLab change between photo and render that surely is paint; the mask then grows into weaker change nearby. */
export const PAINT_STRONG = 0.08;
const PAINT_WEAK = 0.015;
const PAINT_WEAK_MAX = 0.06;
const GROW_STEPS = 4;
/** OKLab distance within which a pixel is the same coat of paint as a surely painted one (shading included). */
const PAINT_SAME = 0.05;
/** Smallest patch of sure paint (fraction of the image) that may seed that flood: a nail's core, not an edge speck. */
const SEED_FRACTION = 0.0002;
/** How far (pixels) YouCam's render may sit off the photo. */
const SHIFT_TOLERANCE = 2;
/** Closing size: fills bays where a dark press-on tip happens to match a dark background. */
const CLOSE_SIZE = 9;
/** Opening size: drops streaks narrower than this (pixels); nails are many times wider. */
const OPEN_SIZE = 7;

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/**
 * Where YouCam painted, shared by the post-passes: strong change, opened (drops 1 px slivers from a resized render),
 * grown into weaker change nearby (polish close to the bare nail's colour, like pink over a pink nail), closed and
 * with holes filled. Away from the nails YouCam's render is the photo, pixel for pixel.
 */
/**
 * Whether some photo pixel within SHIFT_TOLERANCE of pixel i looks like the render's pixel i. YouCam's render can sit
 * a pixel or two off the photo; along a soft edge (finger against background) that reads as a band of strong change
 * that is no paint at all. Real paint has no match nearby.
 */
function nearbyMatch(handLab: Float32Array, youcamLab: Float32Array, i: number, w: number, h: number): boolean {
  const x = i % w, y = (i - x) / w, r = SHIFT_TOLERANCE;
  for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
    for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++)
      if (labDist(handLab, youcamLab, yy * w + xx, i) <= PAINT_STRONG) return true;
  return false;
}

export function paintMask(handLab: Float32Array, youcamLab: Float32Array, w: number, h: number): { mask: Float32Array; delta: Float32Array; weak: number } {
  const n = w * h;
  const delta = new Float32Array(n);
  let mask: Float32Array = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    delta[i] = labDist(handLab, youcamLab, i);
    mask[i] = delta[i] > PAINT_STRONG && !nearbyMatch(handLab, youcamLab, i, w, h) ? 1 : 0;
  }
  // YouCam usually returns the photo's own pixels around the nails; when it resampled the photo, every edge in it
  // differs a little, and growing into weak change would leak onto the skin. Raise the bar to that floor.
  const sample: number[] = [];
  for (let i = 0; i < n; i += 13) sample.push(delta[i]);
  sample.sort((a, b) => a - b);
  const weak = Math.min(PAINT_WEAK_MAX, Math.max(PAINT_WEAK, 2 * quantile(sample, 0.95)));
  mask = rankFilter(rankFilter(mask, w, h, 5, Math.min, 1), w, h, 5, Math.max, 0);
  const sure = new Float32Array(mask);
  for (let step = 0; step < GROW_STEPS; step++) {
    const next = new Float32Array(mask);
    for (let i = 0; i < n; i++) {
      if (mask[i] || delta[i] <= weak) continue;
      const x = i % w;
      if ((i >= w && mask[i - w]) || (i < n - w && mask[i + w]) || (x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1])) next[i] = 1;
    }
    mask = next;
  }
  // Then follow YouCam's paint further, however far, through pixels of the same paint colour as the surely painted
  // pixel the flood came from: a press-on over a natural nail of nearly the same colour changed that stretch only
  // weakly. Matching the paint (not just the neighbour) keeps it off edges a resampled render shifted slightly.
  const seed = new Int32Array(n).fill(-1);
  const queue: number[] = [];
  // Only nail-sized patches seed it: a resampled render leaves small specks of strong change on sharp edges.
  const { labels: patches, count: patchCount } = components(sure, w, h);
  const patchSize = new Int32Array(patchCount + 1);
  for (let i = 0; i < n; i++) patchSize[patches[i]]++;
  for (let i = 0; i < n; i++) if (patches[i] && patchSize[patches[i]] >= n * SEED_FRACTION) { seed[i] = i; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % w;
    for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
      // The paint match guards against shifted edges here, so the base threshold applies, not the resampling one.
      if (j < 0 || j >= n || seed[j] >= 0 || delta[j] <= PAINT_WEAK || labDist(youcamLab, youcamLab, j, seed[i]) > PAINT_SAME) continue;
      seed[j] = seed[i];
      mask[j] = 1;
      queue.push(j);
    }
  }
  mask = rankFilter(rankFilter(mask, w, h, CLOSE_SIZE, Math.max, 0), w, h, CLOSE_SIZE, Math.min, 1);
  // Then open it: when YouCam resampled the photo (a 1058 px photo came back 1056 px, Nov 2) every edge in the render
  // differs a little, and the flood can follow a finger's outline out of the nail as a streak a few pixels wide,
  // which the composite then painted navy. A nail survives an opening this small with its corners barely rounded.
  mask = rankFilter(rankFilter(mask, w, h, OPEN_SIZE, Math.min, 1), w, h, OPEN_SIZE, Math.max, 0);
  // Fill holes: unpainted islands inside a nail (art that happens to match the photo) are still nail.
  const inverse = new Float32Array(n);
  for (let i = 0; i < n; i++) inverse[i] = 1 - mask[i];
  const { labels, count } = components(inverse, w, h);
  const border = new Uint8Array(count + 1);
  for (let x = 0; x < w; x++) border[labels[x]] = border[labels[n - w + x]] = 1;
  for (let y = 0; y < h; y++) border[labels[y * w]] = border[labels[y * w + w - 1]] = 1;
  for (let i = 0; i < n; i++) if (labels[i] && !border[labels[i]]) mask[i] = 1;
  return { mask, delta, weak };
}
