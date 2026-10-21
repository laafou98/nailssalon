// The colours of one nail: k-means in OKLab over the outlined pixels.
// Pure functions over a LabImage + mask, unit-tested on synthetic images.

import { chroma, type Lab, type LabImage, oklabToHex } from "./oklab";
import { dilate, erode } from "./region";

export interface ColourCluster {
  lab: Lab;
  hex: string;
  /** Fraction of the nail's (kept) pixels. */
  share: number;
}

export interface NailColours {
  /** Largest cluster: the polish colour. */
  base: ColourCluster;
  /** The other distinct colours (lines, tips, outlines), largest first. */
  accents: ColourCluster[];
  /**
   * How cleanly the colours separate: the gap between cluster centres over
   * their spread (≥ 3 is very clean). For a single colour: how even it is
   * (1 = perfectly flat).
   */
  separation: number;
  /** Pixels used after dropping glare and surround-coloured border pixels. */
  pixelCount: number;
}

/** Lightness counts half: gloss and shading change it a lot without changing the polish. */
const L_WEIGHT = 0.5;
const dist = (p: Lab, q: Lab) => Math.hypot((p.L - q.L) * L_WEIGHT, p.a - q.a, p.b - q.b);

/**
 * Clusters closer than this are the same polish under different light. Measured
 * with lightness at a quarter weight: a glossy nail is dark on one side and
 * bright on the other, yet it's one colour.
 */
const MERGE_DISTANCE = 0.045;
const mergeDist = (p: Lab, q: Lab) => Math.hypot((p.L - q.L) * 0.25, p.a - q.a, p.b - q.b);
/** Clusters smaller than this are noise (a gem, a stray pixel). */
const MIN_SHARE = 0.05;
const MAX_SAMPLES = 6000;

/** Glare: near-white with almost no colour. White polish is a little less bright. */
const isGlare = (c: Lab) => c.L > 0.96 && chroma(c) < 0.02;

/**
 * k-means with a deterministic start: the mean, then repeatedly the pixel
 * farthest from every centre so far (after trimming the most extreme 1%, so a
 * single sparkle can't become a centre).
 */
export function kMeans(pixels: Lab[], k: number, iterations = 12): { centres: Lab[]; labels: Int32Array } {
  const n = pixels.length;
  const labels = new Int32Array(n);
  if (n === 0) return { centres: [], labels };
  const mean = (idx: (i: number) => boolean): Lab | null => {
    let L = 0, a = 0, b = 0, c = 0;
    for (let i = 0; i < n; i++)
      if (idx(i)) {
        L += pixels[i].L;
        a += pixels[i].a;
        b += pixels[i].b;
        c++;
      }
    return c ? { L: L / c, a: a / c, b: b / c } : null;
  };
  const centres: Lab[] = [mean(() => true)!];
  const nearest = new Float64Array(n).fill(Infinity);
  while (centres.length < k) {
    const last = centres[centres.length - 1];
    for (let i = 0; i < n; i++) nearest[i] = Math.min(nearest[i], dist(pixels[i], last));
    const sorted = Float64Array.from(nearest).sort();
    const cap = sorted[Math.floor(0.99 * (n - 1))];
    let far = -1, farD = -1;
    for (let i = 0; i < n; i++)
      if (nearest[i] <= cap && nearest[i] > farD) {
        farD = nearest[i];
        far = i;
      }
    if (farD <= 0) break; // fewer distinct colours than k
    centres.push({ ...pixels[far] });
  }
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = dist(pixels[i], centres[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (labels[i] !== best) moved = true;
      labels[i] = best;
    }
    for (let c = 0; c < centres.length; c++) centres[c] = mean((i) => labels[i] === c) ?? centres[c];
    if (!moved && it > 0) break;
  }
  return { centres, labels };
}

/**
 * Pixels to measure: the mask, minus glare, minus border pixels that look like
 * whatever surrounds the nail (skin or background the outline caught).
 * `img` may be `scale`× the mask's resolution, so thin lines keep their colour.
 */
export function nailPixels(img: LabImage, mask: Uint8Array, scale = 1): Lab[] {
  const w = Math.floor(img.width / scale);
  const h = Math.floor(img.height / scale);
  const inner = erode(mask, w, h, 2);
  const ringOuter = dilate(mask, w, h, 4);
  const ringInner = dilate(mask, w, h, 1);
  const surround: Lab[] = [];
  const at = (p: number): Lab => {
    const q = Math.floor(p / w) * scale * img.width + (p % w) * scale;
    return { L: img.L[q], a: img.a[q], b: img.b[q] };
  };
  for (let p = 0; p < mask.length; p++) if (ringOuter[p] && !ringInner[p]) surround.push(at(p));
  const median = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1] ?? 0;
  const around: Lab | null = surround.length
    ? { L: median(surround.map((c) => c.L)), a: median(surround.map((c) => c.a)), b: median(surround.map((c) => c.b)) }
    : null;

  const out: Lab[] = [];
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const x0 = (p % w) * scale;
    const y0 = Math.floor(p / w) * scale;
    for (let dy = 0; dy < scale; dy++)
      for (let dx = 0; dx < scale; dx++) {
        const q = (y0 + dy) * img.width + x0 + dx;
        const c = { L: img.L[q], a: img.a[q], b: img.b[q] };
        if (isGlare(c)) continue;
        if (!inner[p] && around && dist(c, around) < 0.03) continue;
        out.push(c);
      }
  }
  return out;
}

const quantile = (v: number[], q: number) => v.sort((x, y) => x - y)[Math.min(v.length - 1, Math.floor(q * v.length))];

/**
 * The base colour: median hue/chroma (a, b) and the 70th percentile of
 * lightness. Shadowed sides of a curved, glossy nail outnumber its lit
 * mid-tones, so a plain mean comes out too dark.
 */
function baseColour(pixels: Lab[]): Lab {
  return { L: quantile(pixels.map((p) => p.L), 0.7), a: quantile(pixels.map((p) => p.a), 0.5), b: quantile(pixels.map((p) => p.b), 0.5) };
}

/**
 * An accent's colour: the median of its 30% of pixels furthest from the base.
 * Thin lines blend into the polish around them, so their purest pixels are the
 * ones least like the base.
 */
function accentColour(pixels: Lab[], base: Lab): Lab {
  const far = pixels.map((p) => ({ p, d: dist(p, base) })).sort((x, y) => y.d - x.d).slice(0, Math.max(1, Math.ceil(pixels.length * 0.3))).map((x) => x.p);
  return { L: quantile(far.map((p) => p.L), 0.5), a: quantile(far.map((p) => p.a), 0.5), b: quantile(far.map((p) => p.b), 0.5) };
}

export function nailColours(img: LabImage, mask: Uint8Array, scale = 1, k = 4): NailColours | null {
  let pixels = nailPixels(img, mask, scale);
  if (pixels.length === 0) return null;
  if (pixels.length > MAX_SAMPLES) {
    const stride = pixels.length / MAX_SAMPLES;
    pixels = Array.from({ length: MAX_SAMPLES }, (_, i) => pixels[Math.floor(i * stride)]);
  }
  const { centres, labels } = kMeans(pixels, k);

  // Merge look-alike clusters (shading of one polish), drop specks.
  let clusters = centres.map((lab) => ({ lab, members: [] as Lab[] }));
  labels.forEach((c, i) => clusters[c].members.push(pixels[i]));
  clusters = clusters.filter((c) => c.members.length > 0);
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++)
        if (mergeDist(clusters[i].lab, clusters[j].lab) < MERGE_DISTANCE) {
          const [p, q] = [clusters[i], clusters[j]];
          const n = p.members.length + q.members.length;
          const lab = {
            L: (p.lab.L * p.members.length + q.lab.L * q.members.length) / n,
            a: (p.lab.a * p.members.length + q.lab.a * q.members.length) / n,
            b: (p.lab.b * p.members.length + q.lab.b * q.members.length) / n,
          };
          clusters = clusters.filter((_, x) => x !== i && x !== j).concat({ lab, members: p.members.concat(q.members) });
          merged = true;
          break outer;
        }
  }
  const total = pixels.length;
  const sorted = clusters.filter((c) => c.members.length / total >= MIN_SHARE).sort((p, q) => q.members.length - p.members.length);
  if (sorted.length === 0) return null;
  const base = baseColour(sorted[0].members);
  const kept: ColourCluster[] = sorted.map((c, i) => {
    const lab = i === 0 ? base : accentColour(c.members, base);
    return { lab, hex: oklabToHex(lab), share: c.members.length / total };
  });

  // Spread: mean distance of pixels to their nearest kept centre.
  let spread = 0;
  for (const px of pixels) spread += Math.min(...kept.map((c) => dist(px, c.lab)));
  spread /= pixels.length;
  let gap = Infinity;
  for (let i = 0; i < kept.length; i++)
    for (let j = i + 1; j < kept.length; j++) gap = Math.min(gap, dist(kept[i].lab, kept[j].lab));
  const separation = kept.length > 1 ? gap / Math.max(spread, 1e-3) : Math.max(0, 1 - spread / 0.08);

  return { base: kept[0], accents: kept.slice(1), separation, pixelCount: pixels.length };
}
