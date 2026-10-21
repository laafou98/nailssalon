"use client";

import type { HandPose } from "@/lib/hand-gate/checks";

/**
 * A small 3D card that copies how the hand is turned (CSS perspective + rotateY),
 * over a flat dashed outline of where it should be. Turning the hand flat lines
 * the two up and the card goes green.
 */
export default function TiltGuide({ pose, mirrored }: { pose: HandPose; mirrored: boolean }) {
  // What the user sees is mirrored on front cameras, so flip sides to match the screen.
  const farOnRight = pose.farEdgeOnRight !== mirrored;
  const thumbOnRight = (pose.farSide === "thumb") === farOnRight;
  // CSS rotateY(+a) pushes the right edge away from the viewer.
  const angle = (farOnRight ? 1 : -1) * pose.turnDeg;
  const tone =
    pose.status === "pass" ? "text-emerald-400" : pose.status === "warn" ? "text-amber-300" : "text-pink-400";

  return (
    <div className="pointer-events-none flex w-36 flex-col items-center gap-1 rounded-xl bg-black/55 p-2 backdrop-blur-sm">
      <div className="relative h-32 w-28" style={{ perspective: "320px" }}>
        {/* Target: flat to the camera. */}
        <HandShape className="absolute inset-0 text-white/35" dashed flip={thumbOnRight} />
        <div
          className={`absolute inset-0 transition-transform duration-100 ${tone}`}
          style={{ transform: `rotateY(${angle}deg)`, transformStyle: "preserve-3d" }}
        >
          <HandShape className="absolute inset-0" flip={thumbOnRight} />
        </div>
        {pose.status !== "pass" && <SwingArrow fromRight={farOnRight} />}
      </div>
      <p className={`mt-3 text-xs font-semibold leading-tight ${tone}`}>
        {pose.status === "pass" ? "Flat ✓" : `Turned ${pose.turnDeg}°`}
      </p>
    </div>
  );
}

/** Stylised back of a right hand (thumb on the left), with nails. */
function HandShape({ className, dashed = false, flip }: { className?: string; dashed?: boolean; flip: boolean }) {
  const stroke = dashed ? { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeDasharray: "4 3" } : { fill: "currentColor" };
  const fingers = [
    { x: 24, y: 20, h: 44 },
    { x: 38, y: 10, h: 52 },
    { x: 52, y: 15, h: 48 },
    { x: 66, y: 28, h: 37 },
  ];
  return (
    <svg viewBox="0 0 100 120" className={className} style={{ transform: flip ? "scaleX(-1)" : undefined }} aria-hidden>
      <g {...stroke}>
        <rect x={22} y={56} width={57} height={52} rx={15} />
        {fingers.map((f) => (
          <rect key={f.x} x={f.x} y={f.y} width={12} height={f.h} rx={6} />
        ))}
        <rect x={7} y={60} width={12} height={34} rx={6} transform="rotate(-32 13 77)" />
      </g>
      {!dashed && (
        <g fill="rgb(251 207 232)">
          {fingers.map((f) => (
            <ellipse key={f.x} cx={f.x + 6} cy={f.y + 6} rx={3.6} ry={4.4} />
          ))}
          <ellipse cx={8} cy={66} rx={3.6} ry={4.4} transform="rotate(-32 13 77)" />
        </g>
      )}
    </svg>
  );
}

/** Curved arrow in front of the card: "swing this edge towards you". */
function SwingArrow({ fromRight }: { fromRight: boolean }) {
  return (
    <svg
      viewBox="0 0 80 30"
      className="absolute -bottom-4 left-0 w-28 animate-pulse text-white"
      style={{ transform: fromRight ? "scaleX(-1)" : undefined }}
      aria-hidden
    >
      <path d="M6 6 Q 10 26 40 26" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      <path d="M33 20 L41 26 L33 31" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
