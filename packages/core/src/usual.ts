/**
 * Where a new prescription line starts, so a busy doctor edits less.
 *
 * In order: how THIS doctor last wrote this medicine (their own habit, which
 * the clinic app remembers on the device), else the usual starting schedule
 * for the medicine's class (a statin at night for a month, a PPI before
 * breakfast for two weeks), else twice a day for five days. The line always
 * says which it was, and the doctor still reads every line before signing:
 * these are starting points, not decisions.
 */
import { normaliseFrequency, suggestedQuantity } from "./items.js";
import type { Drug, PrescriptionItem, Timing } from "./types.js";

export type Schedule = { frequency: string; durationDays: number; timing: Timing; everyDays?: number };
export type ScheduleSource = "yours" | "class" | "default";

const C = (frequency: string, durationDays: number, timing: Timing = "after_food"): Schedule => ({ frequency, durationDays, timing });

/** Usual starting schedules by drug class (the formulary's `drugClass`). */
export const CLASS_SCHEDULES: Record<string, Schedule> = {
  Statin: C("0-0-1", 30),
  Biguanide: C("1-0-1", 30),
  Sulfonylurea: C("1-0-0", 30, "before_food"),
  "Proton pump inhibitor": C("1-0-0", 14, "before_food"),
  "Second-generation antihistamine": C("0-0-1", 5),
  "First-generation antihistamine": C("0-0-1", 5),
  "Analgesic / antipyretic": C("1-1-1", 3),
  NSAID: C("1-0-1", 3),
  "NSAID / antiplatelet": C("0-1-0", 30),
  Antiplatelet: C("1-0-0", 30),
  Aminopenicillin: C("1-1-1", 5),
  "Aminopenicillin + beta-lactamase inhibitor": C("1-0-1", 5),
  Fluoroquinolone: C("1-0-1", 5),
  "Third-generation cephalosporin": C("1-0-1", 5),
  Nitroimidazole: C("1-1-1", 5),
  "Thyroid hormone": C("1-0-0", 30, "empty_stomach"),
  "Calcium channel blocker": C("1-0-0", 30),
  "Angiotensin receptor blocker": C("1-0-0", 30),
  "ACE inhibitor": C("1-0-0", 30),
  "Beta blocker": C("1-0-0", 30),
  "Thiazide diuretic": C("1-0-0", 30),
  "Vitamin supplement": C("1-0-0", 30),
  "Mineral supplement": C("1-0-0", 30),
  Haematinic: C("1-0-0", 30),
  Corticosteroid: C("1-0-0", 5),
  "Leukotriene receptor antagonist": C("0-0-1", 10),
  "Prokinetic antiemetic": C("1-1-1", 3, "before_food"),
  "Antiemetic (5-HT3 antagonist)": C("SOS", 3),
  Rehydration: C("SOS", 3, "any"),
  Anthelmintic: C("0-0-1", 1),
};

const FALLBACK: Schedule = C("1-0-1", 5);

/** A line for this medicine, starting from the doctor's own habit if there is one. */
export function startingLine(drug: Drug, mine?: Partial<Schedule> & { strength?: string }): { item: PrescriptionItem; source: ScheduleSource } {
  const usable = mine && mine.frequency && mine.durationDays && mine.timing;
  const base: Schedule = usable ? (mine as Schedule) : (CLASS_SCHEDULES[drug.drugClass] ?? FALLBACK);
  const source: ScheduleSource = usable ? "yours" : CLASS_SCHEDULES[drug.drugClass] ? "class" : "default";
  const frequency = normaliseFrequency(base.frequency);
  const everyDays = base.everyDays && base.everyDays > 1 ? base.everyDays : undefined;
  const strength = mine?.strength && drug.strengths.includes(mine.strength) ? mine.strength : drug.defaultStrength;
  const item: PrescriptionItem = {
    drugId: drug.id,
    drugName: drug.genericName,
    form: drug.defaultForm,
    strength,
    frequency,
    durationDays: base.durationDays,
    timing: base.timing,
    quantity: suggestedQuantity(frequency, base.durationDays, everyDays ?? 1) ?? base.durationDays,
    ...(everyDays ? { everyDays } : {}),
  };
  return { item, source };
}

/** What to remember of a signed line: the schedule and strength the doctor chose. */
export const scheduleOf = (item: PrescriptionItem): Schedule & { strength: string } => ({
  frequency: item.frequency,
  durationDays: item.durationDays,
  timing: item.timing,
  strength: item.strength,
  ...((item.everyDays ?? 1) > 1 ? { everyDays: item.everyDays } : {}),
});
