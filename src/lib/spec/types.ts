// DesignSpec: the editable, per-finger description of a nail design.
// Everything flows through it (extraction → editor → render → polish matching),
// so it is validated with zod at every server boundary.

import { z } from "zod";

export const FINGERS = ["thumb", "index", "middle", "ring", "pinky"] as const;
export type Finger = (typeof FINGERS)[number];

export const TEXTURES = [
  "matte", "cream", "jelly", "sheer", "metallic", "pearl", "shimmer_fine", "shimmer_coarse", "textured",
] as const;
export type Texture = (typeof TEXTURES)[number];

/** YouCam's press-on shapes (plugins-media.makeupar.com/wcm-saas/shapes/nails.json). */
export const PRESS_ON_SHAPES = [
  "square_oval", "square_square", "square_squoval",
  "squoval_oval", "squoval_square", "squoval_squoval",
  "oval_oval", "oval_square", "oval_squoval",
  "almond_oval", "almond_square", "almond_squoval",
  "stiletto_oval", "stiletto_square", "stiletto_squoval",
] as const;
export type PressOnShape = (typeof PRESS_ON_SHAPES)[number];

export const PATTERNS = ["solid", "french", "ombre", "cat_eye", "art"] as const;

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Expected a #RRGGBB colour").transform((s) => s.toUpperCase());

export const fingerSpecSchema = z
  .object({
    kind: z.enum(["color", "design"]),
    baseHex: hex,
    accentHexes: z.array(hex).max(4).default([]),
    texture: z.enum(TEXTURES),
    pattern: z.enum(PATTERNS).default("solid"),
    /** images.id of the per-finger design PNG, required when kind = "design". */
    designImageId: z.uuid().optional(),
    confidence: z.number().min(0).max(1).default(1),
    polishMatch: z.object({ polishId: z.uuid(), deltaE: z.number() }).optional(),
  })
  .refine((f) => f.kind !== "design" || f.designImageId, {
    message: "Design fingers need a designImageId",
    path: ["designImageId"],
  });

export const designSpecSchema = z
  .object({
    version: z.literal(1),
    source: z.object({
      kind: z.enum(["inspiration", "catalogue", "manual"]),
      imageId: z.uuid().optional(),
    }),
    effectType: z.enum(["nail_polish", "press_on_nails"]),
    shape: z.enum(PRESS_ON_SHAPES).optional(),
    length: z.number().min(0.8).max(2.15).optional(),
    fingers: z.object({
      thumb: fingerSpecSchema,
      index: fingerSpecSchema,
      middle: fingerSpecSchema,
      ring: fingerSpecSchema,
      pinky: fingerSpecSchema,
    }),
    confidence: z.number().min(0).max(1).default(1),
  })
  .refine((s) => s.effectType !== "press_on_nails" || (s.shape && s.length !== undefined), {
    message: "Press-on designs need a shape and a length",
    path: ["shape"],
  });

export type FingerSpec = z.infer<typeof fingerSpecSchema>;
export type DesignSpec = z.infer<typeof designSpecSchema>;
/** What callers may send: defaults not yet applied. */
export type DesignSpecInput = z.input<typeof designSpecSchema>;

/** The same colour and texture on all five fingers: the simplest manual design. */
export function solidSpec(baseHex: string, texture: Texture = "cream"): DesignSpec {
  const finger = { kind: "color", baseHex, texture } as const;
  return designSpecSchema.parse({
    version: 1,
    source: { kind: "manual" },
    effectType: "nail_polish",
    fingers: Object.fromEntries(FINGERS.map((f) => [f, finger])),
  });
}
