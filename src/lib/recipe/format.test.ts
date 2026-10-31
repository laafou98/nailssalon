import { describe, expect, it } from "vitest";
import { hexToLab } from "@/lib/shade/cielab";
import { matchSpec, quoteSpec, type Polish } from "@/lib/shade/match";
import { designSpecSchema, solidSpec } from "@/lib/spec/types";
import { lengthLabel, recipeMessage, serviceLabel, whatsappLink } from "./format";

const polish = (name: string, hex: string): Polish => ({ id: name, brand: "Maison", name, hex, lab: hexToLab(hex), finish: "cream" });
const CATALOGUE = [polish("Cerise", "#B0123A"), polish("Blanc Pur", "#F7F7F5")];
const RULES = { basePrice: 150, artTiers: { french: 15 }, lengthSurcharge: 150, minutes: { base: 45, per_art_finger: 10, extensions: 40 } };

describe("recipe wording", () => {
  it("names the nearest length step", () => {
    expect(lengthLabel(1.35)).toBe("Medium");
    expect(lengthLabel(1.7)).toBe("Long");
    expect(lengthLabel(2.15)).toBe("Extra long");
  });

  it("describes the service", () => {
    expect(serviceLabel(solidSpec("#B0123A"))).toBe("Gel manicure on natural nails");
    const ext = designSpecSchema.parse({ ...solidSpec("#B0123A"), effectType: "press_on_nails", shape: "almond_oval", length: 1.35 });
    expect(serviceLabel(ext)).toBe("Extensions, almond, medium");
  });

  it("writes the WhatsApp message with grouped fingers, estimate and link", () => {
    const base = solidSpec("#B0123A");
    const spec = designSpecSchema.parse({
      ...base,
      fingers: { ...base.fingers, ring: { kind: "color", baseHex: "#F7F7F5", texture: "matte", pattern: "french" } },
    });
    const text = recipeMessage({
      salonName: "Studio Demo", currency: "MAD", spec,
      matches: matchSpec(spec, CATALOGUE)!, quote: quoteSpec(spec, RULES), url: "https://x.test/r/1",
    });
    expect(text).toBe([
      "Hi! I'd like this nail set at Studio Demo:",
      "Gel manicure on natural nails",
      "• Thumb, Index, Middle, Pinky: Maison Cerise",
      "• Ring: Maison Blanc Pur + matte top coat (french)",
      "Estimate: 165 MAD, about 55 min",
      "Recipe and photo: https://x.test/r/1",
    ].join("\n"));
    expect(whatsappLink("a b\n")).toBe("https://wa.me/?text=a%20b%0A");
  });
});
