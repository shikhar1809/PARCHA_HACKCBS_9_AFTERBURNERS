/**
 * Reading the printed words on a photo, on this phone.
 *
 * Tesseract (open source, in WebAssembly) runs in a worker inside the app. Its
 * engine and English model are served by the app itself (public/ocr), so the
 * photo is never sent anywhere, and nothing is stored: the words come back to
 * the screen that asked, and the worker is shut down after each photo. What
 * the words mean is decided by plain rules in @parcha/core (reading.ts), never
 * here.
 */
import { Capacitor } from "@capacitor/core";
import type { ReadLine } from "@parcha/core";

type Bbox = { x0: number; y0: number; x1: number; y1: number };
type TWord = { text: string; confidence: number; bbox: Bbox };
type TLine = { text: string; bbox: Bbox; words: TWord[] };
type TBlock = { paragraphs: { lines: TLine[] }[] };

/**
 * The lines of printed text on a picture (a data URL or a file), each with its
 * words, how sure the reader was of each, and where they are in pixels of the
 * picture as given. `onProgress` gets 0 to 1.
 */
export async function readText(picture: string | Blob, onProgress?: (done: number) => void): Promise<ReadLine[]> {
  const { createWorker, OEM } = await import("tesseract.js");
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    // The Android build unpacks .gz files when it packages the app, so there the
    // model is plain eng.traineddata; the web serves eng.traineddata.gz.
    gzip: !Capacitor.isNativePlatform(),
    workerBlobURL: false,
    // Nothing kept by the reader itself: the app's offline cache holds its files.
    cacheMethod: "none",
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(picture, {}, { blocks: true });
    const blocks = (data as unknown as { blocks: TBlock[] | null }).blocks ?? [];
    return blocks.flatMap((b) =>
      b.paragraphs.flatMap((p) =>
        p.lines.map((l) => ({
          text: l.text.trim(),
          box: l.bbox,
          words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, box: w.bbox })),
        })),
      ),
    );
  } finally {
    await worker.terminate();
  }
}
