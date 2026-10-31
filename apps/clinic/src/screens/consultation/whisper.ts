/**
 * Speech to text on this computer: Whisper, run in WebAssembly.
 *
 * Two sizes, and the computer decides. Base (about 76 MB) hears Indian English
 * dictation best; tiny (about 40 MB) is about twice as quick and a little less
 * sure. Whisper always works on a 30-second window, so a short sentence costs
 * nearly as much as a long one: the first time, base is timed on that window,
 * and a computer too slow for it uses tiny instead, from then on. Only the size
 * used is downloaded. Medicine names either mishears are put right by
 * soundsLike.ts in @parcha/core.
 *
 * The model and its runtime are served by the clinic app itself (public/asr,
 * see scripts/speech-assets.mjs), loaded the first time a doctor speaks and
 * then kept in the browser's cache, so it works offline and in the Windows
 * program. The audio never leaves the computer and nothing is kept: the words
 * go to the pad, the sound is dropped.
 */
export const MODELS = { accurate: "Xenova/whisper-base.en", quick: "Xenova/whisper-tiny.en" } as const;
export type ModelSize = keyof typeof MODELS;
const SIZE_KEY = "parcha.voice.model";
/** Longer than this for one pass of base, and the computer uses tiny. */
const TOO_SLOW_MS = 4000;
let size: ModelSize | null = null;

/** Which size this computer uses, once loaded. */
export const whisperSize = () => size;

type Transcriber = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;

let loading: Promise<Transcriber> | null = null;
let progress = 0;
const listeners = new Set<(p: number) => void>();

/** How far the first load has got, 0 to 1 (1 once ready). */
export const whisperProgress = () => progress;
export function onWhisperProgress(l: (p: number) => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Starts loading the model (once); resolves when it can transcribe. */
export function loadWhisper(): Promise<Transcriber> {
  loading ??= (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = "/asr/";
    env.useBrowserCache = true;
    // Built, the runtime loads from /asr/ort as it is, not rewritten into a blob: script, which the clinic's
    // security policy refuses. The dev server will not let code import from public/, so there the blob is used.
    env.useWasmCache = import.meta.env.DEV;
    const wasm = env.backends.onnx.wasm as { wasmPaths?: unknown; numThreads?: number };
    wasm.wasmPaths = { mjs: "/asr/ort/ort-wasm-simd-threaded.asyncify.mjs", wasm: "/asr/ort/ort-wasm-simd-threaded.asyncify.wasm" };
    // Several processor cores where the page is cross-origin isolated; one elsewhere, which needs nothing special.
    wasm.numThreads = globalThis.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
    const files = new Map<string, number>();
    // The processor, not the graphics chip: with these 8-bit files it is the quicker of the two.
    const make = (model: string) =>
      pipeline("automatic-speech-recognition", model, {
        dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
        device: "wasm",
        progress_callback: (p: { status: string; file?: string; progress?: number }) => {
          if (p.status === "progress" && p.file) {
            files.set(p.file, (p.progress ?? 0) / 100);
            const all = [...files.values()];
            progress = Math.min(0.99, all.reduce((a, b) => a + b, 0) / Math.max(all.length, 2));
            listeners.forEach((l) => l(progress));
          }
        },
      }) as unknown as Promise<Transcriber & { dispose?: () => Promise<void> }>;
    let chosen: ModelSize | null = null;
    try {
      const saved = localStorage.getItem(SIZE_KEY);
      if (saved === "accurate" || saved === "quick") chosen = saved;
    } catch {
      /* decided again below */
    }
    let run = await make(MODELS[chosen ?? "accurate"]);
    if (!chosen) {
      // One pass on a second of quiet sound costs what any short sentence will.
      const hum = new Float32Array(16000).map((_, i) => Math.sin(i / 7) * 0.05);
      const t = performance.now();
      await run(hum);
      chosen = performance.now() - t > TOO_SLOW_MS ? "quick" : "accurate";
      if (chosen === "quick") {
        await run.dispose?.();
        files.clear();
        run = await make(MODELS.quick);
      }
      try {
        localStorage.setItem(SIZE_KEY, chosen);
      } catch {
        /* timed again next time */
      }
    }
    size = chosen;
    progress = 1;
    listeners.forEach((l) => l(1));
    return run as unknown as Transcriber;
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** The words in a recording (16 kHz mono). */
export async function transcribe(audio: Float32Array): Promise<string> {
  // Silence, or a room's hum: Whisper would make up a word ("you"), so nothing is written.
  let loud = 0;
  for (let i = 0; i < audio.length; i += 160) {
    let sum = 0;
    for (let j = i; j < Math.min(i + 160, audio.length); j++) sum += audio[j] * audio[j];
    if (Math.sqrt(sum / 160) > 0.01) loud++;
  }
  if (loud < 15) return "";
  const run = await loadWhisper();
  const out =await run(audio, { chunk_length_s: 30, return_timestamps: false });
  const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
  // Whisper writes "[BLANK_AUDIO]" or "(music)" for silence.
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Records from the microphone at 16 kHz while held. `level` reports the voice
 * level for the marker; `stop` returns the recording. The sound is gathered on
 * the audio thread (public/capture-worklet.js), so none is lost while the page
 * is busy loading the model.
 */
export async function startRecording(level: (v: number) => void): Promise<{ stop: () => Promise<Float32Array>; cancel: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    await ctx.audioWorklet.addModule("/capture-worklet.js");
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw e;
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "parcha-capture");
  const chunks: Float32Array[] = [];
  let flushed: (() => void) | null = null;
  node.port.onmessage = (e: MessageEvent<Float32Array | "done">) => {
    if (e.data === "done") return flushed?.();
    const data = e.data;
    chunks.push(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] * data[i];
    level(Math.min(1, Math.sqrt(sum / (data.length / 4)) * 6));
  };
  source.connect(node);
  const close = () => {
    node.port.onmessage = null;
    node.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    level(0);
  };
  return {
    cancel: close,
    stop: async () => {
      // The last quarter second is still on the audio thread: ask for it.
      await Promise.race([new Promise<void>((r) => ((flushed = r), node.port.postMessage("flush"))), new Promise((r) => setTimeout(r, 500))]);
      close();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Float32Array(total);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    },
  };
}
