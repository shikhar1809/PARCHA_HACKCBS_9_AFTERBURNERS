/**
 * Appointment days and time slots.
 *
 * A hospital runs on its own clock, not the clock of whichever device is
 * looking, so every day and slot here is read in Indian Standard Time. A slot
 * is stored as a plain instant (an ISO string), which is unambiguous
 * everywhere; this module is only the part that turns "Friday, 11:30" into
 * that instant and back.
 */

export const CLINIC_TZ = "Asia/Kolkata";
const OFFSET = "+05:30";

/**
 * Half-hour slots, with the lunch hour (13:00 to 14:00) left out. The same
 * list for every doctor: a real build would hold per-doctor rosters.
 */
export const SLOT_TIMES: string[] = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
];

/** How far ahead anybody can ask for a visit. */
export const BOOKING_DAYS_AHEAD = 14;

const iso = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ }).format(d);

/** Today as YYYY-MM-DD, in the clinic's time zone. */
export function todayInClinic(now: Date = new Date()): string {
  return iso(now);
}

/** A YYYY-MM-DD string moved by whole days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00${OFFSET}`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** The instant a slot starts. */
export function slotInstant(day: string, time: string): Date {
  return new Date(`${day}T${time}:00${OFFSET}`);
}

/** Whether a day is one that can be asked for: today up to the booking window. */
export function isBookableDay(day: unknown, now: Date = new Date()): day is string {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const today = todayInClinic(now);
  return day >= today && day <= addDays(today, BOOKING_DAYS_AHEAD);
}

/** "Today", "Tomorrow", or "Fri 24 Oct". */
export function formatDay(day: string, now: Date = new Date()): string {
  const today = todayInClinic(now);
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: CLINIC_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(slotInstant(day, "12:00"));
}

/** "11:30 am". */
export function formatTime(instant: Date | string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: CLINIC_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(instant));
}

/** "Fri 24 Oct, 11:30 am" for a stored slot. */
export function formatSlot(instant: Date | string): string {
  const d = new Date(instant);
  const day = new Intl.DateTimeFormat("en-IN", {
    timeZone: CLINIC_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
  return `${day}, ${formatTime(d)}`;
}

/** The YYYY-MM-DD a stored slot falls on, in the clinic's time zone. */
export function dayOf(instant: Date | string): string {
  return iso(new Date(instant));
}

/** The HH:MM a stored slot starts at, in the clinic's time zone. */
export function timeOf(instant: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(instant));
}

/** The next `count` days starting today, for a day picker. */
export function nextDays(count: number, now: Date = new Date()): string[] {
  const today = todayInClinic(now);
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}
