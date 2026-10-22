// Browser-only side of tap-to-pick: decodes an inspiration photo into the
// working (outline) and detail (colour) resolutions the pure code expects,
// and encodes each nail's cut-out artwork as a PNG.

import { DESIGN_LIMITS, nailDesign, type RgbaImage } from "./design";
import { toLabImage } from "./oklab";
import type { InspirationImage, NailPick } from "./pick";
import { prepareImage } from "./region";

/** Outlines are found at this long side; colours are measured at twice it. */
const WORK_LONG_SIDE = 512;
const DETAIL_SCALE = 2;
/** Design cut-outs are read from the photo at up to this long side. */
const SOURCE_LONG_SIDE = 3000;

export interface LoadedInspiration {
  /** Object URL of the original file, for display. */
  url: string;
  file: Blob;
  width: number;
  height: number;
  image: InspirationImage;
}

function rgba(bitmap: ImageBitmap, width: number, height: number): RgbaImage {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

function pixels(bitmap: ImageBitmap, width: number, height: number) {
  const { data } = rgba(bitmap, width, height);
  return toLabImage(data, width, height);
}

/** Full-resolution pixels per photo, for design cut-outs. */
const sources = new WeakMap<Blob, RgbaImage>();

/**
 * One nail's artwork as a PNG for Nail VTO (`sub_type: "design"`): cut out of the
 * full-resolution photo, tip up, inside YouCam's size limits and under 1 MB.
 */
export async function nailDesignPng(loaded: LoadedInspiration, pick: NailPick, flipped: boolean): Promise<Blob> {
  const src = sources.get(loaded.file);
  if (!src) throw new Error("Photo pixels are gone; choose the photo again");
  const scale = src.width / loaded.width;
  for (let shrink = 1; ; shrink *= 0.85) {
    const img = nailDesign(src, scale, pick.region, loaded.width, pick.colours.base.hex, { flipped, shrink });
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d")!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Couldn't encode the design image");
    if (blob.size <= DESIGN_LIMITS.maxBytes || shrink < 0.4) return blob;
  }
}

export async function loadInspiration(file: Blob): Promise<LoadedInspiration> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const s = Math.min(1, SOURCE_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
    sources.set(file, rgba(bitmap, Math.round(bitmap.width * s), Math.round(bitmap.height * s)));
    const k = WORK_LONG_SIDE / Math.max(bitmap.width, bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * k));
    const height = Math.max(1, Math.round(bitmap.height * k));
    return {
      url: URL.createObjectURL(file),
      file,
      width,
      height,
      image: {
        prepared: prepareImage(pixels(bitmap, width, height)),
        detail: pixels(bitmap, width * DETAIL_SCALE, height * DETAIL_SCALE),
        scale: DETAIL_SCALE,
      },
    };
  } finally {
    bitmap.close();
  }
}
