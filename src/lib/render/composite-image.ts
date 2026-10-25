// Decodes the hand photo and a YouCam render, runs the true-colour composite, encodes a JPEG.

import sharp from "sharp";
import { type CompositeOptions, type Raster, trueColourComposite } from "./composite";

/** Work size cap: the composite is per-pixel JS, so very large renders are scaled down first. */
const MAX_SIDE = 2048;
/** Hand and render must have the same shape; a larger mismatch means a crop or rotation we can't undo. */
const MAX_ASPECT_DIFF = 0.02;

export type CompositeOutcome =
  | { ok: true; bytes: Uint8Array; nails: number; recoloured: number }
  | { ok: false; reason: string };

export async function compositeRender(
  handBytes: Uint8Array,
  renderBytes: Uint8Array,
  opts: CompositeOptions,
): Promise<CompositeOutcome> {
  const [handMeta, renderMeta] = await Promise.all([orientedSize(handBytes), orientedSize(renderBytes)]);
  if (Math.abs(handMeta.width / handMeta.height - renderMeta.width / renderMeta.height) > MAX_ASPECT_DIFF) {
    return { ok: false, reason: "aspect_mismatch" };
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(renderMeta.width, renderMeta.height));
  const width = Math.round(renderMeta.width * scale);
  const height = Math.round(renderMeta.height * scale);
  const [hand, render] = await Promise.all([raster(handBytes, width, height), raster(renderBytes, width, height)]);

  const result = trueColourComposite(hand, render, opts);
  if (result.recoloured === 0) return { ok: false, reason: "no_nails_recoloured" };
  const bytes = await sharp(Buffer.from(result.image.data), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { ok: true, bytes: new Uint8Array(bytes), nails: result.nails, recoloured: result.recoloured };
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
