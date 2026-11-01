/**
 * A patient's day: which medicines to take when, and what else is on.
 *
 * A reminder is a rule ("Paracetamol at 8, 2 and 9, every day for five days"),
 * not a list of dates. The day's doses are worked out from the rules, so
 * editing a reminder changes every day at once, and a dose that was ticked off
 * is remembered by a key made from the reminder and the time.
 *
 * Dates are the phone's own calendar days (`YYYY-MM-DD`) and times are
 * `HH:MM` on a 24-hour clock: this is something a person reads off the wall.
 */
import { doseWords, isOral, siteWords } from "./forms.js";
import { frequencySlots } from "./items.js";
import type { Timing } from "./items.js";

export type ReminderKind = "medicine" | "appointment" | "followup" | "other";

export type Reminder = {
  id: string;
  ownerPhone: string;
  personName: string;
  kind: ReminderKind;
  title: string;
  /** A line under the title: the strength, the hospital, the instruction. */
  detail: string | null;
  /** `HH:MM` each time it applies. */
  times: string[];
  /** Weekdays it applies on, 0 (Sunday) to 6; empty means every day. */
  days: number[];
  /** Every N days from the start (2 = every other day, 7 = weekly). Absent or 1 is every day. */
  everyDays?: number;
  startDate: string;
  /** The last day, or null to go on until switched off. */
  endDate: string | null;
  enabled: boolean;
  /** Where it came from, when it was made from a prescription. */
  source: { visitId: string; drugId: string | null } | null;
  /**
   * Set once a schedule has been verified medicine by medicine and every strip
   * photographed. A locked reminder cannot be edited, switched off or deleted
   * from the phone; only a newer Parcha ends it (it gets an end date, so its
   * history stays). The lock is what lets a family trust that the times on the
   * phone are the times that were checked.
   */
  locked?: boolean;
};

/** Which doses have been ticked, for one day: key -> when. */
export type DoseLog = { id: string; ownerPhone: string; date: string; taken: Record<string, string> };

export type Dose = {
  /** `reminderId@HHMM`, the key a tick is stored under. */
  key: string;
  reminder: Reminder;
  time: string;
};

export const SLOT_NAMES = ["Morning", "Afternoon", "Night", "Late night"] as const;
export type DayPart = "Morning" | "Afternoon" | "Evening" | "Night";

/** The times a dose pattern is taken at, and how food moves them. */
const BASE_TIMES: Record<number, string[]> = {
  1: ["09:00"],
  2: ["09:00", "21:00"],
  3: ["08:00", "14:00", "21:00"],
  4: ["08:00", "13:00", "18:00", "22:00"],
};

/** Shift a time by minutes, wrapping within the day. */
export function shiftTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The clock times for a dose pattern such as "1-0-1". Slots with a zero are
 * skipped. `before_food` and `empty_stomach` move each time half an hour
 * earlier, so the reminder arrives before the meal it is about.
 *
 * A pattern with no arithmetic (SOS, STAT) has no times: it is "when needed",
 * so there is nothing to remind.
 *
 * The meal shift applies only to something swallowed. An eye drop is not taken
 * half an hour before dinner; it is taken in the morning and at night.
 */
export function timesForFrequency(
  frequency: string,
  timing: Timing | string = "after_food",
  form?: string,
): string[] {
  const slots = frequencySlots(frequency);
  if (!slots) return [];
  // The three-slot pattern is morning, afternoon, night. Two slots are morning
  // and night, which is how "1-0-1" and "BD" are read.
  const clock: string[] =
    slots.length === 3
      ? ["08:00", "14:00", "21:00"]
      : slots.length === 4
        ? BASE_TIMES[4]
        : slots.length === 2
          ? ["09:00", "21:00"]
          : BASE_TIMES[1];
  const early = isOral(form) && (timing === "before_food" || timing === "empty_stomach") ? -30 : 0;
  return slots.flatMap((count, i) => (count > 0 && clock[i] ? [shiftTime(clock[i], early)] : []));
}

export const toDateString = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** `YYYY-MM-DD` plus days, in the calendar and not in milliseconds, so a clock change cannot skip a day. */
export function addCalendarDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return toDateString(new Date(y, m - 1, d + n));
}

const weekday = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

/** Whether a reminder falls on this calendar day. */
export function occursOn(reminder: Reminder, date: string): boolean {
  if (!reminder.enabled) return false;
  if (date < reminder.startDate) return false;
  if (reminder.endDate && date > reminder.endDate) return false;
  const every = Math.max(1, reminder.everyDays ?? 1);
  if (every > 1 && daysBetween(reminder.startDate, date) % every !== 0) return false;
  return reminder.days.length === 0 || reminder.days.includes(weekday(date));
}

/** Whole calendar days from one `YYYY-MM-DD` to another. */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export const doseKey = (reminderId: string, time: string) => `${reminderId}@${time.replace(":", "")}`;

/** Every dose due on a day, in clock order. */
export function dosesOn(reminders: Reminder[], date: string): Dose[] {
  return reminders
    .filter((r) => occursOn(r, date))
    .flatMap((reminder) => reminder.times.map((time) => ({ key: doseKey(reminder.id, time), reminder, time })))
    .sort((a, b) => a.time.localeCompare(b.time) || a.reminder.title.localeCompare(b.reminder.title));
}

/** Morning until noon, afternoon until five, evening until nine, then night. */
export function dayPart(time: string): DayPart {
  const h = Number(time.slice(0, 2));
  return h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night";
}

/** "2:30 pm" for "14:30". */
export function formatClock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/** Minutes from `HH:MM` to now (positive when it is in the past). */
export function minutesSince(time: string, now: Date): number {
  const [h, m] = time.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() - (h * 60 + m);
}

/**
 * One dose of a medicine that is not swallowed, as a phrase: "2 drops in the
 * eye", "1 puff". The first slot with a dose in it is representative, since a
 * drop pattern is the same count each time in practice.
 */
function doseFor(frequency: string, form: string | undefined): string {
  const slots = frequencySlots(frequency);
  const count = slots?.find((n) => n > 0) ?? 1;
  return doseWords(form, count) || siteWords(form);
}

/** The reminder rules that a signed prescription implies, one per medicine that has fixed times. */
export function remindersFromPrescription(input: {
  ownerPhone: string;
  personName: string;
  visitId: string;
  startDate: string;
  items: { drugId: string; drugName: string; strength?: string; form?: string; frequency: string; durationDays: number; timing: Timing | string; everyDays?: number }[];
}): Omit<Reminder, "id">[] {
  return input.items.flatMap((item) => {
    const times = timesForFrequency(item.frequency, item.timing, item.form);
    if (times.length === 0) return [];
    return [
      {
        ownerPhone: input.ownerPhone,
        personName: input.personName,
        kind: "medicine" as const,
        title: item.drugName,
        // What the reminder says under the name. For something swallowed that is
        // the meal instruction; for a drop or a cream it is one dose and where
        // it goes, because "after food" would be nonsense on an eye.
        detail:
          [
            item.strength,
            isOral(item.form)
              ? item.timing.toString().replace(/_/g, " ")
              : doseFor(item.frequency, item.form),
          ]
            .filter(Boolean)
            .join(" · ") || null,
        times,
        days: [],
        ...(item.everyDays && item.everyDays > 1 ? { everyDays: item.everyDays } : {}),
        startDate: input.startDate,
        endDate: addCalendarDays(input.startDate, Math.max(1, item.durationDays) - 1),
        enabled: true,
        source: { visitId: input.visitId, drugId: item.drugId },
      },
    ];
  });
}

/** What to do with a new medicine that is already in someone's reminders. */
export type ClashChoice = "replace" | "both" | "keep";

/**
 * A new prescription against the reminders a person already has: for each new
 * medicine, the current reminder for the same medicine, if there is one that is
 * still running from the new start date. "The same medicine" is the same
 * medicine from the list (drugId), or failing that the same name; a different
 * strength or schedule is still the same medicine, which is exactly the case
 * worth asking about.
 */
export function clashesWith(
  existing: Reminder[],
  proposed: Omit<Reminder, "id">[],
): { reminder: Omit<Reminder, "id">; clash: Reminder | null }[] {
  // The medicine's own word: "Metformin 500 mg" and "Metformin" are the same medicine.
  const name = (s: string) => (s.toLowerCase().match(/[a-z]+/) ?? [""])[0];
  return proposed.map((p) => {
    if (p.kind !== "medicine") return { reminder: p, clash: null };
    const clash =
      existing.find(
        (r) =>
          r.kind === "medicine" &&
          r.enabled !== false &&
          r.personName === p.personName &&
          r.source?.visitId !== p.source?.visitId &&
          (r.endDate === null || r.endDate >= p.startDate) &&
          ((p.source?.drugId && r.source?.drugId === p.source.drugId) || name(r.title) === name(p.title)),
      ) ?? null;
    return { reminder: p, clash };
  });
}

/**
 * Applies the person's choices: which new reminders to save, and which current
 * ones end (the day before the new ones start, so their history stays).
 */
export function applyClashChoices(
  planned: { reminder: Omit<Reminder, "id">; clash: Reminder | null }[],
  choices: Record<number, ClashChoice>,
): { save: Omit<Reminder, "id">[]; end: { reminder: Reminder; endDate: string }[] } {
  const save: Omit<Reminder, "id">[] = [];
  const end: { reminder: Reminder; endDate: string }[] = [];
  planned.forEach(({ reminder, clash }, i) => {
    const choice: ClashChoice = clash ? (choices[i] ?? "replace") : "both";
    if (choice === "keep") return;
    save.push(reminder);
    if (choice === "replace" && clash) {
      const endDate = addCalendarDays(reminder.startDate, -1);
      // A reminder that only began today has nothing to keep: end it today.
      end.push({ reminder: clash, endDate: endDate < clash.startDate ? clash.startDate : endDate });
    }
  });
  return { save, end };
}
