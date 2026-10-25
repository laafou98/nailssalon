// Decodes the hand photo and a YouCam render, runs the post-passes (true-colour composite, realism), encodes a JPEG.

import sharp from "sharp";
import { type NailTarget, type Raster, trueColourComposite } from "./composite";
import { type FingerAxis, realismPass } from "./realism";

/** Work size cap: the passes are per-pixel JS, so very large renders are scaled down first. */
const MAX_SIDE = 2048;
/** Hand and render must have the same shape; a larger mismatch means a crop or rotation we can't undo. */
const MAX_ASPECT_DIFF = 0.02;

export interface FinishOptions {
  /** Requested colour per finger, for the true-colour composite; null when it doesn't apply (design fingers). */
  targets: NailTarget[] | null;
  /** Finger axes from the hand landmarks, for the cuticle shadow. */
  fingers?: FingerAxis[];
  /** Cuticle shadow strength (see realism.ts). */
  shadow?: number;
}

export type FinishOutcome =
  | { ok: true; bytes: Uint8Array; nails: number; recoloured: number }
  | { ok: false; reason: string };

export async function finishRender(handBytes: Uint8Array, renderBytes: Uint8Array, opts: FinishOptions): Promise<FinishOutcome> {
  const [handMeta, renderMeta] = await Promise.all([orientedSize(handBytes), orientedSize(renderBytes)]);
  if (Math.abs(handMeta.width / handMeta.height - renderMeta.width / renderMeta.height) > MAX_ASPECT_DIFF) {
    return { ok: false, reason: "aspect_mismatch" };
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(renderMeta.width, renderMeta.height));
  const width = Math.round(renderMeta.width * scale);
  const height = Math.round(renderMeta.height * scale);
  const [hand, youcam] = await Promise.all([raster(handBytes, width, height), raster(renderBytes, width, height)]);

  // The realism pass adds its own grain, so the composite adds none.
  const composite = opts.targets ? trueColourComposite(hand, youcam, { targets: opts.targets, grain: 0 }) : null;
  const recoloured = composite?.recoloured ?? 0;
  const image = recoloured ? composite!.image : youcam;
  const real = realismPass(hand, image, { youcam, fingers: opts.fingers, shadow: opts.shadow });
  if (recoloured === 0 && real.nails === 0) return { ok: false, reason: "no_nails_found" };

  const bytes = await sharp(Buffer.from(real.image.data), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { ok: true, bytes: new Uint8Array(bytes), nails: Math.max(real.nails, composite?.nails ?? 0), recoloured };
}

async function orientedSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes).metadata();
  const swap = (meta.orientation ?? 1) >= 5; // EXIF 5–8 rotate by 90°
  return swap ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

async function raster(bytes: Uint8Array, width: number, height: number): Promise<Raster> {
  const { data } = await sharp(bytes)
    .rotate()
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}
