/**
 * Photos of a medicine's strip, front and back.
 *
 * Older people know their tablets by the strip in their hand, not by a printed
 * name, so at dose time the app shows the strip they photographed. The
 * pictures are shrunk on the phone and kept in its encrypted store (the
 * vault); they are never uploaded.
 *
 * After the front is taken, the phone reads it and says whether the medicine's
 * name is printed there, with a box round the word, so a wrong strip is caught
 * before it becomes the picture at dose time. It only checks; it never picks.
 */
import { useFormulary, vaultGet, vaultPut } from "@parcha/client";
import { stripShows, type Finding } from "@parcha/core";
import { Camera, Check, Loader2, ScanText, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useT } from "../i18n";
import { PhotoCrop } from "./PhotoCrop";
import { readText } from "./readText";

export type Strip = { front?: string; back?: string };

const keyFor = (medicine: string) => `strip:${medicine.trim().toLowerCase()}`;
const listeners = new Set<() => void>();

/** A photo as a small JPEG data URL: about 60 KB, enough to recognise a strip. */
export async function shrinkPhoto(file: File, max = 640): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function useStrip(medicine: string | null | undefined): Strip | null {
  const [strip, setStrip] = useState<Strip | null>(null);
  useEffect(() => {
    if (!medicine) return;
    let live = true;
    const load = () => void vaultGet<Strip>(keyFor(medicine)).then((s) => live && setStrip(s ?? null));
    load();
    listeners.add(load);
    return () => {
      live = false;
      listeners.delete(load);
    };
  }, [medicine]);
  return strip;
}

export async function saveStripSide(medicine: string, side: "front" | "back", file: File) {
  const now = (await vaultGet<Strip>(keyFor(medicine))) ?? {};
  await vaultPut(keyFor(medicine), { ...now, [side]: await shrinkPhoto(file) });
  listeners.forEach((l) => l());
}

/** The two pictures, side by side, as big as the screen allows. */
export function StripPictures({ medicine, className }: { medicine: string; className?: string }) {
  const strip = useStrip(medicine);
  if (!strip?.front && !strip?.back) return null;
  return (
    <div className={`grid grid-cols-2 gap-2 ${className ?? ""}`}>
      {[strip.front, strip.back].map((src, i) =>
        src ? <img key={i} src={src} alt="" className="aspect-[4/3] w-full rounded-xl border-2 border-[#232326] object-cover" /> : <span key={i} />,
      )}
    </div>
  );
}

/** Two buttons that open the camera: the front of the strip, then the back. */
export function StripCapture({ medicine }: { medicine: string }) {
  const t = useT();
  const strip = useStrip(medicine);
  const [busy, setBusy] = useState<"front" | "back" | null>(null);
  const formulary = useFormulary();
  const drug = formulary.data.find((d) => d.genericName.toLowerCase() === medicine.trim().toLowerCase()) ?? null;
  // What the front of the strip says, read on the phone: kept on screen only.
  const [check, setCheck] = useState<{ state: "reading" | "done" | "failed"; picture?: string; size?: { w: number; h: number }; finding?: Finding | null } | null>(null);
  const take = useCallback(
    async (side: "front" | "back", file: File | undefined) => {
      if (!file) return;
      setBusy(side);
      try {
        await saveStripSide(medicine, side, file);
      } finally {
        setBusy(null);
      }
      if (side === "front" && drug) {
        setCheck({ state: "reading" });
        try {
          const picture = await shrinkPhoto(file, 1600);
          const img = await createImageBitmap(file);
          const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
          const finding = stripShows(await readText(picture), drug);
          setCheck({ state: "done", picture, size: { w: Math.round(img.width * scale), h: Math.round(img.height * scale) }, finding });
        } catch {
          setCheck({ state: "failed" });
        }
      }
    },
    [medicine, drug],
  );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {(["front", "back"] as const).map((side) => {
          const src = strip?.[side];
          return (
            <label
              key={side}
              className="hover-orange relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border-2 border-dashed border-[#232326] bg-white text-center text-base font-bold"
            >
              {src ? <img src={src} alt="" className="absolute inset-0 size-full object-cover" /> : null}
              <span className={src ? "relative rounded-full bg-white/90 px-2 py-0.5 text-sm" : "flex flex-col items-center gap-1"}>
                {src ? <Check className="mr-1 inline size-4" strokeWidth={3} aria-hidden /> : <Camera className="size-7" strokeWidth={2.2} aria-hidden />}
                {busy === side
                  ? t("Saving…", "रख रहे हैं…", "Rakh rahe hain…")
                  : side === "front"
                    ? t("Front of strip", "पत्ते का आगे", "Patte ka aage")
                    : t("Back of strip", "पत्ते का पीछे", "Patte ka peeche")}
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => void take(side, e.target.files?.[0])}
              />
            </label>
          );
        })}
      </div>
      {check?.state === "reading" ? (
        <p role="status" className="flex items-center gap-2 text-base font-bold">
          <Loader2 className="size-5 animate-spin" aria-hidden /> {t("Reading the strip on this phone…", "इसी फ़ोन पर पत्ता पढ़ रहे हैं…", "Isi phone par patta padh rahe hain…")}
        </p>
      ) : check?.state === "done" && check.finding ? (
        <div className="flex items-center gap-3 rounded-xl border-2 border-[#232326] bg-[#eafaf0] p-2">
          <PhotoCrop picture={check.picture!} size={check.size!} box={check.finding.box} tone={check.finding.sure ? "sure" : "check"} width={120} />
          <p className="text-base leading-snug">
            <ScanText className="mr-1 inline size-4 align-[-2px]" aria-hidden />
            {t(`The strip says ${check.finding.word}: ${medicine}.`, `पत्ते पर लिखा है ${check.finding.word}: ${medicine}।`, `Patte par likha hai ${check.finding.word}: ${medicine}.`)}
            {check.finding.sure ? null : <b> {t("Check it.", "एक बार देख लें।", "Ek baar dekh lein.")}</b>}
          </p>
        </div>
      ) : check?.state === "done" ? (
        <p className="flex items-start gap-2 rounded-xl border-2 border-[#232326] bg-[var(--morning-soft)] p-2 text-base leading-snug">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          {t(
            `${medicine} was not found on this photo. Check it is the right strip, or take the photo again closer.`,
            `इस फ़ोटो पर ${medicine} नहीं मिली। देख लें कि सही पत्ता है, या पास से फिर फ़ोटो लें।`,
            `Is photo par ${medicine} nahi mili. Dekh lein ki sahi patta hai, ya paas se phir photo lein.`,
          )}
        </p>
      ) : null}
    </div>
  );
}
