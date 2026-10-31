/**
 * Prescription line items: the shape, and the arithmetic around it.
 *
 * Structured rather than free text for three reasons:
 *   - the conflict engine needs `drugId` to look anything up
 *   - the patient app needs `frequency` and `timing` to pick a pictogram
 *   - the pharmacy needs `quantity` to count tablets off a shelf
 *
 * The same validation runs in firestore.rules, which is the backstop. This
 * module is the ergonomics.
 */

import { TIMINGS, type PrescriptionItem, type Timing } from "./types.js";

export { TIMINGS };
export type { PrescriptionItem, Timing };

/**
 * Maps the shorthand a doctor says to the three-slot pattern the patient
 * pictogram draws. Anything already in n-n-n form passes through.
 */
const SHORTHAND: Record<string, string> = {
  OD: "1-0-0",
  BD: "1-0-1",
  TDS: "1-1-1",
  TID: "1-1-1",
  QID: "1-1-1-1",
  HS: "0-0-1",
  SOS: "SOS",
  STAT: "STAT",
};

export function normaliseFrequency(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (trimmed in SHORTHAND) return SHORTHAND[trimmed];
  return input.trim();
}

/** The three-or-four slot pattern as numbers, or null if it is not one. */
export function frequencySlots(frequency: string): number[] | null {
  const parts = frequency.trim().split("-");
  if (parts.length < 2) return null;
  const slots = parts.map((p) => Number(p));
  if (slots.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return slots;
}

/** Doses per day implied by the frequency, or null when not countable. */
export function dosesPerDay(frequency: string): number | null {
  const slots = frequencySlots(frequency);
  if (!slots) return null;
  return slots.reduce((sum, n) => sum + n, 0);
}

/**
 * Units to dispense. Null for SOS and STAT, where the quantity is a
 * judgement call rather than arithmetic.
 */
export function suggestedQuantity(
  frequency: string,
  durationDays: number,
  everyDays = 1,
): number | null {
  const perDay = dosesPerDay(frequency);
  if (perDay === null || perDay === 0) return null;
  // Taken on day 1, then every N days, within the course.
  return perDay * Math.ceil(durationDays / Math.max(1, everyDays));
}

/**
 * The times of day, by how many slots a pattern has. Three slots are morning,
 * afternoon and night ("1-0-1"); four add the evening ("1-0-1-1": subah,
 * dopahar, shaam, raat). Two are morning and night.
 */
export function slotNames(count: number): { en: string; hi: string }[] {
  const m = { en: "Morning", hi: "सुबह" };
  const a = { en: "Afternoon", hi: "दोपहर" };
  const e = { en: "Evening", hi: "शाम" };
  const n = { en: "Night", hi: "रात" };
  return count === 4 ? [m, a, e, n] : count === 2 ? [m, n] : count === 1 ? [m] : [m, a, n];
}

/** How often a course repeats: every day, every other day, weekly... */
export const EVERY_DAYS: { days: number; en: string; hi: string }[] = [
  { days: 1, en: "Every day", hi: "रोज़" },
  { days: 2, en: "Every 2 days", hi: "हर 2 दिन" },
  { days: 3, en: "Every 3 days", hi: "हर 3 दिन" },
  { days: 7, en: "Once a week", hi: "हफ़्ते में एक बार" },
  { days: 14, en: "Every 2 weeks", hi: "हर 2 हफ़्ते" },
  { days: 30, en: "Once a month", hi: "महीने में एक बार" },
];

export const everyText = (days: number | undefined, lang: "en" | "hi" = "en") => {
  const d = Math.max(1, days ?? 1);
  const known = EVERY_DAYS.find((x) => x.days === d);
  return known ? known[lang] : lang === "hi" ? `हर ${d} दिन` : `Every ${d} days`;
};

/** A pattern in four slots (subah, dopahar, shaam, raat), from any of the stored forms. */
export function toFourSlots(frequency: string): number[] {
  const s = frequencySlots(normaliseFrequency(frequency));
  if (!s) return [0, 0, 0, 0];
  if (s.length === 4) return s;
  if (s.length === 3) return [s[0], s[1], 0, s[2]];
  if (s.length === 2) return [s[0], 0, 0, s[1]];
  return [s[0] ?? 0, 0, 0, 0];
}

/** Back to the stored form: three slots when there is no evening dose (so old prescriptions read the same), else four. */
export function fromFourSlots(slots: number[]): string {
  const [m, a, e, n] = slots.map((x) => Math.max(0, Math.min(9, Math.round(x))));
  return e > 0 ? `${m}-${a}-${e}-${n}` : `${m}-${a}-${n}`;
}

export const TIMING_LABELS: Record<Timing, string> = {
  before_food: "Before food",
  after_food: "After food",
  with_food: "With food",
  empty_stomach: "On an empty stomach",
  any: "Any time",
};

/**
 * Validates an item the same way the security rules will, so a bad line is
 * caught in the form rather than as a rejected write.
 *
 * Returns human-readable problems; empty means valid.
 */
export function validateItem(item: Partial<PrescriptionItem>): string[] {
  const problems: string[] = [];
  if (!item.drugId) problems.push("No drug selected.");
  if (!item.drugName) problems.push("Drug name is missing.");
  if (!item.frequency?.trim()) problems.push("Frequency is required.");
  if (item.durationDays === undefined || item.durationDays === null) {
    problems.push("Duration is required.");
  } else if (!Number.isFinite(item.durationDays) || item.durationDays <= 0) {
    problems.push("Duration must be at least one day.");
  }
  if (item.timing && !TIMINGS.includes(item.timing)) {
    problems.push(`Unknown timing "${item.timing}".`);
  }
  if (item.everyDays !== undefined && (!Number.isInteger(item.everyDays) || item.everyDays < 1 || item.everyDays > 90)) {
    problems.push("How often must be every 1 to 90 days.");
  }
  if (item.frequency && frequencySlots(item.frequency)?.every((n) => n === 0)) {
    problems.push("Choose at least one time of day, or Only when needed.");
  }
  return problems;
}
