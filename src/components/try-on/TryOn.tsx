"use client";

import { useEffect, useRef, useState } from "react";
import type { GatedPhoto } from "@/lib/hand-gate/browser";
import { FINGERS, type DesignSpecInput, type Texture } from "@/lib/spec/types";

/** A first, manual design: one colour and finish on every nail. Day 4–6 adds extraction and the editor. */

const SWATCHES = [
  { name: "Cherry", hex: "#B0123A" },
  { name: "Nude", hex: "#D8B4A0" },
  { name: "Ballet pink", hex: "#F2C6CF" },
  { name: "Coral", hex: "#F0645A" },
  { name: "Navy", hex: "#1F2A55" },
  { name: "Sage", hex: "#9CAF88" },
];

const FINISHES: { value: Texture; label: string }[] = [
  { value: "cream", label: "Cream" },
  { value: "jelly", label: "Jelly" },
  { value: "matte", label: "Matte" },
  { value: "metallic", label: "Chrome" },
  { value: "shimmer_fine", label: "Shimmer" },
];

type Upload = { status: "uploading" } | { status: "ready"; imageId: string } | { status: "error"; error: string };
type Render =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; resultUrl: string; cached: boolean }
  | { status: "error"; error: string };

const POLL_MS = 2000;

/** JSON body, or a readable error if the server replied with something else (e.g. a platform 500 page). */
type ApiReply = { error?: string; imageId?: string; id?: string; status?: string; resultUrl?: string; cached?: boolean };

/** The finished states the render API returns (success with a URL, or an error). */
const toRender = (json: ApiReply): Render =>
  json.status === "success" && json.resultUrl
    ? { status: "success", resultUrl: json.resultUrl, cached: Boolean(json.cached) }
    : { status: "error", error: json.error ?? "unknown_error" };

async function readJson(res: Response): Promise<ApiReply> {
  try {
    return (await res.json()) as ApiReply;
  } catch {
    return { error: `Server error (${res.status}). Please try again.` };
  }
}

export default function TryOn({ photo }: { photo: GatedPhoto }) {
  const [upload, setUpload] = useState<Upload>({ status: "uploading" });
  const [hex, setHex] = useState(SWATCHES[0].hex);
  const [texture, setTexture] = useState<Texture>("cream");
  const [render, setRender] = useState<Render>({ status: "idle" });
  const [showBefore, setShowBefore] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const body = new FormData();
    body.set("photo", photo.blob, "hand.jpg");
    body.set("width", String(photo.width));
    body.set("height", String(photo.height));
    body.set("landmarks", JSON.stringify(photo.landmarks));
    fetch("/api/hands", { method: "POST", body })
      .then(async (res) => {
        const json = await readJson(res);
        if (cancelled) return;
        setUpload(
          res.ok && json.imageId
            ? { status: "ready", imageId: json.imageId }
            : { status: "error", error: json.error ?? "Upload failed" },
        );
      })
      .catch((e: unknown) => !cancelled && setUpload({ status: "error", error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [photo]);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const poll = (id: string) => {
    pollRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/renders/${id}`, { cache: "no-store" });
        const json = await readJson(res);
        if (!res.ok) return setRender({ status: "error", error: json.error ?? "unknown_error" });
        if (json.status === "running") return poll(id);
        setRender(toRender(json));
      } catch (e) {
        setRender({ status: "error", error: String(e) });
      }
    }, POLL_MS);
  };

  const tryOn = async () => {
    if (upload.status !== "ready") return;
    if (pollRef.current) clearTimeout(pollRef.current);
    setRender({ status: "running" });
    setShowBefore(false);
    const spec: DesignSpecInput = {
      version: 1,
      source: { kind: "manual" },
      effectType: "nail_polish",
      fingers: Object.fromEntries(FINGERS.map((f) => [f, { kind: "color", baseHex: hex, texture }])) as DesignSpecInput["fingers"],
    };
    try {
      const res = await fetch("/api/renders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handImageId: upload.imageId, spec }),
      });
      const json = await readJson(res);
      if (!res.ok) return setRender({ status: "error", error: json.error ?? "unknown_error" });
      if (json.status === "running" && json.id) poll(json.id);
      else setRender(toRender(json));
    } catch (e) {
      setRender({ status: "error", error: String(e) });
    }
  };

  const busy = render.status === "running" || upload.status !== "ready";
  const shown = render.status === "success" && !showBefore ? render.resultUrl : photo.url;

  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL / local blob */}
        <img src={shown} alt={shown === photo.url ? "Your hand" : "Your hand with the polish applied"} className="block w-full" />
        {render.status === "running" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-medium text-white">
            Painting your nails… (about 10 s)
          </div>
        )}
        {render.status === "success" && (
          <button
            onPointerDown={() => setShowBefore(true)}
            onPointerUp={() => setShowBefore(false)}
            onPointerLeave={() => setShowBefore(false)}
            className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white"
          >
            Hold to compare
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Colour</p>
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((s) => (
            <button
              key={s.hex}
              onClick={() => setHex(s.hex)}
              aria-label={s.name}
              aria-pressed={hex === s.hex}
              className={`h-10 w-10 rounded-full border-2 ${hex === s.hex ? "border-zinc-900 dark:border-white" : "border-transparent"}`}
              style={{ backgroundColor: s.hex }}
            />
          ))}
          <label className="flex h-10 items-center gap-2 rounded-full border border-zinc-300 px-3 text-sm dark:border-zinc-700">
            <input type="color" value={hex} onChange={(e) => setHex(e.target.value.toUpperCase())} className="h-6 w-6" />
            {hex}
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Finish</p>
        <div className="flex flex-wrap gap-2">
          {FINISHES.map((f) => (
            <button
              key={f.value}
              onClick={() => setTexture(f.value)}
              aria-pressed={texture === f.value}
              className={`rounded-full border px-4 py-2 text-sm ${
                texture === f.value
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={tryOn}
        disabled={busy}
        className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
      >
        {upload.status === "uploading" ? "Saving your photo…" : render.status === "running" ? "Rendering…" : "Try it on"}
      </button>

      {render.status === "success" && render.cached && (
        <p className="text-xs text-zinc-500">Already rendered this exact look, so no new render was needed.</p>
      )}
      {upload.status === "error" && <p className="text-sm text-red-600">Couldn&apos;t save your photo: {upload.error}</p>}
      {render.status === "error" && <p className="text-sm text-red-600">{describeRenderError(render.error)}</p>}
    </div>
  );
}

function describeRenderError(error: string) {
  if (error === "error_no_nail" || error === "error_nail_too_small") {
    return "YouCam couldn't find your nails clearly. Retake the photo a little closer, with bare nails.";
  }
  if (/limit/i.test(error)) return "You've reached the try-on limit for this session.";
  if (error === "timeout") return "The render took too long. Please try again.";
  return `The render failed: ${error}. Your try-on credit was not used.`;
}
