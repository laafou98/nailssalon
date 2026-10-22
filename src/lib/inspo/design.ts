// Design images: the artwork of one tapped nail, cut out of the inspiration photo,
// turned upright (tip at the top) and sized for Nail VTO's `sub_type: "design"`.
// Two fits: "natural" (polish on the client's own, usually shorter, nails: the
// busiest stretch of the art at short-nail proportions, so it isn't squashed) and
// "full" (press-on extensions: the whole nail, drawn into a clean nail silhouette
// on a transparent background, because YouCam uses the PNG's outline as the nail).
// Pure, so it's unit-tested; the browser turns the result into a PNG.

import { hexToRgb } from "./oklab";
import { erode, type NailRegion } from "./region";

/** YouCam's limits for a design image, polish and press-on alike (docs.perfectcorp.com/reference/ai_nail_vto). */
export const DESIGN_LIMITS = { minWidth: 271, maxWidth: 542, minHeight: 522, maxHeight: 1044, maxBytes: 1024 * 1024 } as const;

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Length / width of a typical short natural nail: the window "natural" fit cuts. */
export const NATURAL_ASPECT = 1.3;

export type DesignFit = "natural" | "full";

/** Tip shapes for extensions. YouCam names its press-on shapes tip_cuticle. */
export const TIP_SHAPES = ["almond", "stiletto", "oval", "square", "squoval"] as const;
export type TipShape = (typeof TIP_SHAPES)[number];

/**
 * Half-width (0–1) of a nail silhouette at `t` (0 = tip, 1 = cuticle), with a
 * rounded oval cuticle. Our cut-out's own outline is too ragged to send as the
 * shape of an extension (it showed as torn edges on Oct 22).
 */
export function silhouetteHalfWidth(tip: TipShape, t: number): number {
  if (t < 0 || t > 1) return 0;
  if (t > 0.85) return Math.sqrt(Math.max(0, 1 - ((t - 0.85) / 0.15) ** 2)); // oval cuticle
  switch (tip) {
    case "stiletto": // straight sides to a sharp point
      return t < 0.55 ? 0.04 + 0.96 * (t / 0.55) : 1;
    case "almond": // tapered, softly rounded point
      return t < 0.5 ? Math.sqrt(1 - (1 - t / 0.5) ** 2) : 1;
    case "oval":
      return t < 0.3 ? Math.sqrt(1 - (1 - t / 0.3) ** 2) : 1;
    case "squoval": // square with softened corners
      return t < 0.1 ? Math.pow(1 - (1 - t / 0.1) ** 4, 0.25) : 1;
    case "square":
      return t < 0.03 ? Math.sqrt(1 - (1 - t / 0.03) ** 2) : 1;
  }
}

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
  } else if (h < L.minHeight) {
    // Short nails: widen rather than stretch, so the proportions survive the minimum height.
    h = L.minHeight;
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
  const { box } = region;
  let x = Math.cos(box.angle), y = Math.sin(box.angle);
  const { ahead, behind } = endAreas(region, maskWidth);
  const tapered = Math.min(ahead, behind) < TAPER * Math.max(ahead, behind);
  if (tapered ? ahead > behind : y > 0 || (y === 0 && x > 0)) [x, y] = [-x, -y];
  return flipped ? { x: -x, y: -y } : { x, y };
}

/**
 * One end holding less than this share of the other's outline counts as a tapered
 * tip. inspo-7's almond nails measure 0.57–0.81; ovals measure about 1.
 */
export const TAPER = 0.85;

/** Outline pixels in the outermost 10% at each end of the long axis (`ahead` = along +angle). */
function endAreas(region: NailRegion, maskWidth: number): { ahead: number; behind: number } {
  const { box, mask } = region;
  const x = Math.cos(box.angle), y = Math.sin(box.angle);
  let ahead = 0, behind = 0;
  const reach = box.length * 0.4;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const u = ((p % maskWidth) - box.cx) * x + (Math.floor(p / maskWidth) - box.cy) * y;
    if (u > reach) ahead++;
    else if (u < -reach) behind++;
  }
  return { ahead, behind };
}

/** Tip area / cuticle area: well under 1 for almond and stiletto nails, about 1 for square and oval. */
export function taper(region: NailRegion, maskWidth: number): number {
  const { ahead, behind } = endAreas(region, maskWidth);
  return Math.max(ahead, behind) > 0 ? Math.min(ahead, behind) / Math.max(ahead, behind) : 1;
}

/** Bilinear sample of a 0/1 mask: a soft edge instead of blocky working-resolution pixels. */
function maskAt(mask: Uint8Array, w: number, h: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const m = (xx: number, yy: number) => (xx >= 0 && yy >= 0 && xx < w && yy < h ? mask[yy * w + xx] : 0);
  return (m(x0, y0) * (1 - fx) + m(x0 + 1, y0) * fx) * (1 - fy) + (m(x0, y0 + 1) * (1 - fx) + m(x0 + 1, y0 + 1) * fx) * fy;
}

/**
 * The stretch of the nail to keep, as distances along its axis from the centre
 * (`from` on the tip side, `to` towards the cuticle). "full" keeps all of it;
 * "natural" keeps a window of NATURAL_ASPECT × the width where the art differs
 * most from the base colour, nearer the centre on ties.
 */
export function artWindow(
  profile: number[],
  length: number,
  width: number,
  fit: DesignFit,
): { from: number; to: number } {
  const keep = fit === "full" ? length : Math.min(length, width * NATURAL_ASPECT);
  if (keep >= length || profile.length === 0) return { from: length / 2, to: -length / 2 };
  // profile[i] = art in bin i, bins running tip → cuticle.
  const n = profile.length;
  const bins = Math.max(1, Math.round((keep / length) * n));
  let best = 0, bestScore = -Infinity, sum = 0;
  const total = profile.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < n; i++) {
    sum += profile[i];
    if (i >= bins) sum -= profile[i - bins];
    if (i < bins - 1) continue;
    const start = i - bins + 1;
    const offCentre = Math.abs(start + bins / 2 - n / 2) / n;
    const score = sum / total - 0.05 * offCentre;
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  const from = length / 2 - (best / n) * length;
  return { from, to: from - keep };
}

/**
 * Cuts one nail out of the photo as an upright image.
 * @param src      the photo at `srcScale`× the working resolution the region was found at.
 * @param maskWidth width of the working image (the region's mask is maskWidth × n).
 * @param fillHex  colour for everything outside the outline (the nail's base colour), so
 *                 skin or background caught in the box never ends up on the client's nail.
 *                 With `silhouette` (press-on), the result is cut to that clean nail shape
 *                 on a transparent background instead.
 */
export function nailDesign(
  src: RgbaImage,
  srcScale: number,
  region: NailRegion,
  maskWidth: number,
  fillHex: string,
  options: { flipped?: boolean; shrink?: number; fit?: DesignFit; silhouette?: TipShape } = {},
): RgbaImage {
  const { box } = region;
  const maskHeight = region.mask.length / maskWidth;
  // One working pixel in from the outline: its border pixels are often half skin.
  const mask = erode(region.mask, maskWidth, maskHeight, 1);
  const d = tipDirection(region, maskWidth, options.flipped);
  const across = { x: -d.y, y: d.x }; // left → right when the tip is up
  const [fr, fg, fb] = hexToRgb(fillHex);

  /** Photo colour at (along, side) on the nail and how far inside the outline it is (0–1). */
  const at = (along: number, side: number): [number, number, number, number] => {
    const x = box.cx + along * d.x + side * across.x;
    const y = box.cy + along * d.y + side * across.y;
    const inside = maskAt(mask, maskWidth, maskHeight, x, y);
    if (inside <= 0) return [fr, fg, fb, 0];
    return [...sample(src, (x + 0.5) * srcScale - 0.5, (y + 0.5) * srcScale - 0.5), inside];
  };

  // How much art each stretch of the nail holds: distance from the base colour, tip → cuticle.
  const BINS = 48, ACROSS = 12;
  const profile = Array.from({ length: BINS }, (_, i) => {
    const along = (0.5 - (i + 0.5) / BINS) * box.length;
    let art = 0;
    for (let k = 0; k < ACROSS; k++) {
      const [r, g, b, inside] = at(along, ((k + 0.5) / ACROSS - 0.5) * box.width);
      art += inside * (Math.abs(r - fr) + Math.abs(g - fg) + Math.abs(b - fb));
    }
    return art;
  });
  const { from, to } = artWindow(profile, box.length, box.width, options.fit ?? "full");

  const out = designSize((from - to) * srcScale, box.width * srcScale, options.shrink);
  const data = new Uint8ClampedArray(out.width * out.height * 4);
  for (let v = 0; v < out.height; v++) {
    const along = from - ((v + 0.5) / out.height) * (from - to);
    for (let u = 0; u < out.width; u++) {
      const [sr, sg, sb, inside] = at(along, ((u + 0.5) / out.width - 0.5) * box.width);
      let alpha = 255;
      if (options.silhouette) {
        // Distance inside the silhouette's edge in output pixels, anti-aliased over ~1.5 px.
        const half = silhouetteHalfWidth(options.silhouette, (v + 0.5) / out.height) * (out.width / 2);
        alpha = Math.round(clamp((half - Math.abs(u + 0.5 - out.width / 2)) / 1.5 + 0.5, 0, 1) * 255);
      }
      data.set([sr * inside + fr * (1 - inside), sg * inside + fg * (1 - inside), sb * inside + fb * (1 - inside), alpha], (v * out.width + u) * 4);
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
