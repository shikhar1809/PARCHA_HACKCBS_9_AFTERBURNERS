/**
 * The medicine schedule as a wall of days.
 *
 * A list tells you about today. It does not tell you that the course has nine
 * days left, that Sunday is the heavy day, or that the week after next is
 * empty because everything runs out. A grid does, at a glance and without
 * reading: a column per week, a square per day, darker where there is more to
 * take. The same shape as a contributions wall, for the same reason — the
 * pattern is the information.
 *
 * It is drawn from the reminders alone, so it costs nothing to show and works
 * with no connection: every square is a day the medicines were already
 * written for. The past is what was scheduled, not what was swallowed —
 * whether it was taken is the tick on the Medicines tab, and this does not
 * pretend to know it.
 */
import { addCalendarDays, dosesOn, toDateString, type Reminder } from "@parcha/core";
import { Link } from "react-router-dom";

import { dateIn, useLang, useT } from "../i18n";

/** Weeks shown: two behind for context, ten ahead, which is where a course ends. */
const BEFORE = 2;
const AHEAD = 10;

/** Monday-first, the way a week is read here. */
const weekdayIndex = (date: string) => (new Date(`${date}T00:00:00`).getDay() + 6) % 7;

export function DoseGrid({ reminders, person }: { reminders: Reminder[]; person: string | null }) {
  const t = useT();
  const lang = useLang();

  const today = toDateString(new Date());
  const mine = person ? reminders.filter((r) => r.personName === person) : reminders;

  // Start on the Monday of the first week shown, so the rows line up.
  const first = addCalendarDays(today, -(BEFORE * 7) - weekdayIndex(today));
  const weeks: { date: string; count: number }[][] = [];
  for (let w = 0; w < BEFORE + AHEAD + 1; w++) {
    const week: { date: string; count: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addCalendarDays(first, w * 7 + d);
      week.push({ date, count: dosesOn(mine, date).length });
    }
    weeks.push(week);
  }

  const busiest = Math.max(1, ...weeks.flat().map((d) => d.count));
  /** Four steps, so a day with one dose still reads as different from none. */
  const shade = (count: number) => {
    if (count === 0) return "bg-white";
    const step = Math.ceil((count / busiest) * 3);
    return step <= 1 ? "bg-[var(--brand-soft)]" : step === 2 ? "bg-[var(--brand)]" : "bg-[#d9622b]";
  };

  const total = weeks.flat().filter((d) => d.date >= today).reduce((n, d) => n + d.count, 0);
  const lastDay = [...weeks.flat()].reverse().find((d) => d.count > 0)?.date;
  const endsWithin = lastDay && lastDay < addCalendarDays(today, AHEAD * 7) ? lastDay : null;

  return (
    <Link
      to="/schedule"
      className="block rounded-2xl border-[3px] border-[#232326] bg-card p-3 shadow-[0_3px_0_#232326]"
      aria-label={t("Your medicine schedule", "आपकी दवा का कैलेंडर", "Aapki dawai ka calendar")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-base font-bold">{t("The weeks ahead", "आने वाले हफ़्ते", "Aane wale hafte")}</p>
        <p className="text-sm">
          {total > 0
            ? t(`${total} doses to come`, `${total} खुराक बाकी`, `${total} doses baaki`)
            : t("Nothing scheduled", "कुछ तय नहीं", "Kuch tay nahi")}
        </p>
      </div>

      {/* Small fixed squares, so the wall stays short enough to sit on Home
          with the two buttons still in reach. */}
      <div className="mt-2 flex gap-[3px] overflow-hidden" role="img" aria-label={t("Medicine days", "दवा के दिन", "Dawai ke din")}>
        {weeks.map((week, w) => (
          <div key={w} className="flex flex-col gap-[3px]">
            {week.map((day) => (
              <span
                key={day.date}
                title={`${dateIn(lang, day.date)} · ${day.count}`}
                className={`block size-[13px] shrink-0 rounded-[3px] border ${
                  day.date === today ? "border-[3px] border-[#232326]" : "border-[#2323261f]"
                } ${shade(day.count)}`}
              />
            ))}
          </div>
        ))}
      </div>

      {/* The one thing the pattern is worth saying out loud. */}
      {endsWithin ? (
        <p className="mt-2 text-sm">
          {t(
            `The last day with medicine is ${dateIn(lang, endsWithin)}.`,
            `दवा का आख़िरी दिन ${dateIn(lang, endsWithin)} है।`,
            `Dawai ka aakhri din ${dateIn(lang, endsWithin)} hai.`,
          )}
        </p>
      ) : null}
    </Link>
  );
}
