import { describe, expect, it } from "vitest";
import { designSpecSchema, solidSpec } from "@/lib/spec/types";
import { chooseEngine } from "./router";

const IMAGE = "3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f";
const inspired = (confidence: number, imageId: string | null = IMAGE) =>
  designSpecSchema.parse({ ...solidSpec("#B0123A"), source: { kind: "inspiration", imageId: imageId ?? undefined }, confidence });

describe("chooseEngine", () => {
  it("renders trusted specs per finger with Nail VTO", () => {
    expect(chooseEngine(inspired(0.6))).toBe("nail_vto");
    expect(chooseEngine(solidSpec("#B0123A"))).toBe("nail_vto");
  });

  it("falls back to Nail Transfer for an unsure inspiration spec with a stored photo", () => {
    expect(chooseEngine(inspired(0.59))).toBe("nail_transfer");
    expect(chooseEngine(inspired(0.2, null))).toBe("nail_vto"); // nothing to transfer from
  });

  it("obeys an explicit choice", () => {
    expect(chooseEngine(inspired(0.2), "nail_vto")).toBe("nail_vto");
    expect(chooseEngine(inspired(0.9), "nail_transfer")).toBe("nail_transfer");
  });
});
