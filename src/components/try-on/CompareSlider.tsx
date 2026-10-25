"use client";

import { useState } from "react";

/**
 * Before/after compare: the render with the original photo revealed from the
 * left up to a handle the client drags (a range input, so it works with touch,
 * mouse and keyboard alike).
 */
export default function CompareSlider({ before, after, alt }: { before: string; after: string; alt: string }) {
  const [split, setSplit] = useState(50);
  return (
    <div className="relative select-none" data-testid="compare">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL / local blob */}
      <img src={after} alt={alt} className="block w-full" draggable={false} />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${split}%` }} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob */}
        <img src={before} alt="" className="block h-full max-w-none" style={{ width: `${10000 / split}%` }} draggable={false} />
      </div>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]" style={{ left: `calc(${split}% - 1px)` }}>
        <div className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xs font-bold text-zinc-900 shadow">
          ⇔
        </div>
      </div>
      <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">Before</span>
      <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">After</span>
      <input
        type="range"
        min={0}
        max={100}
        value={split}
        onChange={(e) => setSplit(Number(e.target.value))}
        aria-label="Drag to compare before and after"
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
