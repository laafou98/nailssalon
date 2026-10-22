import { describe, expect, it } from "vitest";
import {
  ASPECTS,
  type DetectedHand,
  type PixelStats,
  type Point,
  cropForHand,
  evaluateHands,
  facingSide,
  fingersCurled,
  outputSize,
  showsWholeHand,
} from "./checks";

// A right hand, back to the camera, fingers up, in a square frame.
// MediaPipe labels the anatomical hand for un-mirrored photos (see anatomicalHand).
const RIGHT_HAND_BACK: Point[] = [
  { x: 0.5, y: 0.85 }, // 0 wrist
  { x: 0.4, y: 0.78 }, { x: 0.33, y: 0.7 }, { x: 0.28, y: 0.62 }, { x: 0.24, y: 0.55 }, // thumb
  { x: 0.42, y: 0.55 }, { x: 0.4, y: 0.42 }, { x: 0.39, y: 0.34 }, { x: 0.38, y: 0.27 }, // index
  { x: 0.5, y: 0.53 }, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.31 }, { x: 0.5, y: 0.23 }, // middle
  { x: 0.58, y: 0.55 }, { x: 0.6, y: 0.43 }, { x: 0.61, y: 0.35 }, { x: 0.62, y: 0.28 }, // ring
  { x: 0.66, y: 0.59 }, { x: 0.69, y: 0.5 }, { x: 0.71, y: 0.44 }, { x: 0.73, y: 0.38 }, // pinky
];

const hand = (overrides: Partial<DetectedHand> = {}): DetectedHand => ({
  landmarks: RIGHT_HAND_BACK,
  handedness: "Right",
  handednessScore: 0.95,
  ...overrides,
});

const GOOD_PIXELS: PixelStats = { meanLuma: 140, clippedFraction: 0.01, sharpness: 150 };

const statusOf = (report: ReturnType<typeof evaluateHands>, id: string) =>
  report.checks.find((c) => c.id === id)?.status;

describe("evaluateHands", () => {
  it("passes a well-framed back of hand", () => {
    const report = evaluateHands([hand()], 1000, 1000, GOOD_PIXELS);
    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.status === "pass")).toBe(true);
    expect(report.headline).toBe("Looks great: hold still");
  });

  it("blames the light when no hand is found in a dark or blown-out frame", () => {
    expect(evaluateHands([], 1000, 1000, undefined, { meanLuma: 40, clippedFraction: 0 }).headline).toMatch(/too dark/i);
    expect(evaluateHands([], 1000, 1000, undefined, { meanLuma: 150, clippedFraction: 0.5 }).headline).toMatch(/too bright/i);
    expect(evaluateHands([], 1000, 1000, undefined, { meanLuma: 140, clippedFraction: 0 }).headline).toMatch(/show the back/i);
  });

  it("fails with no hand or two hands", () => {
    expect(evaluateHands([], 1000, 1000)).toMatchObject({ ok: false, crop: null });
    const two = evaluateHands([hand(), hand()], 1000, 1000);
    expect(two.ok).toBe(false);
    expect(two.headline).toMatch(/one hand/i);
  });

  it("detects the palm side from the landmark winding", () => {
    const mirrored = RIGHT_HAND_BACK.map((p) => ({ ...p, x: 1 - p.x }));
    expect(facingSide(hand())).toBe("back");
    expect(facingSide(hand({ landmarks: mirrored }))).toBe("palm");
    // Same mirrored silhouette, but labelled as the other hand: a left hand's back.
    expect(facingSide(hand({ landmarks: mirrored, handedness: "Left" }))).toBe("back");

    const report = evaluateHands([hand({ landmarks: mirrored })], 1000, 1000, GOOD_PIXELS);
    expect(statusOf(report, "orientation")).toBe("fail");
    expect(report.headline).toMatch(/turn your hand over/i);
    // The live guide must show the palm side, not "flat ✓", even though the pose is flat.
    expect(report.pose).toMatchObject({ status: "pass", facing: "palm" });
    expect(report.autoCapture).toBe(false);
    expect(evaluateHands([hand()], 1000, 1000, GOOD_PIXELS).pose?.facing).toBe("back");
  });

  it("accepts a palm-side hand with the fingers curled so the nails face the camera", () => {
    const mirrored = RIGHT_HAND_BACK.map((p) => ({ ...p, x: 1 - p.x }));
    // Fold each finger: its joints and tip pulled in to 30% of their distance from the knuckle.
    const knuckle = (i: number) => i - ((i - 1) % 4);
    const curled = mirrored.map((p, i) =>
      i < 5 || knuckle(i) === i ? p : { x: mirrored[knuckle(i)].x + (p.x - mirrored[knuckle(i)].x) * 0.3, y: mirrored[knuckle(i)].y + (p.y - mirrored[knuckle(i)].y) * 0.3 },
    );
    expect(fingersCurled(hand({ landmarks: mirrored }), 1000, 1000)).toBe(false);
    expect(fingersCurled(hand({ landmarks: curled }), 1000, 1000)).toBe(true);
    const report = evaluateHands([hand({ landmarks: curled })], 1000, 1000, GOOD_PIXELS);
    expect(statusOf(report, "orientation")).toBe("pass");
    expect(report.pose?.facing).toBe("curled");
    // A flat palm is still refused.
    expect(statusOf(evaluateHands([hand({ landmarks: mirrored })], 1000, 1000, GOOD_PIXELS), "orientation")).toBe("fail");
  });

  it("is rotation-invariant (hand held sideways)", () => {
    const rotated = RIGHT_HAND_BACK.map((p) => ({ x: p.y, y: 1 - p.x }));
    expect(facingSide(hand({ landmarks: rotated }))).toBe("back");
  });

  it("only warns on orientation when handedness is uncertain", () => {
    const report = evaluateHands([hand({ handednessScore: 0.55 })], 1000, 1000, GOOD_PIXELS);
    expect(statusOf(report, "orientation")).toBe("warn");
    expect(report.ok).toBe(true);
  });

  it("fails when a fingertip is cut off", () => {
    const cut = RIGHT_HAND_BACK.map((p, i) => (i === 12 ? { ...p, y: 0.005 } : p));
    const report = evaluateHands([hand({ landmarks: cut })], 1000, 1000, GOOD_PIXELS);
    expect(statusOf(report, "fingertips")).toBe("fail");
  });

  it("fails a hand with too few pixels", () => {
    const report = evaluateHands([hand()], 300, 300, GOOD_PIXELS);
    expect(statusOf(report, "size")).toBe("fail");
    expect(report.headline).toMatch(/closer/i);
  });

  it("warns when fingertips nearly touch", () => {
    const squeezed = RIGHT_HAND_BACK.map((p, i) => (i === 12 ? { x: 0.385, y: 0.27 } : p));
    expect(statusOf(evaluateHands([hand({ landmarks: squeezed })], 1000, 1000, GOOD_PIXELS), "spread")).toBe("warn");
  });

  it("grades exposure and sharpness", () => {
    const run = (p: Partial<PixelStats>) => evaluateHands([hand()], 1000, 1000, { ...GOOD_PIXELS, ...p });
    expect(statusOf(run({ meanLuma: 40 }), "exposure")).toBe("fail");
    expect(statusOf(run({ meanLuma: 70 }), "exposure")).toBe("warn");
    expect(statusOf(run({ meanLuma: 240 }), "exposure")).toBe("fail");
    expect(statusOf(run({ clippedFraction: 0.4 }), "exposure")).toBe("fail");
    expect(statusOf(run({ sharpness: 10 }), "sharpness")).toBe("fail");
    expect(statusOf(run({ sharpness: 40 }), "sharpness")).toBe("warn");
  });

  it("blocks an edge-on hand and says which way to turn", () => {
    // Squash the hand horizontally around the middle finger: the knuckle line foreshortens.
    // Pinky side further from the camera (larger z), as in the real phone photo.
    const edgeOn = RIGHT_HAND_BACK.map((p, i) => ({ x: 0.5 + (p.x - 0.5) * 0.35, y: p.y, z: i >= 17 ? 0.2 : i <= 4 ? -0.3 : 0 }));
    const report = evaluateHands([hand({ landmarks: edgeOn, handednessScore: 0.65 })], 1000, 1000, GOOD_PIXELS);
    expect(statusOf(report, "pose")).toBe("fail");
    expect(report.ok).toBe(false);
    expect(report.autoCapture).toBe(false);
    expect(report.headline).toBe("Turn your hand flat: bring your little finger towards the camera");
    expect(report.pose).toMatchObject({ farSide: "pinky", status: "fail" });
    expect(report.pose!.turnDeg).toBeGreaterThan(60);
  });

  it("allows a slightly turned hand only as a manual photo", () => {
    const slight = RIGHT_HAND_BACK.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.75, z: p.x < 0.45 ? 0.1 : 0 }));
    const report = evaluateHands([hand({ landmarks: slight })], 1000, 1000, GOOD_PIXELS);
    expect(statusOf(report, "pose")).toBe("warn");
    expect(report.headline).toMatch(/almost: turn your thumb/i);
    expect(report.ok).toBe(true);
    expect(report.autoCapture).toBe(false);
  });

  it("auto-captures a flat, good hand", () => {
    const report = evaluateHands([hand()], 1000, 1000, GOOD_PIXELS);
    expect(report.autoCapture).toBe(true);
    expect(report.pose!.turnDeg).toBeLessThan(30);
  });

  it("puts the most fundamental problem in the headline", () => {
    const mirrored = RIGHT_HAND_BACK.map((p) => ({ ...p, x: 1 - p.x }));
    const report = evaluateHands([hand({ landmarks: mirrored })], 1000, 1000, { ...GOOD_PIXELS, meanLuma: 30 });
    expect(report.headline).toMatch(/turn your hand/i);
  });
});

describe("cropForHand", () => {
  it("returns an allowed aspect ratio that stays inside the image", () => {
    for (const [w, h] of [[1000, 1000], [1920, 1080], [1080, 1920], [640, 480]]) {
      const report = evaluateHands([hand()], w, h, GOOD_PIXELS);
      const crop = report.crop!;
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.width).toBeLessThanOrEqual(w);
      expect(crop.y + crop.height).toBeLessThanOrEqual(h);
      const ratio = crop.width / crop.height;
      expect(ASPECTS.some((a) => Math.abs(a - ratio) < 0.01)).toBe(true);
    }
  });

  it("contains the whole hand", () => {
    const crop = cropForHand({ x: 240, y: 230, width: 490, height: 620 }, 1000, 1000);
    expect(crop.x).toBeLessThanOrEqual(240);
    expect(crop.y).toBeLessThanOrEqual(230);
    expect(crop.x + crop.width).toBeGreaterThanOrEqual(730);
    expect(crop.y + crop.height).toBeGreaterThanOrEqual(850);
  });
});

describe("outputSize", () => {
  it("caps the long side at 2048 and keeps the aspect", () => {
    expect(outputSize({ x: 0, y: 0, width: 3000, height: 4000 })).toEqual({ width: 1536, height: 2048 });
    expect(outputSize({ x: 0, y: 0, width: 900, height: 1200 })).toEqual({ width: 900, height: 1200 });
  });
});

describe("showsWholeHand", () => {
  it("is true only when a hand has every fingertip in the frame", () => {
    expect(showsWholeHand([hand()])).toBe(true);
    expect(showsWholeHand([])).toBe(false);
    const cut = RIGHT_HAND_BACK.map((p, i) => (i === 12 ? { ...p, y: -0.05 } : p));
    expect(showsWholeHand([hand({ landmarks: cut })])).toBe(false);
  });
});
