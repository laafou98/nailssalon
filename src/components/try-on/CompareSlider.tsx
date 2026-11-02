"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";

const START = 38;
const PEEK = 16;
const PEEK_MS = 2600;
const PEEK_DELAY_MS = 400;
/** Back at the start by 70% of the animation, as in the design. */
const PEEK_TURN = 0.35;
const PEEK_END = 0.7;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Before/after compare: the render over the original photo, revealed from a handle the client drags anywhere on the
 * picture (touch, mouse, or arrow keys). It peeks once on arrival to show that it moves. Vertical swipes still scroll.
 */
export default function CompareSlider({ before, after, alt, aspect }: { before: string; after: string; alt: string; aspect: number }) {
  const [split, setSplit] = useState(START);
  const touched = useRef(false);
  const dragging = useRef(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now() + PEEK_DELAY_MS;
    const frame = (now: number) => {
      if (touched.current) return;
      const t = Math.max(0, now - start) / PEEK_MS;
      if (t >= PEEK_END) return setSplit(START);
      const into = t < PEEK_TURN ? t / PEEK_TURN : 1 - (t - PEEK_TURN) / (PEEK_END - PEEK_TURN);
      setSplit(START + (PEEK - START) * ease(into));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const moveTo = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    touched.current = true;
    setSplit(Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)));
  };

  return (
    <div
      className="n-cmp"
      data-testid="compare"
      style={{ "--ar": aspect } as React.CSSProperties}
      role="slider"
      tabIndex={0}
      aria-label="Drag to compare before and after"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split)}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e);
      }}
      onPointerMove={(e) => dragging.current && moveTo(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowLeft" ? -5 : e.key === "ArrowRight" ? 5 : 0;
        if (!step) return;
        e.preventDefault();
        touched.current = true;
        setSplit((s) => Math.min(100, Math.max(0, s + step)));
      }}
    >
      <div className="n-cmp-clip">
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob */}
        <img src={before} alt="" draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
        <img src={after} alt={alt} draggable={false} style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
        <span className="n-tagb" style={{ left: 14, background: "rgba(20,18,16,.6)" }}>Before</span>
        <span className="n-tagb" style={{ right: 14, background: "var(--r)" }}>After</span>
        <div className="n-handle" style={{ left: `${split}%` }}>
          <i>
            <Icon name="arrow-left-right" />
          </i>
        </div>
      </div>
    </div>
  );
}
