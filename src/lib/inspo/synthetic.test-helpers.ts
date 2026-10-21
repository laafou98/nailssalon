// Synthetic RGBA test images for the inspiration-photo tests.

export type RGB = [number, number, number];

export interface Scene {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export function scene(width: number, height: number, paint: (x: number, y: number) => RGB): Scene {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      const [r, g, b] = paint(x, y);
      rgba[k] = r;
      rgba[k + 1] = g;
      rgba[k + 2] = b;
      rgba[k + 3] = 255;
    }
  return { width, height, rgba };
}

/** Inside an axis-aligned ellipse centred at (cx, cy) with radii rx, ry. */
export const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/** Deterministic pseudo-noise in [−1, 1] so tests look like (mildly noisy) photos. */
export const noise = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};
