/**
 * What the safety check knows about children, maximum doses and pregnancy, and
 * the two things a prescription carries beyond its medicines: lines written by
 * hand, and tests.
 *
 * Kept in code beside the engine, not in the database: the screen and the
 * server import the same table, so a check can never run against two versions
 * of it, and a change ships with the engine version that reads it.
 *
 * The figures are the familiar textbook ones (BNF and BNF for Children, the
 * IAP drug formulary, the drug's Indian label), written conservatively: a
 * maximum here is the most a day, not a target. Like the rest of the formulary
 * it is a demo dataset; it does not replace a reference, and the screen says so.
 */
import { dosesPerDay } from "./items.js";
import type { PrescriptionItem, Severity } from "./types.js";

/* ------------------------------------------------------- written by hand */

export const UNLISTED_PREFIX = "unlisted:";

/** A line for a medicine that is not in the list, as the doctor wrote it. */
export function unlistedItem(name: string): PrescriptionItem {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
  return {
    drugId: `${UNLISTED_PREFIX}${clean.toLowerCase()}`,
    drugName: clean,
    form: "tablet",
    strength: "",
    frequency: "1-0-1",
    durationDays: 5,
    timing: "after_food",
    quantity: 10,
    unlisted: true,
  };
}

export const isUnlisted = (item: Pick<PrescriptionItem, "drugId">) => item.drugId.startsWith(UNLISTED_PREFIX);

/** The forms a hand-written line can take. */
export const UNLISTED_FORMS = ["tablet", "capsule", "syrup", "drops", "injection", "cream", "inhaler", "sachet", "other"];

/* ----------------------------------------------------------------- tests */

/** The tests an Indian OPD orders most, as they are written on the slip. */
export const COMMON_TESTS = [
  "CBC",
  "Blood sugar (F/PP)",
  "HbA1c",
  "LFT",
  "KFT",
  "Lipid profile",
  "TSH",
  "Urine routine",
  "Chest X-ray",
  "ECG",
  "USG abdomen",
  "Dengue NS1",
  "Malaria antigen",
  "Widal",
];

/** Tidies a list of tests: trimmed, no repeats, at most 20 of 80 characters. */
export function cleanTests(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const t of input) {
    if (typeof t !== "string") continue;
    const v = t.trim().replace(/\s+/g, " ").slice(0, 80);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
    if (out.length === 20) break;
  }
  return out;
}

/* ----------------------------------------------------- special populations */

type Note = { severity: Severity; note: string };

export type Special = {
  /** Not for anyone younger than this, in years. */
  minAge?: Note & { years: number };
  /** The most a day for a child, in mg per kg of body weight. */
  childMgPerKgDay?: number;
  /** The most a day for anyone, in mg. */
  maxMgDay?: number;
  pregnancy?: Note;
  breastfeeding?: Note;
};

const NSAID_PREGNANCY: Note = {
  severity: "high",
  note: "NSAIDs are avoided from 20 weeks (kidney and duct problems in the baby) and are contraindicated in the third trimester. Paracetamol is the usual choice.",
};
const QUINOLONE_CHILD: Note & { years: number } = {
  years: 18,
  severity: "caution",
  note: "Fluoroquinolones are avoided under 18 (joint and tendon damage) unless there is no alternative.",
};
const QUINOLONE_PREGNANCY: Note = { severity: "caution", note: "Fluoroquinolones are usually avoided in pregnancy; prefer a penicillin or cephalosporin." };
const ACE_ARB_PREGNANCY: Note = {
  severity: "high",
  note: "ACE inhibitors and ARBs harm the baby's kidneys, especially after the first trimester. Stop and switch (labetalol, nifedipine or methyldopa).",
};

/** By formulary drug id. A medicine with nothing special is simply absent. */
export const SPECIAL: Record<string, Special> = {
  paracetamol: { childMgPerKgDay: 60, maxMgDay: 4000 },
  ibuprofen: {
    minAge: { years: 0.25, severity: "caution", note: "Ibuprofen is not given under 3 months." },
    childMgPerKgDay: 40,
    maxMgDay: 2400,
    pregnancy: NSAID_PREGNANCY,
  },
  diclofenac: { maxMgDay: 150, pregnancy: NSAID_PREGNANCY },
  aceclofenac: { maxMgDay: 200, pregnancy: NSAID_PREGNANCY },
  naproxen: { maxMgDay: 1250, pregnancy: NSAID_PREGNANCY },
  aspirin: {
    minAge: { years: 16, severity: "high", note: "Aspirin is not given under 16: it can cause Reye's syndrome (liver and brain damage)." },
    pregnancy: { severity: "caution", note: "Pain-relief doses are avoided in the third trimester. Low dose (75–150 mg) for pre-eclampsia is a specialist's decision." },
  },
  tramadol: {
    minAge: { years: 12, severity: "high", note: "Tramadol is contraindicated under 12 (breathing can stop)." },
    maxMgDay: 400,
    pregnancy: { severity: "caution", note: "Opioids near delivery can cause withdrawal and breathing problems in the newborn." },
    breastfeeding: { severity: "high", note: "Tramadol passes into milk and can slow a baby's breathing; it is not recommended while breastfeeding." },
  },
  codeine: {
    minAge: { years: 12, severity: "high", note: "Codeine is contraindicated under 12 (some children turn it into morphine fast; breathing can stop)." },
    maxMgDay: 240,
    pregnancy: { severity: "caution", note: "Opioids near delivery can cause withdrawal and breathing problems in the newborn." },
    breastfeeding: { severity: "high", note: "Codeine is contraindicated while breastfeeding: babies have died of the morphine in milk." },
  },
  amoxicillin: { childMgPerKgDay: 90 },
  cefixime: { childMgPerKgDay: 8, maxMgDay: 400 },
  cephalexin: { childMgPerKgDay: 100, maxMgDay: 4000 },
  azithromycin: { childMgPerKgDay: 12 },
  clarithromycin: { pregnancy: { severity: "caution", note: "Clarithromycin is avoided in the first trimester unless there is no alternative." } },
  ciprofloxacin: { minAge: QUINOLONE_CHILD, maxMgDay: 1500, pregnancy: QUINOLONE_PREGNANCY },
  levofloxacin: { minAge: QUINOLONE_CHILD, maxMgDay: 750, pregnancy: QUINOLONE_PREGNANCY },
  ofloxacin: { minAge: QUINOLONE_CHILD, maxMgDay: 800, pregnancy: QUINOLONE_PREGNANCY },
  cotrimoxazole: {
    minAge: { years: 0.12, severity: "high", note: "Co-trimoxazole is not given under 6 weeks (jaundice in the newborn)." },
    pregnancy: { severity: "caution", note: "A folate antagonist: avoided in the first trimester, and near term (newborn jaundice)." },
  },
  metronidazole: { pregnancy: { severity: "caution", note: "Avoid high doses in pregnancy; a short standard course is used when needed." } },
  doxycycline: {
    minAge: { years: 8, severity: "high", note: "Tetracyclines are not given under 8: they stain growing teeth and affect bone." },
    pregnancy: { severity: "high", note: "Tetracyclines are contraindicated in pregnancy (the baby's teeth and bones)." },
    breastfeeding: { severity: "caution", note: "Short courses are usually acceptable; avoid long ones while breastfeeding." },
  },
  fluconazole: { pregnancy: { severity: "caution", note: "High or long courses are linked to birth defects. A single 150 mg dose is usually avoided too; topical treatment is preferred." } },
  albendazole: {
    minAge: { years: 1, severity: "caution", note: "Albendazole is not usually given under 1 year." },
    pregnancy: { severity: "high", note: "Albendazole is not given in the first trimester (WHO); deworming waits until the second." },
  },
  ivermectin: { pregnancy: { severity: "caution", note: "Ivermectin is not recommended in pregnancy." } },
  ondansetron: { pregnancy: { severity: "caution", note: "First-trimester use has a small link to cleft palate; weigh it against the vomiting." } },
  domperidone: { maxMgDay: 30 },
  glimepiride: { pregnancy: { severity: "caution", note: "Sulfonylureas are usually switched to insulin (or metformin) in pregnancy." } },
  gliclazide: { pregnancy: { severity: "caution", note: "Sulfonylureas are usually switched to insulin (or metformin) in pregnancy." } },
  enalapril: { pregnancy: ACE_ARB_PREGNANCY },
  telmisartan: { pregnancy: ACE_ARB_PREGNANCY },
  atenolol: { pregnancy: { severity: "caution", note: "Atenolol is linked to a smaller baby; labetalol is preferred in pregnancy." } },
  spironolactone: { pregnancy: { severity: "caution", note: "Spironolactone is avoided in pregnancy (anti-androgen effects on a male baby)." } },
  atorvastatin: {
    pregnancy: { severity: "high", note: "Statins are stopped in pregnancy." },
    breastfeeding: { severity: "high", note: "Statins are not used while breastfeeding." },
  },
  warfarin: { pregnancy: { severity: "high", note: "Warfarin causes birth defects (weeks 6–12) and bleeding; heparin is used instead." } },
  carbamazepine: { pregnancy: { severity: "high", note: "Carbamazepine causes neural tube and other defects. Do not stop it suddenly: refer, and give high-dose folic acid." } },
  phenytoin: { pregnancy: { severity: "high", note: "Phenytoin causes birth defects. Do not stop it suddenly: refer, and give folic acid." } },
  chlorpheniramine: { minAge: { years: 2, severity: "caution", note: "Sedating antihistamines are avoided under 2." } },
  cetirizine: { minAge: { years: 0.5, severity: "caution", note: "Cetirizine is not given under 6 months." } },
  levocetirizine: { minAge: { years: 0.5, severity: "caution", note: "Levocetirizine is not given under 6 months." } },
};

/* ------------------------------------------------------------ dose arithmetic */

/** Forms where "1" in the schedule is one countable dose the arithmetic can read. */
const COUNTED = new Set(["tablet", "capsule", "syrup"]);
/** A spoon: the unit of one dose of a syrup in the schedule. */
export const SPOON_ML = 5;

/**
 * Milligrams in one dose of this line: one tablet, or one 5 ml spoon of a
 * syrup. Null where it cannot be read (combinations, creams, units other than
 * mass), and then no dose rule runs on the line.
 */
export function mgPerDose(item: Pick<PrescriptionItem, "strength" | "form">): number | null {
  if (!COUNTED.has(item.form) || item.strength.includes("+")) return null;
  const m = item.strength.match(/^\s*(\d+(?:\.\d+)?)\s*(mg|g|mcg)\b(?:\s*\/\s*(\d+(?:\.\d+)?)\s*ml)?/i);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  let mg = Number(m[1]) * (unit === "g" ? 1000 : unit === "mcg" ? 0.001 : 1);
  if (m[3]) {
    // A liquid: so much in so many ml, read per spoon.
    if (item.form !== "syrup") return null;
    mg = (mg * SPOON_ML) / Number(m[3]);
  } else if (item.form === "syrup") {
    return null;
  }
  return Number.isFinite(mg) && mg > 0 ? mg : null;
}

/** Milligrams a day on a day it is taken, or null when not countable (SOS, STAT). */
export function mgPerDay(item: Pick<PrescriptionItem, "strength" | "form" | "frequency">): number | null {
  const each = mgPerDose(item);
  const doses = dosesPerDay(item.frequency);
  if (each === null || doses === null || doses === 0) return null;
  return each * doses;
}

/** What a medicine comes to in a day once every line carrying it is added up. */
export type DailyDose = {
  /** Milligrams a day, or null when not one line of it could be read. */
  mgPerDay: number | null;
  /** How many lines carry this medicine. */
  lines: number;
  /** How many of those lines the arithmetic could read. */
  checked: number;
};

/**
 * Milligrams a day of each medicine, adding every line that carries it.
 *
 * The same medicine can be on a prescription twice — a regular course and an
 * as-needed line, the same thing under two brands, or simply by mistake — and
 * what reaches the patient is the sum. So the dose rules read this and never a
 * single line: otherwise two lines each just under the most a day would both
 * pass while the patient takes twice it.
 *
 * A line that cannot be turned into milligrams (a combination, a cream, SOS)
 * adds nothing and is counted in `lines` but not in `checked`, so a flag can
 * say what it was able to add. Where no line could be read the total is null
 * and no dose rule runs, exactly as for a single unreadable line.
 */
export function dailyByDrug(items: Pick<PrescriptionItem, "drugId" | "strength" | "form" | "frequency">[]): Map<string, DailyDose> {
  const out = new Map<string, DailyDose>();
  for (const item of items) {
    const each = mgPerDay(item);
    const already = out.get(item.drugId) ?? { mgPerDay: null, lines: 0, checked: 0 };
    out.set(item.drugId, {
      mgPerDay: each === null ? already.mgPerDay : (already.mgPerDay ?? 0) + each,
      lines: already.lines + 1,
      checked: already.checked + (each === null ? 0 : 1),
    });
  }
  return out;
}
