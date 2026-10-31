import assert from "node:assert/strict";
import { test } from "node:test";

import { drugs as seed } from "../src/demo/formulary.js";
import { spellMedicines } from "../src/soundsLike.js";
import { routeSpeech, type PadState } from "../src/voice.js";

const drugs = seed.map((d) => ({ id: d.id, genericName: d.generic, commonBrands: d.brands, defaultForm: d.defaultForm, defaultStrength: d.defaultStrength, strengths: d.strengths, forms: d.forms }));
const empty: PadState = { diagnosis: "", followUp: "", items: [], guessed: {}, skipped: [] };

test("medicine names spelled by ear become the names on the list", () => {
  // What Whisper wrote for a recorded dictation.
  const a = spellMedicines("Diagnosis urinary tract infection. Syprophloxysin 500 twice a day for five days after food. Parasetamal 650 when needed.", drugs);
  assert.equal(a.text, "Diagnosis urinary tract infection. Ciprofloxacin 500 twice a day for five days after food. Paracetamol 650 when needed.");
  assert.deepEqual(a.changed, [["Syprophloxysin", "Ciprofloxacin"], ["Parasetamal", "Paracetamol"]]);
  assert.match(spellMedicines("Siprofloxus in 500", drugs).text, /^Ciprofloxacin 500$/);
  assert.match(spellMedicines("Metformin 500 BD-M Load-A-Bin 5OD", drugs).text, /Amlodipine 5 OD/);
  assert.match(spellMedicines("Metformin 500 BD loadapine 5 OD", drugs).text, /BD Amlodipine 5 OD/);
  assert.match(spellMedicines("as it throw mice in 500 once a day", drugs).text, /^Azithromycin in 500/);
  assert.equal(spellMedicines("Monte lukas 10 at night", drugs).text, "Montelukast 10 at night");
  // Ordinary words stay as they are.
  assert.equal(spellMedicines("the patient has a cough", drugs).text, "the patient has a cough");
  const plain = "Diagnosis viral fever. Advice rest and plenty of fluids. Urine routine and lipid profile. Follow up in five days.";
  assert.equal(spellMedicines(plain, drugs).text, plain);
});

test("a dictation spelled by ear is placed like one spelled right", () => {
  const a = routeSpeech("Diagnosis Type 2 Diabetes Metformin 500 BD M Load-A-Bin 5OD HBA 1C and lipid profile Review after 3 months", drugs, empty, null);
  const meds = a.flatMap((x) => (x.kind === "medicines" ? x.proposals.map((p) => p.item.drugName) : []));
  assert.deepEqual(meds, ["Metformin", "Amlodipine"]);
  assert.deepEqual(a.find((x) => x.kind === "followUp"), { kind: "followUp", days: 90 });
  assert.deepEqual(a.flatMap((x) => (x.kind === "tests" ? x.values : [])).sort(), ["HbA1c", "Lipid profile"]);
  assert.deepEqual(a.filter((x) => x.kind === "unplaced"), []);
});
