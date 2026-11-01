/**
 * The closed-world gate: nothing the model invents may reach the pad.
 *
 * Every case here is an adversarial model output. The bar is not "usually
 * caught" — it is zero leaks, which is why the last test fuzzes instead of
 * listing. If any of these ever fails, the feature is unsafe to ship.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { drugs as seed } from "../src/demo/formulary.js";
import { COMMON_TESTS } from "../src/special.js";
import type { Drug, PrescriptionItem } from "../src/types.js";
import { FREQUENCIES, agentTools, grounded, mergeAgentActions, quoted } from "../src/voiceAgent.js";
import type { VoiceAction } from "../src/voice.js";

const drugs = seed.map((d) => ({
  id: d.id,
  genericName: d.generic,
  commonBrands: d.brands,
  drugClass: d.drugClass,
  forms: d.forms,
  strengths: d.strengths,
  defaultForm: d.defaultForm,
  defaultStrength: d.defaultStrength,
  isOtc: false,
  isSteroid: false,
  allergyClasses: [],
  notes: null,
})) as Drug[];

const real = drugs[0];
const item = (over: Partial<PrescriptionItem> = {}): PrescriptionItem => ({
  drugId: real.id,
  drugName: real.genericName,
  form: real.defaultForm,
  strength: real.defaultStrength,
  frequency: "1-0-1",
  durationDays: 3,
  timing: "after_food",
  quantity: 6,
  ...over,
});
const med = (over: Partial<PrescriptionItem> = {}): VoiceAction => ({
  kind: "medicines",
  proposals: [{ item: item(over), assumed: [], source: "" } as never],
});

test("a valid action is grounded, so the gate is not simply refusing everything", () => {
  assert.equal(grounded(med(), drugs), true);
  assert.equal(grounded({ kind: "tests", values: [COMMON_TESTS[0]] }, drugs), true);
  assert.equal(grounded({ kind: "followUp", days: 5 }, drugs), true);
});

test("a medicine the clinic does not have is dropped", () => {
  assert.equal(grounded(med({ drugId: "ceftriaxone-x", drugName: "Ceftriaxone" }), drugs), false);
  assert.equal(grounded(med({ drugId: "" }), drugs), false);
});

test("a real medicine at an impossible strength is dropped", () => {
  assert.equal(grounded(med({ strength: "9999 mg" }), drugs), false);
  assert.equal(grounded(med({ strength: real.strengths[0] }), drugs), true);
});

test("a medicine written by hand can never come from the model", () => {
  // Only a doctor may write an unlisted line, by typing, in the manual pad.
  assert.equal(grounded(med({ drugId: "unlisted:some cough syrup" }), drugs), false);
});

test("a test not on the clinic's list is dropped", () => {
  assert.equal(grounded({ kind: "tests", values: ["Full body MRI"] }, drugs), false);
  assert.equal(grounded({ kind: "tests", values: [] }, drugs), false);
});

test("an unknown frequency is dropped", () => {
  assert.equal(grounded(med({ frequency: "every 4 hours" }), drugs), false);
  for (const f of FREQUENCIES) assert.equal(grounded(med({ frequency: f }), drugs), true, f);
});

test("an out-of-range or non-integer duration is dropped", () => {
  for (const d of [0, -1, 365, 1.5, NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(grounded(med({ durationDays: d as number }), drugs), false, String(d));
  }
  assert.equal(grounded(med({ durationDays: 90 }), drugs), true);
  assert.equal(grounded({ kind: "followUp", days: 400 }, drugs), false);
  assert.equal(grounded({ kind: "followUp", days: 0 }, drugs), false);
});

test("the doctor's own controls can never be driven by the model", () => {
  assert.equal(grounded({ kind: "undo" }, drugs), false);
  assert.equal(grounded({ kind: "readBack" }, drugs), false);
});

test("diagnosis and advice must be words the doctor actually said", () => {
  const said = "she has viral fever, give paracetamol and tell her to rest";
  assert.equal(quoted("viral fever", said), true);
  // Punctuation and spacing may differ; the words may not.
  assert.equal(quoted("Viral  Fever.", said), true);
  assert.equal(quoted("bacterial pneumonia", said), false);
  // Too short to be meaningful.
  assert.equal(quoted("a", said), false);
});

test("a diagnosis the model composed is rejected even though it is well formed", () => {
  const said = "she has been coughing for two weeks";
  const m = mergeAgentActions([], [{ kind: "diagnosis", value: "Pulmonary tuberculosis" }], drugs, said);
  assert.deepEqual(m.actions, []);
  assert.equal(m.rejected.length, 1);
  assert.match(m.rejected[0].reason, /not said/);
});

test("the rules win every conflict", () => {
  const rules: VoiceAction[] = [{ kind: "diagnosis", value: "Viral fever" }];
  const said = "viral fever, maybe dengue";
  const m = mergeAgentActions(rules, [{ kind: "diagnosis", value: "dengue" }], drugs, said);
  assert.deepEqual(m.actions, rules, "the rules' diagnosis stands");
  assert.match(m.rejected[0].reason, /already placed diagnosis/);
});

test("the model may fill a box the rules left empty", () => {
  const said = "tell her to rest and drink fluids";
  const m = mergeAgentActions([], [{ kind: "advice", value: "rest and drink fluids" }], drugs, said);
  assert.equal(m.actions.length, 1);
  assert.equal(m.provenance[0].from, "agent");
});

test("with no model output the merge is the identity", () => {
  // This is what guarantees the pad behaves exactly as today when Meko is off.
  const rules: VoiceAction[] = [{ kind: "diagnosis", value: "Viral fever" }, { kind: "followUp", days: 5 }];
  const m = mergeAgentActions(rules, [], drugs);
  assert.deepEqual(m.actions, rules);
  assert.deepEqual(m.rejected, []);
  assert.equal(m.provenance[0].from, "rules");
});

test("the tool schemas offer no free-text field for clinical content", () => {
  const tools = agentTools(drugs);
  const byName = Object.fromEntries(tools.map((t) => [t.function.name, t.function.parameters as never]));
  const props = (n: string) => (byName[n] as { properties: Record<string, { enum?: unknown[]; type: string }> }).properties;
  // Every clinical identifier is an enum, never a string the model composes.
  assert.ok(Array.isArray(props("place_medicine").drugId.enum));
  assert.ok(Array.isArray(props("place_medicine").strength.enum));
  assert.ok(Array.isArray(props("place_medicine").frequency.enum));
  assert.ok(Array.isArray(props("place_test").test.enum));
  // The one free string is a quote, and `quoted()` forces it to be the doctor's words.
  assert.equal(props("place_text").quote.type, "string");
  assert.ok(Array.isArray(props("place_text").box.enum));
  // The enum is built from this clinic's formulary, so an unknown id is not expressible.
  assert.ok(!(props("place_medicine").drugId.enum as string[]).includes("ceftriaxone-x"));
});

test("fuzz: no perturbed action ever reaches the pad", () => {
  // Property: grounded(a) === false  =>  a is not in merge.actions. 2000 cases.
  const junkIds = ["", "x", "unlisted:x", "paracetamol-x", "DRUG", "../etc", "null"];
  const junkStrengths = ["", "0 mg", "9999 mg", "1 kg", "lots"];
  const junkFreq = ["", "q4h", "1-2-3-4-5", "twice", "0-0-0-0-0"];
  let checked = 0;
  for (let i = 0; i < 2000; i++) {
    const pick = <T>(xs: T[]) => xs[i % xs.length];
    const a = med({
      drugId: i % 3 === 0 ? pick(junkIds) : real.id,
      strength: i % 5 === 0 ? pick(junkStrengths) : real.defaultStrength,
      frequency: i % 7 === 0 ? pick(junkFreq) : "1-0-1",
      durationDays: i % 11 === 0 ? i - 500 : 3,
    });
    const m = mergeAgentActions([], [a], drugs, "");
    if (!grounded(a, drugs)) {
      assert.deepEqual(m.actions, [], `leaked at i=${i}: ${JSON.stringify(a)}`);
      checked++;
    } else {
      assert.equal(m.actions.length, 1);
    }
  }
  assert.ok(checked > 100, `the fuzz should exercise the reject path (rejected ${checked})`);
});
