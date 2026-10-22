import { describe, expect, it } from "vitest";
import { toLabImage } from "./oklab";
import { draftSpec, type NailPick, pickNail, sourceFingers, typicalArea, withDesigns } from "./pick";
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
