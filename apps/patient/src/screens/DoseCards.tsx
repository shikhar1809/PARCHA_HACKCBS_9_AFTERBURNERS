/**
 * What a reminder opens: the medicines due now, one card at a time.
 *
 * Each card is the photo of the strip, the name under it, and two answers.
 * Three medicines at one time are three cards, never a list, because the
 * question being answered is "is the tablet in my hand this one?" and that is
 * asked of one strip at a time. A list invites one tick for all three.
 *
 * Taken ticks the dose. Not taken asks again in thirty minutes — the app, the
 * phone's own alarm and the telephone call all wait the same thirty — and
 * nothing is recorded as missed: a dose taken late is still taken.
 */
import { markDose, useDoseLog, useReminders } from "@parcha/client";
import { toDateString, type Dose } from "@parcha/core";
import { Screen, cn } from "@parcha/ui";
import { BadgeCheck, Check, Clock, Pill, Volume2, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useHandset } from "../auth";
import { dueNow, NOT_TAKEN_MINUTES, snoozeDose, useNow } from "../components/alerts";
import { doseDoneNative, followUpNative } from "../components/native";
import { usePeople } from "../components/people";
import { speak } from "../components/speak";
import { StripPictures, useStrip } from "../components/strips";
import { clockIn, useLang, useT } from "../i18n";
import { BigButton } from "../kit";

export function DoseCards() {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const now = useNow(15_000);
  const today = toDateString(now);
  const reminders = useReminders(phone);
  const log = useDoseLog(phone, today);
  // Answered on this screen, so a card leaves at once rather than when the
  // server's copy of the day catches up.
  const [answered, setAnswered] = useState<string[]>([]);
  const [count, setCount] = useState(0);

  const { people, active, openPicker } = usePeople();
  const due = dueNow(reminders.data, log.data?.taken ?? {}, now, active).filter((d) => !answered.includes(d.key));
  // Someone else's doses are said to be waiting, never shown to be answered here.
  const others = active ? [...new Set(dueNow(reminders.data, log.data?.taken ?? {}, now).filter((d) => d.reminder.personName !== active).map((d) => d.reminder.personName))] : [];
  const shownName = (name: string) => people.find((p) => p.name === name)?.shown ?? name.split(" ")[0];
  const total = Math.max(count, due.length + answered.length);
  const dose = due[0];

  function answer(d: Dose, taken: boolean) {
    setCount(total);
    setAnswered([...answered, d.key]);
    if (taken) {
      void markDose(today, d.key, true).catch(() => undefined);
      void doseDoneNative(today, d.key);
    } else {
      snoozeDose(d.key, today, NOT_TAKEN_MINUTES);
      void followUpNative(d, today, NOT_TAKEN_MINUTES);
    }
  }

  if (reminders.loading || log.loading) {
    return <Screen className="flex flex-1 items-center justify-center"><span className="skeleton h-80 w-full max-w-sm rounded-3xl border-[3px] border-[#232326]" /></Screen>;
  }

  if (!dose) {
    return (
      <Screen className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <BadgeCheck className="size-20" strokeWidth={2} aria-hidden />
        <p className="text-3xl leading-tight font-bold">
          {answered.length ? t("All answered", "सब हो गया", "Sab ho gaya") : t("Nothing due right now", "अभी कोई दवा नहीं", "Abhi koi dawai nahi")}
        </p>
        {others.length ? (
          <div className="w-full space-y-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-4 text-left">
            <p className="text-lg leading-snug font-bold">
              {t(
                `${others.map(shownName).join(" and ")} also ${others.length === 1 ? "has" : "have"} medicines due. Only they can answer them, from their own name.`,
                `${others.map(shownName).join(" और ")} की दवा भी बाकी है। उसका जवाब वही दे सकते हैं, अपने नाम से।`,
                `${others.map(shownName).join(" aur ")} ki dawai bhi baaki hai. Uska jawab wahi de sakte hain, apne naam se.`,
              )}
            </p>
            <button type="button" onClick={openPicker} className="min-h-12 w-full rounded-xl border-[3px] border-[#232326] bg-white text-lg font-bold">
              {t("Switch person", "व्यक्ति बदलें", "Vyakti badlein")}
            </button>
          </div>
        ) : null}
        <BigButton onClick={() => navigate("/", { replace: true })}>{t("Done", "ठीक है", "Theek hai")}</BigButton>
      </Screen>
    );
  }

  return (
    <Screen className="flex flex-1 flex-col gap-4 px-4 pt-5 pb-6">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xl font-bold">
          <Clock className="size-6" aria-hidden /> {clockIn(lang, dose.time)}
        </p>
        {total > 1 ? (
          <div className="flex items-center gap-2">
            <span className="text-base font-bold">{t(`${answered.length + 1} of ${total}`, `${total} में से ${answered.length + 1}`, `${total} mein se ${answered.length + 1}`)}</span>
            <div className="flex gap-1" aria-hidden>
              {Array.from({ length: total }, (_, i) => (
                <span key={i} className={cn("size-3 rounded-full border-2 border-[#232326]", i <= answered.length ? "bg-[var(--brand)]" : "bg-white")} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {/* Keyed by the dose, so the next card starts fresh and pops in. */}
      <Card key={dose.key} dose={dose} onAnswer={(taken) => answer(dose, taken)} />
    </Screen>
  );
}

function Card({ dose, onAnswer }: { dose: Dose; onAnswer: (taken: boolean) => void }) {
  const t = useT();
  const strip = useStrip(dose.reminder.title);
  const r = dose.reminder;
  const said = t(`${r.personName.split(" ")[0]}, time for ${r.title}.`, `${r.personName.split(" ")[0]} जी, ${r.title} लेने का समय हो गया।`, `${r.personName.split(" ")[0]} ji, ${r.title} lene ka time ho gaya.`);
  return (
    <div className="pop flex flex-1 flex-col gap-4 rounded-3xl border-[3px] border-[#232326] bg-card p-4 shadow-[0_5px_0_#232326]">
      {strip?.front || strip?.back ? (
        <StripPictures medicine={r.title} />
      ) : (
        <div className="flex aspect-[2/1] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#232326] bg-white">
          <Pill className="size-12" aria-hidden />
          <p className="text-base">{t("No photo of this strip", "इस पत्ते की फ़ोटो नहीं है", "Is patte ki photo nahi hai")}</p>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-3xl leading-tight font-bold break-words">{r.title}</p>
          {r.detail ? <p className="text-lg leading-snug">{r.detail}</p> : null}
          <p className="text-lg font-bold">{r.personName}</p>
        </div>
        <button
          type="button"
          aria-label={`${t("Listen", "सुनें", "Suniye")}: ${said}`}
          onClick={() => void speak(said)}
          className="flex size-14 shrink-0 items-center justify-center rounded-2xl border-[3px] border-[#232326] bg-white"
        >
          <Volume2 className="size-6" aria-hidden />
        </button>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onAnswer(false)}
          className="flex min-h-20 flex-col items-center justify-center rounded-2xl border-[3px] border-[#232326] bg-white text-xl font-bold shadow-[0_4px_0_#232326] active:translate-y-0.5"
        >
          <span className="flex items-center gap-1.5">
            <X className="size-6" strokeWidth={3} aria-hidden /> {t("Not taken", "नहीं ली", "Nahi li")}
          </span>
          <span className="text-sm font-normal">{t(`Ask again in ${NOT_TAKEN_MINUTES} min`, `${NOT_TAKEN_MINUTES} मिनट में फिर`, `${NOT_TAKEN_MINUTES} min mein phir`)}</span>
        </button>
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="flex min-h-20 items-center justify-center gap-1.5 rounded-2xl border-[3px] border-[#232326] bg-[#2e9e5b] text-xl font-bold text-white shadow-[0_4px_0_#232326] active:translate-y-0.5"
        >
          <Check className="size-7" strokeWidth={3.2} aria-hidden /> {t("Taken", "ले ली", "Le li")}
        </button>
      </div>
    </div>
  );
}
