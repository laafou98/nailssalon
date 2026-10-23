import { describe, expect, it } from "vitest";
import { canonicalJson, renderCacheKey, toNailVtoPayload, transferCacheKey } from "./payload";
import { type DesignSpecInput, FINGERS, designSpecSchema, solidSpec } from "./types";

const DESIGN_ID = "3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f";
const HAND = "https://storage.example/hand.jpg";

const mixed = (): DesignSpecInput => ({
  version: 1,
  source: { kind: "manual" },
  effectType: "nail_polish",
  fingers: {
    thumb: { kind: "color", baseHex: "#b0123a", texture: "metallic" },
    index: { kind: "color", baseHex: "#B0123A", texture: "jelly" },
    middle: { kind: "color", baseHex: "#F5E6D3", texture: "pearl" },
    ring: { kind: "design", baseHex: "#FFFFFF", texture: "cream", pattern: "art", designImageId: DESIGN_ID },
    pinky: { kind: "color", baseHex: "#B0123A", texture: "shimmer_fine" },
  },
});

describe("designSpecSchema", () => {
  it("normalises hex and fills defaults", () => {
    const spec = designSpecSchema.parse(mixed());
    expect(spec.fingers.thumb.baseHex).toBe("#B0123A");
    expect(spec.fingers.thumb).toMatchObject({ pattern: "solid", accentHexes: [], confidence: 1 });
  });

  it("rejects bad colours, design fingers without an image and press-ons without a shape", () => {
    const badHex = mixed();
    badHex.fingers.thumb.baseHex = "red";
    expect(designSpecSchema.safeParse(badHex).success).toBe(false);

    const noImage = mixed();
    delete noImage.fingers.ring.designImageId;
    expect(designSpecSchema.safeParse(noImage).success).toBe(false);

    expect(designSpecSchema.safeParse({ ...mixed(), effectType: "press_on_nails" }).success).toBe(false);
  });
});

describe("toNailVtoPayload", () => {
  it("matches the smoke-tested solid colour request", () => {
    const payload = toNailVtoPayload(solidSpec("#B0123A"), HAND);
    expect(payload).toMatchObject({ version: "1.0", src_file_url: HAND, effect_type: "nail_polish" });
    expect(payload.effects.map((e) => e.finger)).toEqual([...FINGERS]);
    expect(payload.effects[0]).toEqual({
      sub_type: "color",
      finger: "thumb",
      color: "#B0123A",
      texture: "cream",
      transparency: 0,
      reflection: 60,
      contrast: 50,
      roughness: 10,
    });
  });

  it("only sends the parameters each finish supports", () => {
    const [thumb, index, middle, ring, pinky] = toNailVtoPayload(designSpecSchema.parse(mixed()), HAND, {
      [DESIGN_ID]: "https://storage.example/ring.png",
    }).effects;
    expect(thumb).not.toHaveProperty("transparency"); // metallic
    expect(index.transparency).toBeGreaterThan(0); // jelly
    expect(middle).toHaveProperty("shimmer_opacity"); // pearl
    expect(pinky).toHaveProperty("shimmer_size");
    expect(ring).toMatchObject({ sub_type: "design", ref_file_url: "https://storage.example/ring.png" });
    expect(ring).not.toHaveProperty("color");
  });

  it("refuses to build a design finger without its image URL", () => {
    expect(() => toNailVtoPayload(designSpecSchema.parse(mixed()), HAND)).toThrow(/ring/);
  });

  it("maps press-on finishes to the three YouCam supports and adds shape and length", () => {
    const spec = designSpecSchema.parse({ ...mixed(), effectType: "press_on_nails", shape: "almond_oval", length: 1.4 });
    const effects = toNailVtoPayload(spec, HAND, { [DESIGN_ID]: "https://x/r.png" }).effects;
    expect(effects.map((e) => e.texture)).toEqual(["metallic", "cream", "metallic", "cream", "metallic"]);
    expect(effects[0]).toMatchObject({ shape: "almond_oval", length: 1.4 });
    expect(effects.some((e) => "transparency" in e || "shimmer_size" in e)).toBe(false);
  });
});

describe("renderCacheKey", () => {
  const spec = () => designSpecSchema.parse(mixed());

  it("is stable and ignores fields that don't change the picture", () => {
    const a = spec();
    const b = spec();
    b.confidence = 0.2;
    b.fingers.thumb.polishMatch = { polishId: DESIGN_ID, deltaE: 1.2 };
    expect(renderCacheKey(a, "abc")).toBe(renderCacheKey(b, "abc"));
    expect(renderCacheKey(a, "abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the hand photo or any visible edit", () => {
    const base = renderCacheKey(spec(), "abc");
    expect(renderCacheKey(spec(), "def")).not.toBe(base);
    const edited = spec();
    edited.fingers.pinky.texture = "matte";
    expect(renderCacheKey(edited, "abc")).not.toBe(base);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level but keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: 0 } })).toBe('{"a":{"c":0,"d":[2,1]},"b":1}');
  });
});

describe("transferCacheKey", () => {
  it("depends on both photos and never collides with a VTO key", () => {
    const key = transferCacheKey("a".repeat(64), "b".repeat(64));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(transferCacheKey("a".repeat(64), "c".repeat(64))).not.toBe(key);
    expect(renderCacheKey(solidSpec("#B0123A"), "a".repeat(64))).not.toBe(key);
  });
});
