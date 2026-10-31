import { describe, expect, it } from "vitest";
import { designSpecSchema, solidSpec, type Texture } from "@/lib/spec/types";
import { deltaE2000, hexToLab } from "./cielab";
import { matchColour, matchSpec, quoteSpec, type Polish, type PriceRules } from "./match";

const polish = (name: string, hex: string, finish: Texture = "cream"): Polish => ({
  id: name, brand: "Maison", name, hex, lab: hexToLab(hex), finish,
});

const CATALOGUE = [
  polish("Cerise", "#B0123A"),
  polish("Bordeaux", "#6E1423"),
  polish("Nude Sable", "#D8B4A0"),
  polish("Marine", "#1F2A55"),
  polish("Chrome Argent", "#C9CBCF", "metallic"),
  polish("Paillettes Or", "#C9A75A", "shimmer_fine"),
];

const RULES: PriceRules = {
  basePrice: 150,
  artTiers: { solid: 0, french: 15, art: 30, chrome: 10 },
  lengthSurcharge: 150,
  minutes: { base: 45, per_art_finger: 10, extensions: 40 },
};

describe("CIELAB and CIEDE2000", () => {
  it("converts sRGB white and black", () => {
    expect(hexToLab("#FFFFFF").L).toBeCloseTo(100, 1);
    expect(hexToLab("#000000").L).toBeCloseTo(0, 5);
  });

  // Reference pairs from Sharma, Wu & Dalal (2005), table 1.
  it.each([
    [{ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }, 2.0425],
    [{ L: 50, a: -1.3802, b: -84.2814 }, { L: 50, a: 0, b: -82.7485 }, 1.0],
    [{ L: 50, a: 2.5, b: 0 }, { L: 50, a: 0, b: -2.5 }, 4.3065],
    [{ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 }, 27.1492],
    [{ L: 60.2574, a: -34.0099, b: 36.2677 }, { L: 60.4626, a: -34.1751, b: 39.4387 }, 1.2644],
    [{ L: 2.0776, a: 0.0795, b: -1.135 }, { L: 0.9033, a: -0.0636, b: -0.5514 }, 0.9082],
  ])("matches the published value %#", (p, q, expected) => {
    expect(deltaE2000(p, q)).toBeCloseTo(expected, 4);
  });
});

describe("matchColour", () => {
  it("finds an exact stock colour", () => {
    const m = matchColour("#B0123A", "cream", CATALOGUE)!;
    expect(m.polish.name).toBe("Cerise");
    expect(m.deltaE).toBe(0);
    expect(m.label).toBe("identical");
    expect(m.alternates).toHaveLength(2);
  });

  it("prefers a polish of the same finish family", () => {
    // A silver-grey cream is nearer to nothing glossy; chrome stays in the metal family.
    expect(matchColour("#C0C2C8", "metallic", CATALOGUE)!.polish.name).toBe("Chrome Argent");
    expect(matchColour("#C9A75A", "shimmer_coarse", CATALOGUE)!.polish.name).toBe("Paillettes Or");
  });

  it("falls back to any finish when the family has nothing close, adding chrome powder", () => {
    const m = matchColour("#B0123A", "metallic", CATALOGUE)!;
    expect(m.polish.name).toBe("Cerise");
    expect(m.topCoat).toBe("chrome powder");
    expect(matchColour("#C0C2C8", "metallic", CATALOGUE)!.topCoat).toBeUndefined();
  });

  it("gets matte from a matte top coat over a gloss gel", () => {
    const m = matchColour("#1F2A55", "matte", CATALOGUE)!;
    expect(m.polish.name).toBe("Marine");
    expect(m.topCoat).toBe("matte top coat");
  });

  it("returns null with an empty catalogue", () => {
    expect(matchColour("#B0123A", "cream", [])).toBeNull();
  });
});

describe("matchSpec", () => {
  it("matches every finger and the accents of design fingers", () => {
    const spec = designSpecSchema.parse({
      ...solidSpec("#D8B4A0"),
      fingers: {
        ...solidSpec("#D8B4A0").fingers,
        ring: {
          kind: "design", baseHex: "#D8B4A0", accentHexes: ["#B0123A"], texture: "cream", pattern: "art",
          designImageId: "00000000-0000-4000-8000-000000000000",
        },
      },
    });
    const m = matchSpec(spec, CATALOGUE)!;
    expect(m.thumb.base.polish.name).toBe("Nude Sable");
    expect(m.thumb.accents).toEqual([]);
    expect(m.ring.accents.map((a) => a.polish.name)).toEqual(["Cerise"]);
  });
});

describe("quoteSpec", () => {
  it("charges the base service for a plain manicure", () => {
    expect(quoteSpec(solidSpec("#B0123A"), RULES)).toEqual({
      lines: [{ label: "Gel manicure", amount: 150 }],
      total: 150,
      minutes: 45,
    });
  });

  it("adds extensions, art and chrome per finger", () => {
    const base = solidSpec("#C9CBCF", "metallic");
    const spec = designSpecSchema.parse({
      ...base,
      effectType: "press_on_nails",
      shape: "almond_oval",
      length: 1.35,
      fingers: {
        ...base.fingers,
        ring: { kind: "color", baseHex: "#F7F7F5", texture: "cream", pattern: "french" },
        index: {
          kind: "design", baseHex: "#F7F7F5", texture: "cream",
          designImageId: "00000000-0000-4000-8000-000000000000",
        },
      },
    });
    const q = quoteSpec(spec, RULES);
    expect(q.lines).toEqual([
      { label: "Gel extensions, full set", amount: 150 },
      { label: "Extension length", amount: 150 },
      { label: "Chrome powder × 3", amount: 30 },
      { label: "Nail art × 1", amount: 30 },
      { label: "French tip × 1", amount: 15 },
    ]);
    expect(q.total).toBe(375);
    expect(q.minutes).toBe(45 + 2 * 10 + 40);
  });
});
