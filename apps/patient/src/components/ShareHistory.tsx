/**
 * Giving a doctor fifteen minutes with this person's history.
 *
 * Two ways out of this sheet, and the difference between them is the whole
 * point:
 *
 *   The link — `parcha.web.app/prashant`, with a PIN, for fifteen minutes,
 *   and a Revoke button that takes it back. The summary is sealed on this
 *   phone with a key made from the PIN before it goes anywhere, so what the
 *   server holds is a box it cannot open. It is the only way to have a share
 *   that can be taken back, because a page already open on a doctor's phone
 *   cannot be reached from here.
 *
 *   The code — the whole summary inside a QR, read off this screen by the
 *   doctor's camera. Nothing is uploaded and no server is in the path at all,
 *   and so nothing can expire or be revoked either.
 *
 * Both are offered, the difference is said in plain words on the screen, and
 * the PIN is asked for before either one.
 */
import { call, errorMessage, useHistories } from "@parcha/client";
import {
  HISTORY_MEDICINE_MAX,
  HISTORY_NOTE_MAX,
  SHARE_LINK,
  SHARE_MAX_ATTEMPTS,
  SHARE_MINUTES,
  historyLink,
  lockHistory,
  recallAll,
  shareCountdown,
  shareUsername,
  type HistoryMedicine,
  type HistoryPayload,
  type MemoryParcha,
  type ShareState,
} from "@parcha/core";
import { Qr } from "@parcha/ui";
import { Copy, Loader2, QrCode, ShieldCheck, Trash2, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useHandset } from "../auth";
import { useNow } from "./alerts";
import { useT } from "../i18n";
import { PinPad } from "./pin";
import { Sheet } from "./records";
import type { Person } from "./people";

/** The summary, built from what this phone holds and nothing else. */
function build(
  person: Person,
  history: { conditions: string[]; allergies: string[]; medicines: string[]; bloodGroup: string | null } | null,
  parchas: MemoryParcha[],
  note: string,
): HistoryPayload {
  const medicines: HistoryMedicine[] = [];
  for (const m of recallAll(parchas)) {
    const { parcha, medicine } = m.latest;
    medicines.push({
      n: medicine.name,
      s: medicine.strength ?? null,
      f: medicine.form ?? null,
      q: medicine.frequency ?? null,
      d: medicine.durationDays ?? null,
      on: parcha.date,
      by: parcha.doctor ?? null,
      ...(parcha.certain ? { ok: 1 as const } : {}),
    });
    if (medicines.length >= HISTORY_MEDICINE_MAX) break;
  }
  return {
    v: 1,
    t: new Date().toISOString(),
    p: [person.shown, person.ageYears, person.sex],
    b: history?.bloodGroup ?? null,
    c: history?.conditions ?? [],
    a: history?.allergies ?? [],
    r: history?.medicines ?? [],
    m: medicines,
    note: note.trim() ? note.trim().slice(0, HISTORY_NOTE_MAX) : null,
  };
}

type Way = null | "link" | "code";

export function ShareHistory({ person, parchas, onClose }: { person: Person; parchas: MemoryParcha[]; onClose: () => void }) {
  const t = useT();
  const now = useNow(1000);
  const { handset } = useHandset();
  const histories = useHistories(handset?.phone ?? null);
  const history = histories.data.find((h) => h.personName === person.name) ?? null;

  const [note, setNote] = useState("");
  const [way, setWay] = useState<Way>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<ShareState | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const payload = useMemo(() => build(person, history, parchas, note), [person, history, parchas, note]);
  const online = navigator.onLine;

  /** A live link for this person from an earlier sheet, so Revoke is always reachable. */
  const refresh = useCallback(async () => {
    try {
      const r = await call<object, { shares: ShareState[] }>("myShares", {});
      setShare(r.shares.find((s) => s.person === person.name) ?? null);
    } catch {
      /* offline, or the server is away: the code below still works */
    }
  }, [person.name]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A share that has run out stops being shown the moment it does.
  useEffect(() => {
    if (share && shareCountdown(share.expiresAt, now) === "0:00") setShare(null);
  }, [share, now]);

  async function makeLink(pin: string) {
    setBusy(true);
    setError(null);
    try {
      // Sealed here, with a key made from the PIN. What leaves this phone
      // cannot be read by the server that keeps it.
      const username = shareUsername(person.shown);
      const sealed = await lockHistory(payload, pin, username);
      const made = await call<object, { username: string; expiresAt: string }>("shareHistory", {
        person: person.name,
        ...sealed,
      });
      // The name the server gave back may carry a number, if one was taken;
      // the key was made from the name we asked for, so a different one has to
      // be sealed again under its own name.
      if (made.username !== username) {
        const again = await lockHistory(payload, pin, made.username);
        await call("shareHistory", { person: person.name, ...again });
      }
      await refresh();
      setWay("link");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function makeCode(pin: string) {
    setBusy(true);
    setError(null);
    try {
      // The code carries the summary itself, so the PIN guards the drawing of
      // it on this screen rather than the opening of it on another.
      void pin;
      setQr(await historyLink(payload));
      setWay("code");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!share) return;
    setBusy(true);
    setError(null);
    try {
      await call("revokeShare", { username: share.username });
      setShare(null);
      setWay(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const url = share ? SHARE_LINK + share.username : null;

  return (
    <Sheet title={t("Show the doctor", "डॉक्टर को दिखाएँ", "Doctor ko dikhayein")} onClose={onClose}>
      <div className="space-y-4">
        {/* A link already open: the countdown and the way to take it back come first. */}
        {share && url ? (
          <section className="space-y-3 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] p-3.5">
            <p className="text-lg font-bold">{t("Open now", "अभी खुला है", "Abhi khula hai")}</p>
            <p className="rounded-xl border-2 border-[#232326] bg-white px-3 py-2 text-center text-xl font-bold break-all">{url}</p>
            <p className="text-center text-3xl font-bold tabular-nums">{shareCountdown(share.expiresAt, now)}</p>
            <p className="text-base">
              {share.opened
                ? t("The doctor has opened it.", "डॉक्टर ने खोल लिया है।", "Doctor ne khol liya hai.")
                : t("Not opened yet.", "अभी खोला नहीं गया।", "Abhi khola nahi gaya.")}
              {share.attempts > 0
                ? t(
                    ` ${SHARE_MAX_ATTEMPTS - share.attempts} PIN tries left.`,
                    ` ${SHARE_MAX_ATTEMPTS - share.attempts} PIN कोशिशें बची हैं।`,
                    ` ${SHARE_MAX_ATTEMPTS - share.attempts} PIN tries bachi hain.`,
                  )
                : ""}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => setCopied(false));
                }}
                className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-white text-base font-bold"
              >
                <Copy className="size-5" aria-hidden /> {copied ? t("Copied", "कॉपी हुआ", "Copy hua") : t("Copy", "कॉपी", "Copy")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void revoke()}
                className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-[oklch(0.94_0.05_25)] text-base font-bold disabled:opacity-40"
              >
                {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Trash2 className="size-5" aria-hidden />}
                {t("Revoke", "वापस लें", "Wapas lein")}
              </button>
            </div>
            <p className="text-sm">
              {t(
                "Revoke closes it at once, even if the doctor still has the page open.",
                "वापस लेते ही बंद हो जाएगा, चाहे डॉक्टर का पेज खुला ही क्यों न हो।",
                "Wapas lete hi band ho jayega, chahe doctor ka page khula hi kyon na ho.",
              )}
            </p>
          </section>
        ) : null}

        {/* The QR, once it has been asked for. */}
        {way === "code" && qr ? (
          <section className="space-y-2">
            <div className="flex justify-center rounded-2xl border-[3px] border-[#232326] bg-white p-3">
              <Qr text={qr} size={248} label={t("History code", "इतिहास का कोड", "History ka code")} />
            </div>
            <p className="text-base">
              {t(
                "Hold the phone up for the doctor's camera. This one needs no internet at all — and cannot be taken back.",
                "फ़ोन डॉक्टर के कैमरे के सामने रखें। इसमें इंटरनेट बिलकुल नहीं चाहिए — और इसे वापस नहीं लिया जा सकता।",
                "Phone doctor ke camera ke saamne rakhein. Ismein internet bilkul nahi chahiye — aur ise wapas nahi liya ja sakta.",
              )}
            </p>
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="text-base font-bold text-[#b3261e]">
            {error}
          </p>
        ) : null}

        {/* Choosing a way, and then the PIN. */}
        {way === null ? (
          <>
            <label className="block text-base font-bold" htmlFor="share-note">
              {t("Anything to tell the doctor?", "डॉक्टर को कुछ बताना है?", "Doctor ko kuch batana hai?")}
            </label>
            <textarea
              id="share-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={HISTORY_NOTE_MAX}
              rows={2}
              className="w-full rounded-2xl border-[3px] border-[#232326] bg-card p-3 text-lg"
            />

            <button
              type="button"
              disabled={!online || busy}
              onClick={() => setWay("link")}
              className="flex min-h-20 w-full items-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] p-3.5 text-left shadow-[0_4px_0_#232326] disabled:opacity-40"
            >
              <Wifi className="size-8 shrink-0" aria-hidden />
              <span>
                <span className="block text-lg leading-tight font-bold">
                  {t(`A link, for ${SHARE_MINUTES} minutes`, `${SHARE_MINUTES} मिनट के लिए एक लिंक`, `${SHARE_MINUTES} minute ke liye ek link`)}
                </span>
                <span className="block text-base">
                  {t("The doctor types a PIN. You can take it back.", "डॉक्टर PIN डालेंगे। आप वापस ले सकते हैं।", "Doctor PIN daalenge. Aap wapas le sakte hain.")}
                </span>
              </span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setWay("code")}
              className="flex min-h-20 w-full items-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-card p-3.5 text-left shadow-[0_4px_0_#232326] disabled:opacity-40"
            >
              <QrCode className="size-8 shrink-0" aria-hidden />
              <span>
                <span className="block text-lg leading-tight font-bold">{t("A code to scan", "स्कैन करने का कोड", "Scan karne ka code")}</span>
                <span className="block text-base">
                  {t("No internet, nothing uploaded. Cannot be taken back.", "इंटरनेट नहीं, कुछ अपलोड नहीं। वापस नहीं ले सकते।", "Internet nahi, kuch upload nahi. Wapas nahi le sakte.")}
                </span>
              </span>
            </button>

            {!online ? (
              <p className="flex items-start gap-2 text-base">
                <WifiOff className="mt-0.5 size-5 shrink-0" aria-hidden />
                {t(
                  "No connection, so the link cannot be made. The code works as it is.",
                  "कनेक्शन नहीं है, इसलिए लिंक नहीं बनेगा। कोड ऐसे ही काम करेगा।",
                  "Connection nahi hai, isliye link nahi banega. Code aise hi kaam karega.",
                )}
              </p>
            ) : null}
          </>
        ) : null}

        {/* The PIN: for the link it becomes the key, for the code it is the guard. */}
        {(way === "link" && !share) || (way === "code" && !qr) ? (
          busy ? (
            <p className="flex items-center justify-center gap-2 py-6 text-lg font-bold">
              <Loader2 className="size-6 animate-spin" aria-hidden /> {t("Sealing it…", "बंद किया जा रहा है…", "Seal kiya ja raha hai…")}
            </p>
          ) : (
            <PinPad
              title={t("Choose a PIN for this", "इसके लिए PIN चुनें", "Iske liye PIN chunein")}
              hint={
                way === "link"
                  ? t(
                      "Tell the doctor these four digits. They are the key: without them the link opens nothing, and nobody else holds them.",
                      "ये चार अंक डॉक्टर को बताएँ। यही चाबी है: इनके बिना लिंक कुछ नहीं खोलता, और किसी और के पास ये नहीं हैं।",
                      "Yeh chaar ank doctor ko batayein. Yahi chaabi hai: inke bina link kuch nahi kholta, aur kisi aur ke paas yeh nahi hain.",
                    )
                  : t(
                      "So the code is not drawn by somebody who picks up your phone.",
                      "ताकि आपका फ़ोन उठाने वाला कोई और कोड न बना ले।",
                      "Taki aapka phone uthane wala koi aur code na bana le.",
                    )
              }
              onDone={(pin) => void (way === "link" ? makeLink(pin) : makeCode(pin))}
              onCancel={() => setWay(null)}
            />
          )
        ) : null}

        <p className="flex items-start gap-2 text-sm">
          <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
          {t(
            `A link is sealed on this phone before it is sent, so Parcha's server keeps a box it cannot open. It closes itself after ${SHARE_MINUTES} minutes, and ${SHARE_MAX_ATTEMPTS} wrong PINs close it sooner. Four digits are not a password: the short window and the Revoke button are what protect this.`,
            `लिंक इसी फ़ोन पर बंद करके भेजा जाता है, इसलिए पर्चा के सर्वर के पास ऐसा बक्सा रहता है जिसे वह खोल नहीं सकता। ${SHARE_MINUTES} मिनट में अपने आप बंद, और ${SHARE_MAX_ATTEMPTS} ग़लत PIN पर उससे भी पहले। चार अंक पासवर्ड नहीं हैं: असली बचाव छोटी अवधि और वापस लेने का बटन है।`,
            `Link isi phone par seal karke bheja jaata hai, isliye Parcha ke server ke paas aisa box rehta hai jise woh khol nahi sakta. ${SHARE_MINUTES} minute mein apne aap band, aur ${SHARE_MAX_ATTEMPTS} galat PIN par usse bhi pehle. Chaar ank password nahi hain: asli bachav chhoti avadhi aur Revoke button hai.`,
          )}
        </p>
      </div>
    </Sheet>
  );
}
