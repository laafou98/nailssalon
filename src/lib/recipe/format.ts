// Shared wording for the salon card, the recipe page and the WhatsApp message. Pure.

import { LENGTHS } from "@/lib/inspo/pick";
import type { FingerMatch, Quote } from "@/lib/shade/match";
import { FINGERS, type DesignSpec, type Finger, type Texture } from "@/lib/spec/types";

export const FINGER_LABEL: Record<Finger, string> = {
  thumb: "Thumb", index: "Index", middle: "Middle", ring: "Ring", pinky: "Pinky",
};

export const FINISH_LABEL: Record<Texture, string> = {
  matte: "matte", cream: "cream", jelly: "jelly", sheer: "sheer", metallic: "chrome", pearl: "pearl",
  shimmer_fine: "shimmer", shimmer_coarse: "glitter", textured: "textured",
};

/** Fingers that share the same polish (and no art) collapse into one group. */
export function groupFingers(matches: Record<Finger, FingerMatch>) {
  const groups: { fingers: Finger[]; match: FingerMatch }[] = [];
  for (const finger of FINGERS) {
    const m = matches[finger];
    const same = m.accents.length === 0 &&
      groups.find((g) => g.match.accents.length === 0 && g.match.base.polish.id === m.base.polish.id && g.match.base.topCoat === m.base.topCoat);
    if (same) same.fingers.push(finger);
    else groups.push({ fingers: [finger], match: m });
  }
  return groups;
}

export const fingerList = (fingers: Finger[]) =>
  fingers.length === 5 ? "All nails" : fingers.map((f) => FINGER_LABEL[f]).join(", ");

/** The nearest named length step for a press-on `length`. */
export function lengthLabel(length: number): string {
  return LENGTHS.reduce((best, l) => (Math.abs(l.value - length) < Math.abs(best.value - length) ? l : best)).label;
}

/** "Gel manicure" or "Extensions, almond, Medium". */
export function serviceLabel(spec: DesignSpec): string {
  if (spec.effectType !== "press_on_nails") return "Gel manicure on natural nails";
  const tip = spec.shape?.split("_")[0] ?? "";
  return `Extensions, ${tip}${spec.length !== undefined ? `, ${lengthLabel(spec.length).toLowerCase()}` : ""}`;
}

export const money = (amount: number, currency: string) => `${amount.toLocaleString("fr-MA")} ${currency}`;

/** The pre-filled WhatsApp text: what to ask the salon for, then the recipe link. */
export function recipeMessage(args: {
  salonName: string;
  currency: string;
  spec: DesignSpec;
  matches: Record<Finger, FingerMatch>;
  quote: Quote;
  url: string;
}): string {
  const { salonName, currency, spec, matches, quote, url } = args;
  const lines = groupFingers(matches).map(({ fingers, match }) => {
    const f = spec.fingers[fingers[0]];
    const art = f.kind === "design" || f.pattern !== "solid" ? ` (${f.pattern === "solid" ? "art" : f.pattern.replace("_", " ")})` : "";
    const accents = match.accents.length ? ` + ${match.accents.map((a) => a.polish.name).join(", ")}` : "";
    const top = match.base.topCoat ? ` + ${match.base.topCoat}` : "";
    return `• ${fingerList(fingers)}: ${match.base.polish.brand} ${match.base.polish.name}${top}${accents}${art}`;
  });
  return [
    `Hi! I'd like this nail set at ${salonName}:`,
    serviceLabel(spec),
    ...lines,
    `Estimate: ${money(quote.total, currency)}, about ${quote.minutes} min`,
    `Recipe and photo: ${url}`,
  ].join("\n");
}

export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
