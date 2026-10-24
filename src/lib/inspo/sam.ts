// Nail outline from a tap with SlimSAM (Segment Anything, distilled to ~14 MB).
// The model runs in the browser (onnxruntime-web, see sam-browser.ts); this file
// is the pure part around it, so it is unit-tested: the encoder's input tensor,
// the tap as a prompt point, the decoder's three low-res masks scaled to the
// working image, and the choice of the mask that is the nail.
//
// SAM answers one tap with three nested guesses (roughly: part of the nail, the
// nail, the finger or hand), each with a predicted IoU. The nail is the best
// scored guess that contains the tap and has a plausible nail size.

import type { Point } from "./region";

/** The encoder's input side: the photo is drawn with its long side at this, then padded square. */
export const SAM_SIDE = 1024;
/** The decoder's masks are this square, covering the padded input. */
const MASK_SIDE = 256;

// ImageNet normalisation, as in SlimSAM's preprocessor_config.json.
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/**
 * RGBA pixels (long side ≤ SAM_SIDE) → the encoder's `pixel_values`, 1×3×1024×1024:
 * rescaled to 0–1, normalised, zero-padded on the right and bottom.
 */
export function samPixels(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  if (width > SAM_SIDE || height > SAM_SIDE) throw new Error(`SAM input must fit in ${SAM_SIDE} px`);
  const plane = SAM_SIDE * SAM_SIDE;
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const q = y * SAM_SIDE + x;
      for (let c = 0; c < 3; c++) out[c * plane + q] = (rgba[p * 4 + c] / 255 - MEAN[c]) / STD[c];
    }
  return out;
}

/** Size of the SAM input for a photo: long side SAM_SIDE. */
export function samSize(width: number, height: number): { width: number; height: number } {
  const k = SAM_SIDE / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * The decoder's masks (`pred_masks`, 3×256×256 logits over the padded input) →
 * one binary mask per guess at the working resolution. `samWidth` is the SAM
 * input's width (its pixels per working pixel = samWidth / workWidth).
 */
export function samMasks(logits: ArrayLike<number>, samWidth: number, workWidth: number, workHeight: number): Uint8Array[] {
  const k = samWidth / workWidth;
  const toGrid = (v: number) => ((v + 0.5) * k * MASK_SIDE) / SAM_SIDE - 0.5;
  const masks: Uint8Array[] = [];
  for (let m = 0; m < 3; m++) {
    const base = m * MASK_SIDE * MASK_SIDE;
    const mask = new Uint8Array(workWidth * workHeight);
    for (let y = 0; y < workHeight; y++) {
      const gy = Math.min(MASK_SIDE - 1, Math.max(0, toGrid(y)));
      const y0 = Math.floor(gy), y1 = Math.min(MASK_SIDE - 1, y0 + 1), fy = gy - y0;
      for (let x = 0; x < workWidth; x++) {
        const gx = Math.min(MASK_SIDE - 1, Math.max(0, toGrid(x)));
        const x0 = Math.floor(gx), x1 = Math.min(MASK_SIDE - 1, x0 + 1), fx = gx - x0;
        const top = logits[base + y0 * MASK_SIDE + x0] * (1 - fx) + logits[base + y0 * MASK_SIDE + x1] * fx;
        const bottom = logits[base + y1 * MASK_SIDE + x0] * (1 - fx) + logits[base + y1 * MASK_SIDE + x1] * fx;
        if (top * (1 - fy) + bottom * fy > 0) mask[y * workWidth + x] = 1;
      }
    }
    masks.push(mask);
  }
  return masks;
}

export interface MaskLimits {
  /** Largest plausible nail as a fraction of the working image. */
  maxAreaFraction?: number;
  /** Smallest plausible nail, working pixels. */
  minArea?: number;
  /** Typical nail area in this photo (median of the other picks): caps a guess at 2.5× it. */
  expectedArea?: number;
}

/**
 * Index of the guess that is the nail, or null when none is plausible: it must
 * contain the tap and have a nail's size; among those, the best predicted IoU.
 */
export function chooseSamMask(masks: Uint8Array[], scores: ArrayLike<number>, tap: Point, width: number, height: number, limits: MaskLimits = {}): number | null {
  let maxArea = width * height * (limits.maxAreaFraction ?? 0.08);
  if (limits.expectedArea) maxArea = Math.min(maxArea, 2.5 * limits.expectedArea);
  const minArea = limits.minArea ?? 40;
  const at = Math.round(tap.y) * width + Math.round(tap.x);
  let best: number | null = null;
  masks.forEach((mask, i) => {
    if (!mask[at]) return;
    let area = 0;
    for (let p = 0; p < mask.length; p++) area += mask[p];
    if (area < minArea || area > maxArea) return;
    if (best === null || scores[i] > scores[best]) best = i;
  });
  return best;
}

/** The tap as the decoder's prompt: SAM-input pixels, label 1 (foreground). */
export function samPoint(tap: Point, samWidth: number, workWidth: number): [number, number] {
  const k = samWidth / workWidth;
  return [(tap.x + 0.5) * k, (tap.y + 0.5) * k];
}
