import {
  deleteMyData,
  errorMessage,
  exportMyData,
  recordConsent,
  savePapersToDevice,
  setForcedOffline,
  useConsent,
  useDocuments,
  useOffline,
  usingEmulators,
  vaultClear,
  vaultStats,
} from "@parcha/client";
import { PRIVACY_POINTS, PRIVACY_VERSION } from "@parcha/core";
import { Eye, FolderLock, HardDrive, Loader2, PhoneCall, ShieldCheck, Trash2, WifiOff, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { demoHandsets, signOutOfPatient, useHandset } from "../auth";
import { DoctorArt } from "./art";
import { LangChoice, setLang, useLang, useT, type Lang } from "../i18n";
import { Sheet } from "./records";

const ICON: Record<string, LucideIcon> = { keep: FolderLock, see: Eye, calls: PhoneCall, own: ShieldCheck };

function Points({ lang }: { lang: Lang }) {
  return (
    <ul className="stagger space-y-2.5">
      {PRIVACY_POINTS.map((p) => {
        const Icon = ICON[p.icon] ?? ShieldCheck;
        return (
          <li key={p.icon} className="flex items-start gap-3 rounded-2xl border-[3px] border-[#232326] bg-card p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border-2 border-[#232326] bg-[var(--brand-soft)]">
              <Icon className="size-5" aria-hidden />
            </span>
            <p className="text-base leading-snug">{p[lang]}</p>
          </li>
        );
      })}
    </ul>
  );
}


/**
 * Nothing in the app opens until the current privacy notice has been agreed to.
 * The agreement is stored against the phone number with the notice's version,
 * so a changed notice asks again.
 */
export function ConsentGate({ children }: { children: ReactNode }) {
  const { handset } = useHandset();
  const consent = useConsent(handset?.phone ?? null);
  // The language chosen here is the phone's language from now on.
  const lang = useLang();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (consent.loading) return null;
  if (consent.data?.version === PRIVACY_VERSION) return <>{children}</>;

  async function agree() {
    setBusy(true);
    setError(null);
    try {
      await recordConsent(lang);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="page-in flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-5 pb-5">
      <div className="flex items-center gap-3">
        <DoctorArt size={64} />
        <div>
          <h1 className="text-2xl leading-tight font-bold">{t("Before you start", "शुरू करने से पहले", "Shuru karne se pehle")}</h1>
          <p className="text-base">{t("Your data, in your hands", "आपका डेटा, आपके हाथ में", "Aapka data, aapke haath mein")}</p>
        </div>
      </div>
      <div className="mt-3">
        <p className="mb-2 text-base font-bold">भाषा · Language · Bhasha</p>
        <LangChoice value={lang} onChange={(l) => setLang(l)} />
      </div>
      <div className="mt-3">
        <Points lang={lang} />
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-base font-bold text-[#b3261e]">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void agree()}
        className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-lg font-bold shadow-[0_4px_0_#232326]"
      >
        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
        {busy ? t("Saving…", "सहेज रहे हैं…", "Save ho raha hai…") : t("I agree, continue", "मैं सहमत हूँ, आगे बढ़ें", "Main sehmat hoon, aage badhein")}
      </button>
      <button type="button" onClick={() => void signOutOfPatient()} className="mt-2 min-h-12 text-center text-base font-bold underline">
        {t("I do not agree, sign out", "सहमत नहीं, साइन आउट", "Sehmat nahi, sign out")}
      </button>
    </div>
  );
}

/** The notice, to read again at any time. */
export function PrivacyNotice({ onClose }: { onClose: () => void }) {
  const lang = useLang();
  const t = useT();
  return (
    <Sheet title={t("Privacy", "निजता", "Privacy")} onClose={onClose}>
      <div className="space-y-3">
        <Points lang={lang} />
        <p className="text-sm">{t("Notice version", "सूचना संस्करण", "Notice version")} {PRIVACY_VERSION}.</p>
      </div>
    </Sheet>
  );
}

/** Download a copy of everything, or delete what you added. */
/** What this phone holds, and the controls for it. */
function OnDevice() {
  const t = useT();
  const { handset } = useHandset();
  const docs = useDocuments(handset?.phone ?? null);
  const offline = useOffline();
  const [stats, setStats] = useState<{ items: number; bytes: number; files: number } | null>(null);
  const [busy, setBusy] = useState<"papers" | "clear" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => void vaultStats().then(setStats);
  useEffect(refresh, []);

  async function savePapers() {
    setBusy("papers");
    setNote(null);
    const n = await savePapersToDevice(docs.data.map((d) => d.id));
    setNote(n === 0 ? t("All your papers are already on this phone.", "आपके सारे काग़ज़ पहले से इस फ़ोन पर हैं।", "Aapke saare papers pehle se is phone par hain.") : t(`Saved ${n} paper${n === 1 ? "" : "s"} on this phone.`, `${n} काग़ज़ इस फ़ोन पर सहेजे।`, `${n} paper is phone par save kiye.`));
    setBusy(null);
    refresh();
  }

  async function clear() {
    setBusy("clear");
    await vaultClear();
    setNote(t("This phone's copy was cleared. It fills up again as you use the app.", "इस फ़ोन की कॉपी मिटा दी गई। ऐप इस्तेमाल करने पर फिर भर जाएगी।", "Is phone ki copy mita di. App use karne par phir bhar jaayegi."));
    setBusy(null);
    refresh();
  }

  return (
    <div className="rounded-2xl border-[3px] border-[#232326] bg-card p-3">
      <p className="flex items-center gap-2 text-base font-bold">
        <HardDrive className="size-5" aria-hidden /> {t("Stored on this phone", "इस फ़ोन पर रखा है", "Is phone par rakha hai")}
      </p>
      <p className="mt-1 text-sm leading-snug">
        {t(
          "Your visits, prescriptions, reminders and papers are kept here too, locked with a key that never leaves the phone, so they open with no signal.",
          "आपकी यात्राएँ, पर्चियाँ, रिमाइंडर और काग़ज़ यहाँ भी रखे हैं, एक ऐसी चाबी से बंद जो फ़ोन से बाहर नहीं जाती, ताकि बिना सिग्नल के भी खुलें।",
          "Aapki visits, parchiyan, reminders aur papers yahan bhi rakhe hain, ek aisi chaabi se band jo phone se bahar nahi jaati, taaki bina signal ke bhi khulein.",
        )}
      </p>
      <p className="mt-1.5 text-sm font-bold">
        {stats ? t(`${stats.items} things saved · ${stats.files} paper${stats.files === 1 ? "" : "s"} · ${(stats.bytes / 1024).toFixed(0)} KB`, `${stats.items} चीज़ें · ${stats.files} काग़ज़ · ${(stats.bytes / 1024).toFixed(0)} KB`, `${stats.items} cheezein · ${stats.files} papers · ${(stats.bytes / 1024).toFixed(0)} KB`) : t("Counting…", "गिन रहे हैं…", "Gin rahe hain…")}
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy !== null || docs.data.length === 0}
          onClick={() => void savePapers()}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl border-[3px] border-[#232326] bg-[var(--brand-soft)] text-sm font-bold disabled:opacity-45"
        >
          {busy === "papers" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {t("Save all papers", "सारे काग़ज़ सहेजें", "Saare papers save karein")}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void clear()}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl border-[3px] border-[#232326] bg-card text-sm font-bold"
        >
          {busy === "clear" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {t("Clear this copy", "यह कॉपी मिटाएँ", "Yeh copy mitayein")}
        </button>
      </div>
      {note ? <p role="status" className="mt-2 text-sm font-bold">{note}</p> : null}
      {usingEmulators || demoHandsets ? (
        <button
          type="button"
          role="switch"
          aria-checked={offline}
          onClick={() => void setForcedOffline(!offline)}
          className={`mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border-[3px] border-dashed border-[#232326] text-sm font-bold ${offline ? "bg-[var(--morning-soft)]" : ""}`}
        >
          <WifiOff className="size-4" aria-hidden />
          {offline ? t("No connection (test) is on. Tap to go back online", "बिना इंटरनेट (जाँच) चालू है। वापस ऑनलाइन होने के लिए छुएँ", "Bina internet (test) chalu hai. Wapas online hone ke liye tap karein") : t("Try it with no connection", "बिना इंटरनेट आज़माएँ", "Bina internet try karein")}
        </button>
      ) : null}
    </div>
  );
}

export function MyData({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState<string | null>(null);

  async function download() {
    setBusy("export");
    setError(null);
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `parcha-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setDone(t("Your data was saved to your downloads.", "आपका डेटा डाउनलोड में सहेजा गया।", "Aapka data downloads mein save ho gaya."));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function erase() {
    setBusy("delete");
    setError(null);
    try {
      await deleteMyData();
      await vaultClear();
      await signOutOfPatient().catch(() => undefined);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <Sheet title={t("My data", "मेरा डेटा", "Mera data")} onClose={onClose}>
      <div className="space-y-4">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void download()}
          className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-lg font-bold shadow-[0_4px_0_#232326]"
        >
          {busy === "export" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <FolderLock className="size-5" aria-hidden />}
          {t("Download everything", "सब कुछ डाउनलोड करें", "Sab kuch download karein")}
        </button>
        {done ? <p role="status" className="text-base font-bold">{done}</p> : null}

        <OnDevice />

        <div className="rounded-2xl border-[3px] border-[#232326] bg-card p-3">
          <p className="flex items-center gap-2 text-base font-bold">
            <Trash2 className="size-5" aria-hidden /> {t("Delete my data", "मेरा डेटा मिटाएँ", "Mera data mitayein")}
          </p>
          <p className="mt-1 text-sm leading-snug">
            {t(
              "This deletes the papers, health notes, reminders, dose history and call settings you added, and closes your sign-in. It cannot be undone.",
              "इससे आपके जोड़े काग़ज़, स्वास्थ्य नोट, रिमाइंडर, दवा का इतिहास और कॉल की सेटिंग मिट जाएँगे और साइन इन बंद हो जाएगा। यह वापस नहीं होगा।",
              "Isse aapke jode papers, health notes, reminders, dawai ki history aur call settings mit jaayenge aur sign in band ho jaayega. Yeh wapas nahi hoga.",
            )}
          </p>
          <p className="mt-1 text-sm leading-snug">
            {t(
              "It does not delete the medical records a hospital made about your visits. A hospital must keep those, and we tell it you asked.",
              "अस्पताल ने आपकी यात्राओं के जो चिकित्सा रिकॉर्ड बनाए, वे नहीं मिटते। अस्पताल को उन्हें रखना होता है, और हम उसे बता देते हैं कि आपने कहा।",
              "Hospital ne aapki visits ke jo medical records banaye, woh nahi mitte. Hospital ko unhe rakhna hota hai, aur hum use bata dete hain ki aapne kaha.",
            )}
          </p>
          {confirming ? (
            <div className="pop mt-3 space-y-2">
              <label className="block text-sm font-bold">
                {t("Type DELETE to confirm", "पक्का करने के लिए DELETE लिखें", "Pakka karne ke liye DELETE likhein")}
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoCapitalize="characters"
                  className="mt-1 h-12 w-full rounded-xl border-[3px] border-[#232326] bg-white px-3 text-base outline-none focus:bg-[var(--hover-soft)]"
                />
              </label>
              <button
                type="button"
                disabled={typed !== "DELETE" || busy !== null}
                onClick={() => void erase()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-[oklch(0.82_0.14_25)] text-base font-bold shadow-[0_3px_0_#232326] disabled:opacity-45"
              >
                {busy === "delete" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Trash2 className="size-5" aria-hidden />}
                {t("Delete everything I added", "मेरा जोड़ा सब मिटाएँ", "Mera joda sab mitayein")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-[oklch(0.94_0.05_25)] text-base font-bold"
            >
              {t("Continue", "आगे", "Aage")}
            </button>
          )}
        </div>

        {error ? (
          <p role="alert" className="text-base font-bold text-[#b3261e]">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
