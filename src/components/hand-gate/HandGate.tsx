"use client";

import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CheckResult,
  type DetectedHand,
  FINGERTIPS,
  type GateReport,
  HAND_CONNECTIONS,
  type HandPose,
} from "@/lib/hand-gate/checks";
import { type GatedPhoto, analyze, loadLandmarker, normalisePhoto } from "@/lib/hand-gate/browser";
import TiltGuide from "./TiltGuide";

type Phase = "idle" | "loading" | "live" | "checking" | "rejected" | "accepted" | "error";

const AUTO_CAPTURE_MS = 1500; // the photo must stay good this long before we take it
const PIXEL_EVERY_MS = 250;
const REPORT_EVERY_MS = 200;

export default function HandGate({ onAccept }: { onAccept?: (photo: GatedPhoto) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [report, setReport] = useState<GateReport | null>(null);
  const [photo, setPhoto] = useState<GatedPhoto | null>(null);
  const [rejectedUrl, setRejectedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mirrored, setMirrored] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  // Updated every frame (the report only a few times a second) so the 3D guide tracks the hand smoothly.
  const [pose, setPose] = useState<HandPose | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  // Release object URLs when photos are replaced.
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => () => { if (rejectedUrl) URL.revokeObjectURL(rejectedUrl); }, [rejectedUrl]);

  const fail = (e: unknown) => {
    stopCamera();
    setError(e instanceof Error ? e.message : String(e));
    setPhase("error");
  };

  /** Final check on a still image, then crop + encode if it passes. */
  const checkStill = useCallback(async (landmarker: HandLandmarker, still: HTMLCanvasElement | ImageBitmap) => {
    setPhase("checking");
    const analysis = await analyze(landmarker, still);
    setReport(analysis.report);
    if (!analysis.report.ok) {
      const canvas = document.createElement("canvas");
      canvas.width = analysis.width;
      canvas.height = analysis.height;
      canvas.getContext("2d")!.drawImage(still, 0, 0);
      drawHands(canvas, analysis.hands, toneOf(analysis.report), false);
      setRejectedUrl(canvas.toDataURL("image/jpeg", 0.8));
      setPhase("rejected");
      return;
    }
    const result = await normalisePhoto(still, analysis);
    setPhoto(result);
    setPhase("accepted");
    onAccept?.(result);
  }, [onAccept]);

  const startCamera = async () => {
    setError(null);
    setPhase("loading");
    try {
      const [landmarker, stream] = await Promise.all([
        loadLandmarker(),
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        }),
      ]);
      streamRef.current = stream;
      const settings = stream.getVideoTracks()[0]?.getSettings();
      // Laptops report no facingMode; their webcams face the user.
      setMirrored(settings?.facingMode !== "environment");
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setPhase("live");
      runLoop(landmarker, video);
    } catch (e) {
      fail(e);
    }
  };

  const runLoop = (landmarker: HandLandmarker, video: HTMLVideoElement) => {
    let lastVideoTime = -1;
    let lastPixelAt = 0;
    let lastReportAt = 0;
    let okSince: number | null = null;
    let busy = false;

    const tick = async () => {
      rafRef.current = requestAnimationFrame(tick);
      if (busy || video.readyState < 2 || video.currentTime === lastVideoTime) return;
      busy = true;
      try {
        lastVideoTime = video.currentTime;
        const now = performance.now();
        const withPixels = now - lastPixelAt > PIXEL_EVERY_MS;
        if (withPixels) lastPixelAt = now;
        const analysis = await analyze(landmarker, video, now, withPixels);
        const overlay = overlayRef.current;
        if (overlay) {
          overlay.width = analysis.width;
          overlay.height = analysis.height;
          drawHands(overlay, analysis.hands, toneOf(analysis.report));
        }
        setPose(analysis.report.pose);
        // Pixel checks only run every few frames; only those full reports drive the UI and the hold timer.
        if (withPixels) {
          okSince = analysis.report.autoCapture ? (okSince ?? now) : null;
          if (now - lastReportAt > REPORT_EVERY_MS || !analysis.report.ok) {
            lastReportAt = now;
            setReport(analysis.report);
          }
        }
        const held = okSince === null ? 0 : (now - okSince) / AUTO_CAPTURE_MS;
        setHoldProgress(Math.min(1, held));
        if (held >= 1) {
          if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
          await captureFrame(landmarker, video);
        }
      } catch (e) {
        fail(e);
      } finally {
        busy = false;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const captureFrame = async (landmarker: HandLandmarker, video: HTMLVideoElement) => {
    const still = document.createElement("canvas");
    still.width = video.videoWidth;
    still.height = video.videoHeight;
    still.getContext("2d")!.drawImage(video, 0, 0);
    stopCamera();
    await checkStill(landmarker, still);
  };

  const captureNow = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      await captureFrame(await loadLandmarker(), video);
    } catch (e) {
      fail(e);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    stopCamera();
    setError(null);
    setPhase("loading");
    try {
      const [landmarker, bitmap] = await Promise.all([
        loadLandmarker(),
        createImageBitmap(file, { imageOrientation: "from-image" }),
      ]);
      await checkStill(landmarker, bitmap);
      bitmap.close();
    } catch (e) {
      fail(e);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const reset = () => {
    stopCamera();
    setPhoto(null);
    setRejectedUrl(null);
    setReport(null);
    setHoldProgress(0);
    setPose(null);
    setPhase("idle");
  };

  const live = phase === "live";

  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {/* Camera view stays mounted so the <video> ref exists before the stream starts. */}
      <div
        className={`relative mx-auto overflow-hidden rounded-2xl bg-zinc-900 ${
          phase === "loading" ? "h-64 w-full" : live ? "w-fit max-w-full" : "hidden"
        }`}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          // Capped height so a portrait phone camera fits on screen with the controls.
          className="block max-h-[70vh] max-w-full"
          style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
        />
        <canvas
          ref={overlayRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
        />
        {phase === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-300">
            Loading hand detector…
          </div>
        )}
        {live && report && (
          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-4">
            <p className={`text-lg font-medium ${report.ok ? "text-emerald-300" : "text-white"}`}>{report.headline}</p>
          </div>
        )}
        {live && pose && (
          <div className="absolute right-3 top-16">
            <TiltGuide pose={pose} mirrored={mirrored} />
          </div>
        )}
        {live && holdProgress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/20">
            <div className="h-full bg-emerald-400 transition-[width]" style={{ width: `${holdProgress * 100}%` }} />
          </div>
        )}
      </div>

      {phase === "idle" && (
        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
          <h2 className="text-xl font-semibold">Photograph your hand</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Back of one hand, bare nails, fingers slightly apart, in good light. We check the photo on your
            device before anything is sent, so a bad photo never costs a render.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={startCamera}
              className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
            >
              Use camera
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Upload a photo
            </button>
          </div>
        </div>
      )}

      {live && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-500">Takes the photo by itself once your hand is flat and everything is green.</p>
          <div className="flex gap-2">
            <button onClick={reset} className="rounded-full border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
              Cancel
            </button>
            <button
              onClick={captureNow}
              disabled={!report?.ok}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
            >
              Take photo
            </button>
          </div>
        </div>
      )}

      {phase === "checking" && <p className="text-sm text-zinc-500">Checking photo…</p>}

      {phase === "rejected" && rejectedUrl && (
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
          <img src={rejectedUrl} alt="Your photo, with the detected hand outlined" className="w-full rounded-2xl" />
          <p className="text-lg font-medium">{report?.headline}</p>
        </div>
      )}

      {phase === "accepted" && photo && (
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
          <img src={photo.url} alt="Your hand photo, cropped and ready" className="w-full rounded-2xl" />
          <p className="text-lg font-medium text-emerald-600 dark:text-emerald-400">Photo ready for try-on</p>
          <p className="text-xs text-zinc-500">
            {photo.width}×{photo.height} JPEG · {Math.round(photo.blob.size / 1024)} KB · 21 landmarks saved
          </p>
        </div>
      )}

      {phase === "error" && (
        <div className="rounded-2xl border border-red-300 p-4 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
          {describeError(error)}
        </div>
      )}

      {/* While live, the headline and 3D guide say what to do; the full list is for the result. */}
      {report && (phase === "rejected" || phase === "accepted") && <CheckList checks={report.checks} />}

      {(phase === "rejected" || phase === "accepted" || phase === "error") && (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={startCamera}
            className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
          >
            {phase === "accepted" ? "Retake with camera" : "Try the camera again"}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium dark:border-zinc-700"
          >
            Upload a different photo
          </button>
        </div>
      )}
    </div>
  );
}

const ICON: Record<CheckResult["status"], string> = { pass: "✓", warn: "!", fail: "✕" };
const TONE: Record<CheckResult["status"], string> = {
  pass: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  fail: "text-red-600 dark:text-red-400",
};

function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-2">
          <span className={`w-4 shrink-0 text-center font-bold ${TONE[c.status]}`} aria-label={c.status}>
            {ICON[c.status]}
          </span>
          <span>{c.message}</span>
        </li>
      ))}
    </ul>
  );
}

type Tone = "good" | "almost" | "bad";

const toneOf = (report: GateReport): Tone =>
  report.autoCapture ? "good" : report.ok && report.pose?.status !== "fail" ? "almost" : "bad";

const TONE_RGB: Record<Tone, string> = { good: "52, 211, 153", almost: "252, 211, 77", bad: "244, 114, 182" };

/** Palm outline: wrist, thumb base and the four knuckles. */
const PALM = [0, 1, 5, 9, 13, 17];

function drawHands(canvas: HTMLCanvasElement, hands: DetectedHand[], tone: Tone, clear = true) {
  const ctx = canvas.getContext("2d")!;
  if (clear) ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.max(canvas.width, canvas.height) / 640;
  const rgb = TONE_RGB[tone];
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = tone === "bad" ? "rgba(255, 255, 255, 0.85)" : `rgba(${rgb}, 0.9)`;
  for (const hand of hands) {
    const p = hand.landmarks.map((l) => ({ x: l.x * canvas.width, y: l.y * canvas.height }));
    // Tinted palm plate: it narrows to a sliver as the hand turns edge-on.
    ctx.beginPath();
    PALM.forEach((k, i) => (i === 0 ? ctx.moveTo(p[k].x, p[k].y) : ctx.lineTo(p[k].x, p[k].y)));
    ctx.closePath();
    ctx.fillStyle = `rgba(${rgb}, 0.28)`;
    ctx.fill();
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(p[a].x, p[a].y);
      ctx.lineTo(p[b].x, p[b].y);
    }
    ctx.stroke();
    for (const t of FINGERTIPS) {
      ctx.beginPath();
      ctx.arc(p[t].x, p[t].y, 7 * scale, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.fill();
    }
  }
}

function describeError(error: string | null) {
  if (!error) return "Something went wrong.";
  if (/permission|notallowed/i.test(error)) return "Camera access was blocked. Allow it in your browser, or upload a photo instead.";
  if (/notfound|devices/i.test(error)) return "No camera found. Upload a photo instead.";
  return `Something went wrong: ${error}`;
}
