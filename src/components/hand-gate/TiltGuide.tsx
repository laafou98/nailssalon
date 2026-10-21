"use client";

import type { HandPose } from "@/lib/hand-gate/checks";

/**
 * A small 3D card that copies how the hand is held (CSS perspective + rotateY),
 * over a dashed outline of where it should be: back of the hand, flat to the
 * camera. The card's front is the back of a hand (with nails) and its reverse is
 * a palm, so showing your palm flips the card over. Lining it up turns it green.
 */
export default function TiltGuide({ pose, mirrored }: { pose: HandPose; mirrored: boolean }) {
  // What the user sees is mirrored on front cameras, so flip sides to match the screen.
  const farOnRight = pose.farEdgeOnRight !== mirrored;
  const thumbOnRight = (pose.farSide === "thumb") === farOnRight;
  const palm = pose.facing === "palm";
  // CSS rotateY(+a) pushes the right edge away from the viewer; +180° shows the reverse (palm) face.
  const angle = (palm ? 180 : 0) + (farOnRight ? 1 : -1) * pose.turnDeg;
  const status = palm ? "fail" : pose.status;
  const tone = status === "pass" ? "text-emerald-400" : status === "warn" ? "text-amber-300" : "text-pink-400";
  // Turning a palm over puts the thumb on the other side, so the target swaps sides too.
  const targetThumbOnRight = palm ? !thumbOnRight : thumbOnRight;
  const face = "absolute inset-0 [backface-visibility:hidden]";

  return (
    <div className="pointer-events-none flex w-36 flex-col items-center gap-1 rounded-xl bg-black/55 p-2 backdrop-blur-sm">
      <div className="relative h-32 w-28" style={{ perspective: "320px" }}>
        {/* Target: back of the hand, flat to the camera. */}
        <HandShape className="absolute inset-0 text-white/35" variant="outline" flip={targetThumbOnRight} />
        <div
          className={`absolute inset-0 transition-transform duration-200 ${tone}`}
          style={{ transform: `rotateY(${angle}deg)`, transformStyle: "preserve-3d" }}
        >
          <HandShape className={face} variant="back" flip={thumbOnRight} />
          {/* Reverse face: pre-turned 180°, so with the card's own 180° it reads un-mirrored. */}
          <div className={face} style={{ transform: "rotateY(180deg)" }}>
            <HandShape className="absolute inset-0" variant="palm" flip={thumbOnRight} />
          </div>
        </div>
        {palm ? <FlipArrow /> : pose.status !== "pass" && <SwingArrow fromRight={farOnRight} />}
      </div>
      <p className={`mt-3 text-xs font-semibold leading-tight ${tone}`}>
        {palm ? "Palm side: flip it" : pose.status === "pass" ? "Flat ✓" : `Turned ${pose.turnDeg}°`}
      </p>
    </div>
  );
}

/** Stylised right hand, thumb on the left: back (with nails), palm (with creases) or a dashed outline. */
function HandShape({ className, variant, flip }: { className?: string; variant: "back" | "palm" | "outline"; flip: boolean }) {
  const dashed = variant === "outline";
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
      {variant === "palm" && (
        <g fill="none" stroke="rgba(0, 0, 0, 0.35)" strokeWidth={2} strokeLinecap="round">
          <path d="M30 72 Q 50 66 74 70" />
          <path d="M28 82 Q 46 78 62 88" />
          <path d="M40 104 Q 34 88 26 74" />
        </g>
      )}
      {variant === "back" && (
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

/** Circular arrow: "turn your hand over". */
function FlipArrow() {
  return (
    <svg viewBox="0 0 40 40" className="absolute -bottom-4 left-1/2 w-9 -translate-x-1/2 animate-pulse text-white" aria-hidden>
      <path d="M32 20 A 12 12 0 1 1 26 9.6" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" />
      <path d="M20 6 L27 9 L23 15" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
