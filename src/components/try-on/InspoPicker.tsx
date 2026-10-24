"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type LoadedInspiration, loadInspiration, looksLikeOwnHand, nailDesignPng, toJpeg } from "@/lib/inspo/browser";
import {
  LENGTHS,
  TIP_SHAPES,
  type TipShape,
  asExtensions,
  draftSpec,
  guessExtensions,
  type InspirationImage,
  type NailPick,
  type SamOutline,
  pickNail,
  sourceFingers,
  typicalArea,
  withDesigns,
} from "@/lib/inspo/pick";
import type { Point } from "@/lib/inspo/region";
import { encodeForSam, samOutline } from "@/lib/inspo/sam-browser";
import { type EngineChoice, chooseEngine } from "@/lib/render/router";
import { type DesignSpec, FINGERS, TEXTURES, type Texture, designSpecSchema, solidSpec } from "@/lib/spec/types";
import { type DesignReading, applyReading, needsArtwork } from "@/lib/vision/reading";

/**
 * Tap-to-pick: upload an inspiration photo, tap its nails thumb → pinky (or
 * skip a finger that isn't visible), see each outline and its colours, then
 * try the per-finger design on. Each finger copies the nail's artwork (a
 * cut-out PNG) or just its colour. Outlines and colours are found on the device;
 * once all five are picked, the vision model reads each nail's finish and pattern.
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

/** MobileSAM's outline per photo and tap (null: no nail-sized guess, so the colour flood is used). */
const samOutlines = new WeakMap<InspirationImage, Map<string, SamOutline | null>>();
const tapKey = (t: Point) => `${t.x},${t.y}`;

function outlinesFor(image: InspirationImage): Map<string, SamOutline | null> {
  let map = samOutlines.get(image);
  if (!map) samOutlines.set(image, (map = new Map()));
  return map;
}

/** Cut-out PNGs per pick, orientation and length mode, so re-rendering the list doesn't redo them. */
const cutouts = new WeakMap<NailPick, Map<string, Promise<Blob>>>();

/** `extensions`: the extension's tip shape, or null for polish on natural nails. */
function cutout(loaded: LoadedInspiration, pick: NailPick, flipped: boolean, extensions: TipShape | null): Promise<Blob> {
  let byKind = cutouts.get(pick);
  if (!byKind) cutouts.set(pick, (byKind = new Map()));
  const key = `${flipped}/${extensions}`;
  if (!byKind.has(key)) byKind.set(key, nailDesignPng(loaded, pick, flipped, extensions));
  return byKind.get(key)!;
}

const TIP_LABELS: Record<TipShape, string> = { almond: "Almond", stiletto: "Stiletto", oval: "Oval", square: "Square", squoval: "Squoval" };

const TEXTURE_LABELS: Record<Texture, string> = {
  matte: "Matte",
  cream: "Cream",
  jelly: "Jelly",
  sheer: "Sheer",
  metallic: "Chrome",
  pearl: "Pearl",
  shimmer_fine: "Shimmer",
  shimmer_coarse: "Glitter",
  textured: "Textured",
};

type Reading = { status: "reading" } | { status: "done"; value: DesignReading } | { status: "error"; error: string };

async function postForm<T>(url: string, body: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Server error (${res.status})`);
  return json;
}

async function uploadInspiration(file: Blob): Promise<string> {
  const body = new FormData();
  body.set("photo", await toJpeg(file, 1536), "inspiration.jpg");
  return (await postForm<{ imageId: string }>("/api/inspirations", body)).imageId;
}

/** Asks the vision model about the picked nails: one small crop per finger plus the stored photo. */
async function requestReading(inspoId: string, loaded: LoadedInspiration, picks: (NailPick | null)[]): Promise<DesignReading> {
  const body = new FormData();
  body.set("inspoImageId", inspoId);
  await Promise.all(
    picks.map(async (pick, i) => {
      if (pick) body.set(`crop_${FINGERS[i]}`, await toJpeg(await cutout(loaded, pick, false, null), 384, 0.85), "crop.jpg");
    }),
  );
  return postForm<DesignReading>("/api/designs/extract", body);
}

/** Readings per photo and set of taps, so undo/redo doesn't ask again. */
const readings = new Map<string, Promise<DesignReading>>();

async function uploadDesign(png: Blob): Promise<string> {
  const body = new FormData();
  body.set("design", png, "design.png");
  const res = await fetch("/api/designs/images", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { imageId?: string; error?: string };
  if (!res.ok || !json.imageId) throw new Error(json.error ?? `Server error (${res.status})`);
  return json.imageId;
}

function pickAll(image: InspirationImage, taps: (Point | null)[]): (NailPick | null)[] {
  let cache = firstPass.get(image);
  if (!cache) firstPass.set(image, (cache = new Map()));
  const outlines = outlinesFor(image);
  const first = taps.map((t) => {
    if (!t) return null;
    const key = tapKey(t);
    if (!cache.has(key)) cache.set(key, pickNail(image, t, undefined, outlines.get(key) ?? undefined));
    return cache.get(key)!;
  });
  // Nails in one photo are alike: a flood outline over twice the typical size leaked, so redo it with that cap.
  const typical = typicalArea(first);
  return first.map((p, i) =>
    p && typical && p.region.area > 2 * typical && !outlines.get(tapKey(taps[i]!)) ? pickNail(image, taps[i]!, typical) : p,
  );
}

export default function InspoPicker({ onTryOn, busy }: { onTryOn: (spec: DesignSpec, engine: EngineChoice) => void; busy: boolean }) {
  const [loaded, setLoaded] = useState<LoadedInspiration | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** One entry per finger so far: a tap, or null for a skipped finger. */
  const [taps, setTaps] = useState<(Point | null)[]>([]);
  const [redo, setRedo] = useState<(Point | null)[]>([]);
  /** Per finger: copy the artwork (true) or only the colour. */
  const [useDesign, setUseDesign] = useState<boolean[]>(FINGERS.map(() => true));
  /** Per picked finger: the cut-out's tip was guessed the wrong way round. */
  const [flipped, setFlipped] = useState<boolean[]>(FINGERS.map(() => false));
  const [previews, setPreviews] = useState<(string | null)[]>(FINGERS.map(() => null));
  const [preparing, setPreparing] = useState(false);
  /** Extensions (press-ons at the inspiration's shape and length) instead of polish on natural nails. */
  const [extensions, setExtensions] = useState(false);
  /** Shape and length chosen by the user; null = use the guess from the photo. */
  const [tip, setTip] = useState<TipShape | null>(null);
  const [length, setLength] = useState<number | null>(null);
  /** Finish chosen by the user for every nail; null = per nail as read from the photo (Cream if unread). */
  const [finish, setFinish] = useState<Texture | null>(null);
  /** The chosen photo looks like the client's own hand, not a nail design. */
  const [ownHand, setOwnHand] = useState(false);
  /** The photo as stored on the server (vision model input, Nail Transfer reference). */
  const [inspoId, setInspoId] = useState<string | null>(null);
  const [readingByKey, setReadingByKey] = useState<Record<string, Reading>>({});
  /** The reading whose Design/Colour defaults were applied, so a repeat doesn't undo the user's toggles. */
  const appliedRef = useRef<string | null>(null);
  const fileRef = useRef<Blob | null>(null);
  /** MobileSAM for the current photo: still loading, ready, or unavailable (then the colour flood outlines). */
  const [sam, setSam] = useState<"loading" | "ready" | "failed">("loading");
  /** A tap waiting for its MobileSAM outline: further taps wait too. */
  const [outlining, setOutlining] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const picks = useMemo(() => (loaded ? pickAll(loaded.image, taps) : []), [loaded, taps]);
  const allPicks = useMemo(() => [...picks, ...Array(FINGERS.length - picks.length).fill(null)] as (NailPick | null)[], [picks]);
  const done = taps.length >= FINGERS.length;
  const sources = useMemo(() => sourceFingers(allPicks), [allPicks]);
  const readingKey = done && inspoId ? `${inspoId}|${JSON.stringify(taps)}` : null;
  const reading: Reading | null = readingKey ? (readingByKey[readingKey] ?? { status: "reading" }) : null;
  const read = reading?.status === "done" ? reading.value : null;
  const spec = useMemo(() => {
    const draft = picks.length ? draftSpec(allPicks) : null;
    if (!draft) return null;
    const s = read ? applyReading(draft, read, sources) : draft;
    const fingers = finish ? Object.fromEntries(FINGERS.map((f) => [f, { ...s.fingers[f], texture: finish }])) : s.fingers;
    return designSpecSchema.parse({ ...s, fingers, ...(inspoId && { source: { kind: "inspiration", imageId: inspoId } }) });
  }, [picks.length, allPicks, read, sources, inspoId, finish]);
  /** The finish the chips highlight: the user's choice, or the one every nail was read as. */
  const shownFinish = finish ?? (spec && new Set(FINGERS.map((f) => spec.fingers[f].texture)).size === 1 ? spec.fingers.thumb.texture : null);
  const guess = useMemo(() => (loaded ? guessExtensions(picks, loaded.width) : null), [loaded, picks]);
  const shape = tip ?? read?.shape ?? guess?.tip ?? "almond";
  const nailLength = length ?? read?.length ?? guess?.length ?? 1.4;
  const approximate = spec !== null && chooseEngine(spec) === "nail_transfer";

  // Once all five are picked: read finish, pattern, shape and length (vision model, no YouCam units).
  useEffect(() => {
    if (!readingKey || !loaded || !inspoId) return;
    let cancelled = false;
    if (!readings.has(readingKey)) readings.set(readingKey, requestReading(inspoId, loaded, allPicks));
    const pickSources = sourceFingers(allPicks);
    readings.get(readingKey)!.then(
      (value) => {
        if (cancelled) return;
        setReadingByKey((r) => ({ ...r, [readingKey]: { status: "done", value } }));
        if (appliedRef.current !== readingKey) {
          appliedRef.current = readingKey;
          // Plain nails render best as colour (real finish); art, French, ombre and cat-eye need the artwork.
          setUseDesign(FINGERS.map((_, i) => {
            const r = pickSources[i] === null ? null : value.fingers[pickSources[i]!];
            return r?.pattern ? needsArtwork(r.pattern) : true;
          }));
        }
      },
      (e: unknown) => {
        readings.delete(readingKey); // let a later attempt retry
        if (cancelled) return;
        setReadingByKey((r) => ({ ...r, [readingKey]: { status: "error", error: e instanceof Error ? e.message : String(e) } }));
        if (appliedRef.current !== readingKey) {
          appliedRef.current = readingKey;
          // Pattern unknown: colour with a real finish looks more natural than copied pixels (glare and all).
          setUseDesign(FINGERS.map(() => false));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [readingKey, loaded, inspoId, allPicks]);

  // Cut-out previews for every picked nail.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const urls: (string | null)[] = FINGERS.map(() => null);
    Promise.all(
      picks.map(async (pick, i) => {
        if (!pick) return;
        try {
          urls[i] = URL.createObjectURL(await cutout(loaded, pick, flipped[i], extensions ? shape : null));
        } catch {
          // No preview: the swatch falls back to the colour.
        }
      }),
    ).then(() => {
      if (cancelled) urls.forEach((u) => u && URL.revokeObjectURL(u));
      else setPreviews(urls);
    });
    return () => {
      cancelled = true;
    };
  }, [loaded, picks, flipped, extensions, shape]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

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
      fileRef.current = file;
      setLoaded(next);
      setInspoId(null);
      setSam("loading");
      // Encoding starts now, so the model is ready by the first tap.
      encodeForSam(next).then(
        () => fileRef.current === file && setSam("ready"),
        (e: unknown) => {
          console.warn("MobileSAM unavailable, using the colour outliner", e);
          if (fileRef.current === file) setSam("failed");
        },
      );
      uploadInspiration(file).then(
        (id) => fileRef.current === file && setInspoId(id),
        // Picking still works without it; only the finish reading and Nail Transfer need it.
        (e: unknown) => fileRef.current === file && setError(`Couldn't save the photo for reading (${e instanceof Error ? e.message : String(e)}).`),
      );
      setTaps([]);
      setRedo([]);
      setFlipped(FINGERS.map(() => false));
      setOwnHand(false);
      setTip(null);
      setLength(null);
      setFinish(null);
      // Checked after the photo shows, so a slow detector never delays picking.
      looksLikeOwnHand(file).then(setOwnHand, () => setOwnHand(false));
    } catch (e) {
      setError(`Couldn't open that image (${String(e)}). Try a JPEG or PNG.`);
    } finally {
      setLoading(false);
    }
  };

  const add = (t: Point | null) => {
    if (done || outlining) return;
    setTaps([...taps, t]);
    setRedo([]);
  };

  const tap = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!loaded || done || outlining) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = {
      x: Math.round(((e.clientX - rect.left) / rect.width) * loaded.width),
      y: Math.round(((e.clientY - rect.top) / rect.height) * loaded.height),
    };
    const outlines = outlinesFor(loaded.image);
    if (sam !== "failed" && !outlines.has(tapKey(t))) {
      setOutlining(true);
      try {
        outlines.set(tapKey(t), await samOutline(loaded, t, { expectedArea: typicalArea(picks) }));
      } catch (err) {
        console.warn("MobileSAM outline failed, using the colour outliner", err);
      } finally {
        setOutlining(false);
      }
      if (fileRef.current !== loaded.file) return; // a new photo was chosen meanwhile
    }
    setTaps([...taps, t]);
    setRedo([]);
  };

  const undo = () => {
    setRedo([taps[taps.length - 1], ...redo]);
    setTaps(taps.slice(0, -1));
  };
  const redoTap = () => {
    setTaps([...taps, redo[0]]);
    setRedo(redo.slice(1));
  };

  const toggle = (list: boolean[], i: number) => list.map((v, k) => (k === i ? !v : v));

  /**
   * Uploads the cut-outs the design fingers need (once per picked nail), then renders.
   * Done for Nail Transfer too, so "render each finger exactly" can follow with the art.
   * With nothing picked, Transfer gets a placeholder spec (confidence 0) that only carries the photo.
   */
  const render = async (engine: EngineChoice) => {
    if (!loaded || (!spec && engine !== "nail_transfer")) return;
    if (!spec) {
      if (!inspoId) return;
      const placeholder = { ...solidSpec("#FFFFFF"), source: { kind: "inspiration", imageId: inspoId }, confidence: 0 };
      return onTryOn(designSpecSchema.parse(placeholder), engine);
    }
    setPreparing(true);
    setError(null);
    try {
      const uploads = new Map<number, Promise<string>>();
      const ids = await Promise.all(
        FINGERS.map((_, i) => {
          const from = sources[i];
          if (from === null || !useDesign[i] || !picks[from]) return null;
          if (!uploads.has(from)) uploads.set(from, cutout(loaded, picks[from]!, flipped[from], extensions ? shape : null).then(uploadDesign));
          return uploads.get(from)!;
        }),
      );
      const designed = withDesigns(spec, ids);
      onTryOn(extensions ? asExtensions(designed, shape, nailLength) : designed, engine);
    } catch (e) {
      setError(`Couldn't prepare the nail designs (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      setPreparing(false);
    }
  };

  const failed = taps.length > 0 && taps[taps.length - 1] !== null && picks[taps.length - 1] === null;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex cursor-pointer items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700">
        {loading ? "Opening…" : loaded ? "Choose a different photo" : "Choose the nail design you want"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          data-testid="inspo-file"
          onChange={(e) => choose(e.target.files?.[0])}
        />
      </label>
      {!loaded && <p className="text-xs text-zinc-500">A photo or screenshot of the nails you&apos;d like, e.g. from Pinterest or Instagram.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {ownHand && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm" role="alert">
          <p className="flex-1">
            This looks like a photo of your own hand, not the nail design you want. Your phone may have offered your latest photo or screenshot first: choose the inspiration picture instead.
          </p>
          <button onClick={() => setOwnHand(false)} className="shrink-0 text-xs underline">
            It&apos;s right
          </button>
        </div>
      )}

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
          {outlining && <p className="text-sm text-zinc-500" aria-live="polite">{sam === "loading" ? "Getting the nail outliner ready…" : "Outlining…"}</p>}
          {failed && <p className="text-sm text-amber-700">Couldn&apos;t outline a nail there. Undo and tap nearer the middle of the nail.</p>}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => add(null)} disabled={done || outlining} className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700">
              Skip {done ? "" : LABELS[taps.length].toLowerCase()} (not visible)
            </button>
            <button onClick={undo} disabled={taps.length === 0 || outlining} className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700">
              Undo
            </button>
            <button onClick={redoTap} disabled={redo.length === 0} className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700">
              Redo
            </button>
          </div>
          <p className="text-xs text-zinc-500">Only some nails visible? Skip a finger, or tap the same nail again to reuse it.</p>

          <ul className="grid grid-cols-5 gap-1" aria-label="Design per finger">
            {FINGERS.map((finger, i) => {
              const f = spec?.fingers[finger];
              const picked = Boolean(picks[i]);
              const from = sources[i];
              const preview = from !== null ? previews[from] : null;
              const showDesign = useDesign[i] && preview;
              return (
                <li key={finger} className="flex flex-col items-center gap-1 text-center" data-finger={finger} data-base={f?.baseHex} data-accents={f?.accentHexes.join(" ")} data-design={f ? String(useDesign[i]) : undefined}>
                  <div className="relative flex h-14 items-center">
                    {showDesign ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local blob URL
                      <img src={preview} alt={`${LABELS[i]} nail design`} className={`h-14 w-7 rounded-full border object-cover ${picked ? "border-zinc-400" : "border-dashed border-zinc-400 opacity-60"}`} />
                    ) : (
                      <div
                        className={`relative h-10 w-10 rounded-full border ${picked ? "border-zinc-400" : "border-dashed border-zinc-400 opacity-60"}`}
                        style={{ backgroundColor: f?.baseHex ?? "transparent" }}
                      >
                        {f?.accentHexes.slice(0, 2).map((hex, k) => (
                          <span key={k} className="absolute h-3.5 w-3.5 rounded-full border border-white/70" style={{ backgroundColor: hex, right: -2 - k * 8, bottom: -2 }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] leading-tight">{LABELS[i]}</span>
                  <span className="text-[10px] leading-tight text-zinc-500">
                    {!f ? "–" : !picked ? "copied" : f.confidence < 0.6 ? "unsure" : ""}
                  </span>
                  {f && <span className="text-[10px] leading-tight" data-texture={f.texture}>{TEXTURE_LABELS[f.texture]}</span>}
                  {f && (
                    <button
                      onClick={() => setUseDesign(toggle(useDesign, i))}
                      aria-pressed={useDesign[i]}
                      className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] dark:border-zinc-700"
                    >
                      {useDesign[i] ? "Design" : "Colour"}
                    </button>
                  )}
                  {f && picked && useDesign[i] && (
                    <button onClick={() => setFlipped(toggle(flipped, i))} className="text-[10px] text-zinc-500 underline" aria-label={`Turn the ${LABELS[i].toLowerCase()} design upside down`}>
                      Flip
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-zinc-500">
            &quot;Design&quot; copies the nail art, &quot;Colour&quot; only its colour. Tip of the design upside down? Tap Flip.
          </p>
          {reading && (
            <p className="text-sm" aria-live="polite" data-reading={reading.status}>
              {reading.status === "reading" && "Reading the finish and pattern…"}
              {reading.status === "done" &&
                (reading.value.isNailDesign
                  ? reading.value.summary || "Finish and pattern read."
                  : "This doesn't look like a nail design. Choose a photo that shows painted nails.")}
              {reading.status === "error" && <span className="text-amber-700">
                  Couldn&apos;t read the finish from the photo. Choose it below.
                  <span className="mt-1 block break-words text-xs text-zinc-500" data-testid="reading-error">{reading.error}</span>
                </span>}
            </p>
          )}

          {spec && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium">Finish</p>
              <div className="flex flex-wrap gap-1.5" aria-label="Finish">
                {TEXTURES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setFinish(finish === t ? null : t)}
                    aria-pressed={shownFinish === t}
                    className={`rounded-full border px-3 py-1 text-xs ${shownFinish === t ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}
                  >
                    {TEXTURE_LABELS[t]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-500">
                {finish
                  ? `${TEXTURE_LABELS[finish]} on every nail. Tap it again to go back to ${read ? "the finish read from the photo" : "Cream"}.`
                  : read
                    ? "Read from the photo, per nail. Tap one to use it on every nail."
                    : "Cream unless you choose another."}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex rounded-full border border-zinc-300 p-1 text-sm dark:border-zinc-700" role="tablist" aria-label="Nail length">
              {([false, true] as const).map((ext) => (
                <button
                  key={String(ext)}
                  role="tab"
                  aria-selected={extensions === ext}
                  onClick={() => setExtensions(ext)}
                  className={`flex-1 rounded-full px-3 py-1.5 ${extensions === ext ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : ""}`}
                >
                  {ext ? "Extensions" : "Keep my length"}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-500">
              {extensions
                ? "Press-on or gel extensions in the shape and length below (guessed from the photo)."
                : "Polish on your own nails: the art is fitted to your nail length."}
            </p>
            {extensions && (
              <>
                <div className="flex flex-wrap gap-1.5" aria-label="Shape">
                  {TIP_SHAPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTip(t)}
                      aria-pressed={shape === t}
                      className={`rounded-full border px-3 py-1 text-xs ${shape === t ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}
                    >
                      {TIP_LABELS[t]}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5" aria-label="Length">
                  {LENGTHS.map((l) => (
                    <button
                      key={l.value}
                      onClick={() => setLength(l.value)}
                      aria-pressed={nailLength === l.value}
                      className={`rounded-full border px-3 py-1 text-xs ${nailLength === l.value ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {approximate && (
            <p className="text-xs text-amber-700">
              The nail outlines look unsure, so YouCam&apos;s Nail Transfer will copy the whole photo instead (approximate: designs may land on other fingers). Redo the unsure taps for an exact per-finger try-on.
            </p>
          )}
          <button
            onClick={() => render("auto")}
            disabled={!spec || busy || preparing || reading?.status === "reading"}
            className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            {preparing
              ? "Preparing designs…"
              : busy
                ? "Rendering…"
                : reading?.status === "reading"
                  ? "Reading the design…"
                  : approximate
                    ? "Try this on my hand (approximate)"
                    : done
                      ? "Try this on my hand"
                      : "Try this on my hand (missing fingers copy the nearest)"}
          </button>
          <button onClick={() => render("nail_transfer")} disabled={!inspoId || busy || preparing || reading?.status === "reading"} className="text-sm text-zinc-500 underline disabled:opacity-40">
            Compare: let YouCam copy the whole photo (Nail Transfer)
          </button>
        </>
      )}
    </div>
  );
}
