"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const OUT_MS = 220;
const DRAG_CLOSE_PX = 90;

/** iOS-style bottom sheet: springs up, closes by scrim, Escape, or dragging the grabber down. */
export default function Sheet({
  label,
  onClose,
  children,
  footer,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragFrom = useRef<number | null>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Callers pass an inline onClose; a ref keeps that from re-running the setup below on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const close = useCallback(() => {
    if (leave.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onCloseRef.current();
    setLeaving(true);
    leave.current = setTimeout(() => onCloseRef.current(), OUT_MS);
  }, []);

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      if (leave.current) clearTimeout(leave.current);
    };
  }, [close]);

  return (
    <>
      <div className={`n-scrim ${leaving ? "out" : ""}`} onClick={close} />
      <div
        ref={panel}
        tabIndex={-1}
        className={`n-sheet ${leaving ? "out" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={drag > 0 && !leaving ? { transform: `translateY(${drag}px)`, animation: "none" } : undefined}
      >
        <div
          className="n-grab"
          onPointerDown={(e) => {
            dragFrom.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragFrom.current !== null) setDrag(Math.max(0, e.clientY - dragFrom.current));
          }}
          onPointerUp={() => {
            dragFrom.current = null;
            if (drag > DRAG_CLOSE_PX) close();
            else setDrag(0);
          }}
        />
        <div className="n-sheet-body">{children}</div>
        {footer && <div className="n-sheet-foot">{footer}</div>}
      </div>
    </>
  );
}
