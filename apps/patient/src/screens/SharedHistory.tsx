/**
 * What a doctor sees at `parcha.web.app/prashant`.
 *
 * No sign-in, because a doctor has no account here and should not need one.
 * The page asks the server for the sealed box, asks for the PIN the family
 * read out, and opens it on this device — the key never goes back over the
 * wire. A wrong PIN opens nothing (AES refuses rather than returning rubbish),
 * and the server counts the tries; five and the link is finished.
 *
 * Everything shown here is `HistoryView`, the same screen the scanned QR
 * opens, so a doctor reads one page whichever way the family handed it over,
 * with the same labels saying which medicine came off a signed Parcha and
 * which the family typed in.
 */
import { call, errorMessage } from "@parcha/client";
import { SHARE_MAX_ATTEMPTS, shareCountdown, unlockHistory, usableUsername, type HistoryPayload } from "@parcha/core";
import { Screen } from "@parcha/ui";
import { Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { useNow } from "../components/alerts";
import { PinPad } from "../components/pin";
import { useT } from "../i18n";
import { Header } from "../kit";
import { HistoryPage } from "./HistoryView";

type Sealed = { person: string; blob: string; salt: string; iv: string; expiresAt: string; attemptsLeft: number };

export function SharedHistory({ username }: { username: string }) {
  const t = useT();
  const now = useNow(1000);
  const [pinError, setPinError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sealed, setSealed] = useState<Sealed | null>(null);
  const [opened, setOpened] = useState<HistoryPayload | null>(null);

  // Asked before the PIN pad is drawn, so a link the family has already taken
  // back says so at once rather than after four digits are typed into it.
  // This costs no attempt.
  useEffect(() => {
    if (!usableUsername(username)) {
      setError(t("That is not a Parcha link.", "यह पर्चा का लिंक नहीं है।", "Yeh Parcha ka link nahi hai."));
      return;
    }
    let live = true;
    void call<{ username: string }, { open: boolean }>("shareIsOpen", { username })
      .then((r) => {
        if (live && !r.open) {
          setError(t("This link is closed. Ask the family to share it again.", "यह लिंक बंद है। परिवार से दोबारा भेजने को कहें।", "Yeh link band hai. Family se dobara bhejne ko kahein."));
        }
      })
      .catch(() => {
        /* no answer: the PIN below still says so when it is tried */
      });
    return () => {
      live = false;
    };
  }, [username, t]);

  // Once the window closes, the page closes with it, open or not.
  useEffect(() => {
    if (sealed && shareCountdown(sealed.expiresAt, now) === "0:00") {
      setSealed(null);
      setOpened(null);
      setError(t("The fifteen minutes are up.", "पंद्रह मिनट पूरे हो गए।", "Pandrah minute poore ho gaye."));
    }
  }, [sealed, now, t]);

  async function tryPin(pin: string) {
    setBusy(true);
    setPinError(null);
    setError(null);
    try {
      // Fetched fresh on every try, so a revoke made a second ago is honoured
      // and the server gets to count this attempt.
      const got = await call<{ username: string; pin: string }, Sealed>("openShare", { username, pin });
      const payload = await unlockHistory(got, pin, username);
      if (!payload) {
        setSealed(null);
        setPinError(
          got.attemptsLeft > 0
            ? t(
                `Wrong PIN. ${got.attemptsLeft} ${got.attemptsLeft === 1 ? "try" : "tries"} left.`,
                `ग़लत PIN। ${got.attemptsLeft} कोशिश बची।`,
                `Galat PIN. ${got.attemptsLeft} tries bachi.`,
              )
            : t("Wrong PIN. This link is now closed.", "ग़लत PIN। यह लिंक अब बंद है।", "Galat PIN. Yeh link ab band hai."),
        );
        // The server is told, so a link out of tries is deleted rather than
        // sitting there until the window closes.
        if (got.attemptsLeft <= 0) await call("reportShareFailure", { username }).catch(() => {});
        return;
      }
      setSealed(got);
      setOpened(payload);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (opened && sealed) {
    return (
      <>
        {/* However long is left, at the top where a doctor cannot miss it. */}
        <p className="flex shrink-0 items-center justify-center gap-2 border-b-[3px] border-[#232326] bg-[var(--brand)] px-4 py-2 text-base font-bold">
          {t(
            `Shared by the family · closes in ${shareCountdown(sealed.expiresAt, now)}`,
            `परिवार ने दिखाया · ${shareCountdown(sealed.expiresAt, now)} में बंद`,
            `Family ne dikhaya · ${shareCountdown(sealed.expiresAt, now)} mein band`,
          )}
        </p>
        <HistoryPage payload={opened} />
      </>
    );
  }

  return (
    <>
      <Header title={t("Parcha", "पर्चा", "Parcha")} subtitle={`parcha.web.app/${username}`} />
      <Screen className="space-y-4 px-4 pt-3 pb-5">
        {error ? (
          <p role="alert" className="rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-3.5 text-lg">
            {error}
          </p>
        ) : (
          <>
            <p className="text-lg">
              {t(
                "A family has shared a patient's history with you. Ask them for the four digits.",
                "एक परिवार ने आपको मरीज़ का इतिहास दिखाया है। उनसे चार अंक पूछ लें।",
                "Ek family ne aapko mareez ki history dikhayi hai. Unse chaar ank poochh lein.",
              )}
            </p>
            {busy ? (
              <p className="flex items-center justify-center gap-2 py-8 text-lg font-bold">
                <Loader2 className="size-6 animate-spin" aria-hidden /> {t("Opening…", "खोला जा रहा है…", "Khola ja raha hai…")}
              </p>
            ) : (
              <PinPad
                title={t("The PIN they told you", "उन्होंने जो PIN बताया", "Unhone jo PIN bataya")}
                onDone={(pin) => void tryPin(pin)}
                error={pinError}
              />
            )}
            <p className="flex items-start gap-2 text-sm">
              <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
              {t(
                `${SHARE_MAX_ATTEMPTS} wrong PINs close this link. It is opened on this device: the PIN is not sent anywhere.`,
                `${SHARE_MAX_ATTEMPTS} ग़लत PIN पर यह लिंक बंद हो जाएगा। यह इसी डिवाइस पर खुलता है: PIN कहीं नहीं भेजा जाता।`,
                `${SHARE_MAX_ATTEMPTS} galat PIN par yeh link band ho jayega. Yeh isi device par khulta hai: PIN kahin nahi bheja jaata.`,
              )}
            </p>
          </>
        )}
      </Screen>
    </>
  );
}
