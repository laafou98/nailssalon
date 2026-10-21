"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type LoadedInspiration, loadInspiration } from "@/lib/inspo/browser";
import { draftSpec, type InspirationImage, type NailPick, pickNail, typicalArea } from "@/lib/inspo/pick";
import type { Point } from "@/lib/inspo/region";
import { type DesignSpec, FINGERS } from "@/lib/spec/types";

/**
 * Tap-to-pick: upload an inspiration photo, tap its nails thumb → pinky (or
 * skip a finger that isn't visible), see each outline and its colours, then
 * try the per-finger design on. Everything runs on the device.
 */

const LABELS = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
/** Outline colour per finger, readable on light and dark photos. */
const OUTLINE: [number, number, number][] = [
  [255, 64, 129],
  [0, 176, 255],
  [255, 214, 0],
  [118, 255, 3],
  [213, 0, 249],
];

/** First-pass picks per photo, so adding a tap doesn't redo the others. */
const firstPass = new WeakMap<InspirationImage, Map<string, NailPick | null>>();

function pickAll(image: InspirationImage, taps: (Point | null)[]): (NailPick | null)[] {
  let cache = firstPass.get(image);
  if (!cache) firstPass.set(image, (cache = new Map()));
  const first = taps.map((t) => {
    if (!t) return null;
    const key = `${t.x},${t.y}`;
    if (!cache.has(key)) cache.set(key, pickNail(image, t));
    return cache.get(key)!;
  });
  // Nails in one photo are alike: an outline over twice the typical size leaked, so redo it with that cap.
  const typical = typicalArea(first);
  return first.map((p, i) => (p && typical && p.region.area > 2 * typical ? pickNail(image, taps[i]!, typical) : p));
}

export default function InspoPicker({ onTryOn, busy }: { onTryOn: (spec: DesignSpec) => void; busy: boolean }) {
  const [loaded, setLoaded] = useState<LoadedInspiration | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** One entry per finger so far: a tap, or null for a skipped finger. */
  const [taps, setTaps] = useState<(Point | null)[]>([]);
  const [redo, setRedo] = useState<(Point | null)[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const picks = useMemo(() => (loaded ? pickAll(loaded.image, taps) : []), [loaded, taps]);
  const spec = useMemo(() => (picks.length ? draftSpec([...picks, ...Array(FINGERS.length - picks.length).fill(null)]) : null), [picks]);
  const done = taps.length >= FINGERS.length;

  useEffect(() => () => { if (loaded) URL.revokeObjectURL(loaded.url); }, [loaded]);

  // Outlines and finger labels, drawn at working resolution and scaled over the photo by CSS.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    const { width: w, height: h } = loaded;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const overlay = ctx.createImageData(w, h);
    picks.forEach((pick, finger) => {
      if (!pick) return;
      const [r, g, b] = OUTLINE[finger];
      const m = pick.region.mask;
      for (let p = 0; p < m.length; p++) {
        if (!m[p]) continue;
        const x = p % w;
        const edge = x === 0 || x === w - 1 || !m[p - 1] || !m[p + 1] || !m[p - w] || !m[p + w];
        overlay.data.set([r, g, b, edge ? 255 : 60], p * 4);
      }
    });
    ctx.putImageData(overlay, 0, 0);
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    picks.forEach((pick, finger) => {
      if (!pick) return;
      const label = LABELS[finger];
      const { cx, cy } = pick.region.box;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.beginPath();
      ctx.roundRect(cx - tw / 2, cy - 9, tw, 18, 9);
      ctx.fill();
      ctx.fillStyle = `rgb(${OUTLINE[finger].join(",")})`;
      ctx.fillText(label, cx, cy + 1);
    });
  }, [loaded, picks]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadInspiration(file);
      setLoaded(next);
      setTaps([]);
      setRedo([]);
    } catch (e) {
      setError(`Couldn't open that image (${String(e)}). Try a JPEG or PNG.`);
    } finally {
      setLoading(false);
    }
  };

  const add = (t: Point | null) => {
    if (done) return;
    setTaps([...taps, t]);
    setRedo([]);
  };

  const tap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!loaded) return;
    const rect = e.currentTarget.getBoundingClientRect();
    add({
      x: Math.round(((e.clientX - rect.left) / rect.width) * loaded.width),
      y: Math.round(((e.clientY - rect.top) / rect.height) * loaded.height),
    });
  };

  const undo = () => {
    setRedo([taps[taps.length - 1], ...redo]);
    setTaps(taps.slice(0, -1));
  };
  const redoTap = () => {
    setTaps([...taps, redo[0]]);
    setRedo(redo.slice(1));
  };

  const failed = taps.length > 0 && taps[taps.length - 1] !== null && picks[taps.length - 1] === null;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex cursor-pointer items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700">
        {loading ? "Opening…" : loaded ? "Choose a different photo" : "Upload an inspiration photo"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          data-testid="inspo-file"
          onChange={(e) => choose(e.target.files?.[0])}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {loaded && (
        <>
          <p className="text-sm font-medium" aria-live="polite">
            {done
              ? "All five picked. Check the colours, then try it on."
              : `Tap your ${LABELS[taps.length].toLowerCase()} nail${taps.length === 0 ? " (then index, middle, ring, pinky)" : ""}`}
          </p>
          <div className="relative overflow-hidden rounded-2xl bg-zinc-900">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
            <img src={loaded.url} alt="Your inspiration photo" className="block w-full select-none" draggable={false} />
            <canvas
              ref={canvasRef}
              onPointerUp={tap}
              className="absolute inset-0 h-full w-full touch-manipulation"
              style={{ cursor: done ? "default" : "crosshair" }}
              aria-label="Tap the nails in finger order"
            />
          </div>
          {failed && <p className="text-sm text-amber-700">Couldn&apos;t outline a nail there. Undo and tap nearer the middle of the nail.</p>}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => add(null)} disabled={done} className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700">
              Skip {done ? "" : LABELS[taps.length].toLowerCase()} (not visible)
            </button>
            <button onClick={undo} disabled={taps.length === 0} className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700">
              Undo
            </button>
            <button onClick={redoTap} disabled={redo.length === 0} className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700">
              Redo
            </button>
          </div>
          <p className="text-xs text-zinc-500">Only some nails visible? Skip a finger, or tap the same nail again to reuse it.</p>

          <ul className="grid grid-cols-5 gap-1" aria-label="Colours per finger">
            {FINGERS.map((finger, i) => {
              const f = spec?.fingers[finger];
              const picked = Boolean(picks[i]);
              return (
                <li key={finger} className="flex flex-col items-center gap-1 text-center" data-finger={finger} data-base={f?.baseHex} data-accents={f?.accentHexes.join(" ")}>
                  <div
                    className={`relative h-10 w-10 rounded-full border ${picked ? "border-zinc-400" : "border-dashed border-zinc-400 opacity-60"}`}
                    style={{ backgroundColor: f?.baseHex ?? "transparent" }}
                  >
                    {f?.accentHexes.slice(0, 2).map((hex, k) => (
                      <span key={k} className="absolute h-3.5 w-3.5 rounded-full border border-white/70" style={{ backgroundColor: hex, right: -2 - k * 8, bottom: -2 }} />
                    ))}
                  </div>
                  <span className="text-[11px] leading-tight">{LABELS[i]}</span>
                  <span className="text-[10px] leading-tight text-zinc-500">
                    {!f ? "–" : !picked ? "copied" : f.confidence < 0.6 ? "unsure" : ""}
                  </span>
                </li>
              );
            })}
          </ul>

          <button
            onClick={() => spec && onTryOn(spec)}
            disabled={!spec || busy}
            className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            {busy ? "Rendering…" : done ? "Try this on my hand" : "Try this on my hand (missing fingers copy the nearest)"}
          </button>
        </>
      )}
    </div>
  );
}
