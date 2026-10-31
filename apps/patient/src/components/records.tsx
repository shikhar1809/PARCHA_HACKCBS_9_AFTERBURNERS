import { addDocument, deleteDocument, errorMessage, readDocumentFile } from "@parcha/client";
import type { DocKind, PatientDocument } from "@parcha/core";
import {
  Camera,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Paperclip,
  Pill,
  ScanLine,
  ShieldCheck,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { dateIn, useLang, useT, type T } from "../i18n";

export const KINDS: { id: DocKind; label: string; words: [string, string, string]; icon: LucideIcon }[] = [
  { id: "report", label: "Lab report", words: ["Lab report", "जाँच रिपोर्ट", "Test report"], icon: FileText },
  { id: "scan", label: "X-ray / scan", words: ["X-ray / scan", "एक्स-रे / स्कैन", "X-ray / scan"], icon: ScanLine },
  { id: "prescription", label: "Prescription", words: ["Prescription", "पर्ची", "Parchi"], icon: Pill },
  { id: "insurance", label: "Insurance", words: ["Insurance", "बीमा", "Insurance"], icon: ShieldCheck },
  { id: "other", label: "Other", words: ["Other", "अन्य", "Aur"], icon: Paperclip },
];

export const kindOf = (id: DocKind) => KINDS.find((k) => k.id === id) ?? KINDS[4];
/** A kind of paper, in the language in force. */
export const kindLabel = (t: T, id: DocKind | string) => t(...kindOf(id as DocKind).words);

/** A full-screen layer over the phone, for adding and viewing. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="sheet-in absolute inset-0 z-40 flex flex-col bg-[var(--color-background)]">
      <header className="flex shrink-0 items-center gap-3 px-4 pt-5 pb-3">
        <h2 className="min-w-0 flex-1 truncate text-[1.5rem] leading-tight font-bold">{title}</h2>
        <button
          type="button"
          aria-label={t("Close", "बंद करें", "Band karein")}
          onClick={onClose}
          className="flex size-12 shrink-0 items-center justify-center rounded-full border-[3px] border-[#232326] bg-card"
        >
          <X className="size-6" strokeWidth={2.6} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{children}</div>
    </div>
  );
}

/** Shrinks a photo so it is a few hundred kilobytes, not a few megabytes. */
async function shrinkImage(file: File): Promise<{ mime: string; data: string }> {
  const bitmap = await createImageBitmap(file);
  let side = 1600;
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.72 - attempt * 0.08);
    const data = url.slice(url.indexOf(",") + 1);
    if (data.length <= 900_000) return { mime: "image/jpeg", data };
    side = Math.round(side * 0.75);
  }
  throw new Error("That photo is too big even after shrinking. Try another.");
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("That file could not be read."));
    r.readAsDataURL(file);
  });
}

/** Add a paper: take a photo or choose a file, say what it is, save. */
export function AddDocument({ person, onClose }: { person: string; onClose: () => void }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<DocKind>("report");
  const [title, setTitle] = useState("");
  const [takenOn, setTakenOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<string | null>(null);

  useEffect(() => () => void (preview.current && URL.revokeObjectURL(preview.current)), []);

  function pick(f: File | undefined) {
    if (!f) return;
    setError(null);
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
    setFile(f);
  }

  async function save() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      let mime = file.type;
      let data: string;
      if (file.type === "application/pdf") {
        if (file.size > 650_000) throw new Error(t("That PDF is too big (0.6 MB at most). Take a photo of it instead.", "यह PDF बहुत बड़ी है (0.6 MB तक)। इसकी फ़ोटो ले लें।", "Yeh PDF bahut badi hai (0.6 MB tak). Iski photo le lein."));
        data = await toBase64(file);
      } else if (file.type.startsWith("image/")) {
        ({ mime, data } = await shrinkImage(file));
      } else {
        throw new Error(t("Add a photo or a PDF.", "फ़ोटो या PDF जोड़ें।", "Photo ya PDF jodein."));
      }
      await addDocument({
        personName: person,
        title: title.trim() || kindLabel(t, kind),
        kind,
        mime,
        data,
        takenOn: takenOn || null,
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Sheet title={t(`Add a paper for ${person.split(" ")[0]}`, `${person.split(" ")[0]} के लिए काग़ज़ जोड़ें`, `${person.split(" ")[0]} ke liye kagaz jodein`)} onClose={onClose}>
      <div className="space-y-4">
        {!file ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-[3px] border-[#232326] bg-[var(--brand)] text-xl font-bold shadow-[0_5px_0_#232326] active:translate-y-0.5">
              <Camera className="size-10" strokeWidth={2.3} aria-hidden />
              {t("Take a photo", "फ़ोटो लें", "Photo lein")}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-[3px] border-[#232326] bg-card text-xl font-bold shadow-[0_5px_0_#232326] active:translate-y-0.5">
              <FolderOpen className="size-10" strokeWidth={2.3} aria-hidden />
              {t("Choose a file", "फ़ाइल चुनें", "File chunein")}
              <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-card p-3">
            {preview.current ? (
              <img src={preview.current} alt="" className="size-16 rounded-lg border-2 border-[#232326] object-cover" />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-lg border-2 border-[#232326] bg-[var(--brand-soft)]">
                <FileText className="size-8" aria-hidden />
              </span>
            )}
            <p className="min-w-0 flex-1 truncate text-base font-bold">{file.name}</p>
            <button type="button" onClick={() => setFile(null)} className="min-h-12 text-base font-bold underline">
              {t("Change", "बदलें", "Badlein")}
            </button>
          </div>
        )}

        <div>
          <p className="mb-2 text-lg font-bold">{t("What is it?", "यह क्या है?", "Yeh kya hai?")}</p>
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map(({ id, words, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={kind === id}
                onClick={() => setKind(id)}
                className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-[3px] border-[#232326] px-1 text-center text-base leading-tight font-bold ${
                  kind === id ? "bg-[var(--brand-soft)] shadow-[0_3px_0_#232326]" : "bg-card"
                }`}
              >
                <Icon className="size-6" aria-hidden />
                {t(...words)}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-lg font-bold">{t("Name (optional)", "नाम (चाहें तो)", "Naam (chahein to)")}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder={kindLabel(t, kind)}
            className="h-14 w-full rounded-2xl border-[3px] border-[#232326] bg-card px-4 text-lg outline-none focus:bg-[var(--hover-soft)]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-lg font-bold">{t("Date on the paper (optional)", "काग़ज़ पर लिखी तारीख़ (चाहें तो)", "Kagaz par likhi tareekh (chahein to)")}</span>
          <input
            type="date"
            value={takenOn}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setTakenOn(e.target.value)}
            className="h-14 w-full rounded-2xl border-[3px] border-[#232326] bg-card px-4 text-lg outline-none focus:bg-[var(--hover-soft)]"
          />
        </label>

        {error ? (
          <p role="alert" className="text-lg font-bold text-[#b3261e]">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!file || busy}
          onClick={() => void save()}
          className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-xl font-bold shadow-[0_4px_0_#232326] active:translate-y-0.5 disabled:opacity-45"
        >
          {busy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : null}
          {busy ? t("Saving…", "सहेज रहे हैं…", "Save ho raha hai…") : t("Save", "सहेजें", "Save karein")}
        </button>
      </div>
    </Sheet>
  );
}

/** Opens one paper full size, with save-to-phone and delete. */
export function ViewDocument({ doc, onClose }: { doc: PatientDocument; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    readDocumentFile(doc.id, doc.mime)
      .then(async (dataUrl) => {
        // A blob URL, so a PDF can be shown in a frame under a strict policy.
        const blob = await (await fetch(dataUrl)).blob();
        url = URL.createObjectURL(blob);
        if (live) setSrc(url);
      })
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc.id, doc.mime]);

  async function remove() {
    setBusy(true);
    try {
      await deleteDocument(doc.id);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const ext = doc.mime === "application/pdf" ? "pdf" : doc.mime.split("/")[1];
  return (
    <Sheet title={doc.title} onClose={onClose}>
      <p className="mb-3 text-base">
        {kindLabel(t, doc.kind)} · {doc.personName}
        {doc.takenOn ? ` · ${dateIn(lang, doc.takenOn)}` : t(` · added ${dateIn(lang, doc.createdAt)}`, ` · ${dateIn(lang, doc.createdAt)} को जोड़ा`, ` · ${dateIn(lang, doc.createdAt)} ko joda`)}
      </p>
      <div className="overflow-hidden rounded-2xl border-[3px] border-[#232326] bg-card">
        {error ? (
          <p role="alert" className="p-4 text-lg font-bold text-[#b3261e]">
            {error}
          </p>
        ) : !src ? (
          <div className="skeleton h-64" role="status" aria-label={t("Opening", "खुल रहा है", "Khul raha hai")} />
        ) : doc.mime === "application/pdf" ? (
          <iframe title={doc.title} src={src} className="h-[26rem] w-full" />
        ) : (
          <img src={src} alt={doc.title} className="w-full" />
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {src ? (
          <a
            href={src}
            download={`${doc.title.replace(/[^\w-]+/g, "_")}.${ext}`}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-card text-lg font-bold shadow-[0_3px_0_#232326]"
          >
            <Download className="size-5" aria-hidden /> {t("Save", "सहेजें", "Save karein")}
          </a>
        ) : (
          <span />
        )}
        {confirm ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[oklch(0.82_0.14_25)] text-lg font-bold shadow-[0_3px_0_#232326]"
          >
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Trash2 className="size-5" aria-hidden />} {t("Yes, delete", "हाँ, मिटाएँ", "Haan, mitayein")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[oklch(0.94_0.05_25)] text-lg font-bold shadow-[0_3px_0_#232326]"
          >
            <Trash2 className="size-5" aria-hidden /> {t("Delete", "मिटाएँ", "Mitayein")}
          </button>
        )}
      </div>
    </Sheet>
  );
}
