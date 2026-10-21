// Tap-to-pick: one tap on an inspiration photo → that nail's outline, colours
// and a confidence; five picks → a draft DesignSpec. Pure, so it's unit-tested.

import { designSpecSchema, type DesignSpec, FINGERS, type Finger } from "@/lib/spec/types";
import { type NailColours, nailColours } from "./colours";
import type { LabImage } from "./oklab";
import { type NailRegion, nailRegion, type Point, type PreparedImage } from "./region";

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

/** Outlines and measures the nail under a tap. Null when nothing usable is there. */
export function pickNail(img: InspirationImage, tap: Point, expectedArea?: number): NailPick | null {
  const region = nailRegion(img.prepared, tap, { expectedArea });
  if (region.area === 0) return null;
  const colours = nailColours(img.detail, region.mask, img.scale);
  if (!colours) return null;
  const { width, height } = img.prepared.structure;
  return { tap, region, colours, confidence: pickConfidence(region, colours, width * height) };
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
