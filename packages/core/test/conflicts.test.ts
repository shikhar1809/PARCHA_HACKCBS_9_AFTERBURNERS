import assert from "node:assert/strict";
import { test } from "node:test";

import { conflictKey, runConflictEngine, type ConflictEngineInput } from "../src/conflicts.js";
import { drugs as seedDrugs, interactions as seedInteractions, vitalCautions as seedCautions } from "../src/demo/formulary.js";
import type { Allergy, PrescriptionItem, VitalsSummary } from "../src/types.js";

const drugs = seedDrugs.map((d) => ({
  id: d.id,
  genericName: d.generic,
  commonBrands: d.brands,
  drugClass: d.drugClass,
  forms: d.forms,
  strengths: d.strengths,
  defaultForm: d.defaultForm,
  defaultStrength: d.defaultStrength,
  isOtc: false,
  isSteroid: !!d.steroid,
  allergyClasses: d.allergyClasses ?? [],
  notes: null,
}));
const VITAL_KEYS: Record<string, keyof VitalsSummary> = {
  blood_sugar_mgdl: "bloodSugarMgdl",
  systolic_mmhg: "systolicMmhg",
  diastolic_mmhg: "diastolicMmhg",
  pulse_bpm: "pulseBpm",
  spo2_pct: "spo2Pct",
  temperature_c: "temperatureC",
  respiratory_rate: "respiratoryRate",
  weight_kg: "weightKg",
};
const formulary = {
  drugs,
  interactions: seedInteractions.map((i) => ({ id: `${i.a}__${i.b}`, ...i })),
  vitalCautions: seedCautions.map((c) => ({
    id: c.id,
    drugId: c.drugId ?? null,
    drugClass: c.drugClass ?? null,
    vitalKey: VITAL_KEYS[c.vital] ?? (c.vital as keyof VitalsSummary),
    comparator: c.comparator,
    threshold: c.threshold,
    severity: c.severity,
    message: c.message,
  })),
};

const item = (drugId: string): PrescriptionItem => ({
  drugId,
  drugName: drugs.find((d) => d.id === drugId)!.genericName,
  form: "tablet",
  strength: "1",
  frequency: "BD",
  durationDays: 5,
  timing: "after_food",
  quantity: 10,
});
const allergy = (over: Partial<Allergy>): Allergy => ({
  id: "a1",
  patientId: "p",
  allergyClassId: null,
  label: "Allergy",
  freeText: null,
  reaction: null,
  severity: "high",
  recordedAt: "2026-01-01T00:00:00Z",
  recordedBy: "x",
  source: "patient",
  retractsAllergyId: null,
  ...over,
});
const vitals = (over: Partial<VitalsSummary>): VitalsSummary => ({
  systolicMmhg: null, diastolicMmhg: null, pulseBpm: null, temperatureC: null, respiratoryRate: null,
  spo2Pct: null, weightKg: null, heightCm: null, bloodSugarMgdl: null, bloodSugarType: null, ...over,
});
const run = (over: Partial<ConflictEngineInput>) =>
  runConflictEngine({ visitId: "v", patientId: "p", prescriptionId: "rx", items: [], vitals: null, allergies: [], currentDrugIds: [], formulary, ...over });

test("a clean prescription raises nothing", () => {
  assert.deepEqual(run({ items: [item("paracetamol"), item("cetirizine")] }), []);
});

test("penicillin allergy flags amoxicillin and its combination, high severity", () => {
  const flags = run({ items: [item("amoxicillin"), item("amoxicillin_clavulanate")], allergies: [allergy({ allergyClassId: "penicillins", label: "Penicillins" })] });
  assert.equal(flags.filter((f) => f.rule === "drug_allergy").length, 2);
  assert.ok(flags.every((f) => f.severity === "high"));
});

test("a different class does not fire", () => {
  assert.deepEqual(run({ items: [item("azithromycin")], allergies: [allergy({ allergyClassId: "penicillins" })] }), []);
});

test("an allergy written in free text that names the drug still fires", () => {
  const flags = run({ items: [item("ibuprofen")], allergies: [allergy({ label: "Ibuprofen se rash", allergyClassId: null })] });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].evidence.matchedOn, "name");
});

test("warfarin with ibuprofen inside the prescription is flagged once, whichever order", () => {
  const a = run({ items: [item("warfarin"), item("ibuprofen")] }).filter((f) => f.rule === "drug_drug");
  const b = run({ items: [item("ibuprofen"), item("warfarin")] }).filter((f) => f.rule === "drug_drug");
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].severity, "high");
});

test("an interaction with a drug the patient already takes is found, and says so", () => {
  const flags = run({ items: [item("ibuprofen")], currentDrugIds: ["warfarin"] });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].evidence.source, "already_taking");
});

test("a drug already taking and also written is not compared with itself", () => {
  assert.deepEqual(run({ items: [item("paracetamol")], currentDrugIds: ["paracetamol"] }), []);
});

test("prednisolone on a sugar of 312 is flagged high, once, and is the headline case", () => {
  const flags = run({ items: [item("prednisolone")], vitals: vitals({ bloodSugarMgdl: 312 }) });
  const v = flags.filter((f) => f.rule === "drug_vitals");
  assert.equal(v.length, 1);
  assert.equal(v[0].severity, "high");
  assert.equal(v[0].evidence.reading, 312);
});

test("a moderately raised sugar fires only the class caution", () => {
  const v = run({ items: [item("prednisolone")], vitals: vitals({ bloodSugarMgdl: 200 }) }).filter((f) => f.rule === "drug_vitals");
  assert.equal(v.length, 1);
  assert.equal(v[0].severity, "caution");
});

test("a normal sugar fires nothing, and a missing reading fires nothing", () => {
  assert.deepEqual(run({ items: [item("prednisolone")], vitals: vitals({ bloodSugarMgdl: 110 }) }), []);
  assert.deepEqual(run({ items: [item("prednisolone")], vitals: vitals({}) }), []);
});

test("flags are sorted worst first and keys are stable", () => {
  const flags = run({
    items: [item("prednisolone"), item("ibuprofen"), item("amoxicillin")],
    vitals: vitals({ bloodSugarMgdl: 200 }),
    allergies: [allergy({ allergyClassId: "penicillins" })],
  });
  assert.ok(flags.length >= 3);
  const ranks = flags.map((f) => ({ info: 0, caution: 1, high: 2 })[f.severity]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
  assert.equal(new Set(flags.map(conflictKey)).size, flags.length);
});

test("the same input always gives the same answer", () => {
  const input = { items: [item("warfarin"), item("aspirin"), item("prednisolone")], vitals: vitals({ bloodSugarMgdl: 300 }) };
  assert.deepEqual(run(input), run(input));
});

/* ------------------------------------------------ age, dose, pregnancy, by hand */

const dosed = (drugId: string, strength: string, frequency: string, form = "tablet"): PrescriptionItem => ({ ...item(drugId), strength, frequency, form });
const adult = { ageYears: 35, sex: "male" as const, pregnancy: null };

test("too young: aspirin under 16 and codeine under 12 are high", () => {
  const flags = run({ items: [dosed("aspirin", "75 mg", "1-0-0"), dosed("codeine", "15 mg", "1-0-1")], patient: { ageYears: 9, sex: "male", pregnancy: null } });
  const age = flags.filter((f) => f.rule === "drug_age");
  assert.deepEqual(age.map((f) => [f.subjectDrugId, f.severity]).sort(), [["aspirin", "high"], ["codeine", "high"]]);
});

test("the most a day: paracetamol 650 four times is fine, 1 g four times is not", () => {
  assert.equal(run({ items: [dosed("paracetamol", "650 mg", "1-1-1-1")], patient: adult }).filter((f) => f.rule === "drug_dose").length, 0);
  const over = run({ items: [{ ...dosed("paracetamol", "1 g", "1-1-1-1-1") }], patient: adult }).filter((f) => f.rule === "drug_dose");
  assert.equal(over.length, 1);
  assert.equal(over[0].severity, "high");
  assert.equal(over[0].evidence.mgPerDay, 5000);
});

test("the same medicine on two lines is added up, and flagged once", () => {
  // 650 four times is 2,600 and 500 three times is 1,500: each line is within
  // the 4,000 mg a day, and together they are 4,100.
  const each = [dosed("paracetamol", "650 mg", "1-1-1-1"), dosed("paracetamol", "500 mg", "1-1-1")];
  for (const one of each) assert.equal(run({ items: [one], patient: adult }).filter((f) => f.rule === "drug_dose").length, 0);
  const both = run({ items: each, patient: adult }).filter((f) => f.rule === "drug_dose");
  assert.equal(both.length, 1, "one flag for the medicine, not one for each line");
  assert.equal(both[0].severity, "high");
  assert.equal(both[0].evidence.mgPerDay, 4100);
  assert.equal(both[0].evidence.lines, 2);
  assert.match(both[0].message, /across 2 lines of paracetamol/i);
});

test("two lines that come to less than the most a day are left alone", () => {
  const flags = run({
    items: [dosed("paracetamol", "650 mg", "1-0-1"), dosed("paracetamol", "500 mg", "1-0-0")],
    patient: adult,
  });
  assert.equal(flags.filter((f) => f.rule === "drug_dose").length, 0);
});

test("a line whose dose cannot be read adds nothing, and the flag says how many were counted", () => {
  const flags = run({
    items: [dosed("paracetamol", "1 g", "1-1-1-1-1"), dosed("paracetamol", "325 mg + 37.5 mg", "1-0-1")],
    patient: adult,
  }).filter((f) => f.rule === "drug_dose");
  assert.equal(flags.length, 1);
  assert.equal(flags[0].evidence.mgPerDay, 5000, "the combination line is not guessed at");
  assert.equal(flags[0].evidence.lines, 2);
  assert.equal(flags[0].evidence.linesChecked, 1);
});

test("a child's two lines of the same syrup are added before the weight sum", () => {
  // One spoon three times is 375 mg, which 10 kg allows twice over (600 mg);
  // the same syrup written twice is 750 mg, or 75 mg/kg against a most of 60.
  const line = dosed("paracetamol", "125 mg/5 ml", "1-1-1", "syrup");
  const child = { ageYears: 2, sex: "female" as const, pregnancy: null };
  const flags = run({ items: [line, { ...line }], vitals: vitals({ weightKg: 10 }), patient: child }).filter((f) => f.rule === "drug_dose");
  assert.equal(flags.length, 1);
  assert.equal(flags[0].counterpartRef, "dose_child");
  assert.equal(Math.round(flags[0].evidence.mgPerKgDay as number), 75);
});

test("a child's dose goes by weight, read per 5 ml spoon of syrup", () => {
  // 125 mg/5 ml, two spoons four times a day = 1000 mg; 10 kg allows 600.
  const flags = run({
    items: [dosed("paracetamol", "125 mg/5 ml", "2-2-2-2", "syrup")],
    vitals: vitals({ weightKg: 10 }),
    patient: { ageYears: 2, sex: "female", pregnancy: null },
  }).filter((f) => f.rule === "drug_dose");
  assert.equal(flags.length, 1);
  assert.equal(flags[0].counterpartRef, "dose_child");
  assert.equal(Math.round(flags[0].evidence.mgPerKgDay as number), 100);
  // One spoon three times (375 mg, 37.5 mg/kg) is within it.
  const ok = run({ items: [dosed("paracetamol", "125 mg/5 ml", "1-1-1", "syrup")], vitals: vitals({ weightKg: 10 }), patient: { ageYears: 2, sex: "female", pregnancy: null } });
  assert.equal(ok.filter((f) => f.rule === "drug_dose").length, 0);
});

test("a child with no weight today: the dose is said to be unchecked, not passed", () => {
  const flags = run({ items: [dosed("amoxicillin", "250 mg", "1-1-1", "capsule")], patient: { ageYears: 4, sex: "male", pregnancy: null } });
  const w = flags.find((f) => f.counterpartRef === "weight_missing");
  assert.ok(w);
  assert.equal(w.severity, "caution");
});

test("pregnancy: an ARB is high when pregnant, a note when not asked, nothing for a man", () => {
  const preg = run({ items: [dosed("telmisartan", "40 mg", "1-0-0")], patient: { ageYears: 28, sex: "female", pregnancy: "pregnant" } });
  assert.equal(preg.find((f) => f.rule === "drug_pregnancy")?.severity, "high");
  const unasked = run({ items: [dosed("telmisartan", "40 mg", "1-0-0")], patient: { ageYears: 28, sex: "female", pregnancy: null } });
  assert.equal(unasked.find((f) => f.rule === "drug_pregnancy")?.counterpartRef, "pregnancy_unknown");
  assert.equal(unasked.find((f) => f.rule === "drug_pregnancy")?.severity, "info");
  assert.equal(run({ items: [dosed("telmisartan", "40 mg", "1-0-0")], patient: adult }).filter((f) => f.rule === "drug_pregnancy").length, 0);
  assert.equal(run({ items: [dosed("telmisartan", "40 mg", "1-0-0")], patient: { ageYears: 28, sex: "female", pregnancy: "no" } }).filter((f) => f.rule === "drug_pregnancy").length, 0);
});

test("breastfeeding: codeine is high", () => {
  const flags = run({ items: [dosed("codeine", "15 mg", "1-0-1")], patient: { ageYears: 30, sex: "female", pregnancy: "breastfeeding" } });
  assert.equal(flags.find((f) => f.rule === "drug_pregnancy")?.counterpartRef, "breastfeeding");
});

test("written by hand: flagged as unchecked, still read against a free-text allergy", () => {
  const byHand: PrescriptionItem = { ...dosed("paracetamol", "", "1-0-1"), drugId: "unlisted:rabeprazole", drugName: "Rabeprazole", unlisted: true };
  const flags = run({ items: [byHand], allergies: [allergy({ label: "Rabeprazole rash" })], patient: adult });
  assert.deepEqual(flags.map((f) => f.rule).sort(), ["drug_allergy", "unlisted"]);
  assert.equal(flags.find((f) => f.rule === "unlisted")?.severity, "caution");
});

test("without the patient, the new rules stay quiet (older callers)", () => {
  assert.equal(run({ items: [dosed("aspirin", "75 mg", "1-0-0")] }).length, 0);
});
