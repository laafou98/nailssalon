// Server-side validation of a per-finger design PNG cut out in the browser.
// Nothing from the client is trusted: check it's a real PNG within YouCam's
// design-image limits before storing it or sending it to a paid render.

import { jpegSize } from "@/lib/hand-gate/upload";
import { DESIGN_LIMITS } from "@/lib/inspo/design";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from a PNG's IHDR chunk (always the first chunk). */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export type DesignUpload =
  | { ok: true; bytes: Uint8Array; width: number; height: number }
  | { ok: false; error: string };

export async function parseDesignUpload(form: FormData): Promise<DesignUpload> {
  const file = form.get("design");
  if (!(file instanceof Blob)) return { ok: false, error: "Missing design image" };
  if (file.size > DESIGN_LIMITS.maxBytes) return { ok: false, error: "Design image is larger than 1 MB" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = pngSize(bytes);
  if (!size) return { ok: false, error: "Design image must be a PNG" };
  const L = DESIGN_LIMITS;
  if (size.width < L.minWidth || size.width > L.maxWidth || size.height < L.minHeight || size.height > L.maxHeight) {
    return { ok: false, error: `Design image must be ${L.minWidth}–${L.maxWidth} × ${L.minHeight}–${L.maxHeight} px` };
  }
  return { ok: true, bytes, ...size };
}

/** An inspiration photo, re-encoded in the browser: Nail Transfer's reference and the vision model's input. */
export const MAX_INSPO_BYTES = 4 * 1024 * 1024;
/** Per-nail crops for the vision model: small JPEGs. */
export const MAX_CROP_BYTES = 300 * 1024;

export type ImageUpload = { ok: true; bytes: Uint8Array; width: number; height: number } | { ok: false; error: string };

/** A JPEG within `maxBytes` and YouCam's input sizes (long side ≤ 2048, short side ≥ `minSide`). */
export async function parseJpegUpload(file: FormDataEntryValue | null, maxBytes: number, minSide: number): Promise<ImageUpload> {
  if (!(file instanceof Blob)) return { ok: false, error: "Missing image" };
  if (file.size > maxBytes) return { ok: false, error: `Image is larger than ${Math.round(maxBytes / 1024)} KB` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = jpegSize(bytes);
  if (!size) return { ok: false, error: "Image must be a JPEG" };
  if (Math.max(size.width, size.height) > 2048 || Math.min(size.width, size.height) < minSide) {
    return { ok: false, error: `Image must be ${minSide}–2048 px on each side` };
  }
  return { ok: true, bytes, ...size };
}
