import { describe, expect, it } from "vitest";
import { parseDesignUpload, pngSize } from "./design-upload";

/** Signature + an IHDR chunk header: all our parser reads. */
function fakePng(width: number, height: number, extra = 0): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

const form = (bytes: Uint8Array | null) => {
  const f = new FormData();
  if (bytes) f.set("design", new Blob([bytes as BlobPart], { type: "image/png" }));
  return f;
};

describe("pngSize", () => {
  it("reads IHDR dimensions and rejects non-PNGs", () => {
    expect(pngSize(fakePng(300, 600))).toEqual({ width: 300, height: 600 });
    expect(pngSize(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe("parseDesignUpload", () => {
  it("accepts a PNG within YouCam's limits", async () => {
    const r = await parseDesignUpload(form(fakePng(300, 600)));
    expect(r).toMatchObject({ ok: true, width: 300, height: 600 });
  });

  it("rejects missing, wrong-size, oversized and non-PNG uploads", async () => {
    expect((await parseDesignUpload(form(null))).ok).toBe(false);
    expect((await parseDesignUpload(form(fakePng(200, 600)))).ok).toBe(false);
    expect((await parseDesignUpload(form(fakePng(300, 1100)))).ok).toBe(false);
    expect((await parseDesignUpload(form(fakePng(300, 600, 1024 * 1024)))).ok).toBe(false);
    expect((await parseDesignUpload(form(new Uint8Array(40)))).ok).toBe(false);
  });
});
