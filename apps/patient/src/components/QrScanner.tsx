/**
 * Reads a QR code with the phone's camera, or from a photo of one.
 *
 * jsQR runs on the phone on each video frame: nothing is sent anywhere. Where
 * the camera cannot be opened (no permission, a laptop without one), a photo
 * of the code works the same way.
 */
import jsQR from "jsqr";
import { Camera, ImageUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useT } from "../i18n";

function readImage(source: CanvasImageSource, w: number, h: number, canvas: HTMLCanvasElement): string | null {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  return jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
}

export function QrScanner({ onRead }: { onRead: (text: string) => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const [camera, setCamera] = useState<"starting" | "on" | "off">("starting");
  const [photoError, setPhotoError] = useState(false);
  const done = useRef(false);
  // Bumped by "Allow the camera", which asks the phone again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    setCamera("starting");
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        setCamera("on");
        const tick = () => {
          const v = video.current;
          if (!v || done.current) return;
          if (v.videoWidth) {
            const scale = Math.min(1, 720 / v.videoWidth);
            const text = readImage(v, Math.round(v.videoWidth * scale), Math.round(v.videoHeight * scale), canvas.current);
            if (text) {
              done.current = true;
              onRead(text);
              return;
            }
          }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch {
        setCamera("off");
      }
    })();
    return () => {
      window.clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [onRead, attempt]);

  async function fromPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(false);
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
    const text = readImage(img, Math.round(img.width * scale), Math.round(img.height * scale), canvas.current);
    if (text) onRead(text);
    else setPhotoError(true);
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-3xl border-[3px] border-[#232326] bg-[#232326]">
        <video ref={video} playsInline muted className="aspect-square w-full object-cover" />
        {camera === "on" ? (
          <div aria-hidden className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-lg font-bold text-white">
            <Camera className="size-10" aria-hidden />
            {camera === "starting"
              ? t("Opening the camera…", "कैमरा खुल रहा है…", "Camera khul raha hai…")
              : t("Parcha needs the camera to read the code.", "कोड पढ़ने के लिए पर्चा को कैमरा चाहिए।", "Code padhne ke liye Parcha ko camera chahiye.")}
            {camera === "off" ? (
              <>
                <button
                  type="button"
                  onClick={() => setAttempt((n) => n + 1)}
                  className="mt-1 min-h-12 rounded-2xl border-[3px] border-white bg-[var(--brand)] px-5 text-lg font-bold text-[#232326]"
                >
                  {t("Allow the camera", "कैमरा चालू करें", "Camera allow karein")}
                </button>
                <span className="text-base font-normal">
                  {t("If nothing asks, allow Camera for Parcha in the phone's settings.", "अगर कुछ न पूछे, तो फ़ोन की सेटिंग में Parcha के लिए कैमरा चालू करें।", "Agar kuch na poochhe, to phone ki settings mein Parcha ke liye Camera allow karein.")}
                </span>
              </>
            ) : null}
          </div>
        )}
      </div>
      <p className="text-center text-lg font-bold">
        {t("Point at the square code on your Parcha", "पर्चे पर बने चौकोर कोड की ओर रखें", "Parche par bane chaukor code ki taraf rakhein")}
      </p>
      <label className="hover-orange flex min-h-14 cursor-pointer items-center justify-center gap-2.5 rounded-2xl border-2 border-[var(--brand-deep)] bg-card px-4 text-lg font-bold">
        <ImageUp className="size-6" aria-hidden />
        {t("Use a photo of the code", "कोड की फ़ोटो लगाएँ", "Code ki photo lagaayein")}
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => void fromPhoto(e.target.files?.[0])} />
      </label>
      {photoError ? (
        <p role="alert" className="text-destructive text-lg font-bold">
          {t("No code found in that photo. Take it closer, with the whole square in view.", "उस फ़ोटो में कोड नहीं मिला। पास से लें, पूरा चौकोर दिखे।", "Us photo mein code nahi mila. Paas se lein, poora chaukor dikhe.")}
        </p>
      ) : null}
    </div>
  );
}
