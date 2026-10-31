import { clearCallNumber, confirmCallNumber, errorMessage, startCallNumberVerification } from "@parcha/client";
import { Check, Loader2, PhoneCall } from "lucide-react";
import { useState } from "react";

import { useT } from "../i18n";
import type { Person } from "./people";

const field =
  "min-h-12 w-full rounded-xl border-[3px] border-[#232326] bg-white px-3 text-base outline-none focus:bg-[var(--hover-soft)]";

/**
 * Lets reminder calls for one person go to their own phone. A call reads a code
 * to the number, and typing it back proves it is theirs; until then calls keep
 * going to the number this account signed in with.
 */
export function CallNumber({ person }: { person: Person }) {
  const t = useT();
  const first = person.shown.split(" ")[0];
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<null | { demoCode?: string }>(null);
  const [busy, setBusy] = useState<null | "send" | "confirm" | "clear">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const verified = (person.callNumberVerified && person.callNumber) || null;

  async function send() {
    setBusy("send");
    setError(null);
    try {
      setSent(await startCallNumberVerification(person.name, number));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    setBusy("confirm");
    setError(null);
    try {
      await confirmCallNumber(person.name, code);
      setDone(true);
      setSent(null);
      setNumber("");
      setCode("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setError(null);
    try {
      await clearCallNumber(person.name);
      setDone(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border-[3px] border-[#232326] bg-card p-3">
      <p className="flex items-center gap-2 text-base leading-tight font-bold">
        <PhoneCall className="size-5" aria-hidden /> {t("Reminder calls on their own phone", "उनके अपने फ़ोन पर याद की कॉल", "Unke apne phone par reminder call")}
      </p>

      {verified || done ? (
        <div className="mt-2 space-y-2">
          <p className="flex items-center gap-2 text-base">
            <Check className="size-5 shrink-0 text-[#2e9e5b]" strokeWidth={3.4} aria-hidden />
            <span>
              {t(`Calls for ${first} go to`, `${first} की कॉल यहाँ जाती हैं:`, `${first} ki call yahan jaati hain:`)} <b>{verified ? `+91 ${verified}` : t("their number", "उनका नंबर", "unka number")}</b>
            </span>
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void clear()}
            className="min-h-12 w-full rounded-xl border-[3px] border-[#232326] bg-card text-base font-bold"
          >
            {busy === "clear" ? <Loader2 className="mx-auto size-4 animate-spin" aria-hidden /> : t("Use my number instead", "मेरा नंबर इस्तेमाल करें", "Mera number use karein")}
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-base leading-snug">
            {t(
              `If ${first} has a phone, their reminder calls can ring there. We call that number and read a code; you type it here to prove it is theirs.`,
              `अगर ${first} के पास फ़ोन है, तो याद की कॉल वहाँ बज सकती है। हम उस नंबर पर कॉल करके एक कोड बोलेंगे; आप उसे यहाँ लिखें।`,
              `Agar ${first} ke paas phone hai, toh reminder call wahan baj sakti hai. Hum us number par call karke ek code bolenge; aap use yahan likhein.`,
            )}
          </p>
          {!sent ? (
            <>
              <input value={number} inputMode="tel" onChange={(e) => setNumber(e.target.value)} placeholder={t("Their 10-digit number", "उनका 10 अंकों का नंबर", "Unka 10 digit ka number")} aria-label={t("Their phone number", "उनका फ़ोन नंबर", "Unka phone number")} className={field} />
              <button
                type="button"
                disabled={busy !== null || number.replace(/\D/g, "").length < 10}
                onClick={() => void send()}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-[var(--brand)] text-base font-bold shadow-[0_3px_0_#232326] disabled:opacity-45"
              >
                {busy === "send" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {t("Call them with a code", "कोड वाली कॉल करें", "Code wali call karein")}
              </button>
            </>
          ) : (
            <>
              <p className="text-base font-bold">
                {t("A call is on its way to", "इस नंबर पर कॉल जा रही है:", "Is number par call ja rahi hai:")} +91 {number.replace(/\D/g, "").slice(-10)}
              </p>
              {sent.demoCode ? <p className="rounded-xl border-2 border-dashed border-[#232326] p-2 text-base">{t("Demo phone line: the code is", "डेमो फ़ोन लाइन: कोड है", "Demo phone line: code hai")} <b>{sent.demoCode}</b></p> : null}
              <input value={code} inputMode="numeric" maxLength={4} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder={t("4-digit code", "4 अंकों का कोड", "4 digit ka code")} aria-label={t("Code", "कोड", "Code")} className={`${field} text-center text-xl font-bold`} />
              <button
                type="button"
                disabled={busy !== null || code.length !== 4}
                onClick={() => void confirm()}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-[var(--brand)] text-base font-bold shadow-[0_3px_0_#232326] disabled:opacity-45"
              >
                {busy === "confirm" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {t("Confirm", "पक्का करें", "Pakka karein")}
              </button>
              <button type="button" onClick={() => setSent(null)} className="min-h-11 w-full text-center text-base font-bold underline">
                {t("Use a different number", "दूसरा नंबर डालें", "Doosra number daalein")}
              </button>
            </>
          )}
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-bold text-[#b3261e]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
