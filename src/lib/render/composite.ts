// True-colour composite of a YouCam Nail VTO render (port of scripts/prototypes/true_colour_composite.py).
// YouCam finds and shades the nails well, but drifts the hue (coral came back red) and paints a crisp,
// noise-free nail onto a grainy photo. We keep its nail mask and lightness pattern, swap in the exact
// requested colour (OKLab), and add the photo's grain. Unlike the prototype, the base is YouCam's render,
// not the bare hand: a nail we fail to detect (a pale polish close to the natural nail) keeps YouCam's paint
// instead of vanishing. Only for plain-colour specs: design nails are split by the mask and came out torn.
// Pure functions on raw RGB buffers; decoding and encoding live in composite-image.ts.

import { type Lab, deltaE, hexToRgb, rgbToOklab } from "@/lib/inspo/oklab";
import { type DesignSpec, FINGERS } from "@/lib/spec/types";
import {
  type Raster, clampByte, components, gaussianBlur, growLabels, labDist, linearToSrgb, oklabToLinear, rankFilter, toLab,
} from "./raster";

export type { Raster };

export interface NailTarget {
  /** Requested polish colour, #RRGGBB. */
  hex: string;
  /** The finger's tip in normalised image coordinates (MediaPipe landmark), when known. */
  tip?: { x: number; y: number };
}

export interface CompositeOptions {
  /**
   * One per finger. A nail takes the colour of the nearest fingertip; without tips, the requested
   * colour nearest to YouCam's rendering of it (can swap fingers whose colours are close).
   */
  targets: NailTarget[];
  /** How much of the photo's grain goes onto the nail (default 0.8); 0 when the realism pass adds its own. */
  grain?: number;
}

export interface CompositeResult {
  image: Raster;
  /** Nails found in the render, and how many of them were recoloured. */
  nails: number;
  recoloured: number;
}

/** OKLab distance between photo and render that counts as "painted". */
const PAINT_DELTA = 0.08;
/** Opening size: removes painted lines thinner than this (YouCam's 1 px resize slivers). */
const OPEN_SIZE = 5;
/** Smaller painted blobs are noise, not nails (fraction of the image). */
const MIN_NAIL_FRACTION = 0.0002;
/** How much of YouCam's lightness variation (shading, highlights) we keep. */
const SHADING = 0.8;
/** Default share of the photo's grain on the nail. */
const GRAIN = 0.8;

/** MediaPipe hand landmark index of each finger's tip, in FINGERS order. */
const TIP_LANDMARKS = [4, 8, 12, 16, 20];

/**
 * Targets for a spec, or null when the composite doesn't apply: design fingers (their art comes from
 * the PNG, and the mask splits two-tone nails).
 * `landmarks` is the hand photo's stored MediaPipe result: 21 normalised points.
 */
export function compositeTargets(spec: DesignSpec, landmarks: unknown): NailTarget[] | null {
  if (FINGERS.some((f) => spec.fingers[f].kind !== "color")) return null;
  const points = Array.isArray(landmarks) && landmarks.length === 21 ? (landmarks as { x?: unknown; y?: unknown }[]) : null;
  return FINGERS.map((finger, k) => {
    const p = points?.[TIP_LANDMARKS[k]];
    const tip = p && typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : undefined;
    return { hex: spec.fingers[finger].baseHex, tip };
  });
}

export function trueColourComposite(hand: Raster, render: Raster, opts: CompositeOptions): CompositeResult {
  const { width: w, height: h } = render;
  if (hand.width !== w || hand.height !== h) throw new Error("Hand and render sizes differ");
  const n = w * h;
  const handLab = toLab(hand.data, n);
  const renderLab = toLab(render.data, n);

  // Paint mask from colour change, opened to drop thin slivers (YouCam shifts edges by ~1 px).
  let hard: Float32Array = new Float32Array(n);
  for (let i = 0; i < n; i++) hard[i] = labDist(handLab, renderLab, i) > PAINT_DELTA ? 1 : 0;
  hard = rankFilter(rankFilter(hard, w, h, OPEN_SIZE, Math.min, 1), w, h, OPEN_SIZE, Math.max, 0);

  // One label per nail, each with its finger's colour.
  const { labels, count } = components(hard, w, h);
  const nails = nailStats(labels, count, renderLab, w);
  const minSize = Math.max(1, n * MIN_NAIL_FRACTION);
  const targets = opts.targets.map((t) => ({ lab: hexToLab(t.hex), tip: t.tip && { x: t.tip.x * w, y: t.tip.y * h } }));
  const withTips = targets.filter((t) => t.tip);
  const targetOf: (Lab | null)[] = nails.map((nail) => {
    if (nail.size < minSize || targets.length === 0) return null;
    if (withTips.length) {
      const dist = (t: (typeof targets)[number]) => Math.hypot(t.tip!.x - nail.cx, t.tip!.y - nail.cy);
      return withTips.reduce((best, t) => (dist(t) < dist(best) ? t : best)).lab;
    }
    return targets.reduce((best, t) => (deltaE(t.lab, nail.mean) < deltaE(best.lab, nail.mean) ? t : best)).lab;
  });

  // Soft edge: blur the recoloured nails' mask; the fringe takes the nearest nail's label.
  const keep = new Float32Array(n);
  for (let i = 0; i < n; i++) if (labels[i] > 0 && targetOf[labels[i] - 1]) keep[i] = 1;
  const mask = gaussianBlur(keep, w, h, 1.2);
  const fringeLabels = growLabels(labels, w, h, 3);

  const grainAmount = opts.grain ?? GRAIN;
  const grain = [0, 1, 2].map((c) => {
    const channel = new Float32Array(n);
    for (let i = 0; i < n; i++) channel[i] = hand.data[i * 3 + c];
    const blurred = gaussianBlur(channel, w, h, 1.5);
    for (let i = 0; i < n; i++) channel[i] -= blurred[i];
    return channel;
  });

  const out = new Uint8Array(render.data);
  for (let i = 0; i < n; i++) {
    const m = mask[i];
    const label = fringeLabels[i];
    const target = label ? targetOf[label - 1] : null;
    if (m <= 0.002 || !target) continue;
    // YouCam's lightness pattern centred on the target; highlights lose chroma, as real speculars do.
    const L = target.L + (renderLab[i * 3] - nails[label - 1].medianL) * SHADING;
    const hi = Math.min(1, Math.max(0, (L - target.L) / 0.25));
    const lin = oklabToLinear(L, target.a * (1 - 0.7 * hi), target.b * (1 - 0.7 * hi));
    for (let c = 0; c < 3; c++) {
      const v = linearToSrgb(lin[c]) * 255 + grain[c][i] * grainAmount;
      out[i * 3 + c] = clampByte(v * m + render.data[i * 3 + c] * (1 - m));
    }
  }

  const sized = nails.filter((nail) => nail.size >= minSize).length;
  return { image: { width: w, height: h, data: out }, nails: sized, recoloured: targetOf.filter(Boolean).length };
}

const hexToLab = (hex: string) => rgbToOklab(...hexToRgb(hex));

interface NailStats {
  size: number;
  /** Mean render colour of the nail. */
  mean: Lab;
  medianL: number;
  /** Centroid, in pixels. */
  cx: number;
  cy: number;
}

function nailStats(labels: Int32Array, count: number, lab: Float32Array, w: number): NailStats[] {
  const sums = Array.from({ length: count }, () => ({ size: 0, L: 0, a: 0, b: 0, x: 0, y: 0, Ls: [] as number[] }));
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const s = sums[labels[i] - 1];
    const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
    s.size++;
    s.L += L; s.a += a; s.b += b;
    s.x += i % w; s.y += Math.floor(i / w);
    s.Ls.push(L);
  }
  return sums.map((s) => {
    s.Ls.sort((x, y) => x - y);
    return {
      size: s.size,
      mean: { L: s.L / s.size, a: s.a / s.size, b: s.b / s.size },
      medianL: s.Ls[s.Ls.length >> 1],
      cx: s.x / s.size,
      cy: s.y / s.size,
    };
  });
}
