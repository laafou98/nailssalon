// Server-side validation of a gated hand photo. The browser gate already checked the
// photo, but nothing from the client is trusted: re-check format, size and dimensions
// against YouCam's input rules before storing it or spending a unit on it.

import { z } from "zod";

export const MAX_HAND_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB request body limit

const point = z.object({ x: z.number(), y: z.number(), z: z.number().optional() });

export const handMetaSchema = z.object({
  width: z.coerce.number().int().min(256).max(2048), // YouCam: short side ≥ 256, long side ≤ 2048
  height: z.coerce.number().int().min(256).max(2048),
  landmarks: z.array(point).length(21),
});

export type HandMeta = z.infer<typeof handMetaSchema>;

const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Reads the real pixel size from a JPEG's SOF marker, so client-sent dimensions can be checked. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}

export type HandUpload = { ok: true; bytes: Uint8Array; meta: HandMeta } | { ok: false; error: string };

export async function parseHandUpload(form: FormData): Promise<HandUpload> {
  const photo = form.get("photo");
  if (!(photo instanceof Blob)) return { ok: false, error: "Missing photo" };
  if (photo.size > MAX_HAND_BYTES) return { ok: false, error: "Photo is larger than 4 MB" };
  const bytes = new Uint8Array(await photo.arrayBuffer());
  if (!isJpeg(bytes)) return { ok: false, error: "Photo must be a JPEG" };

  let landmarks: unknown;
  try {
    landmarks = JSON.parse(String(form.get("landmarks") ?? ""));
  } catch {
    return { ok: false, error: "Landmarks must be JSON" };
  }
  const meta = handMetaSchema.safeParse({ width: form.get("width"), height: form.get("height"), landmarks });
  if (!meta.success) return { ok: false, error: `Invalid photo details: ${meta.error.issues[0]?.message}` };

  const size = jpegSize(bytes);
  if (!size || size.width !== meta.data.width || size.height !== meta.data.height) {
    return { ok: false, error: "Photo size doesn't match its details" };
  }
  return { ok: true, bytes, meta: meta.data };
}
