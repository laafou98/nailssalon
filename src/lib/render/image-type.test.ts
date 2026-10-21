import { describe, expect, it } from "vitest";
import { sniffImageType } from "./image-type";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("sniffImageType", () => {
  it("recognises PNG, JPEG and WebP by their magic bytes", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({ contentType: "image/png", ext: "png" });
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ contentType: "image/jpeg", ext: "jpg" });
    expect(sniffImageType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")))).toEqual({ contentType: "image/webp", ext: "webp" });
  });

  it("rejects anything else, whatever the server claimed", () => {
    expect(sniffImageType(bytes(...ascii("<html>")))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});
