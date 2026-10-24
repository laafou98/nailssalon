// Browser-only side of the Hand Quality Gate: loads MediaPipe, samples pixels
// from a frame, and produces the normalised photo YouCam will receive.
// MediaPipe's WASM and model are self-hosted under /public/mediapipe.

import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";
import {
  type Box,
  type DetectedHand,
  FINGERTIPS,
  type GateReport,
  type PixelStats,
  type Point,
  evaluateHands,
  handBox,
  outputSize,
} from "./checks";
import { laplacianVariance, lumaStats } from "./pixels";

type Mode = "VIDEO" | "IMAGE";

let loading: Promise<HandLandmarker> | null = null;

/** Palm detector threshold for the live camera. */
const DETECTION = 0.5;
/**
 * Retry threshold for still photos where nothing was found. The palm detector misses
 * curled, palm-side hands in busy scenes (user's photo, Oct 24: found at 0.15, while
 * a hand-free crop and noise still found nothing), and the landmark model is then sure.
 */
const STILL_RETRY_DETECTION = 0.15;
let currentMode: Mode = "VIDEO";

/** Lazily creates one shared HandLandmarker (≈ 20 MB of WASM + model, cached by the browser). */
export function loadLandmarker(): Promise<HandLandmarker> {
  loading ??= (async () => {
    const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate },
      runningMode: "VIDEO" as const,
      numHands: 2, // so we can tell the user there are two hands, not silently pick one
      minHandDetectionConfidence: DETECTION,
      // Presence (the landmark model's own check) stays strict, so a low detection bar doesn't invent hands.
      minHandPresenceConfidence: 0.5,
    });
    try {
      return await HandLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      return HandLandmarker.createFromOptions(fileset, options("CPU"));
    }
  })().catch((error: unknown) => {
    loading = null; // allow a retry
    throw error;
  });
  return loading;
}

async function setMode(landmarker: HandLandmarker, mode: Mode) {
  if (currentMode === mode) return;
  await landmarker.setOptions({ runningMode: mode });
  currentMode = mode;
}

export function toHands(result: HandLandmarkerResult): DetectedHand[] {
  return result.landmarks.map((landmarks, i) => ({
    landmarks,
    world: result.worldLandmarks[i],
    handedness: result.handedness[i]?.[0]?.categoryName ?? "",
    handednessScore: result.handedness[i]?.[0]?.score ?? 0,
  }));
}

export type FrameSource = HTMLVideoElement | ImageBitmap | HTMLCanvasElement;

export function sourceSize(source: FrameSource) {
  return source instanceof HTMLVideoElement
    ? { width: source.videoWidth, height: source.videoHeight }
    : { width: source.width, height: source.height };
}

const scratch = () => document.createElement("canvas");
let sampleCanvas: HTMLCanvasElement | null = null; // created on first use (module also loads during SSR)

/** Draws a region of the source into a small canvas (long side = `size`) and returns its pixels. */
function sampleRegion(source: FrameSource, box: Box, size: number) {
  const scale = size / Math.max(box.width, box.height, 1);
  const w = Math.max(3, Math.round(box.width * scale));
  const h = Math.max(3, Math.round(box.height * scale));
  sampleCanvas ??= scratch();
  sampleCanvas.width = w;
  sampleCanvas.height = h;
  const ctx = sampleCanvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}

function clampBox(box: Box, width: number, height: number): Box {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  return { x, y, width: Math.min(width, box.x + box.width) - x, height: Math.min(height, box.y + box.height) - y };
}

/** Exposure over the whole hand; sharpness over the fingertip/nail region only. */
export function pixelStats(source: FrameSource, hand: DetectedHand): PixelStats {
  const { width, height } = sourceSize(source);
  const hb = clampBox(handBox(hand.landmarks, width, height), width, height);
  const { meanLuma, clippedFraction } = lumaStats(sampleRegion(source, hb, 160).data);

  const nailPoints = FINGERTIPS.flatMap((t) => [hand.landmarks[t], hand.landmarks[t - 1]]);
  const nb = handBox(nailPoints, width, height);
  const pad = Math.max(nb.width, nb.height) * 0.08;
  const nailBox = clampBox({ x: nb.x - pad, y: nb.y - pad, width: nb.width + pad * 2, height: nb.height + pad * 2 }, width, height);
  const region = sampleRegion(source, nailBox, 256);
  return { meanLuma, clippedFraction, sharpness: laplacianVariance(region.data, region.width, region.height) };
}

export interface Analysis {
  hands: DetectedHand[];
  report: GateReport;
  width: number;
  height: number;
}

export async function analyze(
  landmarker: HandLandmarker,
  source: FrameSource,
  timestampMs?: number,
  withPixels = true,
): Promise<Analysis> {
  const { width, height } = sourceSize(source);
  let result: HandLandmarkerResult;
  if (timestampMs === undefined) {
    await setMode(landmarker, "IMAGE");
    result = landmarker.detect(source);
    if (result.landmarks.length === 0) {
      await landmarker.setOptions({ minHandDetectionConfidence: STILL_RETRY_DETECTION });
      try {
        result = landmarker.detect(source);
      } finally {
        await landmarker.setOptions({ minHandDetectionConfidence: DETECTION });
      }
    }
  } else {
    await setMode(landmarker, "VIDEO");
    result = landmarker.detectForVideo(source, timestampMs);
  }
  const hands = toHands(result);
  const pixels = withPixels && hands.length === 1 ? pixelStats(source, hands[0]) : undefined;
  const frameLuma =
    withPixels && hands.length === 0
      ? lumaStats(sampleRegion(source, { x: 0, y: 0, width, height }, 160).data)
      : undefined;
  return { hands, report: evaluateHands(hands, width, height, pixels, frameLuma), width, height };
}

export interface GatedPhoto {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  /** Landmarks re-normalised to the cropped photo. */
  landmarks: Point[];
  report: GateReport;
}

/** Crops to the hand at an allowed aspect, caps the long side at 2048 and encodes JPEG. */
export async function normalisePhoto(source: FrameSource, analysis: Analysis): Promise<GatedPhoto> {
  const crop = analysis.report.crop;
  if (!crop || analysis.hands.length !== 1) throw new Error("No usable hand to crop");
  const size = outputSize(crop);
  const canvas = scratch();
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")!.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), "image/jpeg", 0.92),
  );
  const landmarks = analysis.hands[0].landmarks.map((p) => ({
    x: (p.x * analysis.width - crop.x) / crop.width,
    y: (p.y * analysis.height - crop.y) / crop.height,
    z: p.z,
  }));
  return { blob, url: URL.createObjectURL(blob), ...size, landmarks, report: analysis.report };
}
