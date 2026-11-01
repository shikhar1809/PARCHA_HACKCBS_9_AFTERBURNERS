/**
 * The safety check: three rules over the seeded formulary.
 *
 * Deterministic TypeScript. No model, no API call: the same inputs give the same
 * answer every time, and every flag says which records it read. It runs twice,
 * on purpose. The prescribing screen runs it live, so the doctor sees a
 * conflict while composing; the `signPrescription` function runs it again,
 * where a modified client cannot skip it, and that run is the one on record.
 *
 *   drug <-> allergy   prescribed drug's allergy classes against the patient's
 *                      recorded allergies (retractions already removed), and
 *                      an allergy written in free text that names the drug.
 *   drug <-> drug      every pair within the prescription, and each drug
 *                      against what the patient is already taking.
 *   drug <-> vitals    this visit's intake reading against cautions that are
 *                      drug-specific or class-wide; the highest severity that
 *                      fires is the one reported.
 *
 *   drug <-> patient   too young for the medicine; more than the most a day,
 *                      for an adult or by a child's weight (with no weight,
 *                      it says the dose could not be checked); pregnant or
 *                      breastfeeding, and a woman of child-bearing age who was
 *                      not asked, for the medicines where it matters
 *                      (special.ts).
 *   written by hand    a medicine not in the list is flagged as unchecked, and
 *                      its name is still read against free-text allergies.
 *
 * Rules of engagement
 *   - Flags ADVISE; they never BLOCK. A tool that blocks gets switched off and
 *     the clinic goes back to paper. The doctor acknowledges each high-severity
 *     flag, and that acknowledgement is recorded with the prescription.
 *   - Every flag is explainable: `evidence` names what the rule read.
 *   - Every flag carries `engineVersion`, so old flags stay interpretable as
 *     the output of the rules that were live when they were raised.
 *
 * What this is not: a replacement for clinical judgement or a complete drug
 * database. It knows only the interactions and cautions in the formulary, and
 * says so on screen. A clear result means "nothing in this formulary matched",
 * not "safe".
 */

import { dailyByDrug, isUnlisted, mgPerDose, SPECIAL, SPOON_ML } from "./special.js";
import type {
  Allergy,
  Conflict,
  Drug,
  DrugInteraction,
  Pregnancy,
  PrescriptionItem,
  Severity,
  Sex,
  VitalCaution,
  VitalsSummary,
} from "./types.js";

/** Stamped on every conflict. Change it whenever a rule changes. */
export const ENGINE_VERSION = "1.2.0";

/** Everything the three rules need, gathered by the caller. */
export type ConflictEngineInput = {
  visitId: string;
  patientId: string;
  prescriptionId: string;
  /** The line items being written. */
  items: PrescriptionItem[];
  /** This visit's intake reading. */
  vitals: VitalsSummary | null;
  /** Live allergies for this patient, tombstones already removed. */
  allergies: Allergy[];
  /** Drugs the patient is already taking, from recent prescriptions. */
  currentDrugIds: string[];
  /** Who the patient is, for the age, dose and pregnancy rules. Absent: those rules do not run. */
  patient?: { ageYears: number | null; sex: Sex | null; pregnancy: Pregnancy | null };
  /** The formulary, read once by the caller. */
  formulary: {
    drugs: Drug[];
    interactions: DrugInteraction[];
    vitalCautions: VitalCaution[];
  };
};

/** A flag, before it is written. */
export type DetectedConflict = Omit<Conflict, "id" | "detectedAt" | "engineVersion">;

const RANK: Record<Severity, number> = { info: 0, caution: 1, high: 2 };
const higher = (a: Severity, b: Severity): Severity => (RANK[a] >= RANK[b] ? a : b);

/** A stable name for a flag, so a doctor's acknowledgement can refer to it. */
export const conflictKey = (c: Pick<DetectedConflict, "rule" | "subjectDrugId" | "counterpartRef">): string =>
  `${c.rule}:${c.subjectDrugId ?? "-"}:${c.counterpartRef ?? "-"}`;

const pairKey = (x: string, y: string) => [x, y].sort().join("__");

const compare = (value: number, op: VitalCaution["comparator"], threshold: number): boolean =>
  op === "gt" ? value > threshold : op === "gte" ? value >= threshold : op === "lt" ? value < threshold : value <= threshold;

const VITAL_LABEL: Partial<Record<keyof VitalsSummary, string>> = {
  systolicMmhg: "systolic pressure",
  diastolicMmhg: "diastolic pressure",
  pulseBpm: "pulse",
  temperatureC: "temperature",
  respiratoryRate: "breathing rate",
  spo2Pct: "oxygen saturation",
  weightKg: "weight",
  heightCm: "height",
  bloodSugarMgdl: "blood sugar",
};

const sameClass = (drugClass: string, wanted: string) => {
  const a = drugClass.toLowerCase();
  const b = wanted.toLowerCase();
  return a === b || a.includes(b);
};

/** Runs the three rules. */
export function runConflictEngine(input: ConflictEngineInput): DetectedConflict[] {
  const { formulary, items, vitals, allergies, currentDrugIds } = input;
  const byId = new Map(formulary.drugs.map((d) => [d.id, d]));
  const base = { visitId: input.visitId, prescriptionId: input.prescriptionId, patientId: input.patientId };
  const out: DetectedConflict[] = [];

  const nameOf = (id: string, fallback?: string) => byId.get(id)?.genericName ?? fallback ?? id;
  // One line per medicine, for the rules that are about the medicine itself: an
  // allergy or a pregnancy caution fires once however many lines carry the drug.
  const written = items.filter((i, idx) => items.findIndex((j) => j.drugId === i.drugId) === idx);
  // The dose rules are the exception — they must add every line up, so they read
  // this instead of the one line above (special.ts explains why).
  const daily = dailyByDrug(items);

  // --- drug <-> allergy -----------------------------------------------------
  for (const item of written) {
    const drug = byId.get(item.drugId);
    if (!drug) continue;
    for (const a of allergies) {
      const byClass = a.allergyClassId !== null && drug.allergyClasses.includes(a.allergyClassId);
      const free = `${a.label} ${a.freeText ?? ""}`.toLowerCase();
      const byName = !byClass && free.includes(drug.genericName.toLowerCase().split(" ")[0]);
      if (!byClass && !byName) continue;
      out.push({
        ...base,
        rule: "drug_allergy",
        severity: "high",
        subjectDrugId: drug.id,
        subjectDrugName: drug.genericName,
        counterpartKind: "allergy_class",
        counterpartRef: a.allergyClassId ?? a.id,
        counterpartLabel: a.label,
        message: `${drug.genericName} is in the ${byClass ? "class" : "name"} of a recorded allergy: ${a.label}${a.reaction ? ` (reaction: ${a.reaction})` : ""}. Choose another medicine, or confirm the allergy is not current.`,
        evidence: { allergyId: a.id, allergyRecordedAt: a.recordedAt, matchedOn: byClass ? "class" : "name", drugAllergyClasses: drug.allergyClasses },
      });
    }
  }

  // --- written by hand ------------------------------------------------------
  for (const item of written.filter(isUnlisted)) {
    const name = item.drugName.trim();
    const first = name.toLowerCase().split(" ")[0];
    for (const a of allergies) {
      if (first.length < 4 || !`${a.label} ${a.freeText ?? ""}`.toLowerCase().includes(first)) continue;
      out.push({
        ...base,
        rule: "drug_allergy",
        severity: "high",
        subjectDrugId: item.drugId,
        subjectDrugName: name,
        counterpartKind: "allergy_class",
        counterpartRef: a.allergyClassId ?? a.id,
        counterpartLabel: a.label,
        message: `${name} is named in a recorded allergy: ${a.label}${a.reaction ? ` (reaction: ${a.reaction})` : ""}. Choose another medicine, or confirm the allergy is not current.`,
        evidence: { allergyId: a.id, allergyRecordedAt: a.recordedAt, matchedOn: "name" },
      });
    }
    out.push({
      ...base,
      rule: "unlisted",
      severity: "caution",
      subjectDrugId: item.drugId,
      subjectDrugName: name,
      counterpartKind: "drug",
      counterpartRef: "unlisted",
      counterpartLabel: "not in the medicine list",
      message: `${name} was written by hand, so its allergy class, interactions, dose and use in pregnancy and children were not checked. Check them yourself.`,
      evidence: { unlisted: true },
    });
  }

  // --- drug <-> drug --------------------------------------------------------
  const table = new Map(formulary.interactions.map((i) => [pairKey(i.a, i.b), i]));
  const seenPairs = new Set<string>();
  const consider = (subject: PrescriptionItem, otherId: string, otherName: string, source: "this_prescription" | "already_taking") => {
    if (subject.drugId === otherId) return;
    const key = pairKey(subject.drugId, otherId);
    if (seenPairs.has(key)) return;
    const hit = table.get(key);
    if (!hit) return;
    seenPairs.add(key);
    out.push({
      ...base,
      rule: "drug_drug",
      severity: hit.severity,
      subjectDrugId: subject.drugId,
      subjectDrugName: nameOf(subject.drugId, subject.drugName),
      counterpartKind: "drug",
      counterpartRef: otherId,
      counterpartLabel: otherName,
      message: `${nameOf(subject.drugId, subject.drugName)} with ${otherName}${source === "already_taking" ? " (already taking)" : ""}: ${hit.mechanism} ${hit.advice}`.trim(),
      evidence: { interactionId: key, source },
    });
  };
  for (let i = 0; i < written.length; i++) {
    for (let j = i + 1; j < written.length; j++) {
      consider(written[i], written[j].drugId, nameOf(written[j].drugId, written[j].drugName), "this_prescription");
    }
    for (const current of new Set(currentDrugIds)) {
      if (written.some((w) => w.drugId === current)) continue;
      consider(written[i], current, nameOf(current), "already_taking");
    }
  }

  // --- drug <-> vitals ------------------------------------------------------
  if (vitals) {
    for (const item of written) {
      const drug = byId.get(item.drugId);
      if (!drug) continue;
      const worst = new Map<keyof VitalsSummary, { caution: VitalCaution; value: number }>();
      for (const c of formulary.vitalCautions) {
        const applies =
          (c.drugId !== null && c.drugId === drug.id) || (c.drugClass !== null && sameClass(drug.drugClass, c.drugClass));
        if (!applies) continue;
        const reading = vitals[c.vitalKey];
        if (typeof reading !== "number" || !compare(reading, c.comparator, c.threshold)) continue;
        const prior = worst.get(c.vitalKey);
        if (!prior || RANK[c.severity] > RANK[prior.caution.severity]) worst.set(c.vitalKey, { caution: c, value: reading });
      }
      for (const [key, { caution, value }] of worst) {
        out.push({
          ...base,
          rule: "drug_vitals",
          severity: higher("info", caution.severity),
          subjectDrugId: drug.id,
          subjectDrugName: drug.genericName,
          counterpartKind: "vital",
          counterpartRef: key,
          counterpartLabel: `${VITAL_LABEL[key] ?? key} ${value}`,
          message: caution.message,
          evidence: { cautionId: caution.id, vital: key, reading: value, comparator: caution.comparator, threshold: caution.threshold },
        });
      }
    }
  }

  // --- drug <-> patient ------------------------------------------------------
  const who = input.patient;
  if (who) {
    const age = who.ageYears;
    const weight = vitals?.weightKg ?? null;
    const child = age !== null && age < 12;
    const flag = (drug: Drug, rule: "drug_age" | "drug_dose" | "drug_pregnancy", severity: Severity, ref: string, label: string, message: string, evidence: Record<string, unknown>) =>
      out.push({ ...base, rule, severity, subjectDrugId: drug.id, subjectDrugName: drug.genericName, counterpartKind: "patient", counterpartRef: ref, counterpartLabel: label, message, evidence });
    const years = (n: number) => (n < 1 ? `${Math.round(n * 12)} months` : `${n} years`);

    for (const item of written) {
      const drug = byId.get(item.drugId);
      const sp = drug ? SPECIAL[drug.id] : undefined;
      if (!drug || !sp) continue;

      if (sp.minAge && age !== null && age < sp.minAge.years) {
        flag(drug, "drug_age", sp.minAge.severity, "age", `age ${age}`, sp.minAge.note, { ageYears: age, minAgeYears: sp.minAge.years, limit: years(sp.minAge.years) });
      }

      // Every line of this medicine, added up: what the patient actually takes.
      const dose = daily.get(item.drugId) ?? { mgPerDay: null, lines: 1, checked: 0 };
      const mgDay = dose.mgPerDay;
      const perDose = mgPerDose(item);
      const spoon = item.form === "syrup" ? ` (counting each dose as one ${SPOON_ML} ml spoon)` : "";
      // Said on the flag when more than one line carries the medicine, or the
      // number would not match the line the doctor is looking at.
      const across = dose.lines > 1 ? ` across ${dose.lines} lines of ${drug.genericName}` : "";
      const counted = { mgPerDay: mgDay, lines: dose.lines, linesChecked: dose.checked };
      if (child && sp.childMgPerKgDay) {
        if (weight && mgDay !== null) {
          const perKg = mgDay / weight;
          if (perKg > sp.childMgPerKgDay * 1.05) {
            flag(drug, "drug_dose", "high", "dose_child", `${Math.round(perKg)} mg/kg a day`,
              `${Math.round(mgDay)} mg a day${across} for ${weight} kg is ${Math.round(perKg)} mg/kg a day${spoon}. The most for a child is ${sp.childMgPerKgDay} mg/kg a day (${Math.round(sp.childMgPerKgDay * weight)} mg). Check the strength and how often.`,
              { ...counted, mgPerDose: perDose, weightKg: weight, mgPerKgDay: perKg, maxMgPerKgDay: sp.childMgPerKgDay });
          }
        } else if (!weight && mgDay !== null) {
          flag(drug, "drug_dose", "caution", "weight_missing", "no weight today",
            `A child's dose of ${drug.genericName} goes by weight, and no weight was recorded today, so the dose was not checked. Weigh the child (the most is ${sp.childMgPerKgDay} mg/kg a day).`,
            { ...counted, maxMgPerKgDay: sp.childMgPerKgDay });
        }
      }
      if (sp.maxMgDay && mgDay !== null && mgDay > sp.maxMgDay * 1.0001) {
        flag(drug, "drug_dose", "high", "dose_max", `${Math.round(mgDay)} mg a day`,
          `${Math.round(mgDay)} mg a day${across}${spoon} is more than the most a day, ${sp.maxMgDay} mg. Check the strength and how often.`,
          { ...counted, mgPerDose: perDose, maxMgDay: sp.maxMgDay });
      }

      if (who.pregnancy === "pregnant" && sp.pregnancy) {
        flag(drug, "drug_pregnancy", sp.pregnancy.severity, "pregnancy", "pregnant", sp.pregnancy.note, { pregnancy: who.pregnancy });
      } else if (who.pregnancy === "breastfeeding" && sp.breastfeeding) {
        flag(drug, "drug_pregnancy", sp.breastfeeding.severity, "breastfeeding", "breastfeeding", sp.breastfeeding.note, { pregnancy: who.pregnancy });
      } else if (
        (who.pregnancy === null || who.pregnancy === undefined) &&
        who.sex === "female" &&
        (age === null || (age >= 12 && age <= 50)) &&
        sp.pregnancy?.severity === "high"
      ) {
        flag(drug, "drug_pregnancy", "info", "pregnancy_unknown", "pregnancy not asked",
          `${drug.genericName} is avoided in pregnancy. Ask, and mark pregnant or breastfeeding above if so.`,
          { pregnancy: null, sex: who.sex, ageYears: age });
      }
    }
  }

  return out.sort(
    (a, b) => RANK[b.severity] - RANK[a.severity] || a.subjectDrugName.localeCompare(b.subjectDrugName) || a.rule.localeCompare(b.rule),
  );
}
