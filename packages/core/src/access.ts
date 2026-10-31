/**
 * Access: for people who cannot see well, cannot hear, or use sign language.
 *
 * Two places hold it, for two different people:
 *
 *   - The PATIENT RECORD carries ACCESS NEEDS that the desk sets, so the desk
 *     and the doctor see them before the patient is in front of them, with a
 *     line of guidance on what to do differently.
 *   - A PERSON on a phone has ACCESS SETTINGS that change the app for them:
 *     read aloud, larger text, high contrast, spoken reminders, flashing and
 *     vibrating alerts instead of a chime, and no reminder calls for someone
 *     who cannot hear them.
 *
 * Pure: the words the app speaks are built here, the same in every screen.
 */
import { isOral, siteWords, unitWord } from "./forms.js";
import { everyText, frequencySlots, slotNames } from "./items.js";
import type { PrescriptionItem, Timing } from "./types.js";

export type AccessNeed = "low_vision" | "deaf" | "sign_language";

export const ACCESS_NEEDS: { id: AccessNeed; label: string; short: string; guidance: string }[] = [
  {
    id: "low_vision",
    label: "Blind or low vision",
    short: "Low vision",
    guidance: "Say who you are and what you are doing. Read the prescription aloud, and print it in large type.",
  },
  {
    id: "deaf",
    label: "Deaf or hard of hearing",
    short: "Deaf",
    guidance: "Face them and speak clearly, or write it down: use Show to patient. Do not rely on calling their name; fetch them.",
  },
  {
    id: "sign_language",
    label: "Uses sign language",
    short: "Sign language",
    guidance: "Ask whether they have an interpreter with them. Write the important parts down: use Show to patient.",
  },
];

export function cleanAccessNeeds(value: unknown): AccessNeed[] {
  const list = Array.isArray(value) ? value : [];
  return ACCESS_NEEDS.map((n) => n.id).filter((id) => list.includes(id));
}

/** How the app behaves for one person on a phone. */
export type PersonAccess = {
  /** Cannot see well: read things aloud, speak reminders, larger text. */
  lowVision: boolean;
  /** Cannot hear: flash and vibrate instead of a chime, no reminder calls. */
  deaf: boolean;
  /** Text one size up throughout. */
  largeText: boolean;
  /** Black on white, thicker edges. */
  highContrast: boolean;
};

export const NO_ACCESS: PersonAccess = { lowVision: false, deaf: false, largeText: false, highContrast: false };

export function cleanAccess(value: unknown): PersonAccess {
  const v = (value ?? {}) as Partial<Record<keyof PersonAccess, unknown>>;
  return {
    lowVision: v.lowVision === true,
    deaf: v.deaf === true,
    largeText: v.largeText === true,
    highContrast: v.highContrast === true,
  };
}

export type SpeechLang = "en" | "hi";

const NUM: Record<SpeechLang, string[]> = {
  en: ["no", "one", "two", "three", "four", "five", "six"],
  hi: ["शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह"],
};
/** "in the morning", "शाम" ... for each slot of a three- or four-slot pattern. */
const partsFor = (count: number, lang: SpeechLang) =>
  slotNames(count).map((p) => (lang === "hi" ? p.hi : p.en === "Night" ? "at night" : `in the ${p.en.toLowerCase()}`));
const TIMING_WORDS: Record<SpeechLang, Record<Timing, string>> = {
  en: {
    before_food: "before food",
    after_food: "after food",
    with_food: "with food",
    empty_stomach: "on an empty stomach",
    any: "at any time",
  },
  hi: {
    before_food: "खाने से पहले",
    after_food: "खाने के बाद",
    with_food: "खाने के साथ",
    empty_stomach: "खाली पेट",
    any: "किसी भी समय",
  },
};

// What one dose is called is the same word on the slip, in the reminder and
// here, so it lives in forms.ts. Kept as a local name for the call sites.
const unit = (form: string, n: number, lang: SpeechLang) => unitWord(form, n, lang);

/**
 * One prescription line as a sentence to speak, e.g. "Paracetamol 650 mg: one
 * tablet in the morning and one at night, after food, for 3 days."
 */
export function spokenDose(item: PrescriptionItem, lang: SpeechLang = "en"): string {
  const slots = frequencySlots(item.frequency);
  const timing = TIMING_WORDS[lang][item.timing] ?? "";
  const days = item.durationDays;
  const name = `${item.drugName}${item.strength ? ` ${item.strength}` : ""}`;
  // Before or after food is an instruction to a stomach. An eye drop, a cream
  // or a puffer has none, so each is told where it goes instead.
  const oral = isOral(item.form);
  const where = oral ? "" : siteWords(item.form, lang);
  if (!slots) {
    const when = item.frequency.toUpperCase() === "SOS" ? (lang === "hi" ? "ज़रूरत पड़ने पर" : "only when needed") : item.frequency;
    const tail = oral ? timing : where;
    return [`${name}: ${when}`, tail].filter(Boolean).join(", ") + (lang === "hi" ? "।" : ".");
  }
  const parts = partsFor(slots.length, lang);
  const doses = slots
    .map((n, i) => (n > 0 ? `${NUM[lang][n] ?? n} ${unit(item.form, n, lang)} ${parts[i] ?? ""}`.trim() : null))
    .filter(Boolean) as string[];
  const joined = doses.length > 1 ? `${doses.slice(0, -1).join(", ")} ${lang === "hi" ? "और" : "and"} ${doses.at(-1)}` : doses[0] ?? "";
  // "every 2 days", "once a week": said only when it is not every day.
  const often = (item.everyDays ?? 1) > 1 ? `, ${everyText(item.everyDays, lang).toLowerCase()}` : "";
  // Where it goes is said once, at the end, rather than after every slot.
  const how = oral ? timing : where;
  return lang === "hi"
    ? [`${name}: ${joined}${often}`, how, `${NUM.hi[days] ?? days} दिन तक`].filter(Boolean).join(", ") + "।"
    : [`${name}: ${joined}${often}`, how, `for ${NUM.en[days] ?? days} day${days === 1 ? "" : "s"}`].filter(Boolean).join(", ") + ".";
}

/** What a reminder says aloud: "Kamla, it is time for Calcium 500, after food." */
export function spokenReminder(personName: string, medicines: string[], lang: SpeechLang = "en"): string {
  const first = personName.split(" ")[0];
  const list = medicines.join(lang === "hi" ? ", " : ", ");
  return lang === "hi" ? `${first} जी, दवा का समय हो गया है: ${list}।` : `${first}, it is time for your medicine: ${list}.`;
}
