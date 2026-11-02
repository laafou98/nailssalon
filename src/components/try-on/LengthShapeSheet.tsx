"use client";

// The Length & shape sheet: polish on the client's own nails, or press-on extensions in a tip shape and length.
// Shared by the One colour screen and the inspiration picker (which can guess the shape and length from the photo).

import Icon from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import { LENGTHS, TIP_SHAPES, type TipShape } from "@/lib/inspo/pick";
import { lengthLabel } from "@/lib/recipe/format";

export const TIP_LABELS: Record<TipShape, string> = { almond: "Almond", stiletto: "Stiletto", oval: "Oval", square: "Square", squoval: "Squoval" };

/** The tip shapes drawn on the sheet. */
const TIP_PATHS: Record<TipShape, string> = {
  almond: "M20 2 C32 10 36 26 36 40 V58 H4 V40 C4 26 8 10 20 2Z",
  stiletto: "M20 1 C26 14 34 30 34 42 V58 H6 V42 C6 30 14 14 20 1Z",
  oval: "M4 22 C4 10 12 4 20 4 C28 4 36 10 36 22 V58 H4Z",
  square: "M4 9 Q4 4 9 4 H31 Q36 4 36 9 V58 H4Z",
  squoval: "M4 15 Q4 4 15 4 H25 Q36 4 36 15 V58 H4Z",
};

/** What the Length & shape cell shows: "Almond · Medium" or "My own nails". */
export function lengthSummary(extensions: boolean, shape: TipShape, length: number): string {
  return extensions ? `${TIP_LABELS[shape]} · ${lengthLabel(length)}` : "My own nails";
}

export default function LengthShapeSheet({
  extensions,
  shape,
  length,
  guessed = false,
  ownNailsNote,
  onExtensions,
  onShape,
  onLength,
  onClose,
}: {
  extensions: boolean;
  shape: TipShape;
  length: number;
  /** The shape and length shown were guessed from the inspiration photo. */
  guessed?: boolean;
  /** What "My own nails" means on this screen. */
  ownNailsNote: string;
  onExtensions: (extensions: boolean) => void;
  onShape: (tip: TipShape) => void;
  onLength: (length: number) => void;
  onClose: () => void;
}) {
  return (
    <Sheet label="Length and shape" onClose={onClose} footer={<button className="n-btn n-btn-k" onClick={onClose}>Done</button>}>
      <div className="n-top" style={{ alignItems: "flex-start", marginTop: 18 }}>
        <div>
          <h2 className="n-d">Length &amp; shape</h2>
          {extensions && guessed && (
            <p>
              <span style={{ color: "var(--r)", display: "flex" }}><Icon name="sparkles" size={14} /></span>
              Guessed from your photo
            </p>
          )}
        </div>
        <button className="n-x" onClick={onClose} aria-label="Close"><Icon name="xmark" size={14} /></button>
      </div>
      <div className="n-seg" role="tablist" aria-label="Nail length" style={{ marginTop: 20 }}>
        {([false, true] as const).map((ext) => (
          <button key={String(ext)} role="tab" aria-selected={extensions === ext} className={extensions === ext ? "on" : ""} onClick={() => onExtensions(ext)}>
            {ext ? "Extensions" : "My own nails"}
          </button>
        ))}
      </div>
      {extensions ? (
        <>
          <p className="n-eye n-lab">Shape</p>
          <div className="n-shapes" aria-label="Shape">
            {TIP_SHAPES.map((t) => (
              <button key={t} className={`n-sh ${shape === t ? "on" : ""}`} aria-pressed={shape === t} onClick={() => onShape(t)}>
                <i>
                  <svg viewBox="0 0 40 60" aria-hidden>
                    <path d={TIP_PATHS[t]} stroke="#141210" strokeWidth="3.5" strokeLinejoin="round" />
                  </svg>
                </i>
                <span>{TIP_LABELS[t]}</span>
              </button>
            ))}
          </div>
          <p className="n-eye n-lab">Length</p>
          <div className="n-seg n-seg-tall" style={{ marginTop: 0 }} aria-label="Length">
            {LENGTHS.map((l) => (
              <button key={l.value} className={length === l.value ? "on" : ""} aria-pressed={length === l.value} onClick={() => onLength(l.value)}>
                {l.label}
              </button>
            ))}
          </div>
          <p className="n-note" style={{ margin: "14px 0 0" }}>Press-on or gel extensions in this shape and length.</p>
        </>
      ) : (
        <p className="n-note" style={{ margin: "14px 0 8px" }}>{ownNailsNote}</p>
      )}
    </Sheet>
  );
}
