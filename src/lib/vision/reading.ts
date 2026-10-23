// Design Compiler [C], semantics: what a vision model reads off an inspiration
// photo that pixels alone can't tell us (finish, pattern, nail shape and length).
// Pure: builds the chat request and parses the reply, so both are unit-tested.
// Colours never come from the model: tap-to-pick measures them.

import { z } from "zod";
import { TIP_SHAPES, type TipShape } from "@/lib/inspo/design";
import { LENGTHS } from "@/lib/inspo/pick";
import { type DesignSpec, FINGERS, type Finger, PATTERNS, TEXTURES, designSpecSchema } from "@/lib/spec/types";

export const LENGTH_NAMES = ["short", "medium", "long", "extra_long"] as const;
type LengthName = (typeof LENGTH_NAMES)[number];

/** Offered extension length for each name the model may answer. */
const LENGTH_VALUE: Record<LengthName, number> = {
  short: LENGTHS[0].value,
  medium: LENGTHS[1].value,
  long: LENGTHS[2].value,
  extra_long: LENGTHS[3].value,
};

const confidence = z.coerce.number().min(0).max(1).catch(0.5);

/**
 * The reply, parsed leniently: one bad field (an unknown finish, a shape we
 * can't render) drops that field, never the whole reading.
 */
const replySchema = z.object({
  is_nail_design: z.boolean().catch(true),
  fingers: z
    .array(
      z.object({
        finger: z.enum(FINGERS).catch("thumb"),
        texture: z.enum(TEXTURES).nullable().catch(null),
        pattern: z.enum(PATTERNS).nullable().catch(null),
        confidence,
      }),
    )
    .catch([]),
  shape: z.enum(TIP_SHAPES).nullable().catch(null),
  length: z.enum(LENGTH_NAMES).nullable().catch(null),
  summary: z.string().max(300).catch(""),
});

export interface FingerReading {
  texture: (typeof TEXTURES)[number] | null;
  pattern: (typeof PATTERNS)[number] | null;
  confidence: number;
}

export interface DesignReading {
  /** False when the photo doesn't show a nail design at all. */
  isNailDesign: boolean;
  /** Per finger (thumb → pinky): what the model saw on that finger's crop, or null if it had no crop. */
  fingers: (FingerReading | null)[];
  shape: TipShape | null;
  /** Extension length on YouCam's press-on scale, snapped to the offered steps. */
  length: number | null;
  /** One sentence describing the design, shown to the user. */
  summary: string;
}

const SYSTEM = `You are a nail technician reading a nail-design inspiration photo for a salon.
You get the full photo, then one close-up crop per nail, each labelled with its finger.
Colours are already measured: never describe colours as hex codes.
For each crop, decide:
- texture (the polish finish), one of: ${TEXTURES.join(", ")}.
  cream = opaque glossy; jelly = glossy and slightly see-through; sheer = mostly transparent wash;
  metallic = chrome or mirror; pearl = soft pearly sheen; shimmer_fine / shimmer_coarse = glitter by particle size;
  matte = no shine; textured = 3D, sugar or sand effect.
- pattern, one of: ${PATTERNS.join(", ")}.
  solid = one plain colour; french = contrasting tip; ombre = gradient; cat_eye = magnetic light band;
  art = anything drawn or applied (lines, dots, flowers, hearts, stickers, gems, marble, mixed colours).
- confidence from 0 to 1 that both answers are right.
Then for the set as a whole:
- shape of the free edge, one of: ${TIP_SHAPES.join(", ")} (coffin or ballerina → square), or null if you can't tell.
- length, one of: ${LENGTH_NAMES.join(", ")} (short = barely past the fingertip), or null.
- is_nail_design: false if the photo shows no painted nails at all.
- summary: one short sentence a client would understand, e.g. "Milky pink jelly with a gold chrome French tip".
Answer with JSON only, exactly this shape:
{"is_nail_design": true, "fingers": [{"finger": "thumb", "texture": "cream", "pattern": "solid", "confidence": 0.8}], "shape": "almond", "length": "medium", "summary": "..."}`;

export interface CropInput {
  finger: Finger;
  /** data: URL (or any URL the model can read) of the nail crop. */
  url: string;
}

/** OpenAI-compatible chat request for DeepSeek's vision model. */
export function buildReadingRequest(model: string, photoUrl: string, crops: CropInput[]) {
  const content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] = [
    { type: "text", text: "Full inspiration photo:" },
    { type: "image_url", image_url: { url: photoUrl } },
  ];
  for (const crop of crops) {
    content.push({ type: "text", text: `Crop of the ${crop.finger} nail:` });
    content.push({ type: "image_url", image_url: { url: crop.url } });
  }
  content.push({
    type: "text",
    text: `Read these fingers: ${crops.map((c) => c.finger).join(", ") || "none (describe only the set as a whole)"}.`,
  });
  return {
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 800,
  };
}

/** Parses the model's JSON reply. Fingers it wasn't shown a crop for stay null. */
export function parseReading(text: string, cropped: Finger[]): DesignReading {
  let raw: unknown;
  try {
    // Some replies wrap the JSON in a ``` fence despite json_object mode.
    raw = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    throw new Error("The vision model did not answer with JSON");
  }
  const reply = replySchema.parse(raw);
  const byFinger = new Map(reply.fingers.map((f) => [f.finger, f]));
  return {
    isNailDesign: reply.is_nail_design,
    fingers: FINGERS.map((finger) => {
      if (!cropped.includes(finger)) return null;
      const f = byFinger.get(finger);
      return f ? { texture: f.texture, pattern: f.pattern, confidence: f.confidence } : null;
    }),
    shape: reply.shape,
    length: reply.length ? LENGTH_VALUE[reply.length] : null,
    summary: reply.summary.trim(),
  };
}

/**
 * Folds a reading into a draft spec: each finger takes the finish and pattern read
 * from the nail it copies (`sources[i]`, from tap-to-pick), and its confidence
 * becomes the average of the outline's and the model's. Colours are untouched.
 */
export function applyReading(spec: DesignSpec, reading: DesignReading, sources: (number | null)[]): DesignSpec {
  const fingers = Object.fromEntries(
    FINGERS.map((finger, i) => {
      const f = spec.fingers[finger];
      const read = sources[i] === null ? null : reading.fingers[sources[i]!];
      if (!read) return [finger, f];
      return [
        finger,
        {
          ...f,
          texture: read.texture ?? f.texture,
          pattern: read.pattern ?? f.pattern,
          confidence: Math.round(((f.confidence + read.confidence) / 2) * 100) / 100,
        },
      ];
    }),
  ) as Record<Finger, DesignSpec["fingers"][Finger]>;
  const mean = FINGERS.reduce((sum, f) => sum + fingers[f].confidence, 0) / FINGERS.length;
  return designSpecSchema.parse({ ...spec, fingers, confidence: Math.round(mean * 100) / 100 });
}

/** Patterns that need the nail's artwork, not just its colour. */
export const needsArtwork = (pattern: FingerReading["pattern"]) => pattern !== null && pattern !== "solid";
