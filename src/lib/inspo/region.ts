// Nail outline from a single tap on an inspiration photo. Pure functions over a
// LabImage, so they run the same in the browser and in tests.
//
// How it works: a geodesic flood from the tap. Every pixel gets the cheapest
// "path cost" from the tap, where stepping between neighbours costs their
// colour difference (plus a little for distance, and extra for straying far
// from the tapped colour). Pixels join the region in order of cost, so it
// spreads freely over smooth polish and slowly across edges. At every size we
// know the mean edge contrast along the region's border; the nail is the size
// where that border sits on a strong edge and the shape is convex. Then holes
// are filled (lines, gems), thin leaks are cut and a white French tip is merged.
//
// The flood runs on a "structure" image: painted lines are filtered out (so a
// swirl doesn't cut a nail in two) and lightness counts less than hue, because
// gloss makes a nail's lightness vary a lot while what separates a dark green
// nail from a dark green sweater, or a nude nail from skin, is mostly hue.

import { chroma, type Lab, type LabImage } from "./oklab";

export interface Point {
  x: number;
  y: number;
}

export interface OrientedBox {
  cx: number;
  cy: number;
  /** Direction of the long axis in radians (image axes, y down). */
  angle: number;
  /** Extent along the long axis, pixels. */
  length: number;
  /** Extent across it, pixels. */
  width: number;
}

export interface NailRegion {
  /** 1 = nail, per pixel of the working image. */
  mask: Uint8Array;
  area: number;
  box: OrientedBox;
  /** Mean OKLab step across the outline: how clearly the nail stands out. */
  edgeContrast: number;
  /** Area / convex hull area of the chosen flood: 1 for a clean convex nail. */
  convexity: number;
  /** Area / area of the oriented box: about π/4 (0.79) for an ellipse. */
  fill: number;
  /** Whether a white tip next to the nail was merged in. */
  mergedTip: boolean;
}

export interface RegionOptions {
  /** Largest plausible nail, as a fraction of the image. */
  maxAreaFraction?: number;
  /** Smallest plausible nail, pixels. */
  minArea?: number;
  /**
   * Typical nail area in this photo (e.g. the median of the other picks):
   * caps the size at twice that, since nails in one photo are alike.
   */
  expectedArea?: number;
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The three versions of an inspiration photo the picker works on (computed once per photo). */
export interface PreparedImage {
  /** Plain OKLab: colours are measured here, so thin lines keep their true colour. */
  raw: LabImage;
  /** Lightly blurred OKLab: for colour tests that shouldn't trip on JPEG noise. */
  smooth: LabImage;
  /** Thin lines removed, lightness down-weighted: what the flood walks on. */
  structure: LabImage;
}

const L_WEIGHT = 0.5;
const AB_WEIGHT = 2;

export function prepareImage(raw: LabImage): PreparedImage {
  const smooth = smoothLab(raw);
  // Lines are removed before blurring: a blurred line is wider than the filter and survives it.
  const s = smoothLab(suppressThinLines(raw));
  return {
    raw,
    smooth,
    structure: {
      width: s.width,
      height: s.height,
      L: s.L.map((v) => v * L_WEIGHT),
      a: s.a.map((v) => v * AB_WEIGHT),
      b: s.b.map((v) => v * AB_WEIGHT),
    },
  };
}

/** 5-tap binomial blur per channel: removes JPEG noise and gem sparkle before measuring edges. */
export function smoothLab(img: LabImage): LabImage {
  const { width: w, height: h } = img;
  const blur = (src: Float32Array) => {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    const k = [1, 4, 6, 4, 1];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = -2; i <= 2; i++) s += k[i + 2] * src[y * w + Math.min(w - 1, Math.max(0, x + i))];
        tmp[y * w + x] = s / 16;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = -2; i <= 2; i++) s += k[i + 2] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
        out[y * w + x] = s / 16;
      }
    return out;
  };
  return { width: w, height: h, L: blur(img.L), a: blur(img.a), b: blur(img.b) };
}

/** Separable min or max filter over a (2r+1)² square. */
function rankFilter(src: Float32Array, w: number, h: number, r: number, max: boolean): Float32Array {
  const pick = max ? Math.max : Math.min;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = src[y * w + x];
      for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) v = pick(v, src[y * w + i]);
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let i = Math.max(0, y - r); i <= Math.min(h - 1, y + r); i++) v = pick(v, tmp[i * w + x]);
      out[y * w + x] = v;
    }
  return out;
}

/**
 * Removes structures thinner than about 2r+1 px (painted lines, gems, glints)
 * while keeping the edges of wide areas: a grey-level opening then closing per
 * channel. The flood runs on this, so a white swirl doesn't cut a nail in two.
 */
export function suppressThinLines(img: LabImage, r = 2): LabImage {
  const { width: w, height: h } = img;
  const openClose = (c: Float32Array) => {
    const opened = rankFilter(rankFilter(c, w, h, r, false), w, h, r, true);
    return rankFilter(rankFilter(opened, w, h, r, true), w, h, r, false);
  };
  return { width: w, height: h, L: openClose(img.L), a: openClose(img.a), b: openClose(img.b) };
}

const step = (img: LabImage, p: number, q: number) =>
  Math.hypot(img.L[p] - img.L[q], img.a[p] - img.a[q], img.b[p] - img.b[q]);

/** Min-heap of pixel indices keyed by cost (lazy deletion: stale entries are skipped on pop). */
class Heap {
  private keys: Float64Array;
  private ids: Int32Array;
  size = 0;
  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.ids = new Int32Array(capacity);
  }
  push(id: number, key: number) {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      const ids = new Int32Array(this.size * 2);
      keys.set(this.keys);
      ids.set(this.ids);
      this.keys = keys;
      this.ids = ids;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.ids[i] = this.ids[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.ids[i] = id;
  }
  /** Returns the id with the smallest key; `topKey` holds that key afterwards. */
  topKey = 0;
  pop(): number {
    const id = this.ids[0];
    this.topKey = this.keys[0];
    const key = this.keys[--this.size];
    const last = this.ids[this.size];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) child++;
      if (this.keys[child] >= key) break;
      this.keys[i] = this.keys[child];
      this.ids[i] = this.ids[child];
      i = child;
    }
    this.keys[i] = key;
    this.ids[i] = last;
    return id;
  }
}

/** Cost of one pixel step: colour change dominates; the small constant keeps flat areas growing roundly. */
const STEP_WEIGHT = 1;
const DISTANCE_COST = 0.0015;
/** Pixels further than this from the tapped colour cost extra, so the flood doesn't wander into look-alike backgrounds. */
const SEED_TOLERANCE = 0.03;
const SEED_WEIGHT = 1;

export interface Growth {
  /** Pixel indices in the order they joined the region. */
  order: Int32Array;
  /** Mean OKLab step across the border once the first n pixels have joined (index n − 1). */
  contrast: Float32Array;
  /** Border length (4-neighbour edges) at each size. */
  perimeter: Int32Array;
  count: number;
}

/** Geodesic flood from the seed, recording the border contrast at every size up to maxArea. */
export function grow(img: LabImage, seed: Point, maxArea: number): Growth {
  const { width: w, height: h } = img;
  const n = w * h;
  const cost = new Float64Array(n).fill(Infinity);
  const inside = new Uint8Array(n);
  const heap = new Heap(4096);
  const order = new Int32Array(maxArea);
  const contrast = new Float32Array(maxArea);
  const perimeter = new Int32Array(maxArea);

  const s = Math.round(seed.y) * w + Math.round(seed.x);
  const ref = seedColour(img, seed);
  cost[s] = 0;
  heap.push(s, 0);
  let count = 0;
  let borderSum = 0;
  let borderLen = 0;

  while (heap.size > 0 && count < maxArea) {
    const p = heap.pop();
    if (inside[p] || heap.topKey > cost[p]) continue;
    inside[p] = 1;
    const x = p % w;
    const y = (p - x) / w;
    for (const [dx, dy] of N4) {
      const qx = x + dx;
      const qy = y + dy;
      if (qx < 0 || qy < 0 || qx >= w || qy >= h) {
        borderLen++; // the image edge counts as a border with no contrast
        continue;
      }
      const q = qy * w + qx;
      const d = step(img, p, q);
      if (inside[q]) {
        borderSum -= d;
        borderLen--;
      } else {
        borderSum += d;
        borderLen++;
        const off = Math.hypot(img.L[q] - ref.L, img.a[q] - ref.a, img.b[q] - ref.b) - SEED_TOLERANCE;
        const c = cost[p] + STEP_WEIGHT * d + DISTANCE_COST + (off > 0 ? SEED_WEIGHT * off : 0);
        if (c < cost[q]) {
          cost[q] = c;
          heap.push(q, c);
        }
      }
    }
    order[count] = p;
    contrast[count] = borderLen > 0 ? borderSum / borderLen : 0;
    perimeter[count] = borderLen;
    count++;
  }
  return { order, contrast, perimeter, count };
}

/**
 * Candidate sizes: where the border contrast peaks (a local maximum over a
 * ±15% size window). Returns up to `limit` sizes, strongest first.
 */
export function contrastPeaks(g: Growth, minArea: number, limit = 8): number[] {
  const peaks: number[] = [];
  for (let k = minArea - 1; k < g.count; k++) {
    const lo = Math.max(minArea - 1, Math.floor(k / 1.15));
    const hi = Math.min(g.count - 1, Math.ceil(k * 1.15));
    let isPeak = true;
    for (let j = lo; j <= hi && isPeak; j++) if (g.contrast[j] > g.contrast[k]) isPeak = false;
    if (isPeak && (peaks.length === 0 || k + 1 - peaks[peaks.length - 1] > 0.1 * k)) peaks.push(k + 1);
  }
  return peaks.sort((p, q) => g.contrast[q - 1] - g.contrast[p - 1]).slice(0, limit);
}

/** Area of the mask's convex hull (from each row's leftmost and rightmost pixel). */
export function hullArea(mask: Uint8Array, w: number, h: number): number {
  const pts: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (lo < 0) lo = x;
        hi = x;
      }
    if (lo >= 0) pts.push([lo, y], [hi + 1, y], [lo, y + 1], [hi + 1, y + 1]);
  }
  if (pts.length < 3) return 0;
  // Andrew's monotone chain.
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/** Nail-likeness of a candidate: convex, fills its box like an ellipse, and not a sliver. 0–1. */
export function shapeScore(mask: Uint8Array, w: number, h: number): { score: number; convexity: number; aspect: number } {
  let area = 0;
  for (let p = 0; p < mask.length; p++) area += mask[p];
  const hull = hullArea(mask, w, h);
  const convexity = hull > 0 ? Math.min(1, area / hull) : 0;
  const box = orientedBox(mask, w);
  const aspect = box.width > 0 ? box.length / box.width : Infinity;
  // Nails run from about round (1) to long stiletto (≈ 4); thinner is a leak along an edge.
  const aspectFit = aspect <= 4 ? 1 : Math.max(0, 1 - (aspect - 4) / 3);
  // An ellipse fills π/4 ≈ 0.79 of its box; a wedge-shaped leak much less.
  const fill = box.length * box.width > 0 ? area / (box.length * box.width) : 0;
  const fillFit = Math.min(1, fill / 0.72) ** 2;
  return { score: convexity ** 4 * aspectFit * fillFit, convexity, aspect };
}

/** Marks every 0-pixel that can't reach the image border through 0-pixels as 1 (lines, gems, glare). */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = mask.slice();
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const visit = (p: number) => {
    if (!mask[p] && !outside[p]) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (y > 0) visit(p - w);
    if (y < h - 1) visit(p + w);
  }
  for (let p = 0; p < mask.length; p++) if (!mask[p] && !outside[p]) out[p] = 1;
  return out;
}

/** Square structuring element of radius r: erode (min) or dilate (max). */
function morph(mask: Uint8Array, w: number, h: number, r: number, dilate: boolean): Uint8Array {
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = dilate ? 0 : 1;
        for (let i = -r; i <= r; i++) {
          const xx = horizontal ? x + i : x;
          const yy = horizontal ? y : y + i;
          const s = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[yy * w + xx];
          if (dilate ? s : !s) {
            v = dilate ? 1 : 0;
            break;
          }
        }
        out[y * w + x] = v;
      }
    return out;
  };
  return pass(pass(mask, true), false);
}

export const erode = (m: Uint8Array, w: number, h: number, r: number) => morph(m, w, h, r, false);
export const dilate = (m: Uint8Array, w: number, h: number, r: number) => morph(m, w, h, r, true);

/** The 4-connected component of `mask` containing `seed` (or the one nearest to it). */
export function componentAt(mask: Uint8Array, w: number, h: number, seed: Point): Uint8Array {
  const out = new Uint8Array(mask.length);
  let start = Math.round(seed.y) * w + Math.round(seed.x);
  if (!mask[start]) {
    let bestD = Infinity;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const d = (p % w - seed.x) ** 2 + (Math.floor(p / w) - seed.y) ** 2;
      if (d < bestD) {
        bestD = d;
        start = p;
      }
    }
    if (bestD === Infinity) return out;
  }
  const stack = [start];
  out[start] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    const push = (q: number) => {
      if (mask[q] && !out[q]) {
        out[q] = 1;
        stack.push(q);
      }
    };
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  return out;
}

/** Principal-axis box around the mask: centre, long-axis angle, length and width. */
export function orientedBox(mask: Uint8Array, w: number): OrientedBox {
  let n = 0, sx = 0, sy = 0;
  for (let p = 0; p < mask.length; p++)
    if (mask[p]) {
      n++;
      sx += p % w;
      sy += Math.floor(p / w);
    }
  if (n === 0) return { cx: 0, cy: 0, angle: 0, length: 0, width: 0 };
  const cx = sx / n;
  const cy = sy / n;
  let xx = 0, yy = 0, xy = 0;
  for (let p = 0; p < mask.length; p++)
    if (mask[p]) {
      const dx = (p % w) - cx;
      const dy = Math.floor(p / w) - cy;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
    }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const ux = Math.cos(angle), uy = Math.sin(angle);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let p = 0; p < mask.length; p++)
    if (mask[p]) {
      const dx = (p % w) - cx;
      const dy = Math.floor(p / w) - cy;
      const u = dx * ux + dy * uy;
      const v = -dx * uy + dy * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  // Re-centre on the box (the centroid of a French tip nail isn't the box centre).
  const mu = (minU + maxU) / 2, mv = (minV + maxV) / 2;
  return {
    cx: cx + mu * ux - mv * uy,
    cy: cy + mu * uy + mv * ux,
    angle,
    length: maxU - minU + 1,
    width: maxV - minV + 1,
  };
}

const isWhitish = (img: LabImage, p: number) =>
  img.L[p] > 0.78 && chroma({ L: img.L[p], a: img.a[p], b: img.b[p] }) < 0.035;

/**
 * French tips: a white band touching the nail is part of it. Floods white pixels
 * from the nail's border; keeps them if they form a modest, attached cap (not
 * a white sweater or a sheet of paper).
 */
export function mergeWhiteTip(img: LabImage, mask: Uint8Array, area: number): { mask: Uint8Array; merged: boolean } {
  const { width: w, height: h } = img;
  const tip = new Uint8Array(mask.length);
  const stack: number[] = [];
  const ring = dilate(mask, w, h, 2);
  for (let p = 0; p < mask.length; p++)
    if (ring[p] && !mask[p] && isWhitish(img, p)) {
      tip[p] = 1;
      stack.push(p);
    }
  const limit = area * 0.8;
  let count = stack.length;
  while (stack.length && count <= limit) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    for (const [dx, dy] of N4) {
      const qx = x + dx, qy = y + dy;
      if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
      const q = qy * w + qx;
      if (!tip[q] && !mask[q] && isWhitish(img, q)) {
        tip[q] = 1;
        count++;
        stack.push(q);
      }
    }
  }
  // Too big: it's a white background, not a tip. Too small: just a highlight on the rim.
  if (count > limit || count < area * 0.06) return { mask, merged: false };
  const merged = mask.slice();
  for (let p = 0; p < mask.length; p++) if (tip[p]) merged[p] = 1;
  return { mask: merged, merged: true };
}

/** Median colour of the (2r+1)² square around a point. */
export function seedColour(img: LabImage, at: Point, r = 2): Lab {
  const L: number[] = [], a: number[] = [], b: number[] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const x = Math.min(img.width - 1, Math.max(0, Math.round(at.x) + dx));
      const y = Math.min(img.height - 1, Math.max(0, Math.round(at.y) + dy));
      const p = y * img.width + x;
      L.push(img.L[p]);
      a.push(img.a[p]);
      b.push(img.b[p]);
    }
  const median = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1];
  return { L: median(L), a: median(a), b: median(b) };
}

/**
 * The nail under a tap. The photo should be downscaled so its long side is
 * about 512 px (nails then span roughly 20–150 px).
 */
export function nailRegion(prepared: PreparedImage, tap: Point, options: RegionOptions = {}): NailRegion {
  const img = prepared.structure;
  const { width: w, height: h } = img;
  let maxArea = Math.max(64, Math.round(w * h * (options.maxAreaFraction ?? 0.08)));
  if (options.expectedArea) maxArea = Math.min(maxArea, Math.max(64, Math.round(2 * options.expectedArea)));
  const minArea = Math.min(maxArea, options.minArea ?? 60);

  const g = grow(img, tap, maxArea);
  // Among the sizes where the border sits on an edge, the nail is the strong, convex one.
  let mask: Uint8Array = new Uint8Array(w * h);
  let best = -Infinity;
  let size = Math.min(g.count, minArea);
  let convexity = 0;
  for (const n of contrastPeaks(g, minArea)) {
    let candidate: Uint8Array = new Uint8Array(w * h);
    for (let i = 0; i < n; i++) candidate[g.order[i]] = 1;
    candidate = fillHoles(candidate, w, h);
    const shape = shapeScore(candidate, w, h);
    const score = g.contrast[n - 1] * shape.score;
    if (score > best) {
      best = score;
      mask = candidate;
      size = n;
      convexity = shape.convexity;
    }
  }

  // Opening (radius 2) cuts thin bridges the flood leaked through, then keep the tapped piece.
  const opened = dilate(erode(mask, w, h, 2), w, h, 2);
  const kept = componentAt(opened, w, h, tap);
  if (kept.some(Boolean)) mask = kept;

  let area = 0;
  for (let p = 0; p < mask.length; p++) area += mask[p];
  const tip = mergeWhiteTip(prepared.smooth, mask, area);
  mask = fillHoles(tip.mask, w, h);

  area = 0;
  for (let p = 0; p < mask.length; p++) area += mask[p];
  const box = orientedBox(mask, w);

  return {
    mask,
    area,
    box,
    edgeContrast: g.contrast[size - 1] ?? 0,
    convexity,
    fill: box.length * box.width > 0 ? area / (box.length * box.width) : 0,
    mergedTip: tip.merged,
  };
}

