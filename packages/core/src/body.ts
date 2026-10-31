/**
 * Where it hurts, pointed at rather than spelt.
 *
 * The complaint is the first thing the doctor reads, and at a busy OPD it is
 * written by a desk that has thirty seconds and heard the patient through a
 * queue. A patient who cannot write, or cannot name the part in a language the
 * desk types in, ends up as "pain" — which tells the doctor nothing.
 *
 * So the kiosk asks the one question everybody can answer without words: they
 * point at a drawing of a body. This module is the parts that can be pointed
 * at, in the three languages the patient app already speaks, and the sentence
 * those taps make. The drawing itself is `@parcha/ui`'s BodyMap; the sentence
 * is ordinary text in the complaint field, so every screen that already reads
 * a complaint reads this too, with nothing new to teach them.
 */

/** A part of the body a patient can point at. */
export type BodyPart = {
  id: string;
  /** Which drawing it is on. */
  view: "front" | "back";
  en: string;
  hi: string;
  hinglish: string;
};

/**
 * The parts, chosen for an Indian OPD rather than for anatomy: these are the
 * ones people come in with. Fewer, bigger regions beat a precise map nobody
 * can hit with a thumb on a kiosk.
 */
export const BODY_PARTS: BodyPart[] = [
  { id: "head", view: "front", en: "Head", hi: "सिर", hinglish: "Sar" },
  { id: "eyes", view: "front", en: "Eyes", hi: "आँखें", hinglish: "Aankhein" },
  { id: "ears", view: "front", en: "Ears", hi: "कान", hinglish: "Kaan" },
  { id: "mouth", view: "front", en: "Mouth or throat", hi: "मुँह या गला", hinglish: "Munh ya gala" },
  { id: "neck", view: "front", en: "Neck", hi: "गरदन", hinglish: "Gardan" },
  { id: "chest", view: "front", en: "Chest", hi: "छाती", hinglish: "Chhaati" },
  { id: "belly", view: "front", en: "Stomach", hi: "पेट", hinglish: "Pet" },
  { id: "arm", view: "front", en: "Arm", hi: "बाँह", hinglish: "Baanh" },
  { id: "hand", view: "front", en: "Hand", hi: "हाथ", hinglish: "Haath" },
  { id: "hip", view: "front", en: "Hip", hi: "कूल्हा", hinglish: "Koolha" },
  { id: "leg", view: "front", en: "Leg", hi: "टाँग", hinglish: "Taang" },
  { id: "knee", view: "front", en: "Knee", hi: "घुटना", hinglish: "Ghutna" },
  { id: "foot", view: "front", en: "Foot", hi: "पैर", hinglish: "Pair" },
  { id: "shoulder", view: "back", en: "Shoulder", hi: "कंधा", hinglish: "Kandha" },
  { id: "upper_back", view: "back", en: "Upper back", hi: "ऊपरी पीठ", hinglish: "Upari peeth" },
  { id: "lower_back", view: "back", en: "Lower back", hi: "कमर", hinglish: "Kamar" },
  { id: "buttock", view: "back", en: "Hip, behind", hi: "पीछे कूल्हा", hinglish: "Peeche koolha" },
  { id: "calf", view: "back", en: "Calf", hi: "पिंडली", hinglish: "Pindli" },
];

export const bodyPart = (id: string): BodyPart | undefined => BODY_PARTS.find((p) => p.id === id);

/** How long it has been going on. Four answers, because a date is more than most people have. */
export type HowLong = "today" | "few_days" | "a_week" | "longer";

export const HOW_LONG: { id: HowLong; days: number; en: string; hi: string; hinglish: string }[] = [
  { id: "today", days: 1, en: "Since today", hi: "आज से", hinglish: "Aaj se" },
  { id: "few_days", days: 3, en: "Two or three days", hi: "दो-तीन दिन से", hinglish: "Do-teen din se" },
  { id: "a_week", days: 7, en: "About a week", hi: "करीब एक हफ़्ते से", hinglish: "Kareeb ek hafte se" },
  { id: "longer", days: 30, en: "Longer than that", hi: "उससे भी ज़्यादा", hinglish: "Usse bhi zyada" },
];

/** How bad it is. Three steps: more than that is a scale nobody agrees on. */
export type HowBad = "mild" | "bad" | "very_bad";

export const HOW_BAD: { id: HowBad; en: string; hi: string; hinglish: string }[] = [
  { id: "mild", en: "Bearable", hi: "सह सकते हैं", hinglish: "Seh sakte hain" },
  { id: "bad", en: "Bad", hi: "ज़्यादा है", hinglish: "Zyada hai" },
  { id: "very_bad", en: "Very bad", hi: "बहुत ज़्यादा", hinglish: "Bahut zyada" },
];

/** How many days to put in the intake's duration box. Null when they did not say. */
export const daysFor = (howLong: HowLong | null): number | null =>
  HOW_LONG.find((h) => h.id === howLong)?.days ?? null;

/**
 * The taps as one line for the complaint box: "Pain in the stomach and the
 * lower back. Very bad. Two or three days." in English, because the desk and
 * the doctor read the clinic app in English, with the patient's own words
 * after it when they typed any.
 *
 * It says "says it hurts" rather than naming a condition: a kiosk collects
 * what the patient points at, and nothing it collects is a diagnosis.
 */
export function complaintFrom(input: {
  parts: string[];
  howLong: HowLong | null;
  howBad: HowBad | null;
  alsoSaid?: string | null;
}): string {
  const names = input.parts.map((id) => bodyPart(id)?.en.toLowerCase()).filter(Boolean) as string[];
  const where =
    names.length === 0
      ? "Not pointed at a part"
      : names.length === 1
        ? `Pain in the ${names[0]}`
        : `Pain in the ${names.slice(0, -1).join(", the ")} and the ${names.at(-1)}`;
  const bad = HOW_BAD.find((b) => b.id === input.howBad)?.en;
  const when = HOW_LONG.find((h) => h.id === input.howLong)?.en;
  const said = input.alsoSaid?.trim();
  return [
    `${where} (said at the kiosk)`,
    bad,
    when,
    said ? `In their words: ${said}` : null,
  ]
    .filter(Boolean)
    .join(". ") + ".";
}
