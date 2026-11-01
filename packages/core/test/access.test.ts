import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanAccess, cleanAccessNeeds, spokenDose, spokenReminder } from "../src/access.js";

const line = { drugId: "paracetamol", drugName: "Paracetamol", form: "tablet", strength: "650 mg", frequency: "1-0-1", durationDays: 3, timing: "after_food" as const, quantity: 6 };

test("a dose is read the way a person would say it", () => {
  assert.equal(spokenDose(line), "Paracetamol 650 mg: one tablet in the morning and one tablet at night, after food, for three days.");
  assert.equal(spokenDose({ ...line, frequency: "1-1-1" }), "Paracetamol 650 mg: one tablet in the morning, one tablet in the afternoon and one tablet at night, after food, for three days.");
  assert.equal(spokenDose({ ...line, frequency: "SOS" }), "Paracetamol 650 mg: only when needed, after food.");
});

test("in Hindi too", () => {
  assert.equal(spokenDose(line, "hi"), "Paracetamol 650 mg: एक गोली सुबह और एक गोली रात, खाने के बाद, तीन दिन तक।");
});

test("a syrup is spoons, two tablets is plural", () => {
  assert.match(spokenDose({ ...line, form: "syrup", frequency: "0-0-2" }), /two spoons at night/);
  assert.match(spokenDose({ ...line, frequency: "2-0-0" }), /two tablets in the morning/);
});

test("a reminder names the person", () => {
  assert.equal(spokenReminder("Prabha Devi", ["Calcium 500"]), "Prabha, it is time for your medicine: Calcium 500.");
});

test("access settings and needs are cleaned", () => {
  assert.deepEqual(cleanAccess({ deaf: true, lowVision: "yes" }), { lowVision: false, deaf: true, largeText: false, highContrast: false });
  assert.deepEqual(cleanAccessNeeds(["deaf", "x", "low_vision"]), ["low_vision", "deaf"]);
});
