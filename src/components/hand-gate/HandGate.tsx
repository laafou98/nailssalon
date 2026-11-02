"use client";

import type { HandLandmarker } from "@mediapipe/tasks-vision";
import Link from "next/link";
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
import Icon from "@/components/ui/Icon";
import StepNav from "@/components/ui/StepNav";
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
  const [captureInfo, setCaptureInfo] = useState<string | null>(null);
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

  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      stopCamera();
    };
  }, [stopCamera]);

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
  }, []);

  const startCamera = async () => {
    setError(null);
    setReport(null);
    setHoldProgress(0);
    setPose(null);
    setPhase("loading");
    try {
      const [landmarker, stream] = await Promise.all([
        loadLandmarker(),
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        }),
      ]);
      if (unmounted.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
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
    setPhase("checking");
    // Prefer a real photo from the camera: video frames are low-resolution and heavily
    // compressed on phones. Where ImageCapture isn't supported (iOS Safari), take one frame at the
    // camera's top video resolution instead of the 1080p preview's.
    let still: HTMLCanvasElement | ImageBitmap | null = await takeFullPhoto(streamRef.current);
    let source = "camera photo";
    if (!still) {
      const sharp = await raiseResolution(streamRef.current, video);
      source = sharp ? "full-resolution video frame" : "video frame";
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      still = canvas;
    }
    setCaptureInfo(`from a ${still.width}×${still.height} ${source}`);
    stopCamera();
    await checkStill(landmarker, still);
    if (still instanceof ImageBitmap) still.close();
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
    setCaptureInfo("from your uploaded photo");
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

  // The flow opens on the camera. The ref keeps React's dev double-mount from asking twice.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const live = phase === "live";
  const onCamera = phase === "idle" || phase === "loading" || phase === "live" || phase === "checking";
  const close = <Link href="/" className="n-ib" aria-label="Close"><Icon name="xmark" /></Link>;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        className="n-sr"
        tabIndex={-1}
        aria-label="Upload a photo of your hand"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {/* Camera view stays mounted so the <video> ref exists before the stream starts. */}
      <div className="n-cam n-push-in" hidden={!onCamera}>
        <div className="n-view">
          <video ref={videoRef} playsInline muted style={{ transform: mirrored ? "scaleX(-1)" : undefined }} />
          <canvas ref={overlayRef} style={{ transform: mirrored ? "scaleX(-1)" : undefined }} />
        </div>
        <div className="n-nav">
          {close}
          <div className="n-prog n-prog-dim" aria-hidden>
            <i className="now" />
            <i />
            <i />
          </div>
          <span className="n-eye" style={{ opacity: 0.8 }}>1/3</span>
        </div>
        <div className="n-pill" key={report?.ok ? "ok" : "not-ok"} aria-live="polite">
          <Icon name={report?.ok ? "checkmark-alt" : "hand-raised"} />
          {phase === "checking" ? "Checking photo…" : live && report ? report.headline : phase === "live" ? "Lay your hand flat, fingers apart" : "Loading hand detector…"}
        </div>
        <div className="n-guide" aria-hidden>
          <b />
          <b />
          <b />
          <b />
        </div>
        {live && pose && pose.status !== "pass" && (
          <div className="n-tilt">
            <TiltGuide pose={pose} mirrored={mirrored} />
          </div>
        )}
        {live && (
          <div className="n-status">
            <span className="n-dot" />
            {holdProgress > 0 ? "Hold still…" : report?.ok ? "Almost there…" : "Looking for your hand…"}
          </div>
        )}
        <div className="n-dock">
          <div className="n-dock-row">
            <button className="n-up" onClick={() => fileRef.current?.click()} aria-label="Upload a photo">
              <Icon name="photo" size={24} />
            </button>
            <button className="n-shutter" onClick={captureNow} disabled={!live || !report?.ok} aria-label="Take photo">
              <svg viewBox="0 0 84 84">
                <circle cx="42" cy="42" r="40" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="4" />
                <circle
                  cx="42"
                  cy="42"
                  r="40"
                  fill="none"
                  stroke="#FF4512"
                  strokeWidth="4"
                  strokeLinecap="round"
                  transform="rotate(-90 42 42)"
                  strokeDasharray="251.3"
                  strokeDashoffset={251.3 * (1 - holdProgress)}
                />
              </svg>
              <i />
            </button>
            <span style={{ width: 52 }} />
          </div>
          <p className="n-hint">Takes the photo by itself when you&apos;re steady</p>
        </div>
      </div>

      {phase === "rejected" && rejectedUrl && report && (
        <div className="n-scr">
          <StepNav step={1} fill={40} onBack={startCamera} label="Back to the camera" />
          <Rejected report={report} url={rejectedUrl} />
          <CheckDetails checks={report.checks} />
          <div className="n-cta">
            <button className="n-btn n-btn-k" onClick={startCamera}>
              <Icon name="arrow-counterclockwise" size={20} />
              Retake
            </button>
            <button className="n-btn n-btn-ghost" onClick={() => fileRef.current?.click()}>
              Upload a different photo
            </button>
          </div>
        </div>
      )}

      {phase === "accepted" && photo && report && (
        <div className="n-scr">
          <StepNav step={1} fill={100} onBack={startCamera} />
          <div className="n-head">
            <p className="n-eye">Step 1 · Your hand</p>
            <h1 className="n-d n-h1">Looking good.</h1>
          </div>
          <div className="n-photo n-sticker">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
            <img src={photo.url} alt="Your hand photo, cropped and ready" />
            <button className="n-retake" onClick={startCamera}>
              <Icon name="arrow-counterclockwise" size={16} />
              Retake
            </button>
          </div>
          <div className="n-checks">
            {READY_CHIPS.map(({ id, label }) => {
              const check = report.checks.find((c) => c.id === id);
              const warn = check?.status === "warn";
              return (
                <div key={id} className={`n-chip ${warn ? "warn" : ""}`} title={check?.message}>
                  <span>{warn ? <b style={{ font: "700 12px var(--mono)" }}>!</b> : <Icon name="checkmark-alt" size={12} />}</span>
                  {label}
                </div>
              );
            })}
          </div>
          <CheckDetails
            checks={report.checks}
            caption={`${photo.width}×${photo.height} JPEG ${captureInfo} · ${Math.round(photo.blob.size / 1024)} KB · 21 landmarks saved`}
            action={<button className="n-link" onClick={() => fileRef.current?.click()}>Upload instead</button>}
          />
          <div className="n-cta">
            <button className="n-btn n-btn-k" onClick={() => onAccept?.(photo)}>
              Continue
              <Icon name="arrow-right" size={20} />
            </button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="n-scr">
          <div className="n-nav">{close}</div>
          <div className="n-fail">
            <div className="n-alert-art white">
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration */}
              <img src="/v2/oops.svg" alt="The polish bottle mascot tipped over" />
            </div>
            <h1 className="n-d n-alert-title">{/permission|notallowed/i.test(error ?? "") ? "Camera's blocked." : "That didn't work."}</h1>
            <p className="n-body">{describeError(error)}</p>
          </div>
          <div className="n-cta">
            <button className="n-btn n-btn-k" onClick={() => fileRef.current?.click()}>
              <Icon name="photo" size={20} />
              Upload a photo
            </button>
            <button className="n-btn n-btn-ghost" onClick={startCamera}>
              Try the camera again
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** The chips on Hand ready, each backed by a real check. */
const READY_CHIPS: { id: CheckResult["id"]; label: string }[] = [
  { id: "pose", label: "Flat" },
  { id: "sharpness", label: "Sharp" },
  { id: "fingertips", label: "All 5 nails" },
];

/** One plain sentence and one way forward, over the photo with the hand outlined. */
function Rejected({ report, url }: { report: GateReport; url: string }) {
  const failed = (id: CheckResult["id"]) => report.checks.some((c) => c.id === id && c.status === "fail");
  const palm = report.pose?.facing === "palm" || failed("orientation");
  const tilted = !palm && failed("pose");
  const eyebrow = palm ? "Camera · Palm facing" : tilted ? "Camera · Hand tilted" : "Camera · Not quite";
  const title = palm ? "That's your palm." : tilted ? "Hand's on a tilt." : "Not quite yet.";
  const body = palm ? "We need the back of your hand to see your nails." : tilted ? "Lay it flat on a table and try again." : report.headline;
  const pill = palm ? "Turn your hand over" : tilted ? report.headline.replace(/^.*?: /, "").replace(/^./, (c) => c.toUpperCase()) : null;
  return (
    <>
      <div className="n-head">
        <p className="n-eye">{eyebrow}</p>
        <h1 className="n-d n-h1 n-h1-sm">{title}</h1>
        <p className="n-body" style={{ marginTop: 10 }}>{body}</p>
      </div>
      <div className="n-photo n-sticker" style={{ height: "clamp(220px, calc(100dvh - 450px), 400px)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
        <img src={url} alt="Your photo, with the detected hand outlined" />
        {pill && <span className="n-pill" style={{ top: 14, position: "absolute", boxShadow: "0 3px 0 var(--r)" }}>{pill}</span>}
        {(palm || tilted) && (
          <span style={{ position: "absolute", right: 12, bottom: 12, display: "grid", placeItems: "center", width: 84, height: 72, borderRadius: 16, background: "var(--k)" }} aria-hidden>
            {palm ? <FlipArt /> : <TiltArt />}
          </span>
        )}
      </div>
    </>
  );
}

function FlipArt() {
  return (
    <svg width="74" height="60" viewBox="0 0 110 90" className="n-wob">
      <rect x="35" y="14" width="40" height="64" rx="18" fill="#fff" stroke="#141210" strokeWidth="3" />
      <path d="M45 34h20M45 44h14" stroke="#141210" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 46 A42 42 0 0 1 96 46" fill="none" stroke="#FF4512" strokeWidth="5" strokeLinecap="round" />
      <path d="M90 36 l7 11 l-12 2" fill="none" stroke="#FF4512" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TiltArt() {
  return (
    <svg width="74" height="60" viewBox="0 0 110 90" className="n-wob">
      <path d="M40 16 L66 10 L66 80 L40 84Z" fill="#fff" stroke="#141210" strokeWidth="3" strokeLinejoin="round" />
      <path d="M66 10 L76 16 L76 76 L66 80" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="5 5" />
      <path d="M84 28 A30 30 0 0 1 84 64" fill="none" stroke="#FF4512" strokeWidth="5" strokeLinecap="round" />
      <path d="M76 60 l8 6 l4 -10" fill="none" stroke="#FF4512" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Full-resolution still from the camera via ImageCapture (Chrome on Android/desktop), or null. */
async function takeFullPhoto(stream: MediaStream | null): Promise<ImageBitmap | null> {
  const track = stream?.getVideoTracks()[0];
  if (!track || typeof ImageCapture === "undefined") return null;
  try {
    const capture = new ImageCapture(track);
    const caps = await capture.getPhotoCapabilities();
    const settings: PhotoSettings = {};
    // Never fire the flash: it flattens the nails and blows out the colour.
    if (caps.fillLightMode?.includes("off")) settings.fillLightMode = "off";
    if (caps.imageWidth?.max) settings.imageWidth = caps.imageWidth.max;
    const blob = await capture.takePhoto(settings);
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
}

/** Largest frame we ask for: 12 MP stays within iOS Safari's canvas memory limit (16.7 MP). */
const MAX_STILL_PIXELS = 12.5e6;

/**
 * Switches the live stream to the camera's top resolution and waits for a frame at that size. The preview runs at
 * 1080p (fast hand tracking); on an iPhone that left the nails about 80–100 px wide. True if the frame got larger.
 */
async function raiseResolution(stream: MediaStream | null, video: HTMLVideoElement): Promise<boolean> {
  const track = stream?.getVideoTracks()[0];
  const caps = track?.getCapabilities?.();
  const maxW = caps?.width?.max, maxH = caps?.height?.max;
  const before = video.videoWidth * video.videoHeight;
  if (!track || !maxW || !maxH || maxW * maxH <= before * 1.2) return false;
  const scale = Math.min(1, Math.sqrt(MAX_STILL_PIXELS / (maxW * maxH)));
  try {
    await track.applyConstraints({ width: { ideal: Math.round(maxW * scale) }, height: { ideal: Math.round(maxH * scale) } });
  } catch {
    return false;
  }
  const deadline = performance.now() + 2500;
  while (video.videoWidth * video.videoHeight <= before * 1.2) {
    if (performance.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  // The first frames after a switch can still be settling (exposure, focus); give it a few.
  await new Promise((r) => setTimeout(r, 300));
  return true;
}

const ICON: Record<CheckResult["status"], string> = { pass: "✓", warn: "!", fail: "✕" };

/** The full list of checks, one tap away. */
function CheckDetails({ checks, caption, action }: { checks: CheckResult[]; caption?: string; action?: React.ReactNode }) {
  const issues = checks.filter((c) => c.status !== "pass").length;
  return (
    <details className="n-details">
      <summary>
        {issues > 0 ? `All checks · ${issues} to look at` : "All checks passed"}
        <Icon name="chevron-right" size={12} />
        <span style={{ marginLeft: "auto" }} onClick={(e) => e.preventDefault()}>{action}</span>
      </summary>
      <ul>
        {checks.map((c) => (
          <li key={c.id} className={c.status}>
            <b aria-label={c.status}>{ICON[c.status]}</b>
            <span>{c.message}</span>
          </li>
        ))}
      </ul>
      {caption && <p className="n-cap">{caption}</p>}
    </details>
  );
}

type Tone = "good" | "almost" | "bad";

const toneOf = (report: GateReport): Tone =>
  report.autoCapture ? "good" : report.ok && report.pose?.status !== "fail" ? "almost" : "bad";

const TONE_RGB: Record<Tone, string> = { good: "255, 69, 18", almost: "255, 194, 26", bad: "255, 255, 255" };

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
