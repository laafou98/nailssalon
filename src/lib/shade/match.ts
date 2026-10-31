// [E] Shade & Stock: each spec colour → the salon's nearest real polish (CIEDE2000),
// plus a price and chair-time quote from the salon's rules. Pure, no I/O.

import { FINGERS, type DesignSpec, type Finger, type FingerSpec, type Texture } from "@/lib/spec/types";
import { deltaE2000, hexToLab, type CieLab } from "./cielab";

export interface Polish {
  id: string;
  brand: string;
  name: string;
  hex: string;
  lab: CieLab;
  finish: Texture;
}

export interface ColourMatch {
  /** The spec colour being matched. */
  hex: string;
  polish: Polish;
  deltaE: number;
  /** Plain-language closeness, e.g. "practically identical". */
  label: string;
  /** Applied over the polish to get the spec's finish: a matte top coat, or chrome powder on a gloss gel. */
  topCoat?: "matte top coat" | "chrome powder";
  alternates: { polish: Polish; deltaE: number }[];
}

export interface FingerMatch {
  base: ColourMatch;
  accents: ColourMatch[];
}

/** Finishes a salon can swap for each other; matte comes from a top coat over any gloss gel. */
const FAMILY: Record<Texture, string> = {
  cream: "gloss", jelly: "gloss", sheer: "gloss", matte: "gloss",
  metallic: "metal", pearl: "metal",
  shimmer_fine: "shimmer", shimmer_coarse: "shimmer", textured: "shimmer",
};

/** Beyond this, a polish of another finish is a better answer than a far-off colour. */
const FAMILY_LIMIT = 10;

export function closeness(deltaE: number): string {
  if (deltaE < 1) return "identical";
  if (deltaE < 2) return "practically identical";
  if (deltaE < 5) return "very close";
  if (deltaE < 10) return "close";
  return "nearest in stock";
}

export function matchColour(hex: string, texture: Texture, polishes: Polish[]): ColourMatch | null {
  if (polishes.length === 0) return null;
  const lab = hexToLab(hex);
  const ranked = (list: Polish[]) =>
    list.map((polish) => ({ polish, deltaE: deltaE2000(lab, polish.lab) })).sort((p, q) => p.deltaE - q.deltaE);

  const family = ranked(polishes.filter((p) => FAMILY[p.finish] === FAMILY[texture]));
  const all = ranked(polishes);
  const pool = family.length > 0 && family[0].deltaE <= FAMILY_LIMIT ? family : all;
  const [best, ...rest] = pool;
  return {
    hex,
    polish: best.polish,
    deltaE: round(best.deltaE),
    label: closeness(best.deltaE),
    topCoat: topCoatFor(texture, best.polish.finish),
    alternates: rest.slice(0, 2).map((r) => ({ polish: r.polish, deltaE: round(r.deltaE) })),
  };
}

function topCoatFor(wanted: Texture, polish: Texture): ColourMatch["topCoat"] {
  if (wanted === "matte" && polish !== "matte") return "matte top coat";
  if (FAMILY[wanted] === "metal" && FAMILY[polish] !== "metal") return "chrome powder";
  return undefined;
}

export function matchSpec(spec: DesignSpec, polishes: Polish[]): Record<Finger, FingerMatch> | null {
  if (polishes.length === 0) return null;
  const entries = FINGERS.map((finger) => {
    const f = spec.fingers[finger];
    return [
      finger,
      {
        base: matchColour(f.baseHex, f.texture, polishes)!,
        // Accents are art colours: matched on colour alone, among gloss gels first.
        accents: f.kind === "design" ? f.accentHexes.map((h) => matchColour(h, "cream", polishes)!) : [],
      },
    ] as const;
  });
  return Object.fromEntries(entries) as Record<Finger, FingerMatch>;
}

// Quote -------------------------------------------------------------------------

export interface PriceRules {
  basePrice: number;
  /** Per-finger surcharge by tier: solid, french, ombre, cat_eye, art, chrome. */
  artTiers: Record<string, number>;
  lengthSurcharge: number;
  minutes: { base?: number; per_art_finger?: number; extensions?: number };
}

export interface Quote {
  lines: { label: string; amount: number }[];
  total: number;
  minutes: number;
}

const TIER_LABEL: Record<string, string> = {
  french: "French tip", ombre: "Ombré", cat_eye: "Cat eye", art: "Nail art", chrome: "Chrome powder",
};

/** The art tier a finger is charged at: its pattern, or "art" for a design with no named pattern. */
export function fingerTier(f: FingerSpec): string {
  if (f.pattern !== "solid") return f.pattern;
  return f.kind === "design" ? "art" : "solid";
}

export function quoteSpec(spec: DesignSpec, rules: PriceRules): Quote {
  const extensions = spec.effectType === "press_on_nails";
  const lines = [{ label: extensions ? "Gel extensions, full set" : "Gel manicure", amount: rules.basePrice }];
  if (extensions) lines.push({ label: "Extension length", amount: rules.lengthSurcharge });

  const counts = new Map<string, number>();
  let artFingers = 0;
  for (const finger of FINGERS) {
    const f = spec.fingers[finger];
    const tier = fingerTier(f);
    if (tier !== "solid") {
      artFingers += 1;
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
    if (f.texture === "metallic" || f.texture === "pearl") counts.set("chrome", (counts.get("chrome") ?? 0) + 1);
  }
  for (const [tier, n] of counts) {
    const each = rules.artTiers[tier] ?? rules.artTiers.art ?? 0;
    if (each > 0) lines.push({ label: `${TIER_LABEL[tier] ?? tier} × ${n}`, amount: each * n });
  }

  const m = rules.minutes;
  const minutes = (m.base ?? 45) + (m.per_art_finger ?? 0) * artFingers + (extensions ? (m.extensions ?? 0) : 0);
  return { lines, total: lines.reduce((sum, l) => sum + l.amount, 0), minutes };
}

const round = (x: number) => Math.round(x * 10) / 10;
