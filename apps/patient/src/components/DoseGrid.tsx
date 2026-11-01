/**
 * The medicine schedule as a wall of days: what was ticked behind, what is
 * coming ahead.
 *
 * A list tells you about today. It does not tell you that last Tuesday half
 * the doses went unticked, that the course has nine days left, or that the
 * week after next is empty because everything runs out. A grid does, at a
 * glance and without reading — the same shape as a contributions wall, for the
 * same reason: the pattern is the information.
 *
 * Behind today, a square is coloured by what was ticked that day: green for
 * all of it, amber for some, red for none. Ahead, it is coloured by how much
 * is scheduled. "Ticked" is the honest word: a dose taken and not ticked
 * shows as not ticked, and the legend says so rather than calling it missed.
 */
import { addCalendarDays, dosesOn, toDateString, type DoseLog, type Reminder } from "@parcha/core";
import { cn } from "@parcha/ui";
import { Link } from "react-router-dom";

import { dateIn, useLang, useT } from "../i18n";

/** Weeks shown: four behind, so a habit can be seen, and eight ahead, which is where a course ends. */
const BEFORE = 4;
const AHEAD = 8;

/** Monday-first, the way a week is read here. */
const weekdayIndex = (date: string) => (new Date(`${date}T00:00:00`).getDay() + 6) % 7;

type Day = { date: string; due: number; ticked: number };

export function DoseGrid({ reminders, person, logs = [] }: { reminders: Reminder[]; person: string | null; logs?: DoseLog[] }) {
  const t = useT();
  const lang = useLang();

  const today = toDateString(new Date());
  const mine = person ? reminders.filter((r) => r.personName === person) : reminders;
  const ticks = new Map(logs.map((l) => [l.date, l.taken]));
  // Before the first day this phone recorded a tick there is no record at all,
  // and "no record" is not "none ticked": those days are drawn grey.
  const firstRecord = logs.length ? logs.reduce((a, l) => (l.date < a ? l.date : a), logs[0].date) : today;

  // Start on the Monday of the first week shown, so the rows line up.
  const first = addCalendarDays(today, -(BEFORE * 7) - weekdayIndex(today));
  const weeks: Day[][] = [];
  for (let w = 0; w < BEFORE + AHEAD + 1; w++) {
    const week: Day[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addCalendarDays(first, w * 7 + d);
      const doses = dosesOn(mine, date);
      const taken = ticks.get(date) ?? {};
      week.push({ date, due: doses.length, ticked: doses.filter((x) => x.key in taken).length });
    }
    weeks.push(week);
  }

  const days = weeks.flat();
  const busiest = Math.max(1, ...days.map((d) => d.due));
  const shade = (d: Day) => {
    if (d.due === 0) return "bg-white";
    if (d.date < firstRecord) return "bg-[#dcd9d4]";
    if (d.date < today) return d.ticked >= d.due ? "bg-[#2e9e5b]" : d.ticked > 0 ? "bg-[#f5b942]" : "bg-[#f08a7e]";
    const step = Math.ceil((d.due / busiest) * 3);
    return step <= 1 ? "bg-[var(--brand-soft)]" : step === 2 ? "bg-[var(--brand)]" : "bg-[#d9622b]";
  };

  const past = days.filter((d) => d.date >= firstRecord && d.date < today && d.due > 0);
  const fullDays = past.filter((d) => d.ticked >= d.due).length;
  const toCome = days.filter((d) => d.date >= today).reduce((n, d) => n + d.due, 0);
  const lastDay = [...days].reverse().find((d) => d.due > 0)?.date;
  const endsWithin = lastDay && lastDay < addCalendarDays(today, AHEAD * 7) ? lastDay : null;
  // Month names over the column where a month starts.
  // A month is named over the week holding its first day, and never within two
  // columns of the last name, so two names cannot run into each other.
  let lastLabel = -3;
  const months = weeks.map((w, i) => {
    const starts = w.find((d) => d.date.endsWith("-01"));
    if (!starts || i - lastLabel < 3) return "";
    lastLabel = i;
    return new Date(`${starts.date}T00:00:00`).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { month: "short" });
  });
  const DAY_LETTERS = lang === "hi" ? ["सो", "", "बु", "", "शु", "", ""] : ["Mon", "", "Wed", "", "Fri", "", ""];

  return (
    <Link
      to="/schedule"
      className="block rounded-2xl border-[3px] border-[#232326] bg-card p-3 shadow-[0_3px_0_#232326]"
      aria-label={t("Your medicine days, ticked and to come", "आपकी दवा के दिन", "Aapki dawai ke din")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-base font-bold">{t("Ticked, and to come", "ली गई, और आगे", "Li gayi, aur aage")}</p>
        <p className="text-sm">
          {past.length
            ? t(`${fullDays} of ${past.length} days fully ticked`, `${past.length} में से ${fullDays} दिन पूरे`, `${past.length} mein se ${fullDays} din poore`)
            : toCome > 0
              ? t(`${toCome} doses to come`, `${toCome} खुराक बाकी`, `${toCome} doses baaki`)
              : t("Nothing scheduled", "कुछ तय नहीं", "Kuch tay nahi")}
        </p>
      </div>

      <div className="mt-2 overflow-x-auto">
        <div className="inline-flex flex-col gap-1">
          <div className="flex gap-[4px] pl-8 text-[0.65rem] leading-none font-bold" aria-hidden>
            {months.map((m, i) => (
              <span key={i} className="w-[15px] shrink-0 overflow-visible whitespace-nowrap">{m}</span>
            ))}
          </div>
          <div className="flex gap-[4px]" role="img" aria-label={t(`${fullDays} of ${past.length} recent days fully ticked; ${toCome} doses to come`, `${past.length} में से ${fullDays} दिन पूरे; ${toCome} खुराक बाकी`, `${fullDays}/${past.length} din poore; ${toCome} baaki`)}>
            <div className="flex w-7 shrink-0 flex-col gap-[4px] text-[0.6rem] leading-[15px] font-bold" aria-hidden>
              {DAY_LETTERS.map((d, i) => <span key={i} className="h-[15px]">{d}</span>)}
            </div>
            {weeks.map((week, w) => (
              <div key={w} className="flex flex-col gap-[4px]">
                {week.map((day) => (
                  <span
                    key={day.date}
                    title={`${dateIn(lang, day.date)} · ${day.date < today ? `${day.ticked}/${day.due}` : day.due}`}
                    className={cn(
                      "block size-[15px] shrink-0 rounded-[4px] border",
                      day.date === today ? "border-[3px] border-[#232326]" : "border-[#23232633]",
                      shade(day),
                    )}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold" aria-hidden>
        <Key className="bg-[#2e9e5b]" label={t("All ticked", "सब ली", "Sab li")} />
        <Key className="bg-[#f5b942]" label={t("Some", "कुछ", "Kuch")} />
        <Key className="bg-[#f08a7e]" label={t("None ticked", "कोई नहीं", "Koi nahi")} />
        <Key className="bg-[var(--brand)]" label={t("To come", "आगे", "Aage")} />
        <Key className="bg-[#dcd9d4]" label={t("No record yet", "रिकॉर्ड नहीं", "Record nahi")} />
      </div>

      {endsWithin ? (
        <p className="mt-2 text-sm">
          {t(`The last day with medicine is ${dateIn(lang, endsWithin)}.`, `दवा का आख़िरी दिन ${dateIn(lang, endsWithin)} है।`, `Dawai ka aakhri din ${dateIn(lang, endsWithin)} hai.`)}
        </p>
      ) : null}
    </Link>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("size-3 rounded-[3px] border border-[#23232633]", className)} />
      {label}
    </span>
  );
}
