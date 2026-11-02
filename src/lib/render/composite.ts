// True-colour composite of a YouCam Nail VTO render (port of scripts/prototypes/true_colour_composite.py).
// YouCam finds and shades the nails well, but drifts the hue (coral came back red) and paints a crisp,
// noise-free nail onto a grainy photo. We keep its nail mask and lightness pattern, swap in the exact
// requested colour (OKLab), and add the photo's grain. Unlike the prototype, the base is YouCam's render,
// not the bare hand: a nail we fail to detect (a pale polish close to the natural nail) keeps YouCam's paint
// instead of vanishing. Only for plain-colour specs: design nails are split by the mask and came out torn.
// Pure functions on raw RGB buffers; decoding and encoding live in composite-image.ts.

import { type Lab, deltaE, hexToRgb, rgbToOklab } from "@/lib/inspo/oklab";
import { type DesignSpec, FINGERS, type Texture } from "@/lib/spec/types";
import {
  type Raster, clampByte, components, gaussianBlur, growLabels, linearToSrgb, oklabToLinear, paintMask, toLab,
} from "./raster";

export type { Raster };

export interface NailTarget {
  /** Requested polish colour, #RRGGBB; null keeps YouCam's paint (see-through finishes). */
  hex: string | null;
  /** The finger's tip in normalised image coordinates (MediaPipe landmark), when known. */
  tip?: { x: number; y: number };
  /** The finger's last joint, for the nail's axis when its shading has to be drawn (see `CLIPPED_MIN`). */
  joint?: { x: number; y: number };
}

export interface CompositeOptions {
  /**
   * One per finger. A nail takes the colour of the nearest fingertip; without tips, the requested
   * colour nearest to YouCam's rendering of it (can swap fingers whose colours are close).
   */
  targets: NailTarget[];
  /** How much of the photo's grain goes onto the nail (default 0.8); 0 when the realism pass adds its own. */
  grain?: number;
}

export interface CompositeResult {
  image: Raster;
  /** Nails found in the render, and how many of them were recoloured. */
  nails: number;
  recoloured: number;
  /** Recoloured nails whose shading was drawn because the photo's plate was blown out. */
  drawn: number;
}

/** Smaller painted blobs are noise, not nails (fraction of the image). */
const MIN_NAIL_FRACTION = 0.0002;
/** How much of YouCam's lightness variation (shading, highlights) we keep. */
const SHADING = 0.8;
/** Default share of the photo's grain on the nail. */
const GRAIN = 0.8;
/** OKLab L at which a photo pixel counts as blown out (about 246 and up). */
const CLIPPED_L = 0.97;
/**
 * A nail plate blown out to white in the photo gives YouCam nothing to shade: its paint comes back a flat cap (Nov 2,
 * a hand on a dark table: nail plates at a median of 254). From this share of clipped photo under the paint the
 * nail's shading is drawn instead, fully from `CLIPPED_FULL`. YouCam's cap over such a plate takes in fingertip skin
 * too, so those nails measured 0.31–0.45 (the side-on thumb 0.88); every nail of the well-exposed photos measured 0.
 */
const CLIPPED_MIN = 0.15;
const CLIPPED_FULL = 0.4;
/** The drawn shading: a curved plate darker towards its sides and the cuticle, one broad soft sheen off centre. */
const SIDE_SHADE = 0.2;
const CUTICLE_SHADE = 0.05;
const SHEEN = 0.09;
const SHEEN_OFFSET = 0.3;
const SHEEN_WIDTH = 0.3;

/** MediaPipe hand landmark index of each finger's tip and last joint, in FINGERS order. */
const TIP_LANDMARKS = [4, 8, 12, 16, 20];
const JOINT_LANDMARKS = [3, 7, 11, 15, 19];

/**
 * Finishes whose colour YouCam mixes with the bare nail underneath. Recolouring them with the solid requested colour
 * made a crimson jelly an opaque, bright red; YouCam's own see-through paint is the truer picture.
 */
const SEE_THROUGH: ReadonlySet<Texture> = new Set(["jelly", "sheer"]);

/**
 * Targets for a spec, or null when no finger is recoloured. Design fingers keep YouCam's paint (their art comes from
 * the PNG, and the mask splits two-tone nails), as do see-through finishes; the plain fingers next to them still get
 * their exact colour.
 * `landmarks` is the hand photo's stored MediaPipe result: 21 normalised points.
 */
export function compositeTargets(spec: DesignSpec, landmarks: unknown): NailTarget[] | null {
  const recolour = (f: (typeof spec.fingers)[keyof typeof spec.fingers]) => f.kind === "color" && !SEE_THROUGH.has(f.texture);
  if (!FINGERS.some((f) => recolour(spec.fingers[f]))) return null;
  const points = Array.isArray(landmarks) && landmarks.length === 21 ? (landmarks as { x?: unknown; y?: unknown }[]) : null;
  const point = (k: number) => {
    const p = points?.[k];
    return p && typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : undefined;
  };
  return FINGERS.map((finger, k) => {
    const f = spec.fingers[finger];
    return { hex: recolour(f) ? f.baseHex : null, tip: point(TIP_LANDMARKS[k]), joint: point(JOINT_LANDMARKS[k]) };
  });
}

export function trueColourComposite(hand: Raster, render: Raster, opts: CompositeOptions): CompositeResult {
  const { width: w, height: h } = render;
  if (hand.width !== w || hand.height !== h) throw new Error("Hand and render sizes differ");
  const n = w * h;
  const handLab = toLab(hand.data, n);
  const renderLab = toLab(render.data, n);

  // Where YouCam painted (raster.ts): the same mask as the realism pass, so polish close to the bare nail's colour
  // (pink over a pink nail) is recoloured whole instead of leaving the natural nail showing through.
  const { mask: painted } = paintMask(handLab, renderLab, w, h);

  // One label per nail, each with its finger's colour.
  const { labels, count } = components(painted, w, h);
  const nails = nailStats(labels, count, renderLab, handLab, w);
  const minSize = Math.max(1, n * MIN_NAIL_FRACTION);
  const targets = opts.targets.map((t) => ({
    lab: t.hex ? hexToLab(t.hex) : null,
    tip: t.tip && { x: t.tip.x * w, y: t.tip.y * h },
    joint: t.joint && { x: t.joint.x * w, y: t.joint.y * h },
  }));
  const withTips = targets.filter((t) => t.tip);
  const solid = targets.filter((t): t is { lab: Lab; tip: typeof t.tip; joint: typeof t.joint } => t.lab !== null);
  const chosen = nails.map((nail) => {
    if (nail.size < minSize || solid.length === 0) return null;
    if (withTips.length) {
      const dist = (t: (typeof targets)[number]) => Math.hypot(t.tip!.x - nail.cx, t.tip!.y - nail.cy);
      return withTips.reduce((best, t) => (dist(t) < dist(best) ? t : best));
    }
    return solid.reduce((best, t) => (deltaE(t.lab, nail.mean) < deltaE(best.lab, nail.mean) ? t : best));
  });
  const targetOf: (Lab | null)[] = chosen.map((t) => t?.lab ?? null);
  // Nails whose plate the photo blew out, with the frame their shading is drawn in: the finger's axis (joint → tip)
  // and the nail's half-extents along and across it.
  const drawn = nails.map((nail, k) => {
    const t = chosen[k];
    if (!t?.lab || !t.tip || !t.joint || nail.clipped < CLIPPED_MIN) return null;
    const len = Math.hypot(t.tip.x - t.joint.x, t.tip.y - t.joint.y);
    if (len < 1) return null;
    const ux = (t.tip.x - t.joint.x) / len, uy = (t.tip.y - t.joint.y) / len;
    const vx = -uy, vy = ux;
    let along = 0, across = 0;
    for (const i of nail.pixels) {
      const dx = (i % w) - nail.cx, dy = Math.floor(i / w) - nail.cy;
      along = Math.max(along, Math.abs(dx * ux + dy * uy));
      across = Math.max(across, Math.abs(dx * vx + dy * vy));
    }
    return { ux, uy, vx, vy, along: along || 1, across: across || 1, weight: smoothstep(CLIPPED_MIN, CLIPPED_FULL, nail.clipped) };
  });

  // Soft edge: blur the recoloured nails' mask; the fringe takes the nearest nail's label.
  const keep = new Float32Array(n);
  for (let i = 0; i < n; i++) if (labels[i] > 0 && targetOf[labels[i] - 1]) keep[i] = 1;
  const mask = gaussianBlur(keep, w, h, 1.2);
  const fringeLabels = growLabels(labels, w, h, 3);

  const grainAmount = opts.grain ?? GRAIN;
  const grain = [0, 1, 2].map((c) => {
    const channel = new Float32Array(n);
    for (let i = 0; i < n; i++) channel[i] = hand.data[i * 3 + c];
    const blurred = gaussianBlur(channel, w, h, 1.5);
    for (let i = 0; i < n; i++) channel[i] -= blurred[i];
    return channel;
  });

  const out = new Uint8Array(render.data);
  for (let i = 0; i < n; i++) {
    const m = mask[i];
    const label = fringeLabels[i];
    const target = label ? targetOf[label - 1] : null;
    if (m <= 0.002 || !target) continue;
    // YouCam's lightness pattern centred on the target; highlights lose chroma, as real speculars do. Shading is
    // scaled in proportion: an offset made for a bright blue took a navy's rim to black (a dark ring round the nail).
    const nail = nails[label - 1], rL = renderLab[i * 3], medianL = nail.medianL;
    let L = rL >= medianL ? target.L + (rL - medianL) * SHADING : target.L * (1 - SHADING * (1 - rL / medianL));
    const frame = drawn[label - 1];
    if (frame) {
      const dx = (i % w) - nail.cx, dy = Math.floor(i / w) - nail.cy;
      const s = clamp((dx * frame.ux + dy * frame.uy) / frame.along, -1, 1); // −1 cuticle … +1 free edge
      const t = clamp((dx * frame.vx + dy * frame.vy) / frame.across, -1, 1); // across the plate
      const shadedL = target.L * (1 - SIDE_SHADE * t * t - CUTICLE_SHADE * smoothstep(0.4, 1, -s))
        + SHEEN * Math.exp(-(((t - SHEEN_OFFSET) / SHEEN_WIDTH) ** 2)) * (1 - 0.3 * s * s);
      L += (shadedL - L) * frame.weight;
    }
    const hi = Math.min(1, Math.max(0, (L - target.L) / 0.25));
    const lin = oklabToLinear(L, target.a * (1 - 0.7 * hi), target.b * (1 - 0.7 * hi));
    for (let c = 0; c < 3; c++) {
      const v = linearToSrgb(lin[c]) * 255 + grain[c][i] * grainAmount;
      out[i * 3 + c] = clampByte(v * m + render.data[i * 3 + c] * (1 - m));
    }
  }

  const sized = nails.filter((nail) => nail.size >= minSize).length;
  return {
    image: { width: w, height: h, data: out },
    nails: sized,
    recoloured: targetOf.filter(Boolean).length,
    drawn: drawn.filter(Boolean).length,
  };
}

const hexToLab = (hex: string) => rgbToOklab(...hexToRgb(hex));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

interface NailStats {
  size: number;
  /** Mean render colour of the nail. */
  mean: Lab;
  medianL: number;
  /** Centroid, in pixels. */
  cx: number;
  cy: number;
  /** Share of the nail where the photo underneath is blown out. */
  clipped: number;
  pixels: number[];
}

function nailStats(labels: Int32Array, count: number, lab: Float32Array, handLab: Float32Array, w: number): NailStats[] {
  const sums = Array.from({ length: count }, () => ({ size: 0, L: 0, a: 0, b: 0, x: 0, y: 0, clipped: 0, Ls: [] as number[], pixels: [] as number[] }));
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const s = sums[labels[i] - 1];
    const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
    s.size++;
    s.L += L; s.a += a; s.b += b;
    s.x += i % w; s.y += Math.floor(i / w);
    if (handLab[i * 3] >= CLIPPED_L) s.clipped++;
    s.Ls.push(L);
    s.pixels.push(i);
  }
  return sums.map((s) => {
    s.Ls.sort((x, y) => x - y);
    return {
      size: s.size,
      mean: { L: s.L / s.size, a: s.a / s.size, b: s.b / s.size },
      medianL: s.Ls[s.Ls.length >> 1],
      cx: s.x / s.size,
      cy: s.y / s.size,
      clipped: s.clipped / s.size,
      pixels: s.pixels,
    };
  });
}
