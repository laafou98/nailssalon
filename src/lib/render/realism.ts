// Realism pass over a finished Nail VTO render, design nails included. YouCam lays a press-on on like a sticker:
// a hard edge, no contact shadow where it meets the finger, and crisp, noise-free paint on a dim, grainy photo.
// Without touching the nail's colours, we
//  - on plain-colour nails, spread YouCam's hard studio-light gloss stripes into a soft sheen: it paints the same
//    pair of crisp white stripes on every nail, whatever the room's light;
//  - add grain with the photo's own noise level, measured around each nail (its smoothest parts: a textured
//    background like a knitted blanket is not sensor noise);
//  - keep the nail's highlights within reach of the brightest thing nearby in the photo (a soft knee): YouCam's
//    gloss and glare streaks are studio-white even on a dim photo. Shadows stay: a dark polish on light skin is
//    meant to be the darkest thing around;
//  - soften the nail's edge by about a pixel, blurring across it (not into the photo underneath: under a
//    press-on's cuticle edge is the pale bare nail, which drew a white rim);
//  - darken the skin just behind the cuticle edge (needs the hand landmarks to know which end that is).
// The nails are the pixels YouCam changed: away from the nails its render is the hand photo, pixel for pixel.
// Pure functions on raw RGB buffers; decoding and encoding live in composite-image.ts.

import { type Raster, clampByte, components, gaussianBlur, labDist, linearToSrgb, oklabToLinear, rankFilter, toLab } from "./raster";

export interface Point {
  x: number;
  y: number;
}

/** A finger's tip and its last joint, in normalised image coordinates (MediaPipe landmarks). */
export interface FingerAxis {
  tip: Point;
  joint: Point;
}

export interface RealismOptions {
  /** YouCam's own render, which tells us where the nails are; defaults to `image` (pass it when `image` was recoloured). */
  youcam?: Raster;
  /** One per finger; without them, no cuticle shadow. */
  fingers?: FingerAxis[];
  /** Darkening of the skin right at the cuticle edge (0–1). A press-on sits on top of the nail; polish barely lifts. */
  shadow?: number;
  /** Spread the gloss stripes into a soft sheen. Only for plain colours: on art, the white details are the design. */
  softenGloss?: boolean;
  /** Seed for the grain, so the same render always comes out the same. */
  seed?: number;
}

export interface RealismResult {
  image: Raster;
  nails: number;
  /** Nails whose lightness was fitted to the photo, and nails that got a cuticle shadow. */
  toned: number;
  shadowed: number;
}

/** OKLab change between photo and render that surely is paint; the mask then grows into weaker change nearby. */
const PAINT_STRONG = 0.08;
const PAINT_WEAK = 0.015;
const PAINT_WEAK_MAX = 0.06;
const GROW_STEPS = 4;
/** Closing size: fills bays where a dark press-on tip happens to match a dark background. */
const CLOSE_SIZE = 9;
/** Smaller painted blobs are noise, not nails (fraction of the image). */
const MIN_NAIL_FRACTION = 0.0002;
/** More change than this (fraction of the image) means the render isn't the photo plus nails: leave it alone. */
const MAX_PAINT_FRACTION = 0.25;
/** The ring around a nail where the photo is measured, in pixels from the nail's edge. */
const RING_NEAR = 3;
const RING_FAR = 24;
/** Lightness headroom for a polish's gloss: above the ring's brightest pixels, and at least above the nail itself. */
const HIGHLIGHT_HEADROOM = 0.1;
const GLOSS_MIN = 0.25;
/** How much of the photo's grain the nail gets. */
const GRAIN = 0.6;
/** Gloss softening: blur radius as a share of a typical nail's size, and how much of the stripes is spread out. */
const GLOSS_SPREAD = 0.35;
const GLOSS_SOFTEN = 1;
/** The softening fades in over about this many pixels inside the nail's edge. */
const GLOSS_EDGE = 2;
/** Width of the highlight knee, in OKLab L. */
const KNEE = 0.08;
/** Edge softening, in pixels. */
const EDGE_SIGMA = 0.9;
/** Shadow falloff behind the cuticle, in pixels, and how far out it is drawn. */
const SHADOW_FALLOFF = 1.4;
const SHADOW_REACH = 5;

/** MediaPipe landmark indices of each finger's tip and last joint, thumb to pinky. */
const TIP_LANDMARKS = [4, 8, 12, 16, 20];
const JOINT_LANDMARKS = [3, 7, 11, 15, 19];

/** Finger axes from the hand photo's stored MediaPipe result (21 normalised points), or undefined. */
export function fingerAxes(landmarks: unknown): FingerAxis[] | undefined {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return undefined;
  const point = (k: number): Point | null => {
    const p = landmarks[k] as { x?: unknown; y?: unknown } | null;
    return p && typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : null;
  };
  const axes = TIP_LANDMARKS.map((t, k) => ({ tip: point(t), joint: point(JOINT_LANDMARKS[k]) }));
  return axes.every((a) => a.tip && a.joint) ? (axes as FingerAxis[]) : undefined;
}

export function realismPass(hand: Raster, image: Raster, opts: RealismOptions = {}): RealismResult {
  const { width: w, height: h } = image;
  const youcam = opts.youcam ?? image;
  for (const r of [hand, youcam]) if (r.width !== w || r.height !== h) throw new Error("Hand and render sizes differ");
  const n = w * h;
  const untouched = { image, nails: 0, toned: 0, shadowed: 0 };

  // 1. Where YouCam painted.
  const handLab = toLab(hand.data, n);
  const youcamLab = toLab(youcam.data, n);
  const { mask, delta, weak } = paintMask(handLab, youcamLab, w, h);
  let painted = 0;
  for (let i = 0; i < n; i++) painted += mask[i];
  if (painted === 0 || painted > n * MAX_PAINT_FRACTION) return untouched;
  const { labels, count } = components(mask, w, h);
  const minSize = Math.max(1, n * MIN_NAIL_FRACTION);
  const nails = nailGeometry(labels, count, w).map((g) => ({ ...g, real: g.size >= minSize }));
  for (let i = 0; i < n; i++) if (labels[i] && !nails[labels[i] - 1].real) labels[i] = 0;
  const realCount = nails.filter((g) => g.real).length;
  if (realCount === 0) return untouched;

  // 2. The photo around each nail: nearest nail and distance for every pixel near one.
  const near = nearestNail(labels, w, h, RING_FAR);
  // youcamLab is done with once the mask is drawn, so the gloss softening may change it in place.
  const imageLab = youcam === image ? youcamLab : toLab(image.data, n);
  const glossed = opts.softenGloss ? softenGloss(imageLab, labels, nails, w, h) : null;
  const handHigh = [0, 1, 2].map((c) => highPass(hand.data, c, w, h));
  const stats = nails.map(() => ({ ringL: [] as number[], noise: [[], [], []] as number[][] }));
  for (let i = 0; i < n; i++) {
    const label = labels[i] || near.label[i];
    if (!label) continue;
    const s = stats[label - 1];
    if (labels[i]) continue;
    const d = near.dist[i];
    if (d < RING_NEAR || d > RING_FAR) continue;
    s.ringL.push(handLab[i * 3]);
    if (d <= RING_FAR / 2) for (let c = 0; c < 3; c++) s.noise[c].push(Math.abs(handHigh[c][i]));
  }

  // 3. Per nail: grain to add and the highlight ceiling.
  const allNoise = [0, 1, 2].map((c) => stats.flatMap((s) => s.noise[c]));
  const plans = nails.map((g, k) => {
    if (!g.real) return null;
    const s = stats[k];
    // YouCam's paint has no sensor noise of its own (art detail isn't grain), so the nail gets the photo's.
    const noise = [0, 1, 2].map((c) => GRAIN * noiseFloor(s.noise[c].length >= 50 ? s.noise[c] : allNoise[c]));
    s.ringL.sort((a, b) => a - b);
    const nailL = g.pixels.map((i) => imageLab[i * 3]).sort((a, b) => a - b);
    const ceiling = s.ringL.length >= 50
      ? Math.max(quantile(s.ringL, 0.99) + HIGHLIGHT_HEADROOM, quantile(nailL, 0.5) + GLOSS_MIN)
      : null;
    return { noise, ceiling };
  });

  // 4. Grain field: shared luminance with a little chroma, slightly soft like a phone's, scaled to unit spread.
  const grain = grainField(w, h, opts.seed ?? 1);

  // 5. Paint: tone and grain.
  const out = new Uint8Array(image.data);
  const toned = new Set<number>();
  for (let i = 0; i < n; i++) {
    const label = labels[i];
    if (!label) continue;
    const plan = plans[label - 1]!;
    // Fade both changes in with how much YouCam changed the pixel: where its paint is thin or happens to match
    // the photo, a hard step at the mask's edge would show.
    const sure = smoothstep(weak, PAINT_STRONG, delta[i]);
    const L0 = imageLab[i * 3], a = imageLab[i * 3 + 1], b = imageLab[i * 3 + 2];
    const L = plan.ceiling === null ? L0 : L0 + (softCeiling(L0, plan.ceiling) - L0) * sure;
    let rgb: number[];
    if (Math.abs(L - L0) > 1e-4 || glossed?.[i]) {
      if (Math.abs(L - L0) > 1e-4) toned.add(label);
      // Keep the chroma in proportion, so a toned-down highlight doesn't turn garish.
      const k = L / L0;
      rgb = oklabToLinear(L, a * k, b * k).map((v) => linearToSrgb(v) * 255);
    } else {
      rgb = [image.data[i * 3], image.data[i * 3 + 1], image.data[i * 3 + 2]];
    }
    for (let c = 0; c < 3; c++) {
      out[i * 3 + c] = clampByte(rgb[c] + sure * plan.noise[c] * (0.97 * grain.lum[i] + 0.15 * grain.chroma[c][i]));
    }
  }

  // 6. Soft edge: in a band about a pixel either side of the nail's outline, the image blurred across it.
  const soft = gaussianBlur(mask, w, h, EDGE_SIGMA);
  const band = new Float32Array(n);
  for (let i = 0; i < n; i++) band[i] = soft[i] > 0.01 && soft[i] < 0.99 ? 1 - Math.abs(2 * soft[i] - 1) : 0;
  for (let c = 0; c < 3; c++) {
    const channel = new Float32Array(n);
    for (let i = 0; i < n; i++) channel[i] = out[i * 3 + c];
    const blurred = gaussianBlur(channel, w, h, EDGE_SIGMA);
    for (let i = 0; i < n; i++) if (band[i]) out[i * 3 + c] = clampByte(channel[i] * (1 - band[i]) + blurred[i] * band[i]);
  }

  // 7. Contact shadow on the skin just behind each nail's cuticle edge.
  const axes = opts.fingers ? nailAxes(nails, opts.fingers, w, h) : [];
  const strength = opts.shadow ?? 0;
  const shadowed = new Set<number>();
  if (strength > 0 && axes.some(Boolean)) {
    for (let i = 0; i < n; i++) {
      if (labels[i] || !near.label[i] || near.dist[i] > SHADOW_REACH) continue;
      const k = near.label[i] - 1;
      const axis = axes[k];
      if (!axis) continue;
      const g = nails[k];
      const t = (((i % w) - g.cx) * axis.x + (Math.floor(i / w) - g.cy) * axis.y) / axis.halfLength;
      const behind = smoothstep(0.25, 0.75, -t);
      if (behind <= 0) continue;
      const dark = strength * behind * Math.exp(-Math.max(0, near.dist[i] - 0.5) / SHADOW_FALLOFF);
      for (let c = 0; c < 3; c++) out[i * 3 + c] = clampByte(out[i * 3 + c] * (1 - dark));
      shadowed.add(k + 1);
    }
  }

  return { image: { width: w, height: h, data: out }, nails: realCount, toned: toned.size, shadowed: shadowed.size };
}

// --- mask ---

/**
 * Strong change, opened (drops 1 px slivers from a resized render), grown into weaker change nearby, closed and
 * with holes filled.
 */
function paintMask(handLab: Float32Array, youcamLab: Float32Array, w: number, h: number): { mask: Float32Array; delta: Float32Array; weak: number } {
  const n = w * h;
  const delta = new Float32Array(n);
  let mask: Float32Array = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    delta[i] = labDist(handLab, youcamLab, i);
    mask[i] = delta[i] > PAINT_STRONG ? 1 : 0;
  }
  // YouCam usually returns the photo's own pixels around the nails; when it resampled the photo, every edge in it
  // differs a little, and growing into weak change would leak onto the skin. Raise the bar to that floor.
  const sample: number[] = [];
  for (let i = 0; i < n; i += 13) sample.push(delta[i]);
  sample.sort((a, b) => a - b);
  const weak = Math.min(PAINT_WEAK_MAX, Math.max(PAINT_WEAK, 2 * quantile(sample, 0.95)));
  mask = rankFilter(rankFilter(mask, w, h, 5, Math.min, 1), w, h, 5, Math.max, 0);
  for (let step = 0; step < GROW_STEPS; step++) {
    const next = new Float32Array(mask);
    for (let i = 0; i < n; i++) {
      if (mask[i] || delta[i] <= weak) continue;
      const x = i % w;
      if ((i >= w && mask[i - w]) || (i < n - w && mask[i + w]) || (x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1])) next[i] = 1;
    }
    mask = next;
  }
  mask = rankFilter(rankFilter(mask, w, h, CLOSE_SIZE, Math.max, 0), w, h, CLOSE_SIZE, Math.min, 1);
  // Fill holes: unpainted islands inside a nail (art that happens to match the photo) are still nail.
  const inverse = new Float32Array(n);
  for (let i = 0; i < n; i++) inverse[i] = 1 - mask[i];
  const { labels, count } = components(inverse, w, h);
  const border = new Uint8Array(count + 1);
  for (let x = 0; x < w; x++) border[labels[x]] = border[labels[n - w + x]] = 1;
  for (let y = 0; y < h; y++) border[labels[y * w]] = border[labels[y * w + w - 1]] = 1;
  for (let i = 0; i < n; i++) if (labels[i] && !border[labels[i]]) mask[i] = 1;
  return { mask, delta, weak };
}

interface NailGeometry {
  size: number;
  cx: number;
  cy: number;
  /** Pixels, for the axis length. */
  pixels: number[];
}

function nailGeometry(labels: Int32Array, count: number, w: number): NailGeometry[] {
  const geo = Array.from({ length: count }, () => ({ size: 0, cx: 0, cy: 0, pixels: [] as number[] }));
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const g = geo[labels[i] - 1];
    g.size++;
    g.cx += i % w;
    g.cy += Math.floor(i / w);
    g.pixels.push(i);
  }
  for (const g of geo) {
    g.cx /= g.size || 1;
    g.cy /= g.size || 1;
  }
  return geo;
}

/**
 * For every unpainted pixel within `reach` of a nail: the nearest nail and the distance to it.
 * Breadth-first, carrying each front pixel's nearest nail pixel, so distances are close to Euclidean.
 */
function nearestNail(labels: Int32Array, w: number, h: number, reach: number): { label: Int32Array; dist: Float32Array } {
  const n = w * h;
  const label = new Int32Array(n);
  const source = new Int32Array(n).fill(-1);
  const dist = new Float32Array(n).fill(Infinity);
  let front: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!labels[i]) continue;
    source[i] = i;
    dist[i] = 0;
    const x = i % w;
    if ((i >= w && !labels[i - w]) || (i < n - w && !labels[i + w]) || (x > 0 && !labels[i - 1]) || (x < w - 1 && !labels[i + 1])) front.push(i);
  }
  while (front.length) {
    const next: number[] = [];
    for (const i of front) {
      const x = i % w, y = Math.floor(i / w);
      const s = source[i], sx = s % w, sy = Math.floor(s / w);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (labels[j]) continue;
          const d = Math.hypot(xx - sx, yy - sy);
          if (d > reach || d >= dist[j]) continue;
          if (dist[j] === Infinity) next.push(j);
          dist[j] = d;
          source[j] = s;
          label[j] = labels[s];
        }
      }
    }
    front = next;
  }
  return { label, dist };
}

/** Each nail's direction towards its fingertip (unit vector) and half its length along it, from the nearest finger. */
function nailAxes(nails: (NailGeometry & { real: boolean })[], fingers: FingerAxis[], w: number, h: number) {
  return nails.map((g) => {
    if (!g.real) return null;
    const finger = fingers.reduce((best, f) =>
      Math.hypot(f.tip.x * w - g.cx, f.tip.y * h - g.cy) < Math.hypot(best.tip.x * w - g.cx, best.tip.y * h - g.cy) ? f : best);
    const ux = (finger.tip.x - finger.joint.x) * w, uy = (finger.tip.y - finger.joint.y) * h;
    const len = Math.hypot(ux, uy);
    if (len < 1) return null;
    const x = ux / len, y = uy / len;
    let halfLength = 0;
    for (const i of g.pixels) halfLength = Math.max(halfLength, Math.abs(((i % w) - g.cx) * x + (Math.floor(i / w) - g.cy) * y));
    return halfLength > 0 ? { x, y, halfLength } : null;
  });
}

// --- photo measurements ---

/** One channel minus its blur: the photo's grain and fine texture. */
function highPass(rgb: Uint8Array, c: number, w: number, h: number): Float32Array {
  const channel = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) channel[i] = rgb[i * 3 + c];
  const blurred = gaussianBlur(channel, w, h, 1.5);
  for (let i = 0; i < w * h; i++) channel[i] -= blurred[i];
  return channel;
}

/** Standard deviation from the median absolute value, so edges and specks don't count as grain. */
function robustSigma(absValues: number[]): number {
  if (absValues.length === 0) return 0;
  const sorted = Float32Array.from(absValues).sort();
  return 1.4826 * sorted[sorted.length >> 1];
}

/**
 * Standard deviation from the lower quartile of absolute values: the noise of the smoothest parts (skin), not of a
 * textured background, which the median picked up as grain and turned matte polish into sandpaper.
 */
function noiseFloor(absValues: number[]): number {
  if (absValues.length === 0) return 0;
  const sorted = Float32Array.from(absValues).sort();
  return sorted[sorted.length >> 2] / 0.3186; // a Gaussian's |x| has its lower quartile at 0.3186 σ
}

// --- gloss ---

/**
 * Spreads the bright detail of each nail (YouCam's hard gloss stripes) into a soft sheen, in place on `lab`: the
 * nail's lightness above its local average is replaced by a blur of it, and those pixels take the average chroma of
 * the nail's body, so the stripe doesn't turn grey once dimmed. Shading (darker than average) stays as painted.
 * The averages only cover nail pixels, and the change fades out over the nail's outer couple of pixels: the mask
 * takes in a little skin at the rim, which must keep its colour. The average is taken twice, the second time with
 * the highlights clipped to the first: stripes lift a plain average, and dimmed to it they stayed pale bands.
 * Works on the nails' bounding box only (the blurs are wide). Returns the pixels it changed.
 */
function softenGloss(lab: Float32Array, labels: Int32Array, nails: (NailGeometry & { real: boolean })[], w: number, h: number): Uint8Array {
  const changed = new Uint8Array(w * h);
  const sizes = nails.filter((g) => g.real).map((g) => g.size).sort((a, b) => a - b);
  if (sizes.length === 0) return changed;
  const sigma = Math.max(2, GLOSS_SPREAD * Math.sqrt(sizes[sizes.length >> 1]));

  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (!labels[i]) continue;
    const x = i % w, y = Math.floor(i / w);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const margin = Math.ceil(3 * sigma);
  x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin);
  x1 = Math.min(w - 1, x1 + margin); y1 = Math.min(h - 1, y1 + margin);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, m = bw * bh;
  const at = (j: number) => (y0 + Math.floor(j / bw)) * w + x0 + (j % bw);

  const inside = new Float32Array(m);
  for (let j = 0; j < m; j++) inside[j] = labels[at(j)] ? 1 : 0;
  const soft = gaussianBlur(inside, bw, bh, GLOSS_EDGE);
  const nail = new Float32Array(m);
  for (let j = 0; j < m; j++) if (inside[j]) nail[j] = smoothstep(0.5, 0.95, soft[j]);
  const blur = (weight: Float32Array, total: Float32Array, value: (j: number) => number) => {
    const weighted = new Float32Array(m);
    for (let j = 0; j < m; j++) if (weight[j]) weighted[j] = weight[j] * value(j);
    const blurred = gaussianBlur(weighted, bw, bh, sigma);
    for (let j = 0; j < m; j++) blurred[j] = total[j] > 1e-6 ? blurred[j] / total[j] : 0;
    return blurred;
  };
  const L = (j: number) => lab[at(j) * 3];
  const nailTotal = gaussianBlur(nail, bw, bh, sigma);
  const rough = blur(nail, nailTotal, L);
  const baseL = blur(nail, nailTotal, (j) => Math.min(L(j), rough[j]));
  const peak = new Float32Array(m);
  for (let j = 0; j < m; j++) if (inside[j]) peak[j] = Math.max(0, L(j) - baseL[j]);
  // Chroma of the body of the nail, not of its white highlights.
  const body = new Float32Array(m);
  for (let j = 0; j < m; j++) body[j] = nail[j] * (1 - smoothstep(0, 0.05, peak[j]));
  const bodyTotal = gaussianBlur(body, bw, bh, sigma);
  const [baseA, baseB] = [1, 2].map((c) => blur(body, bodyTotal, (j) => lab[at(j) * 3 + c]));
  const sheen = blur(nail, nailTotal, (j) => peak[j]);
  for (let j = 0; j < m; j++) {
    if (!nail[j] || (peak[j] === 0 && sheen[j] === 0)) continue;
    const i = at(j), s = GLOSS_SOFTEN * nail[j];
    lab[i * 3] -= s * (peak[j] - sheen[j]);
    const t = s * smoothstep(0, 0.12, peak[j]);
    lab[i * 3 + 1] += (baseA[j] - lab[i * 3 + 1]) * t;
    lab[i * 3 + 2] += (baseB[j] - lab[i * 3 + 2]) * t;
    changed[i] = 1;
  }
  return changed;
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

// --- tone and grain ---

/** L below `ceiling − KNEE` is kept; above, it is compressed towards the ceiling instead of clipped. */
function softCeiling(L: number, ceiling: number): number {
  const top = ceiling - KNEE;
  return L > top ? top + KNEE * Math.tanh((L - top) / KNEE) : L;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Deterministic Gaussian noise: one luminance field and three chroma fields, each softened a little and scaled so
 * that its high-pass (as measured on the photo) has unit spread. Then `sigma × field` matches the photo's grain.
 */
function grainField(w: number, h: number, seed: number): { lum: Float32Array; chroma: Float32Array[] } {
  const random = mulberry32(seed);
  const field = () => {
    const f = new Float32Array(w * h);
    for (let i = 0; i < f.length; i += 2) {
      // Box–Muller: two normals per pair of uniforms.
      const r = Math.sqrt(-2 * Math.log(random() || 1e-12)), t = 2 * Math.PI * random();
      f[i] = r * Math.cos(t);
      if (i + 1 < f.length) f[i + 1] = r * Math.sin(t);
    }
    const soft = gaussianBlur(f, w, h, 0.6);
    const blurred = gaussianBlur(soft, w, h, 1.5);
    const sample: number[] = [];
    for (let i = 0; i < soft.length; i += 7) sample.push(Math.abs(soft[i] - blurred[i]));
    const scale = 1 / (robustSigma(sample) || 1);
    for (let i = 0; i < soft.length; i++) soft[i] *= scale;
    return soft;
  };
  return { lum: field(), chroma: [field(), field(), field()] };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
