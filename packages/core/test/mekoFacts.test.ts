import assert from "node:assert/strict";
import { test } from "node:test";

import { habitFacts, namingFact, placementFact, sendableFacts } from "../src/mekoFacts.js";
import { scopeKeys } from "../src/mekoScope.js";
import type { PrescriptionItem } from "../src/types.js";

const scope = scopeKeys("hosp1", "uid-meena", "test-salt");
const line = (over: Partial<PrescriptionItem> = {}): PrescriptionItem => ({
  drugId: "paracetamol",
  drugName: "Paracetamol",
  form: "tablet",
  strength: "650 mg",
  frequency: "1-0-1",
  durationDays: 3,
  timing: "after_food",
  quantity: 6,
  ...over,
});

test("a signed prescription becomes one habit fact per line", () => {
  const facts = habitFacts({ diagnosis: "Viral fever", items: [line(), line({ drugId: "azithromycin", drugName: "Azithromycin", strength: "500 mg", frequency: "1-0-0" })] }, scope);
  assert.equal(facts.length, 2);
  assert.equal(facts[0].agent, "habit");
  assert.match(facts[0].text, /writes paracetamol-650mg 1-0-1 for 3 days after-food for viral-fever/);
  assert.match(facts[1].text, /azithromycin-500mg 1-0-0/);
});

test("the same habit written twice produces the same sentence", () => {
  // Otherwise Meko accumulates near-duplicates that dilute the search.
  const once = habitFacts({ diagnosis: "Viral fever", items: [line()] }, scope);
  const twice = habitFacts({ diagnosis: "viral  FEVER ", items: [line()] }, scope);
  assert.equal(once[0].text, twice[0].text);
});

test("a fact carries no patient, no date and no visit", () => {
  const [f] = habitFacts({ diagnosis: "Viral fever", items: [line()] }, scope);
  assert.ok(!/\d{1,2}\/\d{1,2}/.test(f.text), "no date");
  assert.ok(!/visit|patient/i.test(f.text), "no visit or patient");
  // The doctor appears only as an opaque key, never as a uid.
  assert.ok(!f.text.includes("uid-meena"));
  assert.match(f.text, /^d:[0-9a-f]{12} /);
});

test("a medicine written by hand is never sent", () => {
  // Its name is free text the doctor typed, so it could be anything.
  const facts = habitFacts({ diagnosis: "Fever", items: [line({ drugId: "unlisted:some syrup" })] }, scope);
  assert.deepEqual(facts, []);
});

test("naming and placement facts go to their own agents", () => {
  const n = namingFact("Dolo", { drugName: "Paracetamol", strength: "650 mg" }, scope);
  assert.equal(n?.agent, "formulary");
  assert.match(n!.text, /^c:[0-9a-f]{12} says 'dolo' for paracetamol-650mg$/);
  const p = placementFact("the patient has", "diagnosis", scope);
  assert.equal(p?.agent, "scribe");
  assert.match(p!.text, /'the patient has' is diagnosis/);
  // Nothing useful in, nothing out.
  assert.equal(namingFact("", { drugName: "Paracetamol", strength: "" }, scope), null);
  assert.equal(placementFact("   ", "advice", scope), null);
});

test("a fact that somehow carries an identifier is refused, not sent", () => {
  const good = habitFacts({ diagnosis: "Viral fever", items: [line()] }, scope);
  const leaked = placementFact("call 9876543210 after", "advice", scope)!;
  const { send, refused } = sendableFacts([...good, leaked]);
  assert.equal(send.length, 1);
  assert.equal(refused.length, 1);
  assert.match(refused[0].reason, /phone/);
});

test("scope keys are stable, opaque and separate doctors from clinics", () => {
  const a = scopeKeys("hosp1", "uid-meena", "test-salt");
  const b = scopeKeys("hosp1", "uid-khan", "test-salt");
  assert.equal(a.doctorKey, scope.doctorKey, "stable across calls");
  assert.equal(a.clinicKey, b.clinicKey, "same hospital, same clinic key");
  assert.notEqual(a.doctorKey, b.doctorKey, "different doctors, different keys");
  // A different salt gives different keys, so the salt is load-bearing.
  assert.notEqual(scopeKeys("hosp1", "uid-meena", "other-salt").doctorKey, a.doctorKey);
  assert.match(a.doctorKey, /^[0-9a-f]{12}$/);
});
