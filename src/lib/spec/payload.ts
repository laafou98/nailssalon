// DesignSpec → YouCam Nail VTO request body (docs.perfectcorp.com/reference/ai_nail_vto).
// Pure functions: the render route and the cache key both build on these.

import { createHash } from "node:crypto";
import { type DesignSpec, FINGERS, type FingerSpec, type Texture } from "./types";

/** Look parameters per finish. Cream matches the smoke test that rendered well on Oct 20. */
const NAIL_POLISH_PARAMS: Record<Texture, Record<string, number>> = {
  matte: { transparency: 0, reflection: 10, contrast: 50, roughness: 80 },
  cream: { transparency: 0, reflection: 60, contrast: 50, roughness: 10 },
  jelly: { transparency: 45, reflection: 80, contrast: 50, roughness: 5 },
  sheer: { transparency: 70, reflection: 60, contrast: 40, roughness: 10 },
  metallic: { reflection: 90, contrast: 70, roughness: 20 }, // YouCam: no transparency for metallic
  pearl: { transparency: 0, reflection: 70, contrast: 50, roughness: 15, shimmer_opacity: 60 },
  shimmer_fine: { transparency: 0, reflection: 70, contrast: 50, roughness: 15, shimmer_size: 30 },
  shimmer_coarse: { transparency: 0, reflection: 70, contrast: 50, roughness: 15, shimmer_size: 70 },
  textured: { transparency: 0, reflection: 30, contrast: 50, roughness: 60, textured_size: 50 },
};

/** Press-on nails only support three finishes; map the rest to the closest look. */
const PRESS_ON_TEXTURE: Record<Texture, "matte" | "cream" | "metallic"> = {
  matte: "matte",
  textured: "matte",
  cream: "cream",
  jelly: "cream",
  sheer: "cream",
  metallic: "metallic",
  pearl: "metallic",
  shimmer_fine: "metallic",
  shimmer_coarse: "metallic",
};

const PRESS_ON_PARAMS = {
  matte: { reflection: 10, contrast: 50, roughness: 80 },
  cream: { reflection: 60, contrast: 50, roughness: 10 },
  metallic: { reflection: 90, contrast: 70, roughness: 20 },
} as const;

export interface NailVtoPayload {
  version: "1.0";
  src_file_url: string;
  effect_type: DesignSpec["effectType"];
  effects: Record<string, string | number>[];
}

/**
 * @param handUrl      URL YouCam can fetch the hand photo from.
 * @param designUrls   images.id → URL for every design finger's PNG.
 */
export function toNailVtoPayload(
  spec: DesignSpec,
  handUrl: string,
  designUrls: Record<string, string> = {},
): NailVtoPayload {
  const effects = FINGERS.map((finger): NailVtoPayload["effects"][number] => {
    const f: FingerSpec = spec.fingers[finger];
    const look =
      spec.effectType === "press_on_nails"
        ? { texture: PRESS_ON_TEXTURE[f.texture], ...PRESS_ON_PARAMS[PRESS_ON_TEXTURE[f.texture]] }
        : { texture: f.texture, ...NAIL_POLISH_PARAMS[f.texture] };
    const shape: Record<string, string | number> =
      spec.effectType === "press_on_nails" ? { shape: spec.shape!, length: spec.length! } : {};

    if (f.kind === "design") {
      const url = designUrls[f.designImageId!];
      if (!url) throw new Error(`No URL for the ${finger} design image`);
      return { sub_type: "design", finger, ref_file_url: url, ...shape, ...look };
    }
    return { sub_type: "color", finger, ...shape, color: f.baseHex, ...look };
  });

  return { version: "1.0", src_file_url: handUrl, effect_type: spec.effectType, effects };
}

/** JSON with object keys sorted at every level, so equal values always serialise identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/**
 * Cache key for a render: the exact payload we would send, with the short-lived
 * signed URLs replaced by stable content identities (hand image hash, design image ids).
 * Fields that don't change the picture (confidence, polish matches) never reach the payload,
 * so editing them can't cost a unit.
 */
export function renderCacheKey(spec: DesignSpec, handSha256: string): string {
  const designIds = Object.fromEntries(
    FINGERS.flatMap((f) => (spec.fingers[f].designImageId ? [[spec.fingers[f].designImageId!, `image:${spec.fingers[f].designImageId}`]] : [])),
  );
  const payload = toNailVtoPayload(spec, `sha256:${handSha256}`, designIds);
  return createHash("sha256").update(canonicalJson({ engine: "nail_vto", payload })).digest("hex");
}
