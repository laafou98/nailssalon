// DesignSpec → YouCam Nail VTO request body (docs.perfectcorp.com/reference/ai_nail_vto).
// Pure functions: the render route and the cache key both build on these.

import { createHash } from "node:crypto";
import { type DesignSpec, FINGERS, type FingerSpec, type Texture } from "./types";

/**
 * Look parameters per finish. High reflection with low roughness (the Oct 20 smoke-test values, 60/10 for cream)
 * makes YouCam paint the same two hard white studio-light stripes on every nail, whatever the room's light. Real
 * renders on the user's hands (Nov 1) chose these softer values: a broad, soft gloss instead. Metallic keeps its
 * facet streaks at any setting (tried 60/40/50 and 40/20/80); 60/40/50 tames them a little and still reads as chrome.
 */
const NAIL_POLISH_PARAMS: Record<Texture, Record<string, number>> = {
  matte: { transparency: 0, reflection: 10, contrast: 50, roughness: 80 },
  cream: { transparency: 0, reflection: 30, contrast: 50, roughness: 40 },
  jelly: { transparency: 45, reflection: 40, contrast: 50, roughness: 40 },
  sheer: { transparency: 40, reflection: 30, contrast: 40, roughness: 40 }, // 70 left a pale pink invisible on a bare nail
  metallic: { reflection: 60, contrast: 40, roughness: 50 }, // YouCam: no transparency for metallic
  pearl: { transparency: 0, reflection: 45, contrast: 50, roughness: 35, shimmer_opacity: 60 },
  shimmer_fine: { transparency: 0, reflection: 45, contrast: 50, roughness: 35, shimmer_size: 30 },
  shimmer_coarse: { transparency: 0, reflection: 45, contrast: 50, roughness: 35, shimmer_size: 70 },
  textured: { transparency: 0, reflection: 30, contrast: 50, roughness: 60, textured_size: 50 },
};

/**
 * Most transparency a design finger gets: YouCam fades the whole art image by it, and at a sheer 70 (or 40) a
 * copied swirl all but disappeared (Nov 1). The see-through look stays, the art stays readable.
 */
const DESIGN_MAX_TRANSPARENCY = 30;

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
  cream: { reflection: 30, contrast: 50, roughness: 40 },
  metallic: { reflection: 60, contrast: 40, roughness: 50 },
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
      const art = "transparency" in look ? { ...look, transparency: Math.min(look.transparency as number, DESIGN_MAX_TRANSPARENCY) } : look;
      return { sub_type: "design", finger, ref_file_url: url, ...shape, ...art };
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

/** Nail Transfer request body: YouCam copies the reference photo's nails onto the hand. */
export function toTransferPayload(handUrl: string, refUrl: string) {
  return { src_file_url: handUrl, ref_file_url: refUrl };
}

/** Cache key for a Nail Transfer render: only the two photos change the picture. */
export function transferCacheKey(handSha256: string, refSha256: string): string {
  const payload = toTransferPayload(`sha256:${handSha256}`, `sha256:${refSha256}`);
  return createHash("sha256").update(canonicalJson({ engine: "nail_transfer", payload })).digest("hex");
}
