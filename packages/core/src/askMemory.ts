/**
 * What the phone can answer about its own Parchas, with no model in it.
 *
 * Ask has one job and one rule. The job: a family holds a strip of tablets and
 * wants to know what it is, who put them on it and whether they are about to
 * run out. The rule: every answer is a thing already written on a Parcha this
 * phone holds. Nothing here infers a reason for a medicine, nothing suggests
 * one, nothing changes a dose, and a question the records cannot answer is
 * answered with "the record does not say" rather than a guess.
 *
 * So the lookup is deliberately dull: match a name against the medicines on
 * the saved Parchas, and report what those Parchas say — the doctor's name,
 * the hospital, the date, how it was written. A model is only ever used to
 * read a *name* off a photograph; the answer is still assembled here.
 */
import { addCalendarDays, daysBetween, occursOn, toDateString, type Reminder } from "./schedule.js";
import { soundKey } from "./soundsLike.js";
import type { Timing } from "./types.js";

/** One medicine as some Parcha wrote it. */
export type MemoryMedicine = {
  name: string;
  strength?: string | null;
  form?: string | null;
  frequency?: string | null;
  durationDays?: number | null;
  timing?: Timing | null;
  instructions?: string | null;
};

/**
 * One Parcha as this phone holds it. `certain` is true only for a slip whose
 * signed QR was checked here: everything else (a photograph, a pharmacy bill,
 * a name read off a strip) is what the family entered and is reported as such.
 */
export type MemoryParcha = {
  id: string;
  person: string;
  savedAt: string;
  /** The day on the slip, where there is one; otherwise the day it was saved. */
  date: string;
  doctor?: string | null;
  hospital?: string | null;
  diagnosis?: string | null;
  certain: boolean;
  medicines: MemoryMedicine[];
};

/** Everything the records say about one medicine, newest first. */
export type MedicineMemory = {
  /** The name as the newest Parcha writes it. */
  name: string;
  mentions: { parcha: MemoryParcha; medicine: MemoryMedicine }[];
  /** The newest Parcha that carries it. */
  latest: { parcha: MemoryParcha; medicine: MemoryMedicine };
};

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The words of a medicine name that are worth matching on (drops the strength). */
const nameWords = (s: string) => squash(s).split(" ").filter((w) => w.length > 2 && !/^\d/.test(w));

/**
 * Whether a written medicine is the one being asked about.
 *
 * Three ways, in order of how sure each is: the same name, one name contained
 * in the other (so "Paracetamol" finds "Paracetamol 650 tablet"), and the same
 * sound (so "Parasetamal", which is how a name comes back off a photograph or
 * out of speech, finds Paracetamol). Sound is the last resort and only for a
 * whole word, because that is where it stops being reliable.
 */
export function sameMedicine(written: string, asked: string): boolean {
  const a = squash(written);
  const b = squash(asked);
  if (!a || !b) return false;
  if (a === b) return true;
  const aw = nameWords(written);
  const bw = nameWords(asked);
  if (!aw.length || !bw.length) return false;
  if (bw.every((w) => aw.includes(w)) || aw.every((w) => bw.includes(w))) return true;
  const aKeys = new Set(aw.map(soundKey).filter(Boolean));
  return bw.map(soundKey).some((k) => k && aKeys.has(k));
}

/**
 * Every mention of a medicine across the Parchas this phone holds, newest
 * first. An empty list is the honest answer that the records do not have it.
 */
export function recallMedicine(parchas: MemoryParcha[], asked: string): MedicineMemory | null {
  const mentions: MedicineMemory["mentions"] = [];
  for (const parcha of [...parchas].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const medicine of parcha.medicines) {
      if (sameMedicine(medicine.name, asked)) mentions.push({ parcha, medicine });
    }
  }
  if (!mentions.length) return null;
  return { name: mentions[0].medicine.name, mentions, latest: mentions[0] };
}

/** Every distinct medicine the records hold for one person, newest mention first. */
export function recallAll(parchas: MemoryParcha[]): MedicineMemory[] {
  const out: MedicineMemory[] = [];
  for (const parcha of [...parchas].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const medicine of parcha.medicines) {
      const seen = out.find((m) => sameMedicine(m.name, medicine.name));
      if (seen) seen.mentions.push({ parcha, medicine });
      else out.push({ name: medicine.name, mentions: [{ parcha, medicine }], latest: { parcha, medicine } });
    }
  }
  return out;
}

/**
 * How a course stands: the last day, and how many days are left.
 *
 * Counted from the reminder, because the reminder is what the family actually
 * follows, and only for a course with an end. A reminder that runs until it is
 * switched off has no last day, and this says so rather than inventing one.
 */
export type Supply = {
  reminder: Reminder;
  /** The last day the medicine is to be taken, where the course has one. */
  lastDay: string | null;
  /** Days from today to the last day, inclusive of today. Null without a last day. */
  daysLeft: number | null;
  /** Doses still to come, to the last day. Null without a last day. */
  dosesLeft: number | null;
};

export function supplyOf(reminder: Reminder, today = toDateString(new Date())): Supply {
  const lastDay = reminder.endDate ?? null;
  if (!lastDay) return { reminder, lastDay: null, daysLeft: null, dosesLeft: null };
  const daysLeft = daysBetween(today, lastDay) + 1;
  if (daysLeft <= 0) return { reminder, lastDay, daysLeft: 0, dosesLeft: 0 };
  let dosesLeft = 0;
  for (let i = 0; i < daysLeft; i++) {
    const day = addCalendarDays(today, i);
    if (occursOn(reminder, day)) dosesLeft += reminder.times.length;
  }
  return { reminder, lastDay, daysLeft, dosesLeft };
}

/**
 * The medicines about to run out: a course whose last day is within `within`
 * days. Said as what it is — the course ends — never as "buy more", which
 * would be advice about treatment rather than a reading of the record.
 */
export function runningOut(reminders: Reminder[], within = 3, today = toDateString(new Date())): Supply[] {
  return reminders
    .filter((r) => r.enabled && r.kind === "medicine")
    .map((r) => supplyOf(r, today))
    .filter((s) => s.daysLeft !== null && s.daysLeft > 0 && s.daysLeft <= within)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
}
