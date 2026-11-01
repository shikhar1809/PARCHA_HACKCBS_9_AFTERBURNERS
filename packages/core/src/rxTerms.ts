/**
 * A prescription line two ways: as a pharmacist reads it, and as the patient
 * does.
 *
 *   pharmacist  Tab. PARACETAMOL 650 mg · 1-0-1 (BD) p.c. × 5 d
 *   patient     सुबह 1 गोली · रात 1 गोली · खाने के बाद
 *
 * The abbreviations are the standard Latin ones every Indian chemist reads
 * (OD, BD, TDS, QID, HS, SOS; a.c., p.c.), so the slip reads like a real
 * prescription, with the plain Hindi beside it for the family.
 */
import { isOral, siteWords, unitWord } from "./forms.js";
import { frequencySlots, normaliseFrequency, slotNames } from "./items.js";
import type { PrescriptionItem, Timing } from "./types.js";

const FORM: Record<string, string> = {
  tablet: "Tab.",
  capsule: "Cap.",
  syrup: "Syp.",
  injection: "Inj.",
  inhaler: "Inh.",
  respule: "Resp.",
  drops: "Drops",
  "eye drops": "Eye drops",
  cream: "Cream",
  gel: "Gel",
  sachet: "Sachet",
};

export const formAbbr = (form: string) => FORM[form] ?? form.charAt(0).toUpperCase() + form.slice(1);

/** OD, BD, TDS, QID, HS, SOS for the familiar patterns; otherwise none. */
export function frequencyAbbr(raw: string): string | null {
  const frequency = normaliseFrequency(raw);
  const f = frequency.trim().toUpperCase();
  if (f === "SOS" || f === "STAT") return f;
  const slots = frequencySlots(frequency);
  if (!slots) return null;
  const key = slots.join("-");
  return (
    {
      "1-0-0": "OD",
      "0-0-1": "HS",
      "1-0-1": "BD",
      "1-1-1": "TDS",
      "1-1-1-1": "QID",
      "1-0-0-1": "BD",
      "1-0-1-0": "BD",
    } as Record<string, string>
  )[key] ?? null;
}

const TIMING_ABBR: Record<Timing, string> = {
  before_food: "a.c.",
  after_food: "p.c.",
  with_food: "with food",
  empty_stomach: "empty stomach",
  any: "",
};

const TIMING_HI: Record<Timing, string> = {
  before_food: "खाने से पहले",
  after_food: "खाने के बाद",
  with_food: "खाने के साथ",
  empty_stomach: "खाली पेट",
  any: "",
};

/** "Tab. PARACETAMOL 650 mg" */
export const rxName = (item: Pick<PrescriptionItem, "form" | "drugName" | "strength">) =>
  [formAbbr(item.form), item.drugName.toUpperCase(), item.strength].filter(Boolean).join(" ");

/**
 * "1-0-1 (BD) p.c." — and for anything not swallowed, where it goes in place
 * of the meal: "1-1-1 (TDS) in the eye". A chemist reading "p.c." on an eye
 * drop learns nothing from it.
 */
export function rxSig(item: Pick<PrescriptionItem, "frequency" | "timing"> & { form?: string }): string {
  const frequency = normaliseFrequency(item.frequency);
  const abbr = frequencyAbbr(frequency);
  const pattern = frequencySlots(frequency) ? frequency : null;
  const how = isOral(item.form) ? TIMING_ABBR[item.timing] || null : siteWords(item.form) || null;
  return [pattern ?? abbr ?? frequency, pattern && abbr ? `(${abbr})` : null, how].filter(Boolean).join(" ");
}

/**
 * "सुबह 1 गोली · रात 1 गोली · खाने के बाद" — what the family reads.
 *
 * The count carries its unit, because a bare "1" beside an eye drop is read as
 * one tablet; and food is named only for what is swallowed, with where it goes
 * in its place for everything else.
 */
export function rxHindi(
  item: Pick<PrescriptionItem, "frequency" | "timing" | "everyDays"> & { form?: string },
): string {
  const frequency = normaliseFrequency(item.frequency);
  const f = frequency.trim().toUpperCase();
  const parts: string[] = [];
  if (f === "SOS") parts.push("ज़रूरत पड़ने पर");
  else if (f === "STAT") parts.push("अभी एक बार");
  else {
    const slots = frequencySlots(frequency);
    if (slots) {
      const names = slotNames(slots.length);
      slots.forEach((n, i) => {
        // A bare "1" beside an eye drop is read as one tablet, so the count
        // carries its own word.
        if (n > 0) parts.push(`${names[i].hi} ${n} ${unitWord(item.form, n, "hi")}`.trim());
      });
    }
  }
  if ((item.everyDays ?? 1) === 7) parts.push("हफ़्ते में एक बार");
  else if ((item.everyDays ?? 1) === 2) parts.push("एक दिन छोड़कर");
  // Food for what is swallowed; for everything else, where it goes.
  if (isOral(item.form)) {
    if (TIMING_HI[item.timing]) parts.push(TIMING_HI[item.timing]);
  } else {
    const where = siteWords(item.form, "hi");
    if (where) parts.push(where);
  }
  return parts.join(" · ");
}
