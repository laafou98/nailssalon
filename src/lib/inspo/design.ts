// Design images: the artwork of one tapped nail, cut out of the inspiration photo,
// turned upright (tip at the top) and sized for Nail VTO's `sub_type: "design"`.
// Two fits: "natural" (polish on the client's own, usually shorter, nails: the
// busiest stretch of the art at short-nail proportions, so it isn't squashed) and
// "full" (press-on extensions: the whole nail, drawn into a clean nail silhouette
// on a transparent background, because YouCam uses the PNG's outline as the nail).
// The art is read from the nail's solid body (no ragged base-colour fringe)
// and the photo's glare streaks are painted out, so YouCam can light the nail itself.
// Pure, so it's unit-tested; the browser turns the result into a PNG.

import { chroma, hexToRgb, rgbToOklab } from "./oklab";
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

/**
 * A cut-out is too poor to pass as a design when its outline isn't a whole nail face-on:
 * seen side-on (width under MIN_SIDE_RATIO of its length) or a partial, odd shape (the box
 * mostly empty or the outline far from convex: the side-on thumb sliver of Oct 25 measured
 * fill 0.50 and convexity 0.73, whole nails ≥ 0.66 and ≥ 0.81); or when it comes out
 * blurry at the size YouCam gets it (a safety net: blown-up crops scored 0.012–0.017,
 * usable smoke art 0.020–0.049).
 */
export const MIN_SIDE_RATIO = 0.25;
export const MIN_FILL = 0.58;
export const MIN_CONVEXITY = 0.78;
export const MIN_SHARPNESS = 0.015;

/** `sharpness`: see `cutoutSharpness`, for display and debugging. */
export type CutoutDetail = ({ ok: true } | { ok: false; reason: "side_on" | "partial" | "blurry" }) & { sharpness: number };

/** Whether a nail's cut-out (`design`, from nailDesign) shows a whole, sharp nail worth copying. */
export function cutoutDetail(region: NailRegion, design: RgbaImage): CutoutDetail {
  const sharpness = Math.round(cutoutSharpness(design) * 1000) / 1000;
  if (region.box.width < MIN_SIDE_RATIO * region.box.length) return { ok: false, reason: "side_on", sharpness };
  if (region.fill < MIN_FILL || region.convexity < MIN_CONVEXITY) return { ok: false, reason: "partial", sharpness };
  if (sharpness < MIN_SHARPNESS) return { ok: false, reason: "blurry", sharpness };
  return { ok: true, sharpness };
}

/**
 * How crisp a cut-out is: the 90th percentile of luminance gradient (central differences, 0–1
 * scale) over its opaque pixels. A blurry nail blown up to YouCam's size has only soft ramps.
 */
export function cutoutSharpness(img: RgbaImage): number {
  const { width: w, height: h, data } = img;
  const Y = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) Y[p] = (0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2]) / 255;
  const g: number[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (data[p * 4 + 3] < 250) continue;
      g.push(Math.hypot(Y[p + 1] - Y[p - 1], Y[p + w] - Y[p - w]));
    }
  if (g.length === 0) return 0;
  g.sort((a, b) => a - b);
  return g[Math.floor(g.length * 0.9)];
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
  const [lo, hi] = bodySpan(out.height, (v) => from - ((v + 0.5) / out.height) * (from - to), box.width, (along, side) =>
    maskAt(mask, maskWidth, maskHeight, box.cx + along * d.x + side * across.x, box.cy + along * d.y + side * across.y),
  );
  const data = new Uint8ClampedArray(out.width * out.height * 4);
  for (let v = 0; v < out.height; v++) {
    const along = from - ((v + 0.5) / out.height) * (from - to);
    for (let u = 0; u < out.width; u++) {
      const [sr, sg, sb, inside] = at(along, lo + ((u + 0.5) / out.width) * (hi - lo));
      let alpha = 255;
      if (options.silhouette) {
        // Distance inside the silhouette's edge in output pixels, anti-aliased over ~1.5 px.
        const half = silhouetteHalfWidth(options.silhouette, (v + 0.5) / out.height) * (out.width / 2);
        alpha = Math.round(clamp((half - Math.abs(u + 0.5 - out.width / 2)) / 1.5 + 0.5, 0, 1) * 255);
      }
      data.set([sr * inside + fr * (1 - inside), sg * inside + fg * (1 - inside), sb * inside + fb * (1 - inside), alpha], (v * out.width + u) * 4);
    }
  }
  return removeGlare({ data, ...out });
}

/**
 * The stretch across the nail to read (side offsets, working px), the same for every row:
 * the solid body of the outline, its ragged rim trimmed off, so the art fills the cut-out's
 * width instead of a base-colour fringe. One span for all rows keeps the art undistorted
 * (per-row spans followed the ragged outline and bent straight lines into zigzags).
 */
function bodySpan(
  rows: number,
  alongOf: (v: number) => number,
  width: number,
  inside: (along: number, side: number) => number,
): [number, number] {
  const half = width / 2 + 2, step = 0.25;
  const los: number[] = [], his: number[] = [];
  for (let v = 0; v < rows; v += Math.max(1, Math.floor(rows / 64))) {
    const along = alongOf(v);
    let lo = Infinity, hi = -Infinity;
    for (let side = -half; side <= half; side += step) {
      if (inside(along, side) >= 0.5) {
        lo = Math.min(lo, side);
        hi = Math.max(hi, side);
      }
    }
    if (hi > lo) {
      los.push(lo);
      his.push(hi);
    }
  }
  if (los.length === 0) return [-width / 2, width / 2];
  // A little inside the typical edges: most rows are then nail all the way across.
  const at = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.floor(q * (values.length - 1))];
  const lo = at(los, 0.6) + 0.75, hi = at(his, 0.4) - 0.75;
  return hi - lo > width / 2 ? [lo, hi] : [-width / 2, width / 2];
}

/** Glare: near-white, colourless, clearly brighter than the nail around it… */
const GLARE_MIN_L = 0.78;
const GLARE_MAX_CHROMA = 0.045;
const GLARE_ABOVE_LOCAL = 0.12;
/** …and its halo: next to a streak, anything this much brighter than the nail around it. */
const GLARE_HALO = 0.03;

/**
 * Paints out the photo's specular streaks: thin, straight, near-white strokes running
 * along the nail (a nail curves across its width, so its highlights run lengthwise:
 * near-vertical in the upright cut-out). Left in, YouCam renders them as part of the art,
 * in the wrong place for the client's light (the white slashes on the Oct 25 extensions).
 * Curvy or crosswise white art, dots and wide white areas (French tips) are kept.
 */
export function removeGlare(img: RgbaImage): RgbaImage {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const L = new Float32Array(n), C = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const lab = rgbToOklab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
    L[p] = lab.L;
    C[p] = chroma(lab);
  }
  const local = boxBlur(L, w, h, Math.max(4, Math.round(w / 8)));
  const bright = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    bright[p] = data[p * 4 + 3] > 0 && L[p] > GLARE_MIN_L && C[p] < GLARE_MAX_CHROMA && L[p] > local[p] + GLARE_ABOVE_LOCAL ? 1 : 0;
  }

  // Keep the streak-shaped pieces.
  const glare = new Uint8Array(n);
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (!bright[start] || seen[start]) continue;
    const piece: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      piece.push(p);
      const x = p % w;
      for (const q of [p - w, p + w, x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1]) {
        if (q >= 0 && q < n && bright[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (isStreak(piece, w)) for (const p of piece) glare[p] = 1;
  }

  // Grow the streak over its soft halo (still a little brighter than the nail), then fill it in from around it.
  const near = dilateMask(glare, w, h, Math.max(3, Math.round(w / 30)));
  const hole = dilateMask(glare, w, h, Math.max(2, Math.round(w / 90)));
  for (let p = 0; p < n; p++) if (near[p] && L[p] > local[p] + GLARE_HALO) hole[p] = 1;
  const filled = dilateMask(hole, w, h, 1);
  return { ...img, data: inpaint(data, filled, w, h) };
}

/** Streaks may lean this far from the nail's axis (vertical). */
const GLARE_MAX_LEAN = (35 * Math.PI) / 180;

/**
 * Long, thin, straight and lengthwise: length ≥ 4× width, width ≤ 18% of the image (the short
 * natural-length window magnifies a streak to ~14%), filling most of its box.
 */
function isStreak(piece: number[], w: number): boolean {
  if (piece.length < 6) return false;
  let mx = 0, my = 0;
  for (const p of piece) {
    mx += p % w;
    my += Math.floor(p / w);
  }
  mx /= piece.length;
  my /= piece.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of piece) {
    const dx = (p % w) - mx, dy = Math.floor(p / w) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(angle), uy = Math.sin(angle);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of piece) {
    const dx = (p % w) - mx, dy = Math.floor(p / w) - my;
    const a = dx * ux + dy * uy, b = -dx * uy + dy * ux;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a);
    b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  const length = a1 - a0 + 1, width = b1 - b0 + 1;
  const lean = Math.abs(Math.abs(angle) - Math.PI / 2); // 0 = vertical
  return lean <= GLARE_MAX_LEAN && length >= 4 * width && width <= 0.18 * w && piece.length >= 0.5 * length * width;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const pass = (input: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(w * h);
    const len = horizontal ? w : h, lines = horizontal ? h : w;
    for (let line = 0; line < lines; line++) {
      const idx = (i: number) => (horizontal ? line * w + i : i * w + line);
      let sum = 0, count = 0;
      for (let i = 0; i <= Math.min(len - 1, r); i++, count++) sum += input[idx(i)];
      for (let i = 0; i < len; i++) {
        out[idx(i)] = sum / count;
        if (i + r + 1 < len) { sum += input[idx(i + r + 1)]; count++; }
        if (i - r >= 0) { sum -= input[idx(i - r)]; count--; }
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

function dilateMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const x = p % w, y = Math.floor(p / w);
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) out[yy * w + xx] = 1;
  }
  return out;
}

/**
 * Fills `hole` pixels from the outside in, each with the mean of its already-known neighbours,
 * then relaxes them towards the average of all their neighbours (a smooth blend across the
 * hole instead of blocky onion layers meeting in a seam).
 */
function inpaint(data: Uint8ClampedArray, hole: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = data.slice();
  const known = Uint8Array.from(hole, (v) => (v ? 0 : 1));
  let remaining = hole.reduce((a, b) => a + b, 0);
  while (remaining > 0) {
    const next: number[] = [];
    for (let p = 0; p < hole.length; p++) {
      if (known[p]) continue;
      const x = p % w, y = Math.floor(p / w);
      let r = 0, g = 0, b = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h && known[yy * w + xx]) {
            const q = (yy * w + xx) * 4;
            r += out[q]; g += out[q + 1]; b += out[q + 2]; k++;
          }
        }
      if (k) {
        out.set([r / k, g / k, b / k], p * 4); // alpha unchanged
        next.push(p);
      }
    }
    if (next.length === 0) break;
    for (const p of next) known[p] = 1;
    remaining -= next.length;
  }
  const holes = hole.reduce<number[]>((acc, v, p) => (v ? (acc.push(p), acc) : acc), []);
  for (let iter = 0; iter < 80; iter++) {
    for (const p of holes) {
      const x = p % w, y = Math.floor(p / w);
      for (let c = 0; c < 3; c++) {
        let sum = 0, k = 0;
        if (x > 0) { sum += out[(p - 1) * 4 + c]; k++; }
        if (x < w - 1) { sum += out[(p + 1) * 4 + c]; k++; }
        if (y > 0) { sum += out[(p - w) * 4 + c]; k++; }
        if (y < h - 1) { sum += out[(p + w) * 4 + c]; k++; }
        out[p * 4 + c] = sum / k;
      }
    }
  }
  return out;
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
