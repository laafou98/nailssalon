import { describe, expect, it } from "vitest";
import { solidSpec, designSpecSchema } from "@/lib/spec/types";
import { applyReading, buildReadingContent, needsArtwork, parseReading, readingFormat } from "./reading";

const reply = (over: object = {}) => ({
    is_nail_design: true,
    fingers: [
      { finger: "thumb", texture: "jelly", pattern: "solid", confidence: 0.9 },
      { finger: "ring", texture: "shimmer_coarse", pattern: "art", confidence: 0.7 },
    ],
    shape: "almond",
    length: "long",
    summary: "  Milky jelly with a glitter accent ",
    ...over,
});

describe("buildReadingContent", () => {
  it("sends the photo, then each crop labelled with its finger", () => {
    const content = buildReadingContent("PHOTO", [
      { finger: "thumb", jpegBase64: "T" },
      { finger: "ring", jpegBase64: "R" },
    ]);
    const images = content.flatMap((c) => (c.type === "image" && c.source.type === "base64" ? [c.source] : []));
    expect(images.map((i) => i.data)).toEqual(["PHOTO", "T", "R"]);
    expect(images.every((i) => i.media_type === "image/jpeg")).toBe(true);
    const texts = content.flatMap((c) => (c.type === "text" ? [c.text] : []));
    expect(texts[1]).toContain("thumb");
    expect(texts.at(-1)).toContain("thumb, ring");
  });
});

describe("parseReading", () => {
  it("maps fingers, shape and length names onto our scales", () => {
    const r = parseReading(reply(), ["thumb", "index", "ring"]);
    expect(r.fingers[0]).toEqual({ texture: "jelly", pattern: "solid", confidence: 0.9 });
    expect(r.fingers[1]).toBeNull(); // cropped but not answered
    expect(r.fingers[3]).toEqual({ texture: "shimmer_coarse", pattern: "art", confidence: 0.7 });
    expect(r.fingers[2]).toBeNull();
    expect(r).toMatchObject({ isNailDesign: true, shape: "almond", length: 1.8, summary: "Milky jelly with a glitter accent" });
  });

  it("ignores fingers it wasn't shown and drops unknown values without failing", () => {
    const r = parseReading(
      reply({ fingers: [{ finger: "thumb", texture: "holographic", pattern: "zebra", confidence: "high" }], shape: "coffin", length: 7 }),
      ["thumb"],
    );
    expect(r.fingers[0]).toEqual({ texture: null, pattern: null, confidence: 0.5 });
    expect(r.shape).toBeNull();
    expect(r.length).toBeNull();
    expect(parseReading(reply(), []).fingers.every((f) => f === null)).toBe(true);
  });

  it("rejects a reply that isn't an object", () => {
    expect(() => parseReading("Sorry, I can't help", ["thumb"])).toThrow();
  });
});

describe("readingFormat", () => {
  it("is the exact shape asked of Claude: our vocabularies, nullable shape and length", () => {
    expect(readingFormat.safeParse(reply()).success).toBe(true);
    expect(readingFormat.safeParse(reply({ shape: null, length: null })).success).toBe(true);
    expect(readingFormat.safeParse(reply({ shape: "coffin" })).success).toBe(false);
    expect(readingFormat.safeParse(reply({ fingers: [{ finger: "thumb", texture: "holographic", pattern: "solid", confidence: 1 }] })).success).toBe(false);
  });
});

describe("applyReading", () => {
  it("copies finish and pattern from each finger's source nail and averages confidence", () => {
    const draft = designSpecSchema.parse({ ...solidSpec("#B0123A"), source: { kind: "inspiration" } });
    for (const f of Object.values(draft.fingers)) f.confidence = 0.5;
    const reading = parseReading(reply(), ["thumb", "ring"]);
    // index copies the thumb, middle and pinky copy the ring.
    const spec = applyReading(draft, reading, [0, 0, 3, 3, 3]);
    expect(spec.fingers.index).toMatchObject({ texture: "jelly", pattern: "solid", confidence: 0.7, baseHex: "#B0123A" });
    expect(spec.fingers.pinky).toMatchObject({ texture: "shimmer_coarse", pattern: "art", confidence: 0.6 });
    expect(spec.confidence).toBe(0.64);
  });

  it("keeps the draft where the model had nothing to say", () => {
    const draft = solidSpec("#B0123A");
    const spec = applyReading(draft, parseReading(reply({ fingers: [] }), ["thumb"]), [0, 0, 0, 0, 0]);
    expect(spec.fingers).toEqual(draft.fingers);
  });
});

it("needsArtwork: only patterned nails", () => {
  expect(needsArtwork("solid")).toBe(false);
  expect(needsArtwork(null)).toBe(false);
  expect(needsArtwork("french")).toBe(true);
});
