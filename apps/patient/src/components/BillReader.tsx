/**
 * "Read the bill on this phone": the medicine names printed on a pharmacy bill,
 * found and shown, for the person to add one by one.
 *
 * Explainable by design: every name found has a numbered box on the photo
 * round the exact word it came from, and a sentence saying why it counts
 * ("DOLO" is Dolo 650, a brand of Paracetamol), with anything less than an
 * exact, clear reading marked "Check". Nothing is added until the person taps
 * Add, nothing is suggested that is not printed on the bill, and the photo is
 * read on the phone and kept nowhere new.
 *
 * The same reader reads a printed Parcha whose code would not scan; then the
 * line each name was found on goes with it, so the times printed beside the
 * name can be filled in (and are still confirmed by the person).
 */
import { judgeReading, medicinesIn, type Drug, type Finding, type PhotoProblem } from "@parcha/core";
import { cn } from "@parcha/ui";
import { Check, Loader2, ScanText, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "../i18n";
import { checkPhoto, PhotoRejected } from "./photoCheck";
import { PhotoCrop } from "./PhotoCrop";
import { readText } from "./readText";

export function BillReader({
  picture,
  drugs,
  added,
  onAdd,
  paper = "bill",
  onRetake,
}: {
  picture: string;
  drugs: Drug[];
  added: string[];
  onAdd: (drug: Drug, finding: Finding) => void;
  /** What is in the photo, for the words on screen. */
  paper?: "bill" | "parcha";
  /** Throws this photo away so another can be taken. */
  onRetake?: () => void;
}) {
  const t = useT();
  const parcha = paper === "parcha";
  const [state, setState] = useState<"idle" | "reading" | "done" | "failed" | "rejected">("idle");
  const [problem, setProblem] = useState<PhotoProblem | null>(null);
  const [progress, setProgress] = useState(0);
  const [found, setFound] = useState<Finding[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // A new photo starts over.
  useEffect(() => {
    setState("idle");
    setFound([]);
    setDropped([]);
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = picture;
  }, [picture]);

  /**
   * Refused before reading if the photo is not clear, and refused after if the
   * reader was not sure of what it read. A refused photo shows nothing found
   * on it, not even the names the reader was sure of: half a bill looks
   * exactly like a whole one.
   */
  async function read() {
    setState("reading");
    setProgress(0);
    setProblem(null);
    try {
      const pixels = await checkPhoto(picture);
      if (!pixels.ok) {
        setProblem(pixels.problem);
        setState("rejected");
        return;
      }
      const lines = await readText(picture, setProgress);
      const reading = judgeReading(lines);
      if (!reading.ok) {
        setProblem(reading.problem);
        setState("rejected");
        return;
      }
      setFound(medicinesIn(lines, drugs));
      setState("done");
    } catch {
      setState("failed");
    }
  }

  if (state === "rejected" && problem) {
    return (
      <PhotoRejected problem={problem} what={parcha ? t("photo of the Parcha", "पर्चे की फ़ोटो", "parche ki photo") : t("photo of the bill", "बिल की फ़ोटो", "bill ki photo")}>
        {onRetake ? (
          <button type="button" onClick={onRetake} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-white text-lg font-bold shadow-[0_3px_0_#232326]">
            {t("Take the photo again", "फिर से फ़ोटो लें", "Phir se photo lein")}
          </button>
        ) : null}
        <p className="text-base">{t("Or add the medicines by searching below.", "या नीचे खोजकर दवा जोड़ें।", "Ya neeche khojkar dawa jodein.")}</p>
      </PhotoRejected>
    );
  }

  const shown = found.filter((f) => !dropped.includes(f.drug.id));

  if (state === "idle" || state === "failed") {
    return (
      <div className="space-y-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-4">
        <button type="button" onClick={() => void read()} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-white text-lg font-bold shadow-[0_3px_0_#232326]">
          <ScanText className="size-6" aria-hidden />
          {parcha ? t("Read the Parcha on this phone", "इसी फ़ोन पर पर्चा पढ़ें", "Isi phone par Parcha padhein") : t("Read the bill on this phone", "इसी फ़ोन पर बिल पढ़ें", "Isi phone par bill padhein")}
        </button>
        <p className="text-base leading-snug">
          {t(
            "It finds the printed medicine names and shows where each one is. The photo stays on this phone. You check and add each one.",
            "छपे दवा के नाम ढूँढकर दिखाता है कि हर नाम कहाँ है। फ़ोटो इसी फ़ोन में रहती है। हर नाम आप देखकर जोड़ते हैं।",
            "Chhape dawa ke naam dhoondhkar dikhata hai ki har naam kahan hai. Photo isi phone mein rehti hai. Har naam aap dekhkar jodte hain.",
          )}
        </p>
        {state === "failed" ? (
          <p role="alert" className="text-destructive text-base font-bold">
            {t("The bill could not be read. Add the medicines by searching below.", "बिल नहीं पढ़ पाए। नीचे खोजकर दवा जोड़ें।", "Bill nahi padh paaye. Neeche khojkar dawa jodein.")}
          </p>
        ) : null}
      </div>
    );
  }

  if (state === "reading") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-4 text-lg font-bold">
        <Loader2 className="size-6 animate-spin" aria-hidden />
        {parcha ? t("Reading the Parcha…", "पर्चा पढ़ रहे हैं…", "Parcha padh rahe hain…") : t("Reading the bill…", "बिल पढ़ रहे हैं…", "Bill padh rahe hain…")} {Math.round(progress * 100)}%
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border-[3px] border-[#232326] bg-white p-3">
      <p className="flex items-center gap-2 text-base font-bold">
        <ScanText className="size-5 shrink-0" aria-hidden />
        {shown.length
          ? t(`Found ${shown.length} on the bill. Check each against the photo.`, `बिल पर ${shown.length} मिलीं। हर एक को फ़ोटो से मिलाएँ।`, `Bill par ${shown.length} mili. Har ek ko photo se milaayein.`)
          : t("No medicine names found on the bill. Add them by searching below.", "बिल पर कोई दवा का नाम नहीं मिला। नीचे खोजकर जोड़ें।", "Bill par koi dawa ka naam nahi mila. Neeche khojkar jodein.")}
      </p>

      {/* The bill, with a numbered box round each word that was read as a medicine. */}
      <div className="relative overflow-hidden rounded-xl border-2 border-[#232326]">
        <img src={picture} alt={t("The pharmacy bill", "दवा का बिल", "Dawa ka bill")} className="block w-full" />
        {size
          ? shown.map((f, i) => (
              <span
                key={f.drug.id}
                aria-hidden
                className={cn("absolute rounded-sm border-2", f.sure ? "border-[#2f9e5b]" : "border-[#f5a524]")}
                style={{
                  // A little larger than the word, so the box frames it instead of covering it.
                  left: `calc(${(f.box.x0 / size.w) * 100}% - 3px)`,
                  top: `calc(${(f.box.y0 / size.h) * 100}% - 3px)`,
                  width: `calc(${((f.box.x1 - f.box.x0) / size.w) * 100}% + 6px)`,
                  height: `calc(${((f.box.y1 - f.box.y0) / size.h) * 100}% + 6px)`,
                }}
              >
                {/* The number sits to the left of the word, off the letters. */}
                <span className={cn("absolute top-1/2 -left-6 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#232326] text-[0.7rem] font-bold", f.sure ? "bg-[#c9f2d8]" : "bg-[var(--morning-soft)]")}>{i + 1}</span>
              </span>
            ))
          : null}
      </div>

      <ul className="space-y-2">
        {shown.map((f, i) => {
          const isAdded = added.includes(f.drug.id);
          return (
            <li key={f.drug.id} className={cn("rounded-xl border-2 border-[#232326] p-3", f.sure ? "bg-[#eafaf0]" : "bg-[var(--morning-soft)]")}>
              <div className="flex items-start gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-[#232326] bg-white text-sm font-bold">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-lg leading-tight font-bold">
                    {f.drug.genericName}
                    {f.strength ? <span className="font-normal"> {f.strength}</span> : null}
                    <span className={cn("ml-2 rounded-full border-2 border-[#232326] px-2 align-middle text-xs", f.sure ? "bg-[#c9f2d8]" : "bg-white")}>
                      {f.sure ? t("Read clearly", "साफ़ पढ़ा", "Saaf padha") : t("Check", "जाँचें", "Jaanchein")}
                    </span>
                  </p>
                  {size ? <PhotoCrop picture={picture} size={size} box={f.box} tone={f.sure ? "sure" : "check"} width={180} /> : null}
                  <p className="text-sm leading-snug">{f.why}</p>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={isAdded}
                  onClick={() => onAdd(f.drug, f)}
                  className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border-[3px] border-[#232326] bg-[var(--brand)] text-base font-bold disabled:bg-white"
                >
                  <Check className="size-4" strokeWidth={3} aria-hidden /> {isAdded ? t("Added", "जुड़ गई", "Jud gayi") : t("Add", "जोड़ें", "Jodein")}
                </button>
                {!isAdded ? (
                  <button type="button" onClick={() => setDropped([...dropped, f.drug.id])} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border-2 border-[#232326] bg-white px-3 text-base font-bold">
                    <X className="size-4" aria-hidden /> {t("Not this", "यह नहीं", "Yeh nahi")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-sm">
        {t("Read by this phone, not by a person: it can miss a name. Anything missing, search below.", "यह फ़ोन ने पढ़ा है, किसी इंसान ने नहीं: कोई नाम छूट सकता है। जो छूटे, नीचे खोजें।", "Yeh phone ne padha hai, kisi insaan ne nahi: koi naam chhoot sakta hai. Jo chhoote, neeche khojein.")}
      </p>
    </div>
  );
}
