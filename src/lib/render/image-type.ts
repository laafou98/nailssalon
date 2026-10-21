/**
 * Image type from the file's first bytes. YouCam's results come from S3 labelled
 * `binary/octet-stream` (observed Oct 21: actually a PNG), and our storage bucket
 * only accepts real image types, so the label can't be trusted.
 */
export function sniffImageType(bytes: Uint8Array): { contentType: string; ext: string } | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { contentType: "image/png", ext: "png" };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { contentType: "image/jpeg", ext: "jpg" };
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  ) {
    return { contentType: "image/webp", ext: "webp" };
  }
  return null;
}
