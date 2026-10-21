// Pixel statistics for the Hand Quality Gate. Pure functions over RGBA buffers
// (the shape of ImageData.data), so they run the same in the browser and in tests.
// Callers resample regions to a fixed size first, so thresholds don't depend on
// camera resolution.

/** Rec. 601 luma, 0–255. */
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

export function lumaStats(rgba: Uint8ClampedArray): { meanLuma: number; clippedFraction: number } {
  const n = rgba.length / 4;
  if (n === 0) return { meanLuma: 0, clippedFraction: 0 };
  let sum = 0;
  let clipped = 0;
  for (let k = 0; k < rgba.length; k += 4) {
    const y = luma(rgba[k], rgba[k + 1], rgba[k + 2]);
    sum += y;
    if (y >= 250) clipped++;
  }
  return { meanLuma: sum / n, clippedFraction: clipped / n };
}

/** Variance of the 4-neighbour Laplacian on luma: a standard focus measure. */
export function laplacianVariance(rgba: Uint8ClampedArray, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  const gray = new Float32Array(width * height);
  for (let k = 0, p = 0; p < gray.length; k += 4, p++) gray[p] = luma(rgba[k], rgba[k + 1], rgba[k + 2]);

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}
