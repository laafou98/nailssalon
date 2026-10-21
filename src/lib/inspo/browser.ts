// Browser-only side of tap-to-pick: decodes an inspiration photo into the
// working (outline) and detail (colour) resolutions the pure code expects.

import { toLabImage } from "./oklab";
import type { InspirationImage } from "./pick";
import { prepareImage } from "./region";

/** Outlines are found at this long side; colours are measured at twice it. */
const WORK_LONG_SIDE = 512;
const DETAIL_SCALE = 2;

export interface LoadedInspiration {
  /** Object URL of the original file, for display. */
  url: string;
  width: number;
  height: number;
  image: InspirationImage;
}

function pixels(bitmap: ImageBitmap, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return toLabImage(ctx.getImageData(0, 0, width, height).data, width, height);
}

export async function loadInspiration(file: Blob): Promise<LoadedInspiration> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const k = WORK_LONG_SIDE / Math.max(bitmap.width, bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * k));
    const height = Math.max(1, Math.round(bitmap.height * k));
    return {
      url: URL.createObjectURL(file),
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
