import { useRecentDoseLogs, useReminders } from "@parcha/client";
import { dosesOn, toDateString } from "@parcha/core";
import { Screen } from "@parcha/ui";
import { ChevronRight, FilePlus2, MessageCircle, Pill } from "lucide-react";
import { Link } from "react-router-dom";

import { useHandset } from "../auth";
import { Avatar, AvatarStack, PillsArt } from "../components/art";
import { DoseGrid } from "../components/DoseGrid";
import { FamilyOverview } from "../components/FamilyOverview";
import { usePeople } from "../components/people";
import { tr, useLang, useT, type Lang } from "../i18n";

const greeting = (lang: Lang) => {
  const h = new Date().getHours();
  return h < 12
    ? tr(lang, "Good morning", "नमस्ते, सुप्रभात", "Good morning")
    : h < 17
      ? tr(lang, "Good afternoon", "नमस्ते", "Namaste")
      : tr(lang, "Good evening", "शुभ संध्या", "Good evening");
};

/**
 * Overview: today's medicines as the one card that matters, then the family —
 * how each of them is doing today and what has happened (a dose ticked, a dose
 * running late, a voice message to hear) — then the weeks, and the two things
 * people come to do: add a new Parcha, or ask about the ones they have. The
 * clinic's queue is not here: this app is the family's own record.
 */
export function Home() {
  const lang = useLang();
  const t = useT();
  const { handset } = useHandset();
  const reminders = useReminders(handset?.phone ?? null);
  const logs = useRecentDoseLogs(handset?.phone ?? null);
  const { people: household, active } = usePeople();
  // On a shared phone, the person whose turn it is sees only their own doses.
  const mine = active ? reminders.data.filter((r) => r.personName === active) : reminders.data;
  const today = dosesOn(mine, toDateString(new Date()));
  const people = household.map((p) => ({ name: p.name, sex: p.sex, age: p.ageYears }));
  const me = household.find((p) => p.name === active);

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">{greeting(lang)}</p>
          <h1 className="truncate text-2xl leading-tight font-bold">
            {me ? me.shown.split(" ")[0] : people.length === 1 ? household[0].shown.split(" ")[0] : t("Your family", "आपका परिवार", "Aapka parivaar")}
          </h1>
        </div>
        {/* With more than one person, the switch bar above says whose turn it is. */}
        {people.length === 1 ? <Avatar name={household[0].name} size={42} /> : people.length > 1 && !me ? <AvatarStack people={people} size={38} /> : null}
      </header>

      <Screen className="flex flex-col gap-3 px-4 pb-3">
        {reminders.error ? (
          <p role="alert" className="text-destructive py-4 text-base">
            {t("Could not load your medicines.", "आपकी दवाइयाँ नहीं खुल पाईं।", "Aapki dawaiyan nahi khul paayi.")} {reminders.error}
          </p>
        ) : reminders.loading ? (
          <div className="skeleton h-36 rounded-2xl border-[3px] border-[#232326]" role="status" aria-label={t("Loading", "खुल रहा है", "Khul raha hai")} />
        ) : today.length > 0 ? (
          <Link
            to="/schedule"
            className="pop halo block rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] p-3.5 shadow-[0_4px_0_#232326]"
          >
            <div className="flex items-center gap-3">
              <Pill className="size-12 shrink-0" strokeWidth={2.2} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold">{t("Today's medicines", "आज की दवाई", "Aaj ki dawai")}</p>
                <p className="truncate text-xl leading-tight font-bold">
                  {t(`${today.length} to take today`, `आज ${today.length} लेनी हैं`, `Aaj ${today.length} leni hain`)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end">
              <span className="flex min-h-11 shrink-0 items-center gap-0.5 rounded-full border-[3px] border-[#232326] bg-white px-3 py-1 text-base font-bold whitespace-nowrap">
                {t("Open", "खोलें", "Kholein")}
                <ChevronRight className="nudge size-4" strokeWidth={3} aria-hidden />
              </span>
            </div>
          </Link>
        ) : (
          <div className="pop flex flex-col items-center rounded-2xl border-[3px] border-dashed border-[#232326] px-5 py-4 text-center">
            <PillsArt size={92} />
            <p className="text-lg font-bold">{t("No medicines today", "आज कोई दवाई नहीं", "Aaj koi dawai nahi")}</p>
            <p className="mx-auto mt-0.5 max-w-72 text-base leading-snug">
              {t("Add a Parcha below and its medicines become reminders.", "नीचे पर्चा जोड़ें, उसकी दवाइयाँ रिमाइंडर बन जाएँगी।", "Neeche Parcha jodein, uski dawaiyan reminder ban jayengi.")}
            </p>
          </div>
        )}

        <FamilyOverview />

        {/* The weeks, so a course is seen whole and not one day at a time. */}
        {!reminders.loading && mine.length > 0 ? <DoseGrid reminders={mine} person={active ?? null} logs={logs.data} /> : null}

        <div className="stagger mt-auto grid grid-cols-2 gap-3">
          <Link
            to="/start"
            className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-2 text-center shadow-[0_4px_0_#232326] active:translate-y-0.5"
          >
            <FilePlus2 className="size-9" strokeWidth={2.2} aria-hidden />
            <span className="text-xl leading-tight font-bold">{t("New Parcha", "नया पर्चा", "Naya Parcha")}</span>
            <span className="text-sm leading-tight">{t("Get medicine reminders", "दवा के रिमाइंडर पाएँ", "Dawa ke reminder paayein")}</span>
          </Link>
          <Link
            to="/ask"
            className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] p-2 text-center shadow-[0_4px_0_#232326] active:translate-y-0.5"
          >
            <MessageCircle className="size-9" strokeWidth={2.2} aria-hidden />
            <span className="text-xl leading-tight font-bold">{t("Ask", "पूछें", "Poochhein")}</span>
            <span className="text-sm leading-tight">{t("About your medicines", "अपनी दवाइयों के बारे में", "Apni dawaiyon ke baare mein")}</span>
          </Link>
        </div>
      </Screen>
    </>
  );
}
