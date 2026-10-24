// Smooth outlines for the picker's overlay. A nail mask lives at working
// resolution (long side 512) and is shown two to three times larger on a phone,
// so its pixel edge looks like a staircase. The mask's boundary is traced into
// a polygon, rounded, and drawn as an anti-aliased path instead.

import type { Point } from "./region";

/**
 * The outer boundary of the mask's largest component as a closed polygon in
 * pixel-corner coordinates (so a lone pixel at (0, 0) gives the unit square).
 * Marching squares over the padded mask; the longest loop wins.
 */
export function traceOutline(mask: Uint8Array, width: number, height: number): Point[] {
  const W = width + 2, H = height + 2;
  const at = (x: number, y: number) => (x >= 1 && y >= 1 && x <= width && y <= height ? mask[(y - 1) * width + (x - 1)] : 0);
  // Horizontal and vertical boundary edges between pixel (x, y) and its neighbour, each used once.
  const seenH = new Uint8Array(W * (H + 1)); // edge above pixel (x, y): between (x, y-1) and (x, y)
  const seenV = new Uint8Array((W + 1) * H); // edge left of pixel (x, y): between (x-1, y) and (x, y)
  let best: Point[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // Start on an "entering from above" edge: outside above, inside below.
      if (seenH[y * W + x] || at(x, y - 1) || !at(x, y)) continue;
      const loop = followBoundary(x, y, at, seenH, seenV, W);
      if (loop.length > best.length) best = loop;
    }
  // Back to unpadded coordinates.
  return best.map((p) => ({ x: p.x - 1, y: p.y - 1 }));
}

/**
 * Walks the boundary clockwise keeping the inside on the right, starting on the
 * top edge of pixel (x0, y0). Directions: 0 right, 1 down, 2 left, 3 up.
 */
function followBoundary(x0: number, y0: number, at: (x: number, y: number) => number, seenH: Uint8Array, seenV: Uint8Array, W: number): Point[] {
  const loop: Point[] = [];
  // The walker stands on a lattice corner and moves along pixel edges.
  let cx = x0, cy = y0, dir = 0;
  const start = `${cx},${cy},${dir}`;
  for (let steps = 0; steps < 4 * W * W; steps++) {
    loop.push({ x: cx, y: cy });
    if (dir === 0) seenH[cy * W + cx] = 1;
    if (dir === 3) seenV[cy * (W + 1) + cx] = 1;
    // Move one edge.
    if (dir === 0) cx++;
    else if (dir === 1) cy++;
    else if (dir === 2) cx--;
    else cy--;
    // The four pixels around the new corner: inside on the right of the direction of travel.
    const tl = at(cx - 1, cy - 1), tr = at(cx, cy - 1), bl = at(cx - 1, cy), br = at(cx, cy);
    // Choose the next direction so the inside stays on the right (clockwise around the shape).
    if (dir === 0) dir = br && !tr ? 0 : br && tr ? 3 : 1;
    else if (dir === 1) dir = bl && !br ? 1 : bl && br ? 0 : 2;
    else if (dir === 2) dir = tl && !bl ? 2 : tl && bl ? 1 : 3;
    else dir = tr && !tl ? 3 : tr && tl ? 2 : 0;
    if (`${cx},${cy},${dir}` === start) break;
  }
  return loop;
}

/** Chaikin corner cutting, `rounds` times: a rounded polygon through the staircase's midpoints. */
export function smoothPolygon(points: Point[], rounds = 2): Point[] {
  let p = points;
  for (let r = 0; r < rounds && p.length > 2; r++) {
    const next: Point[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    p = next;
  }
  return p;
}

/** Drops points closer than `step` to the previous kept one, so a 1-px staircase becomes a sparse polygon before rounding. */
export function simplifyPolygon(points: Point[], step = 2): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= step) out.push(p);
  }
  return out.length >= 3 ? out : points;
}

/** A mask → its smooth outline, ready for a canvas path. */
export function smoothOutline(mask: Uint8Array, width: number, height: number): Point[] {
  return smoothPolygon(simplifyPolygon(traceOutline(mask, width, height), 2), 2);
}
