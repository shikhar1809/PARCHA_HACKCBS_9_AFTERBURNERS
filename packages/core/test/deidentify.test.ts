import assert from "node:assert/strict";
import { test } from "node:test";

import { deidentify, sendable } from "../src/deidentify.js";

test("a prescribing pattern is what we are willing to send", () => {
  const ok = deidentify("writes paracetamol 650 1-0-1 for 3 days after food for viral fever");
  assert.equal(ok.ok, true);
  assert.ok(sendable("clinic says dolo for paracetamol 650"));
  assert.ok(sendable("azithromycin 500 once a day for 3 days"));
  // Numbers that are doses, not identifiers, must pass: this is the common case.
  assert.ok(sendable("metformin 500 twice a day, amlodipine 5 once a day"));
  assert.ok(sendable("follow up in 30 days"));
});

test("anything that could identify a patient is refused, not scrubbed", () => {
  for (const [label, text] of [
    ["phone", "call her on 9876543210 if the fever returns"],
    ["phone spaced", "contact 98765 43210"],
    ["aadhaar", "aadhaar 1234 5678 9012"],
    ["email", "send the report to prashant.kumar@gmail.com"],
    ["age", "45 years old with viral fever"],
    ["age field", "age: 45, viral fever"],
    ["date", "seen on 12/04/2026"],
    ["honorific", "Mr Sharma has viral fever"],
    ["address", "house no 14, gali 3"],
    ["patientId", "patients/aBc123XyZ789q"],
  ] as const) {
    const r = deidentify(text);
    assert.equal(r.ok, false, `${label} should be refused: ${text}`);
    assert.ok(!r.ok && r.found.length > 0, `${label} should name what it found`);
    assert.ok(!r.ok && r.reason.startsWith("Not sent:"), `${label} should explain itself`);
  }
});

test("the patient's own name is caught even when it is an ordinary word", () => {
  // Asha, Lata and Hema are names here and words elsewhere. Known beats clever.
  const r = deidentify("asha is feeling better after the paracetamol", { patientName: "Asha Devi" });
  assert.equal(r.ok, false);
  assert.deepEqual(!r.ok && r.found, ["patientName"]);
  // Each part of the name counts, not only the whole.
  assert.equal(deidentify("devi has a cough", { patientName: "Asha Devi" }).ok, false);
  // Without that patient in context the same words are only words.
  assert.equal(deidentify("asha is feeling better after the paracetamol").ok, true);
});

test("a name is matched whole, so a medicine that contains it still passes", () => {
  // "Ram" inside "ramipril" must not refuse an ordinary prescribing pattern.
  assert.equal(deidentify("ramipril 5 once a day", { patientName: "Ram Singh" }).ok, true);
  assert.equal(deidentify("ram has high bp", { patientName: "Ram Singh" }).ok, false);
});

test("the patient's phone is caught however it is written", () => {
  const known = { phone: "9876543210" };
  assert.equal(deidentify("ring 98765-43210", known).ok, false);
  assert.equal(deidentify("ring +91 98765 43210", known).ok, false);
});

test("it fails closed: one hit refuses the whole text", () => {
  // A perfectly good habit sentence with one phone number in it is still refused.
  const r = deidentify("paracetamol 650 twice a day, call 9876543210 if worse");
  assert.equal(r.ok, false);
  // And it never returns a half-scrubbed string to send.
  assert.ok(!("text" in r));
});
