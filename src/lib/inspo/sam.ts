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

import type { Point } from "./region";

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

/**
 * The tap as the decoder's prompt, in encoder-input pixels: the point (label 1)
 * plus the padding point (0, 0, label −1) SAM's ONNX decoder expects when there's no box.
 */
export function samPrompt(tap: Point, samWidth: number, workWidth: number): { coords: Float32Array; labels: Float32Array } {
  const k = samWidth / workWidth;
  return { coords: new Float32Array([(tap.x + 0.5) * k, (tap.y + 0.5) * k, 0, 0]), labels: new Float32Array([1, -1]) };
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
