// Tap-to-pick: one tap on an inspiration photo → that nail's outline, colours
// and a confidence; five picks → a draft DesignSpec. Pure, so it's unit-tested.

import { designSpecSchema, type DesignSpec, FINGERS, type Finger, type PressOnShape } from "@/lib/spec/types";
import { NATURAL_ASPECT, TAPER, type TipShape, taper } from "./design";
import { type NailColours, nailColours } from "./colours";
import type { LabImage } from "./oklab";
import { type NailRegion, nailRegion, type Point, type PreparedImage, regionFromMask } from "./region";

export interface InspirationImage {
  /** Working resolution (long side ≈ 512): outlines are found here. */
  prepared: PreparedImage;
  /** The same photo at `scale`× the working resolution: colours are measured here. */
  detail: LabImage;
  scale: number;
}

export interface NailPick {
  /** Tap position in working-image pixels. */
  tap: Point;
  region: NailRegion;
  colours: NailColours;
  /** 0–1: how much to trust this outline and its colours. */
  confidence: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Confidence from things we can measure: a convex, ellipse-like outline of a
 * plausible size, a clear edge around it, and colours that separate cleanly.
 */
export function pickConfidence(region: NailRegion, colours: NailColours, imageArea: number): number {
  const shape = clamp01((region.convexity - 0.75) / 0.2) * clamp01(region.fill / 0.72);
  const fraction = region.area / imageArea;
  const size = fraction < 0.002 ? fraction / 0.002 : fraction > 0.05 ? clamp01(1 - (fraction - 0.05) / 0.05) : 1;
  const edge = clamp01(region.edgeContrast / 0.025);
  const colour = colours.accents.length > 0 ? clamp01(colours.separation / 3) : clamp01(colours.separation);
  return Math.round((0.35 * shape + 0.15 * size + 0.2 * edge + 0.3 * colour) * 100) / 100;
}

/** A nail outline found by SlimSAM for this tap, with the model's predicted IoU (0–1). */
export interface SamOutline {
  mask: Uint8Array;
  score: number;
}

/**
 * Outlines and measures the nail under a tap. Null when nothing usable is there.
 * With a SlimSAM outline, that is the nail (its score counts for half the
 * confidence); without one, the colour flood finds it.
 */
export function pickNail(img: InspirationImage, tap: Point, expectedArea?: number, sam?: SamOutline): NailPick | null {
  const region = sam ? regionFromMask(img.prepared, sam.mask, tap) : nailRegion(img.prepared, tap, { expectedArea });
  if (region.area === 0) return null;
  const colours = nailColours(img.detail, region.mask, img.scale);
  if (!colours) return null;
  const { width, height } = img.prepared.structure;
  const measured = pickConfidence(region, colours, width * height);
  const confidence = sam ? Math.round(((measured + sam.score) / 2) * 100) / 100 : measured;
  return { tap, region, colours, confidence };
}

/** Median area of the picks so far: nails in one photo are alike, so it bounds the next outline. */
export function typicalArea(picks: (NailPick | null)[]): number | undefined {
  const areas = picks.filter((p): p is NailPick => p !== null).map((p) => p.region.area).sort((a, b) => a - b);
  return areas.length ? areas[areas.length >> 1] : undefined;
}

/** For each finger, the picked finger whose colours it uses: itself, or the nearest picked one. */
export function sourceFingers(picks: (NailPick | null)[]): (number | null)[] {
  return FINGERS.map((_, i) => {
    if (picks[i]) return i;
    for (let d = 1; d < FINGERS.length; d++) {
      if (picks[i - d]) return i - d; // ties go to the thumb side
      if (picks[i + d]) return i + d;
    }
    return null;
  });
}

/** Confidence for a finger that wasn't picked and borrows another's colours. */
const COPIED_CONFIDENCE = 0.3;

/**
 * Five picks (thumb → pinky, null = skipped) → a draft DesignSpec: one colour
 * per finger, cream finish, solid pattern. Finish and pattern come from the
 * vision model later; the editor lets the user change anything.
 */
export function draftSpec(picks: (NailPick | null)[]): DesignSpec | null {
  const sources = sourceFingers(picks);
  if (sources.every((s) => s === null)) return null;
  const confidences = FINGERS.map((_, i) => {
    const from = picks[sources[i]!]!;
    return sources[i] === i ? from.confidence : Math.min(COPIED_CONFIDENCE, from.confidence);
  });
  const fingers = Object.fromEntries(
    FINGERS.map((finger, i) => {
      const from = picks[sources[i]!]!;
      return [
        finger,
        {
          kind: "color",
          baseHex: from.colours.base.hex,
          accentHexes: from.colours.accents.slice(0, 4).map((a) => a.hex),
          texture: "cream",
          pattern: "solid",
          confidence: confidences[i],
        },
      ];
    }),
  ) as Record<Finger, unknown>;
  return designSpecSchema.parse({
    version: 1,
    source: { kind: "inspiration" },
    effectType: "nail_polish",
    fingers,
    confidence: Math.round((confidences.reduce((a, b) => a + b, 0) / FINGERS.length) * 100) / 100,
  });
}

/**
 * Switches fingers to their cut-out artwork: `designIds[i]` is the stored design
 * PNG for finger i (thumb → pinky), or null to keep it a plain colour. The base
 * colour stays, for polish matching and the recipe card.
 */
export function withDesigns(spec: DesignSpec, designIds: (string | null)[]): DesignSpec {
  const fingers = Object.fromEntries(
    FINGERS.map((finger, i) => {
      const f = spec.fingers[finger];
      const id = designIds[i];
      return [finger, id ? { ...f, kind: "design", pattern: "art", designImageId: id } : f];
    }),
  );
  return designSpecSchema.parse({ ...spec, fingers });
}

export { TIP_SHAPES, type TipShape } from "./design";

/** YouCam press-on shape for a tip shape: we keep a natural oval cuticle. */
export const pressOnShape = (tip: TipShape): PressOnShape => `${tip}_oval`;

/** Extension lengths offered (YouCam's press-on `length`, 0.8–2.15). */
export const LENGTHS = [
  { label: "Short", value: 1 },
  { label: "Medium", value: 1.4 },
  { label: "Long", value: 1.8 },
  { label: "Extra long", value: 2.15 },
] as const;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];

/**
 * Shape and length the inspiration nails seem to have: tapered ends → almond
 * (stiletto when sharply pointed), boxy outlines → square, else oval; length from
 * how much longer than a short natural nail they are, snapped to the offered steps.
 */
export function guessExtensions(picks: (NailPick | null)[], maskWidth: number): { tip: TipShape; length: number } | null {
  const regions = picks.filter((p): p is NailPick => p !== null).map((p) => p.region);
  if (regions.length === 0) return null;
  const t = median(regions.map((r) => taper(r, maskWidth)));
  const fill = median(regions.map((r) => r.fill));
  const tip: TipShape = t < 0.45 ? "stiletto" : t < TAPER ? "almond" : fill > 0.86 ? "square" : "oval";
  const aspect = median(regions.map((r) => r.box.length / Math.max(1, r.box.width)));
  const wanted = aspect / NATURAL_ASPECT;
  const length = LENGTHS.reduce((best, l) => (Math.abs(l.value - wanted) < Math.abs(best - wanted) ? l.value : best), LENGTHS[0].value as number);
  return { tip, length };
}

/** Turns a polish design into press-on extensions with this shape and length. */
export function asExtensions(spec: DesignSpec, tip: TipShape, length: number): DesignSpec {
  return designSpecSchema.parse({ ...spec, effectType: "press_on_nails", shape: pressOnShape(tip), length });
}
