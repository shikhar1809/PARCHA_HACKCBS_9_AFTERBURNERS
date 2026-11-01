import assert from "node:assert/strict";
import { test } from "node:test";

import { judgePixels, judgeReading, pixelStats } from "../src/photoQuality.js";
import type { ReadLine } from "../src/reading.js";

/** An RGBA image from a function of (x, y) giving a grey level. */
function image(w: number, h: number, grey: (x: number, y: number) => number): number[] {
  const px: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const g = grey(x, y);
    px.push(g, g, g, 255);
  }
  return px;
}
const judge = (w: number, h: number, grey: (x: number, y: number) => number) => judgePixels(pixelStats(image(w, h, grey), w, h));

/** Dark "letters" on paper: sharp strokes every few pixels. */
const print = (x: number, y: number) => ((x % 7 < 2 && y % 11 < 8) || (y % 11 === 3 && x % 40 < 30) ? 30 : 235);

test("a sharp photo of print is accepted", () => {
  assert.deepEqual(judge(320, 240, print), { ok: true });
});

test("a photo taken with the lens covered is refused as too dark", () => {
  assert.deepEqual(judge(320, 240, () => 12), { ok: false, problem: "too_dark" });
});

test("glare is refused as too bright", () => {
  assert.deepEqual(judge(320, 240, () => 250), { ok: false, problem: "too_bright" });
});

test("a photo of a plain table is refused as having nothing on it", () => {
  assert.deepEqual(judge(320, 240, (x) => 120 + (x % 3)), { ok: false, problem: "flat" });
});

test("a shaken photo is refused as blurry", () => {
  // Soft bands: plenty of light and dark, almost no sharp edge.
  assert.deepEqual(judge(320, 240, (x) => 128 + 90 * Math.sin(x / 25)), { ok: false, problem: "blurry" });
});

test("a thumbnail is refused as too small", () => {
  assert.deepEqual(judge(120, 90, print), { ok: false, problem: "too_small" });
});

const line = (words: [string, number][]): ReadLine => ({
  text: words.map(([w]) => w).join(" "),
  box: { x0: 0, y0: 0, x1: 1, y1: 1 },
  words: words.map(([text, confidence]) => ({ text, confidence, box: { x0: 0, y0: 0, x1: 1, y1: 1 } })),
});

test("a reading is trusted only with enough words the reader was sure of", () => {
  assert.deepEqual(judgeReading([line([["DOLO", 92], ["650", 88], ["TAB", 90]])]), { ok: true });
  assert.deepEqual(judgeReading([line([["DOLO", 92]])]), { ok: false, problem: "no_text" });
  assert.deepEqual(judgeReading([line([["D0L0", 31], ["6S0", 40], ["TA8", 45]])]), { ok: false, problem: "unsure" });
  assert.deepEqual(judgeReading([]), { ok: false, problem: "no_text" });
});
