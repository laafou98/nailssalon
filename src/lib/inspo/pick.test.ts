import { describe, expect, it } from "vitest";
import { solidSpec } from "@/lib/spec/types";
import { applyEdits } from "./pick";
import { toLabImage } from "./oklab";
import { asExtensions, draftSpec, guessExtensions, type NailPick, pickNail, sourceFingers, typicalArea, withDesigns } from "./pick";
import { prepareImage } from "./region";
import { inEllipse, noise, scene } from "./synthetic.test-helpers";

/** A minimal pick: only the fields the draft builder reads. */
const fake = (baseHex: string, confidence = 0.9, accents: string[] = [], area = 1000) =>
  ({
    tap: { x: 0, y: 0 },
    region: { area },
    colours: { base: { hex: baseHex }, accents: accents.map((hex) => ({ hex })) },
    confidence,
  }) as unknown as NailPick;

describe("pickNail", () => {
  it("outlines and colours a tapped nail with high confidence", () => {
    const s = scene(240, 240, (x, y) => {
      const n = noise(x, y) * 4;
      const [r, g, b] = inEllipse(x, y, 120, 120, 18, 34) ? (Math.abs(y - 110) <= 2 ? [232, 230, 224] : [30, 75, 52]) : [224, 184, 160];
      return [r + n, g + n, b + n];
    });
    const lab = toLabImage(s.rgba, 240, 240);
    const pick = pickNail({ prepared: prepareImage(lab), detail: lab, scale: 1 }, { x: 120, y: 135 })!;
    expect(pick.colours.base.hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(pick.colours.accents).toHaveLength(1);
    expect(pick.confidence).toBeGreaterThan(0.7);
  });
});

describe("draftSpec", () => {
  it("returns null with no picks", () => {
    expect(draftSpec([null, null, null, null, null])).toBeNull();
  });

  it("builds one colour per finger, cream and solid", () => {
    const spec = draftSpec([fake("#112233"), fake("#223344", 0.8, ["#ffffff"]), fake("#334455"), fake("#445566"), fake("#556677")])!;
    expect(spec.source.kind).toBe("inspiration");
    expect(spec.fingers.thumb.baseHex).toBe("#112233");
    expect(spec.fingers.index.accentHexes).toEqual(["#FFFFFF"]);
    expect(spec.fingers.pinky).toMatchObject({ kind: "color", texture: "cream", pattern: "solid", baseHex: "#556677" });
    expect(spec.confidence).toBeCloseTo(0.88);
  });

  it("copies the nearest picked finger into skipped ones, with low confidence", () => {
    expect(sourceFingers([fake("#111111"), null, null, fake("#444444"), null])).toEqual([0, 0, 3, 3, 3]);
    const spec = draftSpec([null, fake("#222222"), null, null, fake("#555555")])!;
    expect(spec.fingers.thumb.baseHex).toBe("#222222");
    expect(spec.fingers.middle.baseHex).toBe("#222222"); // tie → thumb side
    expect(spec.fingers.ring.baseHex).toBe("#555555");
    expect(spec.fingers.thumb.confidence).toBe(0.3);
    expect(spec.fingers.index.confidence).toBe(0.9);
  });
});

describe("typicalArea", () => {
  it("is the median area of the picks", () => {
    expect(typicalArea([null, null])).toBeUndefined();
    expect(typicalArea([fake("#000000", 1, [], 100), null, fake("#000000", 1, [], 900), fake("#000000", 1, [], 300)])).toBe(300);
  });
});

describe("withDesigns", () => {
  it("turns chosen fingers into design fingers and leaves the rest as colours", () => {
    const spec = draftSpec([fake("#112233"), fake("#223344"), fake("#334455"), fake("#445566"), fake("#556677")])!;
    const id = "0b9c3f0e-5d1a-4c6e-9a3b-2f1d8e7c6b5a";
    const out = withDesigns(spec, [id, null, id, null, null]);
    expect(out.fingers.thumb).toMatchObject({ kind: "design", pattern: "art", designImageId: id, baseHex: "#112233" });
    expect(out.fingers.index.kind).toBe("color");
    expect(out.fingers.middle.designImageId).toBe(id);
  });
});

describe("guessExtensions", () => {
  const pickOf = (paint: (x: number, y: number) => boolean) => {
    const s = scene(120, 120, (x, y) => (paint(x, y) ? [30, 90, 60] : [224, 184, 160]));
    const lab = toLabImage(s.rgba, 120, 120);
    return pickNail({ prepared: prepareImage(lab), detail: lab, scale: 1 }, { x: 60, y: 60 });
  };

  it("reads a long almond nail as almond and long", () => {
    // Lying sideways: wide rounded cuticle on the left, tapering to a point on the right.
    const almond = pickOf((x, y) => x >= 28 && x <= 96 && Math.abs(y - 60) <= 16 * Math.min(1, Math.sqrt((96 - x) / 40)) * Math.sqrt(Math.max(0, 1 - ((Math.min(x, 60) - 60) / 32) ** 2)));
    const g = guessExtensions([almond, almond, null, null, null], 120)!;
    expect(g.tip).toBe("almond");
    expect(g.length).toBeGreaterThanOrEqual(1.4);
  });

  it("reads a short oval nail as oval and short", () => {
    const oval = pickOf((x, y) => inEllipse(x, y, 60, 60, 18, 23));
    expect(guessExtensions([oval, null, null, null, null], 120)).toEqual({ tip: "oval", length: 1 });
  });

  it("returns null with no picks", () => {
    expect(guessExtensions([null, null, null, null, null], 120)).toBeNull();
  });
});

describe("asExtensions", () => {
  it("switches the spec to press-on nails with a shape and length", () => {
    const spec = asExtensions(draftSpec([fake("#112233"), null, null, null, null])!, "almond", 1.8);
    expect(spec).toMatchObject({ effectType: "press_on_nails", shape: "almond_oval", length: 1.8 });
  });
});

describe("applyEdits", () => {
  it("overrides colour and finish per finger, turning a recoloured design into plain colour", () => {
    const base = solidSpec("#112233", "cream");
    const spec = { ...base, fingers: { ...base.fingers, ring: { ...base.fingers.ring, kind: "design" as const, designImageId: "11111111-1111-4111-8111-111111111111", accentHexes: ["#FFFFFF"], pattern: "art" as const } } };
    const out = applyEdits(spec, { ring: { baseHex: "#AABBCC" }, index: { texture: "jelly" } });
    expect(out.fingers.ring).toMatchObject({ kind: "color", baseHex: "#AABBCC", accentHexes: [], texture: "cream" });
    expect(out.fingers.ring.designImageId).toBeUndefined();
    expect(out.fingers.index).toMatchObject({ baseHex: "#112233", texture: "jelly" });
    expect(out.fingers.thumb).toEqual(base.fingers.thumb);
  });
});
