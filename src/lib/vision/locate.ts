// Automatic nail detection: the vision model names and locates every visible
// fingernail in an inspiration photo; the picker turns one hand's nails into
// taps for the outliner, so the user only corrects instead of tapping five
// times. Pure parts (format, parsing, hand choice) live here and are tested.
//
// Measured Oct 24 on the 4 test photos (claude-opus-5-5, effort low): every
// one of the 24 nails got a point inside its painted surface, 3–11 s per photo.

import { z } from "zod";
import { FINGERS, type Finger } from "@/lib/spec/types";

export const locateFormat = z.object({
  hands_visible: z.number().int(),
  nails: z.array(
    z.object({
      /** 1-based index of the hand this nail belongs to; nails of one hand share it. */
      hand: z.number().int(),
      finger: z.enum(FINGERS),
      /** Pixel coordinates of the nail's centre in the image as sent. */
      x: z.number(),
      y: z.number(),
      visible: z.enum(["full", "partial", "hidden"]),
      confidence: z.number(),
    }),
  ),
});

export interface LocatedNail {
  hand: number;
  finger: Finger;
  /** Centre of the painted nail as fractions (0–1) of the photo's width and height. */
  x: number;
  y: number;
  visible: "full" | "partial" | "hidden";
  confidence: number;
}

export interface NailLocations {
  handsVisible: number;
  nails: LocatedNail[];
}

export const locateSystem = (width: number, height: number) =>
  `You locate fingernails in nail-design inspiration photos for a salon app. The image is ${width} px wide and ${height} px tall; give pixel coordinates (origin top-left) of the CENTRE of each visible fingernail's painted surface, not the fingertip skin. Name each finger (thumb, index, middle, ring, pinky) as the person's own finger. Number the hands (1, 2, …) so every nail of the same hand carries the same number. A thumb seen edge-on, or a nail cut by the frame, is "partial". Report hidden nails only if you are sure which finger they are.`;

/** The model's reply (pixel coordinates in a `width` × `height` image) → fractions, dropping points outside the photo. */
export function parseLocations(raw: z.infer<typeof locateFormat>, width: number, height: number): NailLocations {
  const nails = raw.nails
    .filter((n) => n.visible !== "hidden" && n.x >= 0 && n.y >= 0 && n.x <= width && n.y <= height)
    .map((n) => ({
      hand: n.hand,
      finger: n.finger,
      x: n.x / width,
      y: n.y / height,
      visible: n.visible,
      confidence: Math.min(1, Math.max(0, n.confidence)),
    }));
  return { handsVisible: Math.max(raw.hands_visible, new Set(nails.map((n) => n.hand)).size), nails };
}

/**
 * The hand to suggest: the one with the most fully visible nails, then the
 * highest mean confidence. One entry per finger (the first listed wins), null
 * for a finger that hand doesn't show.
 */
export function chooseHand(locations: NailLocations): (LocatedNail | null)[] {
  const hands = new Map<number, LocatedNail[]>();
  for (const n of locations.nails) hands.set(n.hand, [...(hands.get(n.hand) ?? []), n]);
  let best: LocatedNail[] = [];
  let bestScore = -1;
  for (const nails of hands.values()) {
    const full = nails.filter((n) => n.visible === "full").length;
    const mean = nails.reduce((s, n) => s + n.confidence, 0) / nails.length;
    const score = full + mean;
    if (score > bestScore) {
      bestScore = score;
      best = nails;
    }
  }
  return FINGERS.map((f) => best.find((n) => n.finger === f) ?? null);
}
