/**
 * The phone's half of "never assume" (the rule is packages/core/src/photoQuality.ts):
 * measure a photo here, and say plainly why one was refused.
 */
import { judgePixels, pixelStats, type PhotoProblem, type PhotoVerdict } from "@parcha/core";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "../i18n";

/** Judges a photo's pixels, at about 320 pixels wide. Never throws: a photo that cannot be measured is refused. */
export async function checkPhoto(picture: string | Blob): Promise<PhotoVerdict> {
  try {
    const img = await createImageBitmap(typeof picture === "string" ? await (await fetch(picture)).blob() : picture);
    const scale = Math.min(1, 320 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    const stats = pixelStats(ctx.getImageData(0, 0, w, h).data, w, h);
    // The size rule is about the photo as taken, not the measuring copy.
    return judgePixels({ ...stats, width: img.width, height: img.height });
  } catch {
    return { ok: false, problem: "unsure" };
  }
}

/** Why a photo was refused, and what to do, in the reader's language. */
export function PhotoRejected({ problem, what, children }: { problem: PhotoProblem; what: string; children?: ReactNode }) {
  const t = useT();
  const WHY: Record<PhotoProblem, [string, string, string]> = {
    too_small: ["The photo is too small to read.", "फ़ोटो पढ़ने के लिए बहुत छोटी है।", "Photo padhne ke liye bahut chhoti hai."],
    too_dark: ["The photo is too dark.", "फ़ोटो बहुत अँधेरी है।", "Photo bahut andheri hai."],
    too_bright: ["The photo is too bright, or has glare on it.", "फ़ोटो में बहुत रोशनी या चमक है।", "Photo mein bahut roshni ya chamak hai."],
    flat: ["Nothing can be seen on the photo.", "फ़ोटो में कुछ दिख नहीं रहा।", "Photo mein kuch dikh nahi raha."],
    blurry: ["The photo is blurred.", "फ़ोटो धुंधली है।", "Photo dhundhli hai."],
    no_text: ["No printed words could be found on it.", "इस पर कोई छपे शब्द नहीं मिले।", "Is par koi chhape shabd nahi mile."],
    unsure: ["The words on it could not be read clearly.", "इस पर लिखा साफ़ नहीं पढ़ा जा सका।", "Is par likha saaf nahi padha ja saka."],
  };
  return (
    <div role="alert" className="space-y-2.5 rounded-2xl border-[3px] border-[#232326] bg-[oklch(0.94_0.05_25)] p-4">
      <p className="flex items-start gap-2 text-lg leading-snug font-bold">
        <TriangleAlert className="mt-0.5 size-6 shrink-0" aria-hidden />
        <span>
          {t(...WHY[problem])}{" "}
          {t(`Nothing was read from this ${what}.`, `इस ${what} से कुछ नहीं पढ़ा गया।`, `Is ${what} se kuch nahi padha gaya.`)}
        </span>
      </p>
      <p className="text-base leading-snug">
        {t(
          "Take it again: flat on a table, in daylight, with the whole thing in the frame and the phone held still.",
          "फिर से लें: मेज़ पर सीधा रखकर, दिन की रोशनी में, पूरा फ़्रेम में, फ़ोन स्थिर रखकर।",
          "Phir se lein: mez par seedha rakhkar, din ki roshni mein, poora frame mein, phone sthir rakhkar.",
        )}
      </p>
      {children}
    </div>
  );
}
