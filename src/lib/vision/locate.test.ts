import { describe, expect, it } from "vitest";
import { chooseHand, parseLocations } from "./locate";

const nail = (hand: number, finger: "thumb" | "index" | "middle" | "ring" | "pinky", x: number, y: number, visible: "full" | "partial" | "hidden" = "full", confidence = 0.9) => ({
  hand,
  finger,
  x,
  y,
  visible,
  confidence,
});

describe("parseLocations", () => {
  it("turns pixel coordinates into fractions and drops hidden or out-of-frame nails", () => {
    const r = parseLocations({ hands_visible: 1, nails: [nail(1, "index", 100, 50), nail(1, "thumb", 10, 10, "hidden"), nail(1, "pinky", 500, 10), nail(1, "ring", 20, 20, "partial", 1.4)] }, 200, 100);
    expect(r.nails.map((n) => n.finger)).toEqual(["index", "ring"]);
    expect(r.nails[0]).toMatchObject({ x: 0.5, y: 0.5 });
    expect(r.nails[1].confidence).toBe(1);
    expect(r.handsVisible).toBe(1);
  });
});

describe("chooseHand", () => {
  it("suggests the hand with the most fully visible nails, one entry per finger", () => {
    const two = parseLocations(
      {
        hands_visible: 2,
        nails: [nail(1, "index", 10, 10), nail(1, "middle", 20, 10, "partial"), nail(2, "thumb", 50, 50), nail(2, "index", 60, 50), nail(2, "middle", 70, 50), nail(2, "pinky", 90, 50), nail(2, "pinky", 95, 55)],
      },
      100,
      100,
    );
    const hand = chooseHand(two);
    expect(hand.map((n) => n && n.hand)).toEqual([2, 2, 2, null, 2]);
    expect(hand[4]?.x).toBeCloseTo(0.9, 5);
  });

  it("gives five nulls when nothing was found", () => {
    expect(chooseHand({ handsVisible: 0, nails: [] })).toEqual([null, null, null, null, null]);
  });
});
