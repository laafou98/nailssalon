import { describe, expect, it } from "vitest";
import { solidSpec, designSpecSchema } from "@/lib/spec/types";
import { applyReading, buildReadingRequest, needsArtwork, parseReading } from "./reading";

const reply = (over: object = {}) =>
  JSON.stringify({
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

describe("buildReadingRequest", () => {
  it("sends the photo, then each crop labelled with its finger, asking for JSON", () => {
    const req = buildReadingRequest("deepseek-flash", "data:photo", [
      { finger: "thumb", url: "data:t" },
      { finger: "ring", url: "data:r" },
    ]);
    expect(req.model).toBe("deepseek-flash");
    expect(req.response_format).toEqual({ type: "json_object" });
    const content = req.messages[1].content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(content.filter((c) => c.type === "image_url").map((c) => c.image_url!.url)).toEqual(["data:photo", "data:t", "data:r"]);
    expect(content[2].text).toContain("thumb");
    expect(content.at(-1)!.text).toContain("thumb, ring");
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

  it("accepts a fenced reply and rejects non-JSON", () => {
    expect(parseReading("```json\n" + reply() + "\n```", ["thumb"]).fingers[0]?.texture).toBe("jelly");
    expect(() => parseReading("Sorry, I can't help", ["thumb"])).toThrow(/JSON/);
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
