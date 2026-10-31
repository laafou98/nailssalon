// CIELAB (D65) and CIEDE2000: the industry-standard colour difference, used to
// match a spec colour to the salon's real polishes. Pure functions, no browser APIs.

import { hexToRgb } from "@/lib/inspo/oklab";

export interface CieLab {
  L: number; // 0 (black) – 100 (white)
  a: number;
  b: number;
}

const linear = (byte: number) => {
  const s = byte / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

// D65 reference white.
const XN = 0.95047, YN = 1, ZN = 1.08883;
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

export function hexToLab(hex: string): CieLab {
  const [r, g, b] = hexToRgb(hex).map(linear);
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = f(x / XN), fy = f(y / YN), fz = f(z / ZN);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** CIEDE2000 (Sharma, Wu & Dalal 2005), kL = kC = kH = 1. */
export function deltaE2000(p: CieLab, q: CieLab): number {
  const C1 = Math.hypot(p.a, p.b), C2 = Math.hypot(q.a, q.b);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1 = (1 + G) * p.a, a2 = (1 + G) * q.a;
  const c1 = Math.hypot(a1, p.b), c2 = Math.hypot(a2, q.b);
  const hue = (a: number, b: number) => (a === 0 && b === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1 = hue(a1, p.b), h2 = hue(a2, q.b);

  const dL = q.L - p.L;
  const dC = c2 - c1;
  let dh = 0;
  if (c1 * c2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(rad(dh / 2));

  const Lbar = (p.L + q.L) / 2;
  const cbar = (c1 + c2) / 2;
  let hbar = h1 + h2;
  if (c1 * c2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) hbar /= 2;
    else hbar = h1 + h2 < 360 ? (hbar + 360) / 2 : (hbar - 360) / 2;
  }
  const T =
    1 - 0.17 * Math.cos(rad(hbar - 30)) + 0.24 * Math.cos(rad(2 * hbar)) +
    0.32 * Math.cos(rad(3 * hbar + 6)) - 0.2 * Math.cos(rad(4 * hbar - 63));
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const cbar7 = cbar ** 7;
  const RC = 2 * Math.sqrt(cbar7 / (cbar7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * cbar;
  const SH = 1 + 0.015 * cbar * T;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;

  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
