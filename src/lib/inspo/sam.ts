// Nail outline from a tap with MobileSAM (Segment Anything with a small TinyViT
// encoder). The model runs in the browser (onnxruntime-web, see sam-browser.ts);
// this file is the pure part around it, so it is unit-tested: the encoder's
// input, the tap as a prompt, the decoder's masks, and the choice of the mask
// that is the nail.
//
// SlimSAM was tried first (Oct 24) and crashed iPhone Safari: its global
// attention needs ≈ 2 GB per encode. MobileSAM peaks at ≈ 200 MB.
//
// SAM answers one tap with four guesses (from part of the nail up to the whole
// hand or photo), each with a predicted IoU. The nail is the best-scored guess
// that contains the tap and has a plausible nail size.
//
// Model files (public/models/mobilesam/) come from huggingface.co/Acly/MobileSAM
// (MIT; MobileSAM is Apache-2.0), quantized to 8 bits with onnxruntime's
// quantize_dynamic: encoder MatMuls only (quantizing its convolutions made
// outlines leak onto skin), decoder MatMul/Gemm.

import type { OrientedBox, Point } from "./region";

/** The encoder's input: the photo drawn with its long side at this (the model pads it square itself). */
export const SAM_SIDE = 1024;

/** Size of the encoder input for a photo: long side SAM_SIDE. */
export function samSize(width: number, height: number): { width: number; height: number } {
  const k = SAM_SIDE / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** RGBA pixels (long side ≤ SAM_SIDE) → the encoder's `input_image`: height × width × RGB, 0–255 (it normalises itself). */
export function samPixels(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  if (width > SAM_SIDE || height > SAM_SIDE) throw new Error(`SAM input must fit in ${SAM_SIDE} px`);
  const out = new Float32Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    out[p * 3] = rgba[p * 4];
    out[p * 3 + 1] = rgba[p * 4 + 1];
    out[p * 3 + 2] = rgba[p * 4 + 2];
  }
  return out;
}

/** A box prompt around the tap: half extents in working pixels. */
export interface PromptBox {
  hx: number;
  hy: number;
}

/**
 * The box to prompt with once a nail of this photo is known: the typical nail's
 * oriented box, a little larger (1.15× along, 1.3× across), axis-aligned. A lone
 * tap on a glossy nail makes SAM answer with a glare-split fragment or the whole
 * finger; a box of about the nail's size makes it answer with the nail (Oct 24:
 * rescued the taps that got only hand-sized guesses on the brown photos, while
 * a box 1.6× too big leaked down the finger, so it is only used when the lone
 * tap fails, see sam-browser.ts).
 */
export function nailPromptBox(box: OrientedBox): PromptBox {
  const c = Math.abs(Math.cos(box.angle)), s = Math.abs(Math.sin(box.angle));
  const length = 1.15 * box.length, width = 1.3 * box.width;
  return { hx: (c * length + s * width) / 2, hy: (s * length + c * width) / 2 };
}

/** Whether a guess of this area is close enough to the typical nail (0.6–1.6×) to be kept without a second, boxed prompt. */
export function nearTypical(area: number, expectedArea: number | undefined): boolean {
  return expectedArea === undefined || (area >= 0.6 * expectedArea && area <= 1.6 * expectedArea);
}

/**
 * The tap as the decoder's prompt, in encoder-input pixels: the point (label 1)
 * and either the padding point (0, 0, label −1) SAM's ONNX decoder expects when
 * there's no box, or the box's corners (labels 2 and 3).
 */
export function samPrompt(tap: Point, samWidth: number, workWidth: number, box?: PromptBox): { coords: Float32Array; labels: Float32Array } {
  const k = samWidth / workWidth;
  const x = (tap.x + 0.5) * k, y = (tap.y + 0.5) * k;
  if (!box) return { coords: new Float32Array([x, y, 0, 0]), labels: new Float32Array([1, -1]) };
  return {
    coords: new Float32Array([x, y, x - box.hx * k, y - box.hy * k, x + box.hx * k, y + box.hy * k]),
    labels: new Float32Array([1, 2, 3]),
  };
}

/** The decoder's `masks` (n guesses of logits, already at the working size we asked for) → binary masks. */
export function samMasks(logits: ArrayLike<number>, count: number, width: number, height: number): Uint8Array[] {
  const size = width * height;
  return Array.from({ length: count }, (_, m) => {
    const mask = new Uint8Array(size);
    for (let p = 0; p < size; p++) if (logits[m * size + p] > 0) mask[p] = 1;
    return mask;
  });
}

export interface MaskLimits {
  /** Largest plausible nail as a fraction of the working image. */
  maxAreaFraction?: number;
  /** Smallest plausible nail, working pixels. */
  minArea?: number;
  /** Typical nail area in this photo (median of the other picks): a guess must be 0.4–1.8× it. */
  expectedArea?: number;
}

/** Whether the mask covers the tap or a pixel within 2 px of it (a tap can land on a glare pixel SAM leaves out). */
function coversTap(mask: Uint8Array, tap: Point, width: number, height: number): boolean {
  const cx = Math.round(tap.x), cy = Math.round(tap.y);
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x]) return true;
    }
  return false;
}

/**
 * Index of the guess that is the nail, or null when none is plausible. A guess
 * must cover the tap and have a nail's size. SAM's guesses nest (part of the
 * nail, the nail, the finger, the hand), and the finger often scores as well
 * as the nail, so a plausible guess at least 3× bigger than another plausible
 * one is taken to be the finger and dropped. Among the rest, the best predicted IoU.
 */
export function chooseSamMask(masks: Uint8Array[], scores: ArrayLike<number>, tap: Point, width: number, height: number, limits: MaskLimits = {}): number | null {
  let maxArea = width * height * (limits.maxAreaFraction ?? 0.08);
  let minArea = limits.minArea ?? 40;
  if (limits.expectedArea) {
    maxArea = Math.min(maxArea, 1.8 * limits.expectedArea);
    minArea = Math.max(minArea, 0.4 * limits.expectedArea);
  }
  const plausible: { i: number; area: number }[] = [];
  masks.forEach((mask, i) => {
    if (!coversTap(mask, tap, width, height)) return;
    let area = 0;
    for (let p = 0; p < mask.length; p++) area += mask[p];
    if (area >= minArea && area <= maxArea) plausible.push({ i, area });
  });
  const nailSized = plausible.filter((c) => !plausible.some((o) => o.area * 3 <= c.area));
  let best: number | null = null;
  for (const { i } of nailSized) if (best === null || scores[i] > scores[best]) best = i;
  return best;
}
