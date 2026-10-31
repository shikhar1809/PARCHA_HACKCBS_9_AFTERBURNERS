/**
 * Draws the things a medicine alert needs on Android: a short chime, the small
 * white icon in the status bar, and the larger icon beside the text.
 *
 *   node scripts/make-android-alerts.mjs
 *
 * Writes into android/app/src/main/res. Run it once; the files are committed.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const res = path.resolve(import.meta.dirname, "..", "android", "app", "src", "main", "res");
fs.mkdirSync(path.join(res, "raw"), { recursive: true });
fs.mkdirSync(path.join(res, "drawable"), { recursive: true });

// --- A chime: two soft bell tones, a fifth apart, each fading out. 16-bit mono WAV.
const rate = 22050;
const tones = [{ f: 880, at: 0, len: 0.55 }, { f: 1318.5, at: 0.28, len: 0.85 }];
const total = Math.ceil(rate * 1.2);
const samples = new Float32Array(total);
for (const { f, at, len } of tones) {
  const start = Math.floor(at * rate);
  const n = Math.floor(len * rate);
  for (let i = 0; i < n && start + i < total; i++) {
    const t = i / rate;
    const env = Math.exp(-4.2 * (i / n)) * Math.min(1, i / 120); // a click-free start, a long fade
    samples[start + i] += env * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t) + 0.12 * Math.sin(2 * Math.PI * f * 3 * t));
  }
}
const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0.001);
const pcm = Buffer.alloc(total * 2);
for (let i = 0; i < total; i++) pcm.writeInt16LE(Math.round((samples[i] / peak) * 0.8 * 32767), i * 2);
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(path.join(res, "raw", "dose_chime.wav"), Buffer.concat([header, pcm]));

// --- The status-bar icon must be a white shape on transparent: a pill, slanted.
fs.writeFileSync(path.join(res, "drawable", "ic_stat_parcha.xml"), `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFFFF"
      android:pathData="M4.2,13.2 L13.2,4.2 A4.5,4.5 0 0 1 19.8,10.8 L10.8,19.8 A4.5,4.5 0 0 1 4.2,13.2 Z M9.4,9.4 L7.2,11.6 L12.4,16.8 L14.6,14.6 Z" />
</vector>
`);

// --- The larger icon beside the text: the app's own icon.
await sharp(path.resolve(import.meta.dirname, "..", "assets", "icon-only.png")).resize(192, 192).png().toFile(path.join(res, "drawable", "ic_notify_large.png"));
console.log("alert resources written to", res);
