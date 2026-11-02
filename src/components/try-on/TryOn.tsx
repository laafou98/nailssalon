"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import StepNav from "@/components/ui/StepNav";
import type { GatedPhoto } from "@/lib/hand-gate/browser";
import type { EngineChoice, EngineName } from "@/lib/render/router";
import { FINGERS, type DesignSpecInput, type Texture } from "@/lib/spec/types";
import { go } from "@/lib/transition";
import CompareSlider from "./CompareSlider";
import InspoPicker from "./InspoPicker";
import Painting, { type PaintStage } from "./Painting";
import SalonMatch, { type Share } from "./SalonMatch";

/** Either one colour and finish on every nail, or per-finger colours picked from an inspiration photo. */

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

/** Screens of the design step. Painting, result and failure follow the render. */
type View = "choose" | "colour" | "photo" | "painting" | "result" | "failed";

/** How long Painting waits for the result image and the salon's quote before showing Result anyway. */
const SETTLE_MS = 6000;

type Upload = { status: "uploading" } | { status: "ready"; imageId: string } | { status: "error"; error: string };
type Render =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; id?: string; resultUrl: string; cached: boolean; engine: EngineName }
  | { status: "error"; error: string };

const POLL_MS = 2000;

/** JSON body, or a readable error if the server replied with something else (e.g. a platform 500 page). */
type ApiReply = { error?: string; imageId?: string; id?: string; status?: string; resultUrl?: string; cached?: boolean; engine?: EngineName };

/** The finished states the render API returns (success with a URL, or an error). */
const toRender = (json: ApiReply): Render =>
  json.status === "success" && json.resultUrl
    ? { status: "success", id: json.id, resultUrl: json.resultUrl, cached: Boolean(json.cached), engine: json.engine ?? "nail_vto" }
    : { status: "error", error: json.error ?? "unknown_error" };

async function readJson(res: Response): Promise<ApiReply> {
  try {
    return (await res.json()) as ApiReply;
  } catch {
    return { error: `Server error (${res.status}). Please try again.` };
  }
}

export default function TryOn({ photo, onBack, onRetake }: { photo: GatedPhoto; onBack: () => void; onRetake: () => void }) {
  const [upload, setUpload] = useState<Upload>({ status: "uploading" });
  const [hex, setHex] = useState(SWATCHES[0].hex);
  const [texture, setTexture] = useState<Texture>("cream");
  const [render, setRender] = useState<Render>({ status: "idle" });
  const [view, setView] = useState<View>("choose");
  /** The design screen a failed or finished render goes back to. */
  const [from, setFrom] = useState<"colour" | "photo">("colour");
  const [stage, setStage] = useState<PaintStage>(1);
  /** The picker holds a lot of state; once opened it stays mounted so Back keeps its edits. */
  const [pickerOpened, setPickerOpened] = useState(false);
  const compareRef = useRef<(() => void) | null>(null);
  const [share, setShare] = useState<Share>({ status: "loading" });
  const [imageReady, setImageReady] = useState(false);
  const [quoteReady, setQuoteReady] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The last spec sent, so an approximate Nail Transfer result can be redone per finger. */
  const [lastSpec, setLastSpec] = useState<DesignSpecInput | null>(null);

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

  /** A finished render: failures leave Painting now, a success stays until its image and quote are ready. */
  const finish = (r: Render) => {
    if (r.status === "error") go("dissolve", () => { setRender(r); setView("failed"); });
    else {
      setStage(3);
      setRender(r);
    }
  };

  const poll = (id: string) => {
    pollRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/renders/${id}`, { cache: "no-store" });
        const json = await readJson(res);
        if (!res.ok) return finish({ status: "error", error: json.error ?? "unknown_error" });
        if (json.status === "running") return poll(id);
        finish(toRender(json));
      } catch (e) {
        finish({ status: "error", error: String(e) });
      }
    }, POLL_MS);
  };

  const tryOn = () =>
    renderSpec({
      version: 1,
      source: { kind: "manual" },
      effectType: "nail_polish",
      fingers: Object.fromEntries(FINGERS.map((f) => [f, { kind: "color", baseHex: hex, texture }])) as DesignSpecInput["fingers"],
    });

  /**
   * Drops the last result once the design it showed is gone (a new inspiration photo), so its quote and WhatsApp
   * recipe can't be sent for the wrong nails. A render still running is kept: its unit is spent, and polling collects it.
   */
  const clearResult = () => setRender((r) => (r.status === "running" ? r : { status: "idle" }));

  const renderSpec = async (spec: DesignSpecInput, engine: EngineChoice = "auto") => {
    if (upload.status !== "ready") return;
    if (pollRef.current) clearTimeout(pollRef.current);
    go("dissolve", () => {
      setLastSpec(spec);
      setRender({ status: "running" });
      setStage(1);
      setImageReady(false);
      setQuoteReady(false);
      setShare({ status: "loading" });
      setView("painting");
    });
    try {
      const res = await fetch("/api/renders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handImageId: upload.imageId, spec, engine }),
      });
      const json = await readJson(res);
      if (!res.ok) return finish({ status: "error", error: json.error ?? "unknown_error" });
      if (json.status === "running" && json.id) {
        setStage(2);
        poll(json.id);
      } else finish(toRender(json));
    } catch (e) {
      finish({ status: "error", error: String(e) });
    }
  };

  // Painting stays up until the picture can appear at once, with a limit so a slow quote never traps the client there.
  const resultUrl = render.status === "success" ? render.resultUrl : null;
  useEffect(() => {
    if (!resultUrl) return;
    let cancelled = false;
    const done = () => !cancelled && setImageReady(true);
    const image = new Image();
    image.onload = done;
    image.onerror = done;
    image.src = resultUrl;
    const limit = setTimeout(() => {
      if (cancelled) return;
      setImageReady(true);
      setQuoteReady(true);
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(limit);
    };
  }, [resultUrl]);
  useEffect(() => {
    if (view === "painting" && resultUrl && imageReady && quoteReady) go("dissolve", () => setView("result"));
  }, [view, resultUrl, imageReady, quoteReady]);

  const busy = render.status === "running" || upload.status !== "ready";
  const swatch = SWATCHES.find((s) => s.hex === hex);
  const shareRecipe = () => {
    if (share.status !== "ready") return;
    if (navigator.share) navigator.share({ title: "My nail recipe", url: share.url }).catch(() => {});
    else window.open(share.url, "_blank", "noopener");
  };
  const failure = render.status === "error" ? describeRenderError(render.error) : null;

  return (
    <>
      {view === "choose" && (
        <div className="n-scr">
          <StepNav step={2} fill={20} onBack={onBack} />
          <div className="n-head">
            <p className="n-eye">Step 2 · Design</p>
            <h1 className="n-d n-h1">
              What are we
              <br />
              painting?
            </h1>
          </div>
          {upload.status === "error" && (
            <div className="n-note n-note-warn" role="alert">
              Couldn&apos;t save your photo: {upload.error}
              <button onClick={onRetake}>Retake hand photo</button>
            </div>
          )}
          <button className="n-card n-card-a" onClick={() => go("push", () => { setPickerOpened(true); setFrom("photo"); setView("photo"); })}>
            <div className="n-card-art">
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration */}
              <img src="/v2/photos.svg" alt="" />
            </div>
            <div className="n-card-body">
              <div>
                <h2 className="n-d">Copy a nail photo</h2>
                <p>
                  Instagram, Pinterest, a screenshot.
                  <br />
                  We read every nail.
                </p>
              </div>
              <span className="n-go"><Icon name="arrow-right" /></span>
            </div>
          </button>
          <button className="n-card n-card-b" onClick={() => go("push", () => { setFrom("colour"); setView("colour"); })}>
            <div className="n-stack" aria-hidden>
              {SWATCHES.map((s) => <i key={s.hex} style={{ background: s.hex }} />)}
            </div>
            <div className="n-card-body" style={{ paddingTop: 14 }}>
              <div>
                <h2 className="n-d">One colour</h2>
                <p>A shade and a finish, every nail.</p>
              </div>
              <span className="n-go"><Icon name="arrow-right" /></span>
            </div>
          </button>
        </div>
      )}

      {view === "colour" && (
        <div className="n-scr">
          <StepNav step={2} fill={60} onBack={() => go("pop", () => setView("choose"))} />
          <div className="n-head">
            <p className="n-eye">Step 2 · One colour</p>
            <h1 className="n-d n-h1">Pick your shade.</h1>
          </div>
          <div className="n-prev">
            <NailTrio hex={hex} matte={texture === "matte"} />
            <div style={{ position: "relative" }}>
              <p className="n-d n-name">{swatch?.name ?? "Your colour"}</p>
              <p className="n-meta">{hex} · {FINISHES.find((f) => f.value === texture)?.label.toUpperCase()}</p>
            </div>
          </div>
          <p className="n-eye n-lab">Colour</p>
          <div className="n-sw">
            {SWATCHES.map((s) => (
              <button key={s.hex} onClick={() => setHex(s.hex)} aria-label={s.name} aria-pressed={hex === s.hex} className={hex === s.hex ? "on" : ""} style={{ backgroundColor: s.hex, color: isLight(s.hex) ? "#141210" : "#fff" }}>
                {hex === s.hex && <Icon name="checkmark-alt" />}
              </button>
            ))}
            <label className={`n-cu ${swatch ? "" : "on"}`} aria-label="Any colour">
              <span><Icon name="eyedropper" size={14} /></span>
              <input type="color" value={hex} onChange={(e) => setHex(e.target.value.toUpperCase())} aria-label="Any colour" />
            </label>
          </div>
          <p className="n-eye n-lab">Finish</p>
          <div className="n-seg">
            {FINISHES.map((f) => (
              <button key={f.value} onClick={() => setTexture(f.value)} aria-pressed={texture === f.value} className={texture === f.value ? "on" : ""}>
                {f.label}
              </button>
            ))}
          </div>
          {upload.status === "error" && <p className="n-note n-note-err">Couldn&apos;t save your photo: {upload.error}</p>}
          <div className="n-cta">
            <button className="n-btn n-btn-r" onClick={tryOn} disabled={busy}>
              <Icon name="sparkles" size={20} />
              {upload.status === "uploading" ? "Saving your photo…" : render.status === "running" ? "Rendering…" : "Try it on my hand"}
            </button>
          </div>
        </div>
      )}

      {pickerOpened && (
        <div hidden={view !== "photo"}>
          <InspoPicker onTryOn={renderSpec} onNewPhoto={clearResult} busy={busy} onBack={() => go("pop", () => setView("choose"))} compareRef={compareRef} />
        </div>
      )}

      {view === "painting" && <Painting stage={stage} />}

      {view === "failed" && failure && (
        <div className="n-scr">
          <StepNav step={3} fill={30} onBack={() => go("pop", () => setView(from))} />
          <div className="n-fail">
            <p className="n-eye" style={{ color: "var(--mute)" }}>{failure.eyebrow}</p>
            <div className={`n-alert-art ${failure.limit ? "lacquer" : "white"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration */}
              <img src={failure.limit ? "/v2/mascot.svg" : "/v2/oops.svg"} alt="" />
            </div>
            <h1 className="n-d n-alert-title">{failure.title}</h1>
            <p className="n-body">{failure.body}</p>
          </div>
          <div className="n-cta">
            {failure.retake ? (
              <button className="n-btn n-btn-k" onClick={onRetake}>Retake hand photo</button>
            ) : failure.limit ? (
              <button className="n-btn n-btn-soft" onClick={() => go("pop", () => setView(from))}>OK</button>
            ) : (
              <button className="n-btn n-btn-k" onClick={() => go("pop", () => setView(from))}>Try again</button>
            )}
          </div>
        </div>
      )}

      {render.status === "success" && lastSpec && (
        <div className="n-scr" hidden={view !== "result"} style={{ paddingBottom: 0 }}>
          <StepNav
            step={3}
            fill={100}
            onBack={() => go("pop", () => setView("choose"))}
            trailing={
              <button className="n-ib" aria-label="Share the recipe" onClick={shareRecipe} disabled={share.status !== "ready"}>
                <Icon name="square-arrow-up" />
              </button>
            }
          />
          <div className="n-head">
            <p className="n-eye">Your recipe · 5 nails</p>
            <h1 className="n-d n-h1">
              Looks good
              <br />
              on you.
            </h1>
          </div>
          {view === "result" && <CompareSlider before={photo.url} after={render.resultUrl} alt="Your hand with the polish applied" aspect={photo.width / photo.height} />}
          {render.engine === "nail_transfer" ? (
            <div className="n-transfer">
              <p>Approximate: YouCam&apos;s Nail Transfer copied the whole photo, so designs can land on the wrong fingers and fine detail can blur.</p>
              {(lastSpec.confidence ?? 1) > 0 && (
                <button className="n-link" onClick={() => renderSpec(lastSpec, "nail_vto")} disabled={busy}>
                  Render each finger exactly instead
                </button>
              )}
            </div>
          ) : (
            from === "photo" && (
              <button className="n-link-mute" onClick={() => compareRef.current?.()} disabled={busy} style={{ marginTop: 18 }}>
                Compare with YouCam Nail Transfer
                <Icon name="chevron-right" size={14} />
              </button>
            )
          )}
          {render.cached && <p className="n-note" style={{ textAlign: "center" }}>Already rendered this exact look, so no new render was needed.</p>}
          <SalonMatch
            key={render.id ?? JSON.stringify(lastSpec)}
            spec={lastSpec}
            renderId={render.id}
            onSettled={() => setQuoteReady(true)}
            onShare={setShare}
            onChangeDesign={() => go("pop", () => setView("choose"))}
          />
        </div>
      )}
    </>
  );
}

/** The three lacquered nails on One colour. */
function NailTrio({ hex, matte }: { hex: string; matte: boolean }) {
  const path = "M28 0 C46 12 54 38 54 72 V128 Q28 140 2 128 V72 C2 38 10 12 28 0Z";
  return (
    <svg viewBox="0 0 230 190" aria-hidden>
      <defs>
        <linearGradient id="n-lacquer" x1="0" x2="1">
          <stop offset="0" stopColor={mix(hex, "#FFFFFF", 0.14)} />
          <stop offset=".5" stopColor={hex} />
          <stop offset="1" stopColor={mix(hex, "#000000", 0.18)} />
        </linearGradient>
      </defs>
      <g stroke="#141210" strokeWidth="4" strokeLinejoin="round">
        <g transform="translate(14 54) rotate(-20)"><path d={path} fill="url(#n-lacquer)" /></g>
        <g transform="translate(150 34) rotate(18)"><path d={path} fill="url(#n-lacquer)" /></g>
        <g transform="translate(86 14)"><path d={path} fill="url(#n-lacquer)" /></g>
      </g>
      {!matte && <path className="n-shine" d="M100 52 v40" stroke="#fff" strokeWidth="7" strokeLinecap="round" opacity=".85" />}
    </svg>
  );
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function mix(hex: string, other: string, amount: number) {
  const a = channels(hex);
  const b = channels(other);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * amount)).join(",")})`;
}

const isLight = (hex: string) => {
  const [r, g, b] = channels(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
};

function describeRenderError(error: string): { eyebrow: string; title: string; body: string; retake?: boolean; limit?: boolean } {
  if (error === "error_no_nail" || error === "error_nail_too_small") {
    return {
      eyebrow: "Painting · Failed",
      title: "We couldn't find your nails.",
      body: "No try-on was used. A closer, brighter photo with bare nails usually fixes it.",
      retake: true,
    };
  }
  if (/limit/i.test(error)) {
    return {
      eyebrow: "Painting · Limit reached",
      title: "Out of try-ons for now.",
      body: "This session has reached its limit. Come back later for more.",
      limit: true,
    };
  }
  if (error === "timeout") {
    return { eyebrow: "Painting · Failed", title: "That took too long.", body: "The render took too long. Please try again." };
  }
  return { eyebrow: "Painting · Failed", title: "That one slipped.", body: `The render failed: ${error}. Your try-on credit was not used.` };
}
