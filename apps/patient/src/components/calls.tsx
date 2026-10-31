import {
  errorMessage,
  requestTestCall,
  saveCallSettings,
  simulateCallOutcome,
  useCallJobs,
  useCallSettings,
} from "@parcha/client";
import { CALL_CONSENT, DEFAULT_CALL_SETTINGS, type CallJob, type CallLanguage } from "@parcha/core";
import { Check, Loader2, PhoneCall, PhoneMissed, PhoneOff, Voicemail } from "lucide-react";
import { useState } from "react";

import { useHandset } from "../auth";
import { usePeople } from "./people";
import { Sheet } from "./records";
import { clockIn, speechLang, useLang, useT } from "../i18n";

const OUTCOME: Record<string, { label: [string, string, string]; icon: typeof Check }> = {
  taken: { label: ["Taken", "ले ली", "Le li"], icon: Check },
  snoozed: { label: ["Asked to call again", "फिर कॉल करने को कहा", "Phir call karne ko kaha"], icon: PhoneCall },
  no_answer: { label: ["No answer", "किसी ने नहीं उठाया", "Kisi ne nahi uthaya"], icon: PhoneMissed },
  no_input: { label: ["Hung up", "फ़ोन काट दिया", "Phone kaat diya"], icon: PhoneOff },
  failed: { label: ["Could not call", "कॉल नहीं हो सकी", "Call nahi ho saki"], icon: PhoneOff },
};

const field =
  "min-h-12 w-full rounded-xl border-[3px] border-[#232326] bg-card px-3 text-base outline-none focus:bg-[var(--hover-soft)]";

function CallRow({ job, demo }: { job: CallJob; demo: boolean }) {
  const t = useT();
  const lang = useLang();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ringing = job.status === "ringing" || job.status === "queued";
  const out = job.outcome ? OUTCOME[job.outcome] : null;
  const Icon = out?.icon ?? PhoneCall;

  async function press(p: "1" | "2" | "none") {
    setBusy(p);
    setError(null);
    try {
      await simulateCallOutcome(job.id, p);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-2xl border-[3px] border-[#232326] bg-card p-3 shadow-[0_3px_0_#232326]">
      <div className="flex items-start gap-2.5">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl border-2 border-[#232326] ${job.outcome === "taken" ? "bg-[var(--brand-soft)]" : "bg-white"}`}>
          {ringing ? <PhoneCall className="size-5 animate-pulse" aria-hidden /> : <Icon className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base leading-tight font-bold">
            {job.doses.length === 0 ? t("Test call", "जाँच कॉल", "Test call") : job.doses.map((d) => d.title).join(", ")}
          </p>
          <p className="text-base">
            {clockIn(lang, job.time)}
            {job.attempt > 1 ? t(" · second try", " · दूसरी बार", " · doosri baar") : ""} · {ringing ? t("Ringing…", "घंटी बज रही है…", "Ghanti baj rahi hai…") : out ? t(...out.label) : t("Done", "हो गया", "Ho gaya")}
          </p>
        </div>
      </div>
      {ringing && demo ? (
        <div className="mt-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold">
            <Voicemail className="size-4" aria-hidden /> {t("Sample phone line: what you would press", "नमूना फ़ोन लाइन: आप क्या दबाते", "Sample phone line: aap kya dabaate")}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {([["1", t("1  Taken", "1  ले ली", "1  Le li")], ["2", t("2  Later", "2  बाद में", "2  Baad mein")], ["none", t("No answer", "नहीं उठाया", "Nahi uthaya")]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                disabled={busy !== null}
                onClick={() => void press(k)}
                className="flex min-h-12 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-[var(--brand)] text-base font-bold"
              >
                {busy === k ? <Loader2 className="size-4 animate-spin" aria-hidden /> : label}
              </button>
            ))}
          </div>
          {error ? <p role="alert" className="mt-1.5 text-sm font-bold text-[#b3261e]">{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

/** Switch on phone calls, say what language and when not to ring, and see the calls made. */
export function CallReminders({ onClose }: { onClose: () => void }) {
  const t = useT();
  const appLang = useLang();
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const settings = useCallSettings(phone);
  const jobs = useCallJobs(phone);
  // Someone who cannot hear is never phoned; their reminders flash and vibrate instead.
  const deaf = usePeople().people.filter((p) => p.access.deaf);
  const s = settings.data;

  const [consenting, setConsenting] = useState(false);
  const [lang, setLang] = useState<CallLanguage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // A call is spoken in Hindi or English; Hinglish readers get it in Hindi to begin with.
  const language = lang ?? s?.language ?? (s ? DEFAULT_CALL_SETTINGS.language : speechLang(appLang));
  const quietStart = s?.quietStart ?? DEFAULT_CALL_SETTINGS.quietStart;
  const quietEnd = s?.quietEnd ?? DEFAULT_CALL_SETTINGS.quietEnd;

  async function save(patch: Partial<{ enabled: boolean; language: CallLanguage; quietStart: string; quietEnd: string; consent: boolean }>) {
    setBusy(true);
    setError(null);
    try {
      await saveCallSettings({ enabled: s?.enabled ?? false, language, quietStart, quietEnd, ...patch });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    setError(null);
    try {
      await requestTestCall();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  }

  const enabled = s?.enabled === true;

  return (
    <Sheet title={t("Phone call reminders", "फ़ोन कॉल से याद", "Phone call reminders")} onClose={onClose}>
      <div className="space-y-4">
        {deaf.length ? (
          <p className="rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-3 text-base leading-snug">
            {t(
              `No calls for ${deaf.map((p) => p.shown).join(" and ")}: marked as not able to hear, so their reminders flash and vibrate on the phone instead.`,
              `${deaf.map((p) => p.shown).join(" और ")} को कॉल नहीं होगी: वे सुन नहीं सकते, इसलिए उनके रिमाइंडर फ़ोन पर चमकेंगे और काँपेंगे।`,
              `${deaf.map((p) => p.shown).join(" aur ")} ko call nahi hogi: woh sun nahi sakte, isliye unke reminders phone par chamkenge aur vibrate karenge.`,
            )}
          </p>
        ) : null}
        <div className="flex items-start gap-3 rounded-2xl border-[3px] border-[#232326] bg-card p-3 shadow-[0_3px_0_#232326]">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border-2 border-[#232326] bg-[var(--brand-soft)]">
            <PhoneCall className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base leading-tight font-bold">{t("Call me when it is time", "समय होने पर मुझे कॉल करें", "Time hone par mujhe call karein")}</p>
            <p className="text-base leading-snug">
              {t(
                `A short call to +91 ${phone}, at the time of each medicine. Press 1 if you took it.`,
                `हर दवा के समय +91 ${phone} पर छोटी सी कॉल। दवा ले ली हो तो 1 दबाएँ।`,
                `Har dawai ke time +91 ${phone} par chhoti si call. Dawai le li ho to 1 dabayein.`,
              )}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t("Phone calls", "फ़ोन कॉल", "Phone calls")}
            disabled={busy || settings.loading}
            onClick={() => (enabled ? void save({ enabled: false }) : s?.consentAt ? void save({ enabled: true }) : setConsenting(true))}
            className={`relative h-8 w-14 shrink-0 rounded-full border-[3px] border-[#232326] ${enabled ? "bg-[var(--brand)]" : "bg-white"}`}
          >
            <span
              className="absolute top-0.5 size-5 rounded-full border-2 border-[#232326] bg-white"
              style={{ left: enabled ? "1.6rem" : "0.15rem", transition: "left 200ms var(--ease-spring)" }}
            />
          </button>
        </div>

        {consenting ? (
          <div className="pop space-y-2.5 rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-3">
            <p className="text-base leading-snug font-bold">{CALL_CONSENT[language]}</p>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConsenting(false)}
                className="min-h-12 rounded-xl border-[3px] border-[#232326] bg-card text-base font-bold"
              >
                {t("Not now", "अभी नहीं", "Abhi nahi")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void save({ enabled: true, consent: true }).then(() => setConsenting(false))}
                className="min-h-12 rounded-xl border-[3px] border-[#232326] bg-[var(--brand)] text-base font-bold shadow-[0_3px_0_#232326]"
              >
                {t("I agree", "मैं सहमत हूँ", "Main sehmat hoon")}
              </button>
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-1.5 text-base font-bold">{t("Language of the call", "कॉल की भाषा", "Call ki bhasha")}</p>
          <div className="grid grid-cols-2 gap-2">
            {([["hi", "हिन्दी"], ["en", "English"]] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={language === id}
                onClick={() => {
                  setLang(id);
                  if (s) void save({ language: id });
                }}
                className={`h-12 rounded-xl border-[3px] border-[#232326] text-lg font-bold ${language === id ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-base font-bold">{t("Do not call between", "इस समय के बीच कॉल न करें", "Is time ke beech call na karein")}</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="time" aria-label={t("Quiet from", "कब से नहीं", "Kab se nahi")} value={quietStart} onChange={(e) => s && void save({ quietStart: e.target.value })} className={field} />
            <input type="time" aria-label={t("Quiet until", "कब तक नहीं", "Kab tak nahi")} value={quietEnd} onChange={(e) => s && void save({ quietEnd: e.target.value })} className={field} />
          </div>
        </div>

        {enabled ? (
          <button
            type="button"
            disabled={testing}
            onClick={() => void test()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-card text-base font-bold shadow-[0_3px_0_#232326]"
          >
            {testing ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <PhoneCall className="size-5" aria-hidden />}
            {t("Call me now to try it", "आज़माने के लिए अभी कॉल करें", "Try karne ke liye abhi call karein")}
          </button>
        ) : null}

        {error ? <p role="alert" className="text-base font-bold text-[#b3261e]">{error}</p> : null}

        <div>
          <p className="mb-1.5 text-base font-bold">{t("Recent calls", "हाल की कॉल", "Recent calls")}</p>
          {jobs.data.length === 0 ? (
            <p className="text-base">{t("No calls yet. They appear here as they are made.", "अभी कोई कॉल नहीं। कॉल होने पर यहाँ दिखेंगी।", "Abhi koi call nahi. Call hone par yahan dikhengi.")}</p>
          ) : (
            <ul className="stagger space-y-2.5">
              {jobs.data.map((j) => (
                <CallRow key={j.id} job={j} demo={j.provider === "mock"} />
              ))}
            </ul>
          )}
        </div>

        <p className="text-sm leading-snug">
          {t(
            "Calls come from Parcha's number. Registering with the national do-not-call list does not stop these, because you asked for them; switching off here does.",
            "कॉल पर्चा के नंबर से आती हैं। 'डू नॉट कॉल' सूची में नाम होने से ये नहीं रुकतीं, क्योंकि आपने इन्हें माँगा है; यहाँ बंद करने से रुक जाती हैं।",
            "Calls Parcha ke number se aati hain. 'Do not call' list mein naam hone se yeh nahi rukti, kyunki aapne inhe maanga hai; yahan band karne se ruk jaati hain.",
          )}
        </p>
      </div>
    </Sheet>
  );
}
