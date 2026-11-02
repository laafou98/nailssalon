"use client";

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import StepNav from "@/components/ui/StepNav";
import { type LoadedInspiration, loadInspiration, looksLikeOwnHand, nailDesignPng, pickDetail, toJpeg } from "@/lib/inspo/browser";
import {
  DEFAULT_LENGTH,
  type TipShape,
  asExtensions,
  draftSpec,
  guessExtensions,
  type InspirationImage,
  type NailPick,
  type SamOutline,
  type FingerEdits,
  applyEdits,
  pickNail,
  sourceFingers,
  typicalArea,
  typicalPick,
  withDesigns,
} from "@/lib/inspo/pick";
import { smoothOutline } from "@/lib/inspo/contour";
import LengthShapeSheet, { lengthSummary as summarizeLength } from "./LengthShapeSheet";
import { go } from "@/lib/transition";
import type { CutoutDetail } from "@/lib/inspo/design";
import type { Point } from "@/lib/inspo/region";
import { nailPromptBox } from "@/lib/inspo/sam";
import { encodeForSam, samOutline } from "@/lib/inspo/sam-browser";
import { type EngineChoice, chooseEngine } from "@/lib/render/router";
import { type DesignSpec, FINGERS, TEXTURES, type Texture, designSpecSchema, solidSpec } from "@/lib/spec/types";
import { type NailLocations, chooseHand } from "@/lib/vision/locate";
import { type DesignReading, applyReading, needsArtwork } from "@/lib/vision/reading";

/**
 * Tap-to-pick: upload an inspiration photo, tap its nails thumb → pinky (or
 * skip a finger that isn't visible), see each outline and its colours, then
 * try the per-finger design on. Each finger copies the nail's artwork (a
 * cut-out PNG) or just its colour. Outlines and colours are found on the device;
 * once all five are picked, the vision model reads each nail's finish and pattern.
 */

const LABELS = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
/** An error as a short reason for the status line (no stack, no secrets). */
const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 160);

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

/** Finds and caches the MobileSAM outline for a tap, with a box of the typical nail's size once one is known. */
async function outlineTap(loaded: LoadedInspiration, t: Point, picksSoFar: (NailPick | null)[], label: string): Promise<void> {
  const outlines = outlinesFor(loaded.image);
  if (outlines.has(tapKey(t))) return;
  const typical = typicalPick(picksSoFar);
  const box = typical && nailPromptBox(typical.region.box);
  const outline = await samOutline(loaded, t, { expectedArea: typical?.region.area }, box);
  outlines.set(tapKey(t), outline);
  console.debug("MobileSAM outline", label, { area: outline?.mask.reduce((a, b) => a + b, 0) ?? null, score: outline?.score, expectedArea: typical?.region.area, box });
}

/** Photos whose nails were already suggested automatically (once per photo: after an Undo the user is tapping by hand). */
const suggested = new WeakSet<InspirationImage>();

async function requestLocations(inspoId: string): Promise<NailLocations> {
  const res = await fetch("/api/designs/locate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inspoImageId: inspoId }) });
  const body = (await res.json().catch(() => null)) as (NailLocations & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
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

/** Why a nail's art isn't copied by default, under its finger. */
function detailNote(d: CutoutDetail | null): string | null {
  if (!d || d.ok) return null;
  return { side_on: "side view", partial: "partial nail", blurry: "blurry" }[d.reason];
}

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

export default function InspoPicker({
  onTryOn,
  onNewPhoto,
  busy,
  onBack,
  compareRef,
}: {
  onTryOn: (spec: DesignSpec, engine: EngineChoice) => void;
  /** A different inspiration photo was chosen: the last render's design (and its quote and recipe) no longer applies. */
  onNewPhoto?: () => void;
  busy: boolean;
  onBack: () => void;
  /** Filled with "render this with Nail Transfer", for the Result screen's compare link. */
  compareRef: RefObject<(() => void) | null>;
}) {
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
  /** The client's own colour or finish per finger, over what the photo gave. */
  const [edits, setEdits] = useState<FingerEdits>({});
  /** The finger whose editor is open. */
  const [editing, setEditing] = useState<number | null>(null);
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
  /** Why MobileSAM is unavailable, shown so a rough outline is never mistaken for a model result. */
  const [samError, setSamError] = useState<string | null>(null);
  /** A tap waiting for its MobileSAM outline: further taps wait too. */
  const [outlining, setOutlining] = useState(false);
  /** Automatic nail detection for the current photo. */
  const [finding, setFinding] = useState<{ status: "idle" | "finding" | "done" | "failed"; count?: number; error?: string }>({ status: "idle" });
  /** Swapping two finger labels: the first finger chosen, if any. */
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  /** The taps as of the latest render, for the detection effect (which must not overwrite taps made meanwhile). */
  const tapsRef = useRef<(Point | null)[]>([]);
  useEffect(() => {
    tapsRef.current = taps;
  }, [taps]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Screen 08: tapping nails on the dark screen, instead of checking them. */
  const [fixing, setFixing] = useState(false);
  const [sheet, setSheet] = useState<"length" | "finish" | null>(null);
  const [approxOpen, setApproxOpen] = useState(false);
  /** Where automatic detection put each nail, so the Fix screen's ripple can point at the next one. */
  const [located, setLocated] = useState<(Point | null)[]>([]);
  const [ripple, setRipple] = useState<(Point & { n: number }) | null>(null);
  const [notNailsOff, setNotNailsOff] = useState<string | null>(null);
  const [finderAlertOff, setFinderAlertOff] = useState(false);

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
    return applyEdits(designSpecSchema.parse({ ...s, fingers, ...(inspoId && { source: { kind: "inspiration", imageId: inspoId } }) }), edits);
  }, [picks.length, allPicks, read, sources, inspoId, finish, edits]);
  /** The finish the chips highlight: the user's choice, or the one every nail was read as. */
  const shownFinish = finish ?? (spec && new Set(FINGERS.map((f) => spec.fingers[f].texture)).size === 1 ? spec.fingers.thumb.texture : null);
  const guess = useMemo(() => (loaded ? guessExtensions(picks, loaded.width) : null), [loaded, picks]);
  const shape = tip ?? read?.shape ?? guess?.tip ?? "almond";
  /** Per finger: whether its cut-out is face-on and sharp enough for its art to survive. */
  const detail = useMemo(() => allPicks.map((p) => (loaded && p ? pickDetail(loaded, p, extensions ? shape : null) : null)), [loaded, allPicks, extensions, shape]);
  // Switching to extensions can make a cut-out too blurry: those fingers fall back to colour (the user can switch back).
  const [detailSeen, setDetailSeen] = useState(detail);
  if (detailSeen !== detail) {
    setDetailSeen(detail);
    setUseDesign(useDesign.map((v, i) => v && (sources[i] === null || detail[sources[i]!]?.ok !== false)));
  }
  const nailLength = length ?? read?.length ?? guess?.length ?? DEFAULT_LENGTH;
  const approximate = spec !== null && chooseEngine(spec) === "nail_transfer";

  // Automatic nail detection: once the photo is stored, the vision model names and locates the nails,
  // and the fingers not yet tapped are filled in (outlined like taps). Once per photo; the user corrects by Undo, retap or Swap.
  useEffect(() => {
    if (!loaded || !inspoId || sam === "loading" || suggested.has(loaded.image) || tapsRef.current.length >= FINGERS.length) return;
    suggested.add(loaded.image);
    let cancelled = false;
    setFinding({ status: "finding" });
    (async () => {
      try {
        const hand = chooseHand(await requestLocations(inspoId));
        if (cancelled) return;
        const from = tapsRef.current.length;
        const pending = FINGERS.map((_, i) => i).filter((i) => i >= from);
        const tapFor = (i: number) => (hand[i] ? { x: Math.round(hand[i]!.x * loaded.width), y: Math.round(hand[i]!.y * loaded.height) } : null);
        setLocated(FINGERS.map((_, i) => tapFor(i)));
        // Fully visible nails are outlined first: they set the typical nail size that guides the partial ones (an edge-on thumb).
        const order = [...pending.filter((i) => hand[i]?.visible === "full"), ...pending.filter((i) => hand[i] && hand[i]!.visible !== "full")];
        const done: (Point | null)[] = [...tapsRef.current];
        for (const i of order) {
          const t = tapFor(i)!;
          if (sam !== "failed") {
            setOutlining(true);
            try {
              await outlineTap(loaded, t, pickAll(loaded.image, done), `${LABELS[i]} (auto)`);
            } catch (err) {
              console.warn("MobileSAM outline failed, using the colour outliner", err);
            } finally {
              setOutlining(false);
            }
          }
          if (cancelled || tapsRef.current.length !== from) return; // the user tapped meanwhile: their taps win
          done.push(t);
        }
        const filled = [...tapsRef.current, ...pending.map(tapFor)];
        const count = pending.filter((i) => hand[i]).length;
        if (count === 0) {
          setFinding({ status: "failed", error: "no nails found" });
          return;
        }
        setTaps(filled);
        setRedo([]);
        setFinding({ status: "done", count });
      } catch (e) {
        if (!cancelled) setFinding({ status: "failed", error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, inspoId, sam]);

  /** Swaps two fingers' taps (and their per-finger settings), for a nail detected as the wrong finger. */
  const swapFingers = (i: number, j: number) => {
    if (i === j || i >= taps.length || j >= taps.length) return;
    const swap = <T,>(arr: T[]) => arr.map((v, k) => (k === i ? arr[j] : k === j ? arr[i] : v));
    setTaps(swap(taps));
    setFlipped(swap(flipped));
    setUseDesign(swap(useDesign));
    setEdits({ ...edits, [FINGERS[i]]: edits[FINGERS[j]], [FINGERS[j]]: edits[FINGERS[i]] });
    setRedo([]);
  };

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
          // A nail too small or side-on in the photo would be a blurry smear: colour instead (the user can still switch).
          setUseDesign(FINGERS.map((_, i) => {
            const from = pickSources[i];
            const r = from === null ? null : value.fingers[from];
            const sharp = from !== null && detail[from]?.ok !== false;
            return sharp && (r?.pattern ? needsArtwork(r.pattern) : true);
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
  }, [readingKey, loaded, inspoId, allPicks, detail]);

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
    // Drawn at 3× the working resolution as smooth, anti-aliased paths: a mask's pixel edge would show as a staircase on the phone.
    const S = 3;
    canvas.width = w * S;
    canvas.height = h * S;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(S, S);
    ctx.lineJoin = "round";
    picks.forEach((pick) => {
      if (!pick) return;
      const outline = smoothOutline(pick.region.mask, w, h);
      if (outline.length < 3) return;
      ctx.beginPath();
      outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = "rgba(255,69,18,0.16)";
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = "#FF4512";
      ctx.stroke();
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
      onNewPhoto?.();
      setInspoId(null);
      setSam("loading");
      setSamError(null);
      setFinding({ status: "idle" });
      setSwapFrom(null);
      setFixing(false);
      setSheet(null);
      setLocated([]);
      setRipple(null);
      setFinderAlertOff(false);
      setNotNailsOff(null);
      // Encoding starts now, so the model is ready by the first tap.
      encodeForSam(next).then(
        () => fileRef.current === file && setSam("ready"),
        (e: unknown) => {
          console.warn("MobileSAM unavailable, using the colour outliner", e);
          if (fileRef.current === file) {
            setSam("failed");
            setSamError(describe(e));
          }
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
      setEdits({});
      setEditing(null);
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
    setRipple({ ...t, n: e.timeStamp });
    const outlines = outlinesFor(loaded.image);
    if (sam !== "failed" && !outlines.has(tapKey(t))) {
      setOutlining(true);
      try {
        await outlineTap(loaded, t, picks, LABELS[taps.length]);
      } catch (err) {
        console.warn("MobileSAM outline failed, using the colour outliner", err);
        setSamError(describe(err));
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
  /** Goes back to a finger on the Fix screen; the fingers after it can be redone or retapped. */
  const undoTo = (i: number) => {
    setRedo([...taps.slice(i), ...redo]);
    setTaps(taps.slice(0, i));
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

  useEffect(() => {
    compareRef.current = () => render("nail_transfer");
  });

  const failed = taps.length > 0 && taps[taps.length - 1] !== null && picks[taps.length - 1] === null;
  /** Fingers whose outline came from the colour flood because MobileSAM had no nail-sized guess (or failed) for that tap. */
  const flooded = loaded
    ? taps.flatMap((t, i) => (t && picks[i] && !outlinesFor(loaded.image).get(tapKey(t)) ? [LABELS[i].toLowerCase()] : []))
    : [];
  const pickedCount = picks.filter(Boolean).length;
  const looking = finding.status === "finding" || (finding.status === "idle" && !error && taps.length === 0);
  const notNails = read !== null && !read.isNailDesign && notNailsOff !== readingKey;
  const finderFailed = finding.status === "failed" && taps.length === 0 && !finderAlertOff && !fixing;
  const lengthSummary = summarizeLength(extensions, shape, nailLength);
  const edited = editing !== null ? FINGERS[editing] : null;
  const editedFinger = edited && spec ? spec.fingers[edited] : null;
  const editedFrom = editing !== null ? sources[editing] : null;
  const editedPreview = editing !== null && useDesign[editing] && editedFrom !== null ? previews[editedFrom] : null;

  const fileInput = (
    <input
      id="inspo-file"
      type="file"
      accept="image/*"
      className="n-sr"
      tabIndex={-1}
      data-testid="inspo-file"
      onChange={(e) => {
        choose(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  if (!loaded) {
    return (
      <div className="n-scr">
        {fileInput}
        <StepNav step={2} fill={30} onBack={onBack} />
        <div className="n-head">
          <p className="n-eye">Step 2 · Nail photo</p>
          <h1 className="n-d n-h1">
            Add your
            <br />
            inspiration.
          </h1>
        </div>
        <label
          htmlFor="inspo-file"
          className="n-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            choose(e.dataTransfer.files[0]);
          }}
        >
          <svg className="n-ants" viewBox="0 0 342 430" preserveAspectRatio="none" aria-hidden>
            <rect x="1.5" y="1.5" width="339" height="427" rx="27" fill="none" stroke="#C9C0B8" strokeWidth="2.5" strokeDasharray="12 12" vectorEffect="non-scaling-stroke" />
          </svg>
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration */}
          <img src="/v2/photos.svg" alt="Two instant photos, one with a nail design" />
          <h2 className="n-d">Drop in any nail photo</h2>
          <p>Camera roll, screenshot or saved post</p>
        </label>
        <div className="n-tip">
          <Icon name="info-circle" />
          Close-ups of one hand work best.
        </div>
        {error && <p className="n-note n-note-err">{error}</p>}
        <div className="n-cta">
          <label htmlFor="inspo-file" className="n-btn n-btn-k">
            <Icon name="photo" size={20} />
            {loading ? "Opening…" : "Choose a photo"}
          </label>
        </div>
      </div>
    );
  }

  const fingerStatus = (i: number) => (i < taps.length ? (taps[i] ? "ok" : "skip") : i === taps.length ? "now" : "");

  return (
    <div className={`n-scr ${fixing ? "n-scr-dark" : ""}`}>
      {fileInput}
      {fixing ? (
        <div className="n-nav n-nav-between">
          <button className="n-ib" onClick={() => go("pop", () => setFixing(false))} aria-label="Close">
            <Icon name="xmark" />
          </button>
          <div className="n-dots">
            {FINGERS.map((finger, i) => (
              <button key={finger} className={fingerStatus(i)} onClick={() => i < taps.length && undoTo(i)} aria-label={`Redo from the ${LABELS[i].toLowerCase()} nail`} disabled={i >= taps.length || outlining}>
                {LABELS[i][0]}
              </button>
            ))}
          </div>
          <span style={{ width: 40 }} />
        </div>
      ) : (
        <StepNav step={2} fill={75} onBack={onBack} />
      )}
      {fixing ? (
        <div className="n-head">
          <p className="n-eye">Fix nails · {Math.min(taps.length, 5)} of 5</p>
          <h1 className="n-d n-h1" style={{ fontSize: 46 }} aria-live="polite">
            {done ? (
              "All five picked."
            ) : (
              <>
                Tap the <em>{LABELS[taps.length].toLowerCase()}</em> nail.
              </>
            )}
          </h1>
        </div>
      ) : (
        <div className="n-head">
          <p className="n-eye">Step 2 · Check</p>
          <h1 className="n-d n-h1 n-h1-sm">Every nail, read.</h1>
        </div>
      )}

      <div className={`n-insp ${fixing ? "n-insp-fix" : ""}`} style={{ "--ar": loaded.width / loaded.height } as React.CSSProperties}>
        <div className="n-insp-clip">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
          <img src={loaded.url} alt="Your inspiration photo" draggable={false} />
          <canvas
            ref={canvasRef}
            onPointerUp={fixing ? tap : undefined}
            style={{ pointerEvents: fixing ? undefined : "none", cursor: fixing && !done ? "crosshair" : "default" }}
            aria-label="Tap the nails in finger order"
          />
        </div>
        {picks.map((pick, i) => {
          if (!pick) return null;
          const at = { left: `${(pick.region.box.cx / loaded.width) * 100}%`, top: `${(pick.region.box.cy / loaded.height) * 100}%` };
          return fixing ? (
            <div key={`${i}-${taps[i]?.x}-${taps[i]?.y}`} className="n-fm" style={at} aria-hidden>{LABELS[i][0]}</div>
          ) : (
            <div key={`${i}-${taps[i]?.x}-${taps[i]?.y}`} className="n-m" style={{ ...at, animationDelay: `${i * 0.08}s` }} aria-hidden>
              <b>{LABELS[i][0]}</b>
            </div>
          );
        })}
        {fixing && !done && !outlining && (
          <div
            className="n-tap"
            aria-hidden
            style={{
              left: `${((located[taps.length]?.x ?? loaded.width / 2) / loaded.width) * 100}%`,
              top: `${((located[taps.length]?.y ?? loaded.height / 2) / loaded.height) * 100}%`,
            }}
          />
        )}
        {fixing && ripple && <div key={ripple.n} className="n-tap once" aria-hidden style={{ left: `${(ripple.x / loaded.width) * 100}%`, top: `${(ripple.y / loaded.height) * 100}%` }} />}
        {!fixing && (
          <label htmlFor="inspo-file" className="n-retake">
            <Icon name="arrow-counterclockwise" size={16} />
            {loading ? "Opening…" : "New photo"}
          </label>
        )}
      </div>

      {error && <p className="n-note n-note-err">{error}</p>}

      {fixing ? (
        <>
          {outlining && <p className="n-note" aria-live="polite">{sam === "loading" ? "Getting the nail outliner ready…" : "Outlining…"}</p>}
          {failed && <p className="n-note">Couldn&apos;t outline a nail there. Undo and tap nearer the middle of the nail.</p>}
          {!done && !outlining && !failed && <p className="n-note">Only some nails visible? Tap &quot;Not in photo&quot;, or tap the same nail again to reuse it.</p>}
          <OutlinerNote sam={sam} samError={samError} flooded={flooded} picked={pickedCount > 0} />
          <div className="n-fixbar">
            <button className="n-tb" onClick={undo} disabled={taps.length === 0 || outlining} aria-label="Undo">
              <Icon name="arrow-uturn-left" />
              <span className="n-tb-label">Undo</span>
            </button>
            <button className="n-tb" onClick={redoTap} disabled={redo.length === 0} aria-label="Redo">
              <Icon name="arrow-uturn-right" />
            </button>
            <button className="n-tb" onClick={() => add(null)} disabled={done || outlining}>
              Not in photo
            </button>
            <button className={`n-tb n-tb-grow ${done ? "n-tb-done" : "n-tb-off"}`} onClick={() => go("pop", () => setFixing(false))}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="n-found" data-testid="finding" aria-live="polite">
            <span>
              {looking ? <span className="n-spin" /> : pickedCount > 0 && <i><Icon name="checkmark-alt" size={12} /></i>}
              {looking
                ? "Finding the nails…"
                : pickedCount === FINGERS.length
                  ? finding.status === "done" ? "All 5 nails found" : "All 5 nails picked"
                  : `${pickedCount} of 5 nails found`}
            </span>
            <button className="n-link" onClick={() => go("up", () => setFixing(true))}>
              {looking ? "Tap them" : "Fix"}
            </button>
          </div>

          {swapFrom !== null && (
            <div className="n-swapbar" role="status">
              <span>Now tap the finger to swap {LABELS[swapFrom]} with.</span>
              <button className="n-link" onClick={() => setSwapFrom(null)}>Cancel</button>
            </div>
          )}

          <ul className="n-strip" aria-label="Design per finger">
            {FINGERS.map((finger, i) => {
              const f = spec?.fingers[finger];
              const picked = Boolean(picks[i]);
              const from = sources[i];
              const preview = from !== null ? previews[from] : null;
              const showDesign = useDesign[i] && preview;
              const note = !f ? "–" : !picked ? "copied" : detailNote(detail[i]) ?? (f.confidence < 0.6 ? "unsure" : "");
              return (
                <li key={finger} style={{ display: "contents" }}>
                  <button
                    className="n-t"
                    disabled={!f}
                    data-finger={finger}
                    data-base={f?.baseHex}
                    data-accents={f?.accentHexes.join(" ")}
                    data-design={f ? String(useDesign[i]) : undefined}
                    data-detail={detail[i] ? `${detail[i]!.ok ? "ok" : detail[i]!.reason} sharpness ${detail[i]!.sharpness}` : undefined}
                    data-swap={swapFrom === i ? "from" : undefined}
                    aria-label={!f ? LABELS[i] : swapFrom !== null ? `Swap with ${LABELS[i].toLowerCase()}` : `Edit the ${LABELS[i].toLowerCase()} nail`}
                    onClick={() => {
                      if (swapFrom !== null) {
                        if (i < taps.length) {
                          swapFingers(swapFrom, i);
                          setSwapFrom(null);
                        }
                        return;
                      }
                      setEditing(i);
                    }}
                  >
                    <i className={picked ? "" : "empty"} style={!showDesign && f ? { backgroundColor: f.baseHex } : undefined}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                      {showDesign && <img src={preview} alt={`${LABELS[i]} nail design`} />}
                    </i>
                    <span>{LABELS[i]}</span>
                    {f && <small data-texture={f.texture}>{TEXTURE_LABELS[f.texture]}</small>}
                    <small className={note && note !== "copied" ? "warn" : ""}>{note}</small>
                  </button>
                </li>
              );
            })}
          </ul>

          {reading && (
            <p className="n-note" aria-live="polite" data-reading={reading.status}>
              {reading.status === "reading" && "Reading the finish and pattern…"}
              {reading.status === "done" && reading.value.isNailDesign && (reading.value.summary || "Finish and pattern read.")}
              {reading.status === "done" && !reading.value.isNailDesign && "This doesn't look like a nail design. Choose a photo that shows painted nails."}
              {reading.status === "error" && (
                <>
                  Couldn&apos;t read the finish from the photo. Choose it below.
                  <span className="n-cap" style={{ display: "block", marginTop: 4, overflowWrap: "anywhere" }} data-testid="reading-error">{reading.error}</span>
                </>
              )}
            </p>
          )}

          <button className="n-cell" onClick={() => setSheet("length")}>
            <span className="n-ic"><Icon name="hand-raised" size={16} /></span>
            <b>Length &amp; shape</b>
            <em>{lengthSummary}</em>
            <Icon name="chevron-right" size={14} />
          </button>
          {spec && (
            <button className="n-cell" onClick={() => setSheet("finish")}>
              <span className="n-ic"><Icon name="sparkles" size={16} /></span>
              <b>Finish</b>
              <em>{finish ? TEXTURE_LABELS[finish] : read ? "As in the photo" : "Cream"}</em>
              <Icon name="chevron-right" size={14} />
            </button>
          )}

          <button className="n-link-mute" onClick={() => render("nail_transfer")} disabled={!inspoId || busy || preparing || reading?.status === "reading"}>
            Compare: let YouCam copy the whole photo
          </button>
          <OutlinerNote sam={sam} samError={samError} flooded={flooded} picked={pickedCount > 0} />

          <div className="n-cta">
            {spec && !done && <p className="n-cta-hint">Missing nails copy the nearest one.</p>}
            <button
              className="n-btn n-btn-r"
              onClick={() => (approximate ? setApproxOpen(true) : render("auto"))}
              disabled={!spec || busy || preparing || reading?.status === "reading"}
            >
              <Icon name="sparkles" size={20} />
              {preparing
                ? "Preparing designs…"
                : busy
                  ? "Rendering…"
                  : reading?.status === "reading"
                    ? "Reading the design…"
                    : approximate
                      ? "Try on my hand (approximate)"
                      : "Try on my hand"}
            </button>
          </div>
        </>
      )}

      {editing !== null && edited && editedFinger && (
        <Sheet
          label={`Edit the ${LABELS[editing].toLowerCase()} nail`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button
                className="n-btn n-btn-soft"
                onClick={() => {
                  const e = edits[edited];
                  if (!e) return;
                  setEdits(Object.fromEntries(FINGERS.map((f) => [f, { ...edits[f], ...(e.baseHex && { baseHex: e.baseHex }), ...(e.texture && { texture: e.texture }) }])));
                  if (e.baseHex) setUseDesign(FINGERS.map(() => false));
                }}
                disabled={!edits[edited]?.baseHex && !edits[edited]?.texture}
              >
                Use on all nails
              </button>
              <button className="n-btn n-btn-k" onClick={() => setEditing(null)}>Done</button>
            </>
          }
        >
          <div data-testid="finger-editor">
            <div className="n-top">
              <span className="n-top-nail" style={editedPreview ? undefined : { backgroundColor: editedFinger.baseHex }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                {editedPreview && <img src={editedPreview} alt="" />}
              </span>
              <div>
                <h2 className="n-d">{LABELS[editing]} nail</h2>
                <p>
                  {TEXTURE_LABELS[editedFinger.texture]}
                  {editedFinger.pattern !== "solid" && ` · ${editedFinger.pattern.replace("_", " ")}`}
                  {detailNote(detail[editing]) && ` · ${detailNote(detail[editing])}`}
                </p>
              </div>
              <button className="n-x" onClick={() => setEditing(null)} aria-label="Close"><Icon name="xmark" size={14} /></button>
            </div>
            <div className="n-seg" style={{ marginTop: 20 }}>
              {([true, false] as const).map((copy) => (
                <button key={String(copy)} className={useDesign[editing] === copy ? "on" : ""} aria-pressed={useDesign[editing] === copy} onClick={() => setUseDesign(useDesign.map((v, k) => (k === editing ? copy : v)))}>
                  {copy ? "Copy the art" : "Colour only"}
                </button>
              ))}
            </div>
            <p className="n-eye n-lab">Base colour</p>
            <div className="n-group">
              <label className="n-row">
                <span className="n-swatch-dot" style={{ backgroundColor: editedFinger.baseHex }} />
                <b>{editedFinger.baseHex}</b>
                <em>Change</em>
                <Icon name="chevron-right" size={13} />
                <input
                  type="color"
                  value={editedFinger.baseHex}
                  onChange={(e) => {
                    const hex = e.target.value.toUpperCase();
                    setEdits({ ...edits, [edited]: { ...edits[edited], baseHex: hex } });
                    // The design cut-out would still show the photo's colour, so a recoloured nail renders as colour.
                    setUseDesign(useDesign.map((v, k) => (k === editing ? false : v)));
                  }}
                  aria-label={`${LABELS[editing]} colour`}
                />
              </label>
            </div>
            {edits[edited]?.baseHex && (
              <button className="n-link" onClick={() => setEdits({ ...edits, [edited]: { ...edits[edited], baseHex: undefined } })}>
                Back to the photo&apos;s colour
              </button>
            )}
            <p className="n-eye n-lab">Finish</p>
            <div className="n-chips">
              {TEXTURES.map((t) => (
                <button
                  key={t}
                  className={editedFinger.texture === t ? "on" : ""}
                  aria-pressed={editedFinger.texture === t}
                  onClick={() => setEdits({ ...edits, [edited]: { ...edits[edited], texture: edits[edited]?.texture === t ? undefined : t } })}
                >
                  {TEXTURE_LABELS[t]}
                </button>
              ))}
            </div>
            <div className="n-group" style={{ marginTop: 22 }}>
              {picks[editing] && useDesign[editing] && (
                <button className="n-row" role="switch" aria-checked={flipped[editing]} aria-label={`Turn the ${LABELS[editing].toLowerCase()} design upside down`} onClick={() => setFlipped(toggle(flipped, editing))}>
                  <span className="n-ic"><Icon name="arrow-up-arrow-down" size={16} /></span>
                  <b>Flip the art</b>
                  <span className="n-switch" aria-checked={flipped[editing]}><i /></span>
                </button>
              )}
              {taps.filter(Boolean).length >= 2 && (
                <button
                  className="n-row"
                  data-testid="swap"
                  onClick={() => {
                    setSwapFrom(editing);
                    setEditing(null);
                  }}
                >
                  <span className="n-ic"><Icon name="arrow-right-arrow-left" size={16} /></span>
                  <b>Swap with another finger</b>
                  <Icon name="chevron-right" size={13} />
                </button>
              )}
            </div>
          </div>
        </Sheet>
      )}

      {sheet === "length" && (
        <LengthShapeSheet
          extensions={extensions}
          shape={shape}
          length={nailLength}
          guessed={tip === null && length === null && Boolean(read?.shape || guess)}
          ownNailsNote="Polish on your own nails: the art is fitted to your nail length."
          onExtensions={setExtensions}
          onShape={setTip}
          onLength={setLength}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === "finish" && spec && (
        <Sheet label="Finish" onClose={() => setSheet(null)} footer={<button className="n-btn n-btn-k" onClick={() => setSheet(null)}>Done</button>}>
          <div className="n-top" style={{ alignItems: "flex-start", marginTop: 18 }}>
            <h2 className="n-d">Finish</h2>
            <button className="n-x" onClick={() => setSheet(null)} aria-label="Close"><Icon name="xmark" size={14} /></button>
          </div>
          <div className="n-chips" style={{ marginTop: 18 }} aria-label="Finish">
            {TEXTURES.map((t) => (
              <button key={t} className={shownFinish === t ? "on" : ""} aria-pressed={shownFinish === t} onClick={() => setFinish(finish === t ? null : t)}>
                {TEXTURE_LABELS[t]}
              </button>
            ))}
          </div>
          <p className="n-note" style={{ margin: "14px 0 8px" }}>
            {finish
              ? `${TEXTURE_LABELS[finish]} on every nail. Tap it again to go back to ${read ? "the finish read from the photo" : "Cream"}.`
              : read
                ? "Read from the photo, per nail. Tap one to use it on every nail."
                : "Cream unless you choose another."}
          </p>
        </Sheet>
      )}

      {ownHand && (
        <Alert
          eyebrow="Add photo · Own hand"
          art={<div className="n-badge"><Icon name="hand-raised" size={34} /></div>}
          title="That looks like your own hand."
          body="Choose the nail photo you want to copy. Your phone may have offered your latest photo first."
          onClose={() => setOwnHand(false)}
        >
          <label htmlFor="inspo-file" className="n-b n-b-k">Choose again</label>
          <button className="n-b n-b-s" onClick={() => setOwnHand(false)}>It&apos;s right</button>
        </Alert>
      )}
      {!ownHand && notNails && (
        <Alert
          eyebrow="Add photo · Not nails"
          /* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration */
          art={<img src="/v2/photos.svg" alt="" />}
          title="No nail design in there."
          body="Choose a photo that shows painted nails."
          onClose={() => setNotNailsOff(readingKey)}
        >
          <label htmlFor="inspo-file" className="n-b n-b-k">Choose another photo</label>
        </Alert>
      )}
      {!ownHand && finderFailed && (
        <Alert
          eyebrow="Check nails · None found"
          art={<div className="n-badge"><Icon name="hand-draw" size={34} /></div>}
          title="We couldn't spot the nails."
          body={`Tap them yourself, from thumb to pinky. (${finding.error})`}
          onClose={() => setFinderAlertOff(true)}
        >
          <button
            className="n-b n-b-k"
            onClick={() => {
              setFinderAlertOff(true);
              go("up", () => setFixing(true));
            }}
          >
            Tap the nails
          </button>
        </Alert>
      )}
      {approxOpen && (
        <Alert
          eyebrow="Check nails · Unsure"
          art={<div className="n-badge white"><Icon name="exclamationmark-triangle" size={34} /></div>}
          title="This one will be approximate."
          body="Some outlines look unsure, so YouCam's Nail Transfer will copy the whole photo and a design may land on another finger."
          onClose={() => setApproxOpen(false)}
        >
          <button
            className="n-b n-b-k"
            onClick={() => {
              setApproxOpen(false);
              go("up", () => setFixing(true));
            }}
          >
            Fix nails
          </button>
          <button
            className="n-b n-b-s"
            onClick={() => {
              setApproxOpen(false);
              render("auto");
            }}
          >
            Try anyway
          </button>
        </Alert>
      )}
    </div>
  );
}

/** A "when things go wrong" card, as a sheet: one plain sentence, one way forward. */
function Alert({ eyebrow, art, title, body, onClose, children }: { eyebrow: string; art: React.ReactNode; title: string; body: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Sheet label={title} onClose={onClose}>
      <p className="n-eye" style={{ color: "var(--mute)", marginTop: 14 }}>{eyebrow}</p>
      <div className="n-alert-art">{art}</div>
      <h2 className="n-d n-alert-title">{title}</h2>
      <p className="n-body" style={{ marginTop: 8 }}>{body}</p>
      <div className="n-alert-acts" style={{ paddingBottom: "calc(max(var(--sab), 12px) + 8px)" }}>{children}</div>
    </Sheet>
  );
}

/** Which outliner drew the shapes, so a rough outline is never mistaken for a model result. */
function OutlinerNote({ sam, samError, flooded, picked }: { sam: "loading" | "ready" | "failed"; samError: string | null; flooded: string[]; picked: boolean }) {
  if (sam === "failed") {
    return (
      <p className="n-note n-cap" data-testid="outliner-status">
        The nail outliner (MobileSAM) couldn&apos;t run here{samError ? ` (${samError})` : ""}, so outlines come from the colour outliner and may be rough on nails that match the skin or background.
      </p>
    );
  }
  if (flooded.length > 0) {
    return (
      <p className="n-note n-cap" data-testid="outliner-status">
        MobileSAM found no nail-sized shape under the {flooded.join(", ")} tap{flooded.length > 1 ? "s" : ""}, so {flooded.length > 1 ? "those outlines come" : "that outline comes"} from the colour outliner and may be rough. Undo and tap the middle of the nail to retry.
      </p>
    );
  }
  if (picked && sam === "ready") return <p className="n-note n-cap" data-testid="outliner-status">Outlines by MobileSAM.</p>;
  return null;
}
