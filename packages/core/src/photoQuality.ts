/**
 * Whether a photo is clear enough to read from, decided before anything is read
 * and again after.
 *
 * The rule is "never assume": a dark, washed-out or shaken photo is refused
 * with the reason, not read hopefully. A bill read from a blurred photo gives
 * half the names, and half the names looks exactly like all of them. So:
 *
 *   1. Before reading, the pixels. Too dark, too bright, too flat (no contrast:
 *      a photo of a table, or of glare), too blurry (little edge energy), or
 *      too small. Any one refuses the photo.
 *   2. After reading, the reader's own confidence. Too few words, or words the
 *      reader itself was unsure of, refuse it too — and then nothing found on
 *      it is shown, not even the names it was sure of.
 *
 * Pure functions of numbers, so they are tested here and the phone only has to
 * hand over the pixels.
 */
import type { ReadLine } from "./reading.js";

export type PixelStats = {
  width: number;
  height: number;
  /** Mean luminance, 0 to 255. */
  brightness: number;
  /** Standard deviation of luminance: how much light and dark there is. */
  contrast: number;
  /** Variance of the Laplacian: how much sharp edge there is. Print is all edges. */
  sharpness: number;
};

export type PhotoProblem = "too_small" | "too_dark" | "too_bright" | "flat" | "blurry" | "no_text" | "unsure";
export type PhotoVerdict = { ok: true } | { ok: false; problem: PhotoProblem };

/** The thresholds, measured on photos scaled to about 320 pixels wide. */
export const PHOTO_LIMITS = {
  minSide: 240,
  minBrightness: 45,
  maxBrightness: 235,
  minContrast: 20,
  minSharpness: 60,
  minWords: 3,
  minConfidence: 60,
} as const;

/** Luminance statistics and edge energy of an RGBA image. */
export function pixelStats(rgba: ArrayLike<number>, width: number, height: number): PixelStats {
  const n = width * height;
  const lum = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    lum[i] = l;
    sum += l;
  }
  const brightness = n ? sum / n : 0;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (lum[i] - brightness) ** 2;
  const contrast = n ? Math.sqrt(sq / n) : 0;
  // 4-neighbour Laplacian over the interior.
  let lsum = 0;
  let lsq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = lum[i - 1] + lum[i + 1] + lum[i - width] + lum[i + width] - 4 * lum[i];
      lsum += v;
      lsq += v * v;
      count++;
    }
  }
  const mean = count ? lsum / count : 0;
  const sharpness = count ? lsq / count - mean * mean : 0;
  return { width, height, brightness, contrast, sharpness };
}

/** Step 1: is there enough light, contrast and edge to read print from? */
export function judgePixels(s: PixelStats): PhotoVerdict {
  if (Math.max(s.width, s.height) < PHOTO_LIMITS.minSide) return { ok: false, problem: "too_small" };
  if (s.brightness < PHOTO_LIMITS.minBrightness) return { ok: false, problem: "too_dark" };
  if (s.brightness > PHOTO_LIMITS.maxBrightness) return { ok: false, problem: "too_bright" };
  if (s.contrast < PHOTO_LIMITS.minContrast) return { ok: false, problem: "flat" };
  if (s.sharpness < PHOTO_LIMITS.minSharpness) return { ok: false, problem: "blurry" };
  return { ok: true };
}

/** Step 2: did the reader find enough words, and was it sure of them? */
export function judgeReading(lines: ReadLine[]): PhotoVerdict {
  const words = lines.flatMap((l) => l.words).filter((w) => /[A-Za-z0-9]{2,}/.test(w.text));
  if (words.length < PHOTO_LIMITS.minWords) return { ok: false, problem: "no_text" };
  const confidence = words.reduce((a, w) => a + w.confidence, 0) / words.length;
  if (confidence < PHOTO_LIMITS.minConfidence) return { ok: false, problem: "unsure" };
  return { ok: true };
}
