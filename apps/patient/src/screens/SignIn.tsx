import { errorMessage, takeSessionEndedNotice, usingEmulators } from "@parcha/client";
import { Screen, Wordmark } from "@parcha/ui";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { ConfirmationResult } from "firebase/auth";

import { DEMO_PHONES, demoHandsets, demoSignIn, emulatorCodeFor, sendCode } from "../auth";
import { LangChoice, setLang, useLang, useT } from "../i18n";
import { BigButton } from "../kit";

export function SignIn() {
  const t = useT();
  const lang = useLang();
  // The demo build starts with the family phone filled in: one tap on Continue.
  const [phone, setPhone] = useState(demoHandsets ? DEMO_PHONES[0].phone : "");
  const [pending, setPending] = useState<ConfirmationResult | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // Read once: if a session ended by itself, say so, so it never feels random.
  const [error, setError] = useState<string | null>(() => takeSessionEndedNotice());

  const valid = /^\d{10}$/.test(phone);

  async function requestCode(number: string) {
    setError(null);
    setBusy(true);
    try {
      // A demo handset on a live project: straight in, no SMS. Where the
      // project cannot do that, the usual code sign-in below takes over.
      if (demoHandsets && !usingEmulators && DEMO_PHONES.some((d) => d.phone === number)) {
        const ok = await demoSignIn(number).then(
          () => true,
          () => false,
        );
        if (ok) return;
      }
      const result = await sendCode(number);
      setPending(result);
      // Emulator convenience: fill the code in so the demo is one tap.
      const known = await emulatorCodeFor(number);
      if (known) setCode(known);
    } catch (e) {
      const text = errorMessage(e);
      setError(
        /operation-not-allowed/.test(text)
          ? demoHandsets
            ? DEMO_PHONES.some((d) => d.phone === number)
              ? t(
                  "This sample cannot sign phones in yet: SMS sign-in is off on this project.",
                  "यह नमूना अभी फ़ोन से साइन इन नहीं कर सकता: इस प्रोजेक्ट पर SMS से साइन इन बंद है।",
                  "Yeh sample abhi phone se sign in nahi kar sakta: is project par SMS sign-in band hai.",
                )
              : t(
                  "Sign-in by SMS is not switched on yet. Use the demo number below.",
                  "SMS से साइन इन अभी चालू नहीं है। नीचे का डेमो नंबर इस्तेमाल करें।",
                  "SMS se sign in abhi chalu nahi hai. Neeche ka demo number use karein.",
                )
            : t("Sign-in by SMS is not switched on for this app yet.", "इस ऐप पर SMS से साइन इन अभी चालू नहीं है।", "Is app par SMS se sign in abhi chalu nahi hai.")
          : text,
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setError(null);
    setBusy(true);
    try {
      await pending.confirm(code);
    } catch {
      setError(t("That code did not match. Check it and try again.", "यह कोड नहीं मिला। देखकर फिर से डालें।", "Yeh code match nahi hua. Dekh kar phir se daalein."));
      setBusy(false);
    }
  }

  return (
    <Screen className="flex flex-col">
      <div className="px-6 pt-10 pb-4 text-[var(--brand-deep)]">
        <h1 className="text-6xl">
          <Wordmark />
        </h1>
        <p className="mt-5 max-w-72 text-lg leading-snug">
          {t("Your prescriptions and clinic visits, in one place.", "आपकी पर्चियाँ और डॉक्टर के पास की यात्राएँ, एक जगह।", "Aapki parchiyan aur doctor visits, ek jagah.")}
        </p>
      </div>

      <div className="flex-1 space-y-5 px-5 pt-2 pb-8">
        {/* The language comes first: everything after it is read in it. */}
        <div>
          <p className="mb-2 text-base font-bold">भाषा · Language · Bhasha</p>
          <LangChoice value={lang} onChange={(l) => setLang(l)} />
        </div>

        {!pending ? (
          <>
            <label className="block text-lg font-bold">
              {t("Your mobile number", "आपका मोबाइल नंबर", "Aapka mobile number")}
              <div className="bg-card mt-2 flex items-center rounded-2xl border-2 border-[var(--color-input)] px-4 focus-within:border-[var(--brand)]">
                <span className="text-muted-foreground pr-2 text-xl font-bold">+91</span>
                <input
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder={t("10-digit number", "10 अंकों का नंबर", "10 digit ka number")}
                  className="h-16 w-full bg-transparent text-2xl font-bold tabular-nums outline-none placeholder:text-base placeholder:font-normal"
                />
              </div>
            </label>

            <BigButton disabled={!valid || busy} onClick={() => void requestCode(phone)}>
              {busy ? <Loader2 className="size-6 animate-spin" /> : t("Send me a code", "मुझे कोड भेजें", "Mujhe code bhejein")}
            </BigButton>

            {/* The seeded demo handsets: on the emulator, and on a live demo project. */}
            {demoHandsets ? (
              <div className="space-y-2.5 pt-3">
                <p className="text-muted-foreground text-base font-bold">
                  {t("Demo: the family phone, already filled in above", "डेमो: परिवार का फ़ोन, ऊपर भरा हुआ", "Demo: parivaar ka phone, upar bhara hua")}
                </p>
                <p className="text-muted-foreground text-sm leading-snug">
                  {t(
                    "Sample data: the people and visits here are made up. You can ask the real hospitals on the map for a visit, but nobody there sees it: it is a demo.",
                    "नमूना डेटा: यहाँ के लोग और यात्राएँ बनावटी हैं। नक़्शे के असली अस्पतालों से विज़िट माँग सकते हैं, पर वहाँ कोई उसे नहीं देखता: यह डेमो है।",
                    "Sample data: yahan ke log aur visits banawati hain. Map ke asli hospitals se visit maang sakte hain, par wahan koi use nahi dekhta: yeh demo hai.",
                  )}
                </p>
                {DEMO_PHONES.map((d) => (
                  <button
                    key={d.phone}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setPhone(d.phone);
                      void requestCode(d.phone);
                    }}
                    className="bg-card border-border w-full rounded-2xl border px-4 py-3.5 text-left active:bg-[var(--brand-soft)] disabled:opacity-60"
                  >
                    <span className="block text-xl font-bold tabular-nums">{d.phone}</span>
                    <span className="text-muted-foreground block text-base">{t(d.note.en, d.note.hi, d.note.hg)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <label className="block text-lg font-bold">
              {t(`Code sent to +91 ${phone}`, `+91 ${phone} पर कोड भेजा`, `+91 ${phone} par code bheja`)}
              <input
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="bg-card mt-2 h-20 w-full rounded-2xl border-2 border-[var(--color-input)] px-4 text-center text-4xl font-bold tracking-[0.3em] tabular-nums outline-none focus:border-[var(--brand)]"
              />
            </label>
            <BigButton disabled={code.length < 6 || busy} onClick={() => void confirm()}>
              {busy ? <Loader2 className="size-6 animate-spin" /> : t("Open my records", "मेरे काग़ज़ खोलें", "Mere records kholein")}
            </BigButton>
            <button
              type="button"
              onClick={() => {
                setPending(null);
                setCode("");
                setError(null);
              }}
              className="text-muted-foreground w-full py-3 text-lg font-bold"
            >
              {t("Use a different number", "दूसरा नंबर डालें", "Doosra number daalein")}
            </button>
          </>
        )}

        {error ? (
          <p role="alert" className="text-destructive text-lg font-bold">
            {error}
          </p>
        ) : null}
        <div id="recaptcha-anchor" />
      </div>
    </Screen>
  );
}
