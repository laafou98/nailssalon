// Design images: the artwork of one tapped nail, cut out of the inspiration photo,
// turned upright (tip at the top) and sized for Nail VTO's `sub_type: "design"`.
// Pure, so it's unit-tested; the browser turns the result into a PNG.

import { hexToRgb } from "./oklab";
import { erode, type NailRegion } from "./region";

/** YouCam's limits for a nail-polish design image (docs.perfectcorp.com/reference/ai_nail_vto). */
export const DESIGN_LIMITS = { minWidth: 271, maxWidth: 542, minHeight: 522, maxHeight: 1044, maxBytes: 1024 * 1024 } as const;

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Output size for a nail `length` × `width` source pixels: keeps its proportions
 * where the limits allow, never upscales past the maximum. `shrink` (≤ 1) is for
 * retrying when the PNG comes out over 1 MB.
 */
export function designSize(length: number, width: number, shrink = 1): { width: number; height: number } {
  const L = DESIGN_LIMITS;
  const aspect = length / Math.max(1, width);
  let w = clamp(Math.round(width * shrink), L.minWidth, Math.round(L.maxWidth * shrink));
  let h = Math.round(w * aspect);
  if (h > L.maxHeight * shrink) {
    h = Math.round(L.maxHeight * shrink);
    w = Math.round(h / aspect);
  }
  return { width: clamp(w, L.minWidth, L.maxWidth), height: clamp(h, L.minHeight, L.maxHeight) };
}

/**
 * Unit vector from the nail's centre towards its tip. Almond, stiletto and coffin
 * nails narrow towards the tip, so when one end holds clearly less of the outline
 * that end is the tip. Otherwise (square or round nails) we assume fingers point
 * up the photo, true of most inspiration shots. `flipped` reverses the guess.
 */
export function tipDirection(region: NailRegion, maskWidth: number, flipped = false): { x: number; y: number } {
  const { box, mask } = region;
  let x = Math.cos(box.angle), y = Math.sin(box.angle);
  // Outline pixels in the outer 30% at each end of the long axis.
  let ahead = 0, behind = 0;
  const reach = box.length * 0.2;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const u = ((p % maskWidth) - box.cx) * x + (Math.floor(p / maskWidth) - box.cy) * y;
    if (u > reach) ahead++;
    else if (u < -reach) behind++;
  }
  const tapered = Math.min(ahead, behind) < 0.8 * Math.max(ahead, behind);
  if (tapered ? ahead > behind : y > 0 || (y === 0 && x > 0)) [x, y] = [-x, -y];
  return flipped ? { x: -x, y: -y } : { x, y };
}

/** Bilinear sample of a 0/1 mask: a soft edge instead of blocky working-resolution pixels. */
function maskAt(mask: Uint8Array, w: number, h: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const m = (xx: number, yy: number) => (xx >= 0 && yy >= 0 && xx < w && yy < h ? mask[yy * w + xx] : 0);
  return (m(x0, y0) * (1 - fx) + m(x0 + 1, y0) * fx) * (1 - fy) + (m(x0, y0 + 1) * (1 - fx) + m(x0 + 1, y0 + 1) * fx) * fy;
}

/**
 * Cuts one nail out of the photo as an upright, opaque image.
 * @param src      the photo at `srcScale`× the working resolution the region was found at.
 * @param maskWidth width of the working image (the region's mask is maskWidth × n).
 * @param fillHex  colour for everything outside the outline (the nail's base colour), so
 *                 skin or background caught in the box never ends up on the client's nail.
 */
export function nailDesign(
  src: RgbaImage,
  srcScale: number,
  region: NailRegion,
  maskWidth: number,
  fillHex: string,
  options: { flipped?: boolean; shrink?: number } = {},
): RgbaImage {
  const { box } = region;
  const maskHeight = region.mask.length / maskWidth;
  // One working pixel in from the outline: its border pixels are often half skin.
  const mask = erode(region.mask, maskWidth, maskHeight, 1);
  const d = tipDirection(region, maskWidth, options.flipped);
  const across = { x: -d.y, y: d.x }; // left → right when the tip is up
  const out = designSize(box.length * srcScale, box.width * srcScale, options.shrink);
  const [fr, fg, fb] = hexToRgb(fillHex);
  const data = new Uint8ClampedArray(out.width * out.height * 4);

  for (let v = 0; v < out.height; v++) {
    const along = (0.5 - (v + 0.5) / out.height) * box.length;
    for (let u = 0; u < out.width; u++) {
      const side = ((u + 0.5) / out.width - 0.5) * box.width;
      const x = box.cx + along * d.x + side * across.x;
      const y = box.cy + along * d.y + side * across.y;
      const inside = maskAt(mask, maskWidth, maskHeight, x, y);
      let r = fr, g = fg, b = fb;
      if (inside > 0) {
        const [sr, sg, sb] = sample(src, (x + 0.5) * srcScale - 0.5, (y + 0.5) * srcScale - 0.5);
        r = sr * inside + fr * (1 - inside);
        g = sg * inside + fg * (1 - inside);
        b = sb * inside + fb * (1 - inside);
      }
      const o = (v * out.width + u) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { data, ...out };
}

/** Bilinear RGB sample, clamped to the image. */
function sample(img: RgbaImage, x: number, y: number): [number, number, number] {
  const cx = clamp(x, 0, img.width - 1), cy = clamp(y, 0, img.height - 1);
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
  const fx = cx - x0, fy = cy - y0;
  const px = (xx: number, yy: number, c: number) => img.data[(yy * img.width + xx) * 4 + c];
  const ch = (c: number) =>
    (px(x0, y0, c) * (1 - fx) + px(x1, y0, c) * fx) * (1 - fy) + (px(x0, y1, c) * (1 - fx) + px(x1, y1, c) * fx) * fy;
  return [ch(0), ch(1), ch(2)];
}
