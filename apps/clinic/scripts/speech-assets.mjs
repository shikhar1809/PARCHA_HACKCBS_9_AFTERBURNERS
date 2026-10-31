/**
 * The on-device speech engine's files, served by the clinic app itself:
 * Whisper base.en and tiny.en (English, 8-bit, about 76 and 40 MB) and the ONNX runtime that runs
 * it in WebAssembly. Fetched once from Hugging Face into public/asr (not in
 * git) the first time the app is served or built, then reused; the clinic
 * never loads them from anywhere else, and no audio leaves the computer.
 */
import { copyFileSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Base for computers quick enough, tiny for the rest (see whisper.ts).
const MODELS = ["Xenova/whisper-base.en", "Xenova/whisper-tiny.en"];
const FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];
const RUNTIME = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];

export async function ensureSpeechAssets(appDir) {
  const out = path.join(appDir, "public", "asr");
  const modules = path.resolve(appDir, "../../node_modules");
  mkdirSync(path.join(out, "ort"), { recursive: true });
  for (const f of RUNTIME) {
    const src = path.join(modules, "onnxruntime-web", "dist", f);
    const dst = path.join(out, "ort", f);
    if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) copyFileSync(src, dst);
  }
  for (const MODEL of MODELS) for (const f of FILES) {
    const dst = path.join(out, MODEL, f);
    if (existsSync(dst) && statSync(dst).size > 0) continue;
    mkdirSync(path.dirname(dst), { recursive: true });
    const res = await fetch(`https://huggingface.co/${MODEL}/resolve/main/${f}`);
    if (!res.ok || !res.body) throw new Error(`Could not fetch ${f} of ${MODEL}: ${res.status}`);
    // Its own temporary name, so two builds at once do not trip on each other.
    const tmp = `${dst}.${process.pid}.${Date.now()}.part`;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    if (existsSync(dst)) rmSync(tmp);
    else renameSync(tmp, dst);
    console.log(`  speech model: ${f}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await ensureSpeechAssets(path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), ".."));
}
