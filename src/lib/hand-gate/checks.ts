// Hand Quality Gate [A]: pure checks on MediaPipe hand landmarks + pixel stats.
// No browser APIs here, so everything is unit-testable.
//
// Thresholds mirror YouCam Nail VTO's documented input rules
// (docs.perfectcorp.com/reference/ai_nail_vto): one hand, back of hand,
// nails unoccluded, palm ideally ≥ half the image area, long side ≤ 2048,
// short side ≥ 256, aspect ideally 1:1, 3:4 or 4:3.

export interface Point {
  x: number; // normalised 0–1 (MediaPipe convention)
  y: number;
  z?: number;
}

export interface DetectedHand {
  landmarks: Point[]; // 21 points
  /** The same 21 points in metres, camera-aligned axes, origin at the hand centre. */
  world?: Required<Point>[];
  /** MediaPipe's handedness label ("Left" | "Right"). */
  handedness: string;
  handednessScore: number;
}

export interface PixelStats {
  /** Mean luma (0–255) over the hand region. */
  meanLuma: number;
  /** Fraction of hand-region pixels at ≥ 250 (blown highlights). */
  clippedFraction: number;
  /** Variance of the Laplacian over the fingertip region (higher = sharper). */
  sharpness: number;
}

export type CheckId = "hands" | "pose" | "fingertips" | "orientation" | "coverage" | "size" | "spread" | "sharpness" | "exposure";
export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  /** Plain-language guidance shown to the user. */
  message: string;
}

export interface Box {
  x: number; // pixels
  y: number;
  width: number;
  height: number;
}

export interface GateReport {
  checks: CheckResult[];
  /** True when no check failed: the photo is good enough to spend a unit on. */
  ok: boolean;
  /** The single most important instruction to show right now. */
  headline: string;
  /** Crop (in source pixels) that the normalised output photo will use. */
  crop: Box | null;
  /** How the hand is turned, for the live 3D guide. Null when there isn't exactly one hand. */
  pose: HandPose | null;
  /**
   * Stricter than `ok`: the camera only takes the photo by itself when the hand
   * faces it squarely. `ok` alone still allows a manual "Take photo".
   */
  autoCapture: boolean;
}

export interface HandPose {
  /** How far the back of the hand is turned away from the camera, 0° = flat on. */
  turnDeg: number;
  /** Which edge of the hand is further from the camera. */
  farSide: "thumb" | "pinky";
  /** Whether that far edge is on the right of the (un-mirrored) image. */
  farEdgeOnRight: boolean;
  /**
   * Which side faces the camera; "unsure" while edge-on or when handedness is
   * low-confidence. "curled": palm towards the camera but fingers folded so the
   * nails face it (the usual way people photograph their nails).
   */
  facing: "back" | "palm" | "curled" | "unsure";
  status: CheckStatus;
}

export const FINGERTIPS = [4, 8, 12, 16, 20] as const;
export const WRIST = 0;
export const INDEX_MCP = 5;
export const PINKY_MCP = 17;

/** Hand connections for drawing the overlay. */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export const THRESHOLDS = {
  edgeMargin: 0.02, // fingertips must sit this far inside the frame
  handednessMinScore: 0.7, // below this we can't tell palm from back reliably
  coveragePass: 0.5, // YouCam: palm ideally ≥ half the image area
  coverageWarn: 0.35,
  handMinPx: 256, // hand's long side in source pixels (YouCam short side ≥ 256)
  handGoodPx: 480,
  spreadMin: 0.12, // min fingertip gap / hand size before nails overlap
  sharpnessFail: 20,
  sharpnessWarn: 60,
  lumaTooDark: 55,
  lumaDim: 80,
  lumaBright: 200,
  lumaTooBright: 225,
  clippedFail: 0.2,
  // Knuckle width (index MCP → pinky MCP) over palm length (wrist → middle MCP)
  // for a flat hand; the ratio shrinks with cos(turn angle). Our flat test hand
  // measured 0.70 in live video (0.75–0.81 as stills); the edge-on phone photo
  // that slipped through on Oct 21 measured 0.28 (≈ 67°).
  knuckleRatioFlat: 0.72,
  // Fingertip-to-knuckle length over palm length, averaged over index–pinky:
  // about 0.95 for straight fingers (the synthetic test hand: 0.94). Below this the
  // fingers are folded towards the camera and their nails face it. Set from
  // geometry, not yet measured on a real curled-hand photo.
  curledFingerRatio: 0.6,
  posePassDeg: 30, // auto-capture only at or below this turn
  poseFailDeg: 45, // block the photo above this
  cropPadding: 0.12,
  outputLongSide: 2048,
} as const;

/** Allowed output aspect ratios (width / height). */
export const ASPECTS = [1, 3 / 4, 4 / 3] as const;

/** Order checks are surfaced in: fix the most fundamental thing first. */
const PRIORITY: CheckId[] = ["hands", "pose", "orientation", "fingertips", "size", "coverage", "exposure", "sharpness", "spread"];

export function handBox(landmarks: Point[], width: number, height: number): Box {
  const xs = landmarks.map((p) => p.x * width);
  const ys = landmarks.map((p) => p.y * height);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * A whole hand with every fingertip in the frame: what a client's own hand photo
 * looks like. Real inspiration shots (close-ups, curled or overlapping hands)
 * defeat the detector at its default confidence (checked on Oct 21), so this
 * catches the client's hand photo picked as "inspiration" by mistake.
 */
export function showsWholeHand(hands: DetectedHand[]): boolean {
  return hands.some((h) => FINGERTIPS.every((i) => {
    const p = h.landmarks[i];
    return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  }));
}

/**
 * MediaPipe's docs say handedness assumes a mirrored (selfie) image, but on our
 * un-mirrored test photo (back of a left hand) it answered "Left" with 0.94
 * confidence, so we treat the label as the anatomical hand. Calibrated on
 * test-output/input-hand.jpg; re-check if the model version changes.
 */
export function anatomicalHand(label: string): "left" | "right" {
  return label.toLowerCase() === "left" ? "left" : "right";
}

/**
 * Which side of the hand faces the camera, from the winding of
 * wrist → index MCP → pinky MCP in image space (rotation-invariant).
 * For a right hand seen from the back, the thumb side is on the image's left,
 * which gives a positive cross product (y points down).
 */
export function facingSide(hand: DetectedHand): "back" | "palm" {
  const w = hand.landmarks[WRIST];
  const i = hand.landmarks[INDEX_MCP];
  const p = hand.landmarks[PINKY_MCP];
  const cross = (i.x - w.x) * (p.y - w.y) - (i.y - w.y) * (p.x - w.x);
  const rightHandBack = cross > 0;
  return (anatomicalHand(hand.handedness) === "right") === rightHandBack ? "back" : "palm";
}

/**
 * Fingers folded towards the camera: seen from the palm side, the fingertips sit
 * close to their knuckles on screen, and the nails face the camera.
 */
export function fingersCurled(hand: DetectedHand, width: number, height: number): boolean {
  const lm = hand.landmarks;
  const dist = (a: number, b: number) => Math.hypot((lm[a].x - lm[b].x) * width, (lm[a].y - lm[b].y) * height);
  const palm = dist(WRIST, 9) || 1;
  const fingers = [[8, INDEX_MCP], [12, 9], [16, 13], [20, PINKY_MCP]] as const;
  const ratio = fingers.reduce((sum, [tip, mcp]) => sum + dist(tip, mcp), 0) / fingers.length / palm;
  return ratio < THRESHOLDS.curledFingerRatio;
}

/**
 * How far the hand is turned about its long axis. MediaPipe's 3D world landmarks
 * proved unreliable for this (they called an edge-on hand flat), so the angle
 * comes from 2D foreshortening of the knuckle line, and only the direction comes
 * from MediaPipe's per-landmark depth (z), which did get the near side right.
 */
export function handPose(hand: DetectedHand, width: number, height: number): HandPose {
  const lm = hand.landmarks;
  const dist = (a: number, b: number) => Math.hypot((lm[a].x - lm[b].x) * width, (lm[a].y - lm[b].y) * height);
  const ratio = dist(INDEX_MCP, PINKY_MCP) / (dist(WRIST, 9) || 1);
  const facing = Math.min(1, ratio / THRESHOLDS.knuckleRatioFlat);
  const turnDeg = Math.round((Math.acos(facing) * 180) / Math.PI);
  const pinkyFar = (lm[PINKY_MCP].z ?? 0) > (lm[INDEX_MCP].z ?? 0);
  const far = pinkyFar ? PINKY_MCP : INDEX_MCP;
  const near = pinkyFar ? INDEX_MCP : PINKY_MCP;
  const status: CheckStatus =
    turnDeg > THRESHOLDS.poseFailDeg ? "fail" : turnDeg > THRESHOLDS.posePassDeg ? "warn" : "pass";
  return { turnDeg, farSide: pinkyFar ? "pinky" : "thumb", farEdgeOnRight: lm[far].x > lm[near].x, facing: "unsure", status };
}

/**
 * Crop around the hand: padded box, grown to the closest allowed aspect ratio,
 * shifted (not shrunk) to stay inside the image where possible.
 */
export function cropForHand(box: Box, width: number, height: number): Box {
  const pad = Math.max(box.width, box.height) * THRESHOLDS.cropPadding;
  let w = box.width + pad * 2;
  let h = box.height + pad * 2;
  const ratio = w / h;
  const aspect = ASPECTS.reduce((best, a) =>
    Math.abs(Math.log(a / ratio)) < Math.abs(Math.log(best / ratio)) ? a : best,
  );
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  // If it no longer fits, scale the crop down uniformly (keeps the aspect).
  const scale = Math.min(1, width / w, height / h);
  w *= scale;
  h *= scale;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const x = Math.min(Math.max(cx - w / 2, 0), width - w);
  const y = Math.min(Math.max(cy - h / 2, 0), height - h);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

/** Output size for a crop: long side capped at 2048, aspect preserved. */
export function outputSize(crop: Box): { width: number; height: number } {
  const scale = Math.min(1, THRESHOLDS.outputLongSide / Math.max(crop.width, crop.height));
  return { width: Math.round(crop.width * scale), height: Math.round(crop.height * scale) };
}

/** Area of the palm polygon (wrist + MCPs), in pixels². */
function polygonArea(points: { x: number; y: number }[]): number {
  let sum = 0;
  for (let k = 0; k < points.length; k++) {
    const a = points[k];
    const b = points[(k + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function evaluateHands(
  hands: DetectedHand[],
  width: number,
  height: number,
  pixels?: PixelStats,
  /** Whole-frame brightness, used to explain *why* no hand was found. */
  frameLuma?: Pick<PixelStats, "meanLuma" | "clippedFraction">,
): GateReport {
  const checks: CheckResult[] = [];
  const add = (id: CheckId, status: CheckStatus, message: string) => checks.push({ id, status, message });

  if (hands.length === 0) {
    // The detector loses hands in poor light well before our exposure thresholds
    // would trip on a found hand, so blame the light when the frame is off.
    if (frameLuma && frameLuma.meanLuma < THRESHOLDS.lumaDim) {
      add("hands", "fail", "Too dark to find your hand: move towards a light");
    } else if (frameLuma && (frameLuma.meanLuma > THRESHOLDS.lumaBright || frameLuma.clippedFraction > THRESHOLDS.clippedFail)) {
      add("hands", "fail", "Too bright to find your hand: avoid direct light");
    } else {
      add("hands", "fail", "Show the back of one hand to the camera");
    }
    return finish(checks, null, null);
  }
  if (hands.length > 1) {
    add("hands", "fail", "Only one hand in the picture, please");
    return finish(checks, null, null);
  }
  add("hands", "pass", "One hand found");

  const hand = hands[0];
  const lm = hand.landmarks;
  const box = handBox(lm, width, height);
  const crop = cropForHand(box, width, height);

  // Hand turned flat towards the camera, so YouCam sees every nail face-on.
  const pose = handPose(hand, width, height);
  const bring = pose.farSide === "pinky" ? "little finger" : "thumb";
  if (pose.status === "fail") add("pose", "fail", `Turn your hand flat: bring your ${bring} towards the camera`);
  else if (pose.status === "warn") add("pose", "warn", `Almost: turn your ${bring} a little more towards the camera`);
  else add("pose", "pass", "Hand flat to the camera");

  // Back of hand facing the camera. Handedness is unreliable when the hand is
  // edge-on, so only judge it once the pose is roughly flat.
  if (pose.status === "fail") {
    // Nothing to say yet: the pose message already tells the user what to do.
  } else if (hand.handednessScore < THRESHOLDS.handednessMinScore) {
    add("orientation", "warn", "Make sure the back of your hand faces the camera");
  } else if (facingSide(hand) === "palm" && fingersCurled(hand, width, height)) {
    pose.facing = "curled";
    add("orientation", "pass", "Fingers curled, nails facing the camera");
  } else if (facingSide(hand) === "palm") {
    pose.facing = "palm";
    add("orientation", "fail", "Turn your hand over, or curl your fingers so your nails face the camera");
  } else {
    pose.facing = "back";
    add("orientation", "pass", "Back of hand facing the camera");
  }

  // All five nails inside the frame.
  const m = THRESHOLDS.edgeMargin;
  const outside = FINGERTIPS.filter((t) => lm[t].x < m || lm[t].x > 1 - m || lm[t].y < m || lm[t].y > 1 - m);
  if (outside.length > 0) add("fingertips", "fail", "Keep all five fingertips inside the frame");
  else add("fingertips", "pass", "All five fingertips visible");

  // Enough pixels on the hand for YouCam to find the nails.
  const handPx = Math.max(box.width, box.height);
  if (handPx < THRESHOLDS.handMinPx) add("size", "fail", "Move closer: your hand is too small");
  else if (handPx < THRESHOLDS.handGoodPx) add("size", "warn", "Move a little closer for sharper nails");
  else add("size", "pass", "Hand is large enough");

  // YouCam: palm ideally ≥ half the image area. Measured on the crop we will send,
  // using the whole-hand box (fingers included) as the "palm" region.
  const coverage = (box.width * box.height) / (crop.width * crop.height);
  if (coverage >= THRESHOLDS.coveragePass) add("coverage", "pass", "Hand fills the photo");
  else if (coverage >= THRESHOLDS.coverageWarn) add("coverage", "warn", "Spread your fingers so your hand fills more of the photo");
  else add("coverage", "fail", "Spread your fingers and move closer");

  // Nails shouldn't touch or overlap.
  const palmArea = polygonArea([WRIST, 1, INDEX_MCP, 9, 13, PINKY_MCP].map((k) => ({ x: lm[k].x * width, y: lm[k].y * height })));
  const handScale = Math.sqrt(palmArea) || 1;
  let minGap = Infinity;
  for (let a = 1; a < FINGERTIPS.length; a++) {
    const p = lm[FINGERTIPS[a - 1]];
    const q = lm[FINGERTIPS[a]];
    minGap = Math.min(minGap, Math.hypot((p.x - q.x) * width, (p.y - q.y) * height) / handScale);
  }
  if (minGap < THRESHOLDS.spreadMin) add("spread", "warn", "Spread your fingers a little so nails don't overlap");
  else add("spread", "pass", "Fingers apart");

  if (pixels) {
    if (pixels.meanLuma < THRESHOLDS.lumaTooDark) add("exposure", "fail", "Too dark: move towards a light");
    else if (pixels.meanLuma > THRESHOLDS.lumaTooBright || pixels.clippedFraction > THRESHOLDS.clippedFail)
      add("exposure", "fail", "Too bright: avoid direct light or glare");
    else if (pixels.meanLuma < THRESHOLDS.lumaDim) add("exposure", "warn", "A bit dark: more light helps colour matching");
    else if (pixels.meanLuma > THRESHOLDS.lumaBright) add("exposure", "warn", "A bit bright: soften the light");
    else add("exposure", "pass", "Lighting looks good");

    if (pixels.sharpness < THRESHOLDS.sharpnessFail) add("sharpness", "fail", "Blurry: hold still and tap to focus");
    else if (pixels.sharpness < THRESHOLDS.sharpnessWarn) add("sharpness", "warn", "Slightly soft: hold still");
    else add("sharpness", "pass", "Sharp");
  }

  return finish(checks, crop, pose);
}

function finish(checks: CheckResult[], crop: Box | null, pose: HandPose | null): GateReport {
  const ranked = [...checks].sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));
  const firstFail = ranked.find((c) => c.status === "fail");
  const firstWarn = ranked.find((c) => c.status === "warn");
  const ok = !firstFail;
  const headline = firstFail?.message ?? firstWarn?.message ?? "Looks great: hold still";
  const autoCapture = ok && pose?.status === "pass";
  return { checks: ranked, ok, headline, crop, pose, autoCapture };
}
