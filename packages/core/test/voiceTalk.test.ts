import assert from "node:assert/strict";
import { test } from "node:test";

import { drugs as seed } from "../src/demo/formulary.js";
import { routeSpeech, sayLine, sayPrescription, type PadState, type VoiceAction } from "../src/voice.js";

const drugs = seed.map((d) => ({ id: d.id, genericName: d.generic, commonBrands: d.brands, defaultForm: d.defaultForm, defaultStrength: d.defaultStrength, strengths: d.strengths, forms: d.forms }));
const empty: PadState = { diagnosis: "", followUp: "", items: [], guessed: {}, skipped: [] };
const line = (id: string, name: string) => ({ drugId: id, drugName: name, form: "tablet", strength: "", frequency: "1-0-0", durationDays: 5, timing: "any" as const, quantity: 5 });
const meds = (a: VoiceAction[]) => a.flatMap((x) => (x.kind === "medicines" ? x.proposals.map((p) => p.item) : []));
const kinds = (a: VoiceAction[]) => a.map((x) => x.kind);

test("the ways doctors say a prescription are each placed", () => {
  // Lead-in words are not medicines; "before breakfast" is before food.
  const a = routeSpeech("Give him amoxicillin 500 thrice daily for five days and pantoprazole 40 before breakfast.", drugs, empty, null);
  assert.ok(kinds(a).every((k) => k === "medicines"));
  assert.deepEqual(meds(a).map((m) => [m.drugName, m.frequency, m.timing]), [["Amoxicillin", "1-1-1", "any"], ["Pantoprazole", "1-0-0", "before_food"]]);

  // "Stop the X" takes it off; it does not add it.
  const on: PadState = { ...empty, items: [line("ibuprofen", "Ibuprofen")] };
  const b = routeSpeech("Stop the ibuprofen. Add omeprazole 20 empty stomach for two weeks.", drugs, on, null);
  assert.deepEqual(kinds(b), ["remove", "medicines"]);
  assert.equal(meds(b)[0].durationDays, 14);

  // Advice said plainly is advice, not a medicine that sounds a little like it.
  const c = routeSpeech("Diagnosis acute pharyngitis. Azithromycin 500 once a day for 3 days. Warm saline gargles. Review after 5 days.", drugs, empty, null);
  assert.deepEqual(kinds(c), ["diagnosis", "medicines", "advice", "followUp"]);

  // "Patient has …" is the diagnosis; SOS and bedtime are read; "a week" is 7 days.
  const d = routeSpeech("Patient has viral fever. Dolo 650 SOS. Cetirizine 10 at bedtime for 5 days. Come back after a week.", drugs, empty, null);
  assert.equal(d[0].kind === "diagnosis" && d[0].value, "Viral fever");
  assert.deepEqual(meds(d).map((m) => [m.drugName, m.frequency]), [["Paracetamol", "SOS"], ["Cetirizine", "0-0-1"]]);
  assert.deepEqual(d.at(-1), { kind: "followUp", days: 7 });

  // Hinglish, with the length said once for both.
  const e = routeSpeech("Levocetirizine 5 raat ko, pantoprazole 40 subah khaali pet, paanch din.", drugs, empty, null);
  assert.deepEqual(meds(e).map((m) => [m.drugName, m.frequency, m.timing, m.durationDays]), [
    ["Levocetirizine", "0-0-1", "any", 5],
    ["Pantoprazole", "1-0-0", "empty_stomach", 5],
  ]);
  assert.ok(kinds(e).every((k) => k === "medicines"));

  // "...then stop" is not a removal.
  assert.deepEqual(kinds(routeSpeech("Prednisolone 10 mg once a day after breakfast for 5 days then stop.", drugs, empty, null)), ["medicines"]);
});

test("a medicine already on the prescription is changed, not added again", () => {
  const on: PadState = { ...empty, items: [line("paracetamol", "Paracetamol")] };
  const a = routeSpeech("Make paracetamol five days instead.", drugs, on, null);
  assert.deepEqual(a, [{ kind: "change", drugId: "paracetamol", drugName: "Paracetamol", patch: { durationDays: 5 } }]);
});

test("it, that and both mean the medicines last talked about", () => {
  const items = [line("metformin", "Metformin"), line("amlodipine", "Amlodipine")];
  const st: PadState = { ...empty, items, focus: ["metformin", "amlodipine"] };
  assert.deepEqual(routeSpeech("make it 30 days", drugs, st, null), [{ kind: "change", drugId: "amlodipine", drugName: "Amlodipine", patch: { durationDays: 30 } }]);
  assert.deepEqual(kinds(routeSpeech("both for one month", drugs, st, null)), ["change", "change"]);
  assert.deepEqual(routeSpeech("remove that", drugs, st, null), [{ kind: "remove", drugName: "Amlodipine" }]);
  assert.deepEqual(routeSpeech("make it 1000", drugs, { ...st, focus: ["metformin"] }, null), [{ kind: "change", drugId: "metformin", drugName: "Metformin", patch: { strength: "1 g" } }]);
  assert.deepEqual(routeSpeech("undo", drugs, st, null), [{ kind: "undo" }]);
  assert.deepEqual(routeSpeech("read it back", drugs, st, null), [{ kind: "readBack" }]);
  // With nothing talked about yet, "it" points at nothing and nothing is changed.
  assert.ok(!kinds(routeSpeech("make it 30 days", drugs, { ...st, focus: [] }, null)).includes("change"));
});

test("what was done is said back plainly", () => {
  assert.equal(sayLine({ drugName: "Azithromycin", strength: "500 mg", frequency: "1-0-0", durationDays: 3, timing: "after_food" }), "Azithromycin 500 mg, once a day, morning, for 3 days, after food");
  assert.equal(
    sayPrescription({ diagnosis: "Viral fever", items: [{ ...line("p", "Paracetamol"), strength: "650 mg", frequency: "SOS" }], tests: ["CBC"], advice: "Rest", followUp: "5" }),
    "Diagnosis: Viral fever. 1. Paracetamol 650 mg, when needed, for 5 days. Tests: CBC. Advice: Rest. Follow-up in 5 days.",
  );
});

test("a medicine said while another is being asked about is that medicine, not the answer", () => {
  const st: PadState = { ...empty, items: [line("omeprazole", "Omeprazole")], guessed: { omeprazole: ["frequency"] } };
  const q = { kind: "frequency" as const, drugId: "omeprazole", drugName: "Omeprazole", ask: "How often is Omeprazole?" };
  const a = routeSpeech("Start metformin 500 twice a day", drugs, st, q);
  assert.deepEqual(meds(a).map((m) => [m.drugName, m.frequency]), [["Metformin", "1-0-1"]]);
  assert.ok(!kinds(a).includes("answer"));
  // The answer itself still answers.
  assert.deepEqual(routeSpeech("twice a day", drugs, st, q), [{ kind: "answer", question: q, patch: { frequency: "1-0-1" } }]);
});
