/**
 * The backup, as the family meets it: checked once on the way up, and managed
 * from My data.
 *
 * At start-up this does one thing and does it quietly: if the device holds a
 * backup newer than what is on the phone, it offers to put it back. It never
 * restores by itself. A phone that was wiped and reinstalled is the case this
 * exists for, and in that case the offer is the first thing the family sees;
 * a phone with its data intact is not interrupted, because its own copy is
 * the newer one and there is nothing to say.
 *
 * Making one needs the PIN, and the PIN is the only way back into it. That is
 * said on the screen before the backup is made, not after, because a sealed
 * file nobody can open is worse than no file at all.
 *
 * All of it works with no connection. The parts that come from the database
 * are read through the cache the app is already running on, so a backup made
 * on a phone with no signal holds exactly what that phone was showing.
 */
import {
  backupFileName,
  isBackupFile,
  type BackupContents,
  type BackupFile,
} from "@parcha/core";
import {
  makeBackup,
  readBackup,
  readDeviceFile,
  restoreVault,
  touchedAt,
  useDocuments,
  useHistories,
  useProfiles,
  useReminders,
} from "@parcha/client";
import { backupIsNewer } from "@parcha/core";
import { Check, Download, HardDriveDownload, Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useHandset } from "../auth";
import { dateIn, useLang, useT } from "../i18n";
import { PinPad } from "./pin";
import { Sheet } from "./records";

/**
 * The phone's own records, for the backup to gather. They are read from the
 * same hooks the screens use, so whatever the app can show, the backup holds.
 */
function useReader() {
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const profiles = useProfiles(phone);
  const reminders = useReminders(phone);
  const histories = useHistories(phone);
  const documents = useDocuments(phone);
  return useCallback(
    async (collection: string): Promise<unknown[]> => {
      switch (collection) {
        case "profiles":
          return profiles.data;
        case "reminders":
          return reminders.data;
        case "histories":
          return histories.data;
        case "documents":
          return documents.data;
        default:
          // Dose ticks are per day and live in the cache the Medicines tab
          // reads; nothing is fetched here to make a backup.
          return [];
      }
    },
    [profiles.data, reminders.data, histories.data, documents.data],
  );
}

/**
 * The one check at start-up. It asks, and only asks, when the device's backup
 * is newer than the phone's own data — which is what a fresh install looks
 * like from here.
 */
export function BackupCheck() {
  const t = useT();
  const lang = useLang();
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const read = useReader();

  const [found, setFound] = useState<BackupFile | null>(null);
  const [asked, setAsked] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    if (!phone || asked) return;
    let live = true;
    void (async () => {
      const [file, touched] = await Promise.all([readDeviceFile(phone), touchedAt()]);
      if (!live || !file || !backupIsNewer(file, touched)) return;
      setFound(file);
    })();
    return () => {
      live = false;
    };
  }, [phone, asked]);

  async function restore(pin: string) {
    if (!found) return;
    setBusy(true);
    setPinError(null);
    try {
      const contents = await readBackup(found, pin);
      if (!contents) {
        setPinError(t("That PIN does not open this backup.", "यह PIN इस बैकअप को नहीं खोलता।", "Yeh PIN is backup ko nahi kholta."));
        return;
      }
      setDone(await restoreVault(contents));
    } finally {
      setBusy(false);
    }
  }

  if (!found) return null;

  return (
    <Sheet
      title={t("A backup is on this phone", "इस फ़ोन पर बैकअप है", "Is phone par backup hai")}
      onClose={() => {
        setFound(null);
        setAsked(true);
      }}
    >
      {done !== null ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-lg font-bold">
            <Check className="size-6" aria-hidden /> {t("Put back.", "वापस आ गया।", "Wapas aa gaya.")}
          </p>
          <p className="text-base">
            {t(
              `${found.counts.parchas} Parchas are on this phone again.`,
              `${found.counts.parchas} पर्चे फिर से इस फ़ोन पर हैं।`,
              `${found.counts.parchas} Parche phir se is phone par hain.`,
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setFound(null);
              setAsked(true);
              window.location.reload();
            }}
            className="min-h-14 w-full rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-lg font-bold"
          >
            {t("Open Parcha", "पर्चा खोलें", "Parcha kholein")}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-base">
            {t(
              `Made ${dateIn(lang, found.madeAt)}, and newer than what is on this phone. It holds ${found.counts.parchas} Parchas, ${found.counts.people} people and ${found.counts.reminders} reminders. Type the PIN it was made with to put it back.`,
              `${dateIn(lang, found.madeAt)} को बना, और इस फ़ोन पर जो है उससे नया है। इसमें ${found.counts.parchas} पर्चे, ${found.counts.people} लोग और ${found.counts.reminders} रिमाइंडर हैं। वापस लाने के लिए वही PIN डालें।`,
              `${dateIn(lang, found.madeAt)} ko bana, aur is phone par jo hai usse naya hai. Ismein ${found.counts.parchas} Parche, ${found.counts.people} log aur ${found.counts.reminders} reminders hain. Wapas laane ke liye wahi PIN daalein.`,
            )}
          </p>
          {busy ? (
            <p className="flex items-center justify-center gap-2 py-6 text-lg font-bold">
              <Loader2 className="size-6 animate-spin" aria-hidden /> {t("Putting it back…", "वापस लाया जा रहा है…", "Wapas laya ja raha hai…")}
            </p>
          ) : (
            <PinPad
              title={t("The backup's PIN", "बैकअप का PIN", "Backup ka PIN")}
              onDone={(pin) => void restore(pin)}
              onCancel={() => {
                setFound(null);
                setAsked(true);
              }}
              error={pinError}
            />
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Making a backup, saving a copy of it, and putting one back by hand. */
export function BackupControls() {
  const t = useT();
  const lang = useLang();
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const read = useReader();

  const [file, setFile] = useState<BackupFile | null>(null);
  const [asking, setAsking] = useState<null | "make" | "restore">(null);
  const [picked, setPicked] = useState<BackupFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    if (phone) void readDeviceFile(phone).then(setFile);
  }, [phone]);

  async function make(pin: string) {
    if (!phone) return;
    setBusy(true);
    setPinError(null);
    try {
      const made = await makeBackup(phone, pin, read);
      if (!made) {
        setNote(t("This phone would not keep a backup.", "यह फ़ोन बैकअप नहीं रख सका।", "Yeh phone backup nahi rakh saka."));
        return;
      }
      setFile(made);
      setAsking(null);
      setNote(t("Backup made.", "बैकअप बन गया।", "Backup ban gaya."));
    } finally {
      setBusy(false);
    }
  }

  /** The same bytes as a file of their own: the copy that survives a reinstall. */
  function saveACopy() {
    if (!file || !phone) return;
    const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = backupFileName(phone, new Date(file.madeAt));
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  async function pick(f: File) {
    setNote(null);
    try {
      const parsed: unknown = JSON.parse(await f.text());
      if (!isBackupFile(parsed)) {
        setNote(t("That is not a Parcha backup.", "यह पर्चा का बैकअप नहीं है।", "Yeh Parcha ka backup nahi hai."));
        return;
      }
      if (parsed.phone !== phone) {
        setNote(t("That backup belongs to another phone number.", "वह बैकअप किसी और नंबर का है।", "Woh backup kisi aur number ka hai."));
        return;
      }
      setPicked(parsed);
      setAsking("restore");
    } catch {
      setNote(t("That file could not be read.", "यह फ़ाइल पढ़ी नहीं जा सकी।", "Yeh file padhi nahi ja saki."));
    }
  }

  async function putBack(pin: string) {
    const from: BackupFile | null = picked ?? file;
    if (!from) return;
    setBusy(true);
    setPinError(null);
    try {
      const contents: BackupContents | null = await readBackup(from, pin);
      if (!contents) {
        setPinError(t("That PIN does not open this backup.", "यह PIN इस बैकअप को नहीं खोलता।", "Yeh PIN is backup ko nahi kholta."));
        return;
      }
      const put = await restoreVault(contents);
      setAsking(null);
      setPicked(null);
      setNote(t(`${put} things put back.`, `${put} चीज़ें वापस आईं।`, `${put} cheezein wapas aayin.`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border-[3px] border-[#232326] bg-card p-3.5">
      <p className="flex items-center gap-2 text-lg font-bold">
        <HardDriveDownload className="size-6" aria-hidden /> {t("Backup on this phone", "इस फ़ोन पर बैकअप", "Is phone par backup")}
      </p>
      <p className="text-base">
        {file
          ? t(
              `Last made ${dateIn(lang, file.madeAt)}: ${file.counts.parchas} Parchas, ${file.counts.people} people, ${file.counts.reminders} reminders.`,
              `आख़िरी बार ${dateIn(lang, file.madeAt)}: ${file.counts.parchas} पर्चे, ${file.counts.people} लोग, ${file.counts.reminders} रिमाइंडर।`,
              `Aakhri baar ${dateIn(lang, file.madeAt)}: ${file.counts.parchas} Parche, ${file.counts.people} log, ${file.counts.reminders} reminders.`,
            )
          : t(
              "No backup yet. Everything you have is on this phone only, so a lost phone loses it.",
              "अभी कोई बैकअप नहीं। आपका सब कुछ सिर्फ़ इसी फ़ोन पर है, फ़ोन गया तो सब गया।",
              "Abhi koi backup nahi. Aapka sab kuch sirf isi phone par hai, phone gaya to sab gaya.",
            )}
      </p>

      {note ? (
        <p role="status" className="rounded-xl border-2 border-[#232326] bg-[var(--morning-soft)] p-2.5 text-base font-bold">
          {note}
        </p>
      ) : null}

      {asking ? (
        busy ? (
          <p className="flex items-center justify-center gap-2 py-6 text-lg font-bold">
            <Loader2 className="size-6 animate-spin" aria-hidden /> {t("Working…", "हो रहा है…", "Ho raha hai…")}
          </p>
        ) : (
          <PinPad
            title={asking === "make" ? t("Choose a PIN for the backup", "बैकअप के लिए PIN चुनें", "Backup ke liye PIN chunein") : t("The backup's PIN", "बैकअप का PIN", "Backup ka PIN")}
            hint={
              asking === "make"
                ? t(
                    "Remember these four digits. They are the only way back into this backup — nobody, Parcha included, can open it without them.",
                    "ये चार अंक याद रखें। बैकअप खोलने का यही एक रास्ता है — पर्चा भी इनके बिना नहीं खोल सकता।",
                    "Yeh chaar ank yaad rakhein. Backup kholne ka yahi ek raasta hai — Parcha bhi inke bina nahi khol sakta.",
                  )
                : undefined
            }
            onDone={(pin) => void (asking === "make" ? make(pin) : putBack(pin))}
            onCancel={() => {
              setAsking(null);
              setPicked(null);
            }}
            error={pinError}
          />
        )
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setNote(null);
              setAsking("make");
            }}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-[var(--brand)] text-base font-bold"
          >
            <HardDriveDownload className="size-5" aria-hidden /> {t("Back up now", "अभी बैकअप लें", "Abhi backup lein")}
          </button>
          <button
            type="button"
            disabled={!file}
            onClick={saveACopy}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-card text-base font-bold disabled:opacity-40"
          >
            <Download className="size-5" aria-hidden /> {t("Save a copy", "कॉपी सहेजें", "Copy save karein")}
          </button>
          <label className="col-span-2 flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-card text-base font-bold">
            <Upload className="size-5" aria-hidden /> {t("Put a backup back", "बैकअप वापस लाएँ", "Backup wapas laayein")}
            <input
              type="file"
              accept=".parcha,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pick(f);
              }}
            />
          </label>
        </div>
      )}

      <p className="text-sm">
        {t(
          "The backup is sealed with your PIN before it is written, and it never leaves this phone unless you save a copy yourself. Keep that copy somewhere safe: it is what moves your Parchas to a new phone.",
          "बैकअप आपके PIN से बंद करके लिखा जाता है, और जब तक आप ख़ुद कॉपी न सहेजें, यह फ़ोन से बाहर नहीं जाता। उस कॉपी को सँभालकर रखें: नए फ़ोन पर पर्चे वही ले जाएगी।",
          "Backup aapke PIN se seal karke likha jaata hai, aur jab tak aap khud copy save na karein, yeh phone se bahar nahi jaata. Us copy ko sambhaalkar rakhein: naye phone par Parche wahi le jayegi.",
        )}
      </p>
    </section>
  );
}
