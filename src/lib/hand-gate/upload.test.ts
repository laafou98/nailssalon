import { describe, expect, it } from "vitest";
import { jpegSize, parseHandUpload } from "./upload";

/** Smallest byte sequence our parser accepts: SOI, an APP0 segment, then a SOF0 header. */
function fakeJpeg(width: number, height: number, extra = 0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, ...new Array(10).fill(0)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, ...new Array(extra).fill(0)]);
}

const LANDMARKS = Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: 0.5, z: 0 }));

const form = (photo: Uint8Array | null, fields: Record<string, string> = {}) => {
  const f = new FormData();
  if (photo) f.set("photo", new Blob([photo as BlobPart], { type: "image/jpeg" }));
  f.set("width", "750");
  f.set("height", "1000");
  f.set("landmarks", JSON.stringify(LANDMARKS));
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("jpegSize", () => {
  it("reads dimensions from the SOF marker", () => {
    expect(jpegSize(fakeJpeg(750, 1000))).toEqual({ width: 750, height: 1000 });
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0x00, 0x00]))).toBeNull();
  });
});

describe("parseHandUpload", () => {
  it("accepts a valid gated photo", async () => {
    const result = await parseHandUpload(form(fakeJpeg(750, 1000)));
    expect(result).toMatchObject({ ok: true, meta: { width: 750, height: 1000 } });
  });

  it("rejects missing, non-JPEG, oversized or mismatched photos", async () => {
    expect(await parseHandUpload(form(null))).toMatchObject({ ok: false, error: "Missing photo" });
    expect(await parseHandUpload(form(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])))).toMatchObject({ ok: false, error: "Photo must be a JPEG" });
    expect(await parseHandUpload(form(fakeJpeg(750, 1000, 4 * 1024 * 1024)))).toMatchObject({ ok: false, error: "Photo is larger than 4 MB" });
    expect(await parseHandUpload(form(fakeJpeg(800, 1000)))).toMatchObject({ ok: false, error: "Photo size doesn't match its details" });
  });

  it("enforces YouCam's size limits and needs all 21 landmarks", async () => {
    const tooBig = await parseHandUpload(form(fakeJpeg(3000, 4000), { width: "3000", height: "4000" }));
    expect(tooBig.ok).toBe(false);
    const fewPoints = await parseHandUpload(form(fakeJpeg(750, 1000), { landmarks: JSON.stringify(LANDMARKS.slice(0, 5)) }));
    expect(fewPoints.ok).toBe(false);
  });
});
