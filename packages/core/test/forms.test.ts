import assert from "node:assert/strict";
import { test } from "node:test";

import { doseKind, doseSite, doseWords, howWords, isOral, siteWords, unitWord } from "../src/forms.js";
import { spokenDose } from "../src/access.js";
import { rxHindi } from "../src/rxTerms.js";
import { remindersFromPrescription, timesForFrequency } from "../src/schedule.js";
import type { PrescriptionItem } from "../src/types.js";

const drop: PrescriptionItem = {
  drugId: "moxi",
  drugName: "Moxifloxacin",
  form: "eye drops",
  strength: "0.5%",
  frequency: "1-1-1",
  durationDays: 5,
  timing: "after_food",
  quantity: 1,
};

test("the form decides what one dose is called", () => {
  assert.equal(doseKind("eye drops"), "drops");
  assert.equal(doseKind("Respule"), "inhaler");
  assert.equal(doseKind("ointment"), "topical");
  assert.equal(doseKind("susp"), "syrup");
  // Anything unrecognised, or missing, is a tablet: the common case.
  assert.equal(doseKind("lozenge"), "tablet");
  assert.equal(doseKind(undefined), "tablet");
  assert.equal(unitWord("eye drops", 2), "drops");
  assert.equal(unitWord("eye drops", 1), "drop");
  assert.equal(unitWord("syrup", 2, "hi"), "चम्मच");
  assert.equal(doseWords("eye drops", 2), "2 drops in the eye");
});

test("only what is swallowed has a food instruction", () => {
  assert.ok(isOral("tablet") && isOral("syrup") && isOral("sachet"));
  assert.ok(!isOral("eye drops") && !isOral("inhaler") && !isOral("cream"));
  assert.equal(doseSite("ear drops"), "ear");
  assert.equal(siteWords("cream"), "on the skin");
  assert.equal(howWords("tablet"), null);
  assert.equal(howWords("cream"), "Apply it, do not swallow");
});

test("an eye drop is spoken as drops in the eye, not tablets after food", () => {
  assert.equal(
    spokenDose(drop),
    "Moxifloxacin 0.5%: one drop in the morning, one drop in the afternoon and one drop at night, in the eye, for five days.",
  );
  assert.match(spokenDose({ ...drop, form: "inhaler", frequency: "1-0-1" }), /one puff in the morning and one puff at night, breathed in/);
  // A tablet still reads exactly as it did.
  assert.match(spokenDose({ ...drop, form: "tablet", frequency: "1-0-1" }), /one tablet in the morning and one tablet at night, after food/);
});

test("the family's line on the slip counts in the right thing", () => {
  assert.equal(rxHindi(drop), "सुबह 1 बूँद · दोपहर 1 बूँद · रात 1 बूँद · आँख में");
  // No form at all: the old wording, unchanged.
  assert.equal(
    rxHindi({ frequency: "1-0-1", timing: "after_food" }),
    "सुबह 1 गोली · रात 1 गोली · खाने के बाद",
  );
});

test("a drop is not reminded half an hour before a meal", () => {
  // "Before food" moves a tablet earlier, so the reminder lands before the meal.
  assert.deepEqual(timesForFrequency("1-0-1", "before_food", "tablet"), ["07:30", "20:30"]);
  // An eye has no mealtime, so the drop keeps the plain hours.
  assert.deepEqual(timesForFrequency("1-0-1", "before_food", "eye drops"), ["08:00", "21:00"]);
});

test("the reminder says where a drop goes, not when to eat", () => {
  const [made] = remindersFromPrescription({
    ownerPhone: "9811044321",
    personName: "Kamla",
    visitId: "v1",
    startDate: "2026-10-30",
    items: [drop],
  });
  assert.equal(made.detail, "0.5% · 1 drop in the eye");
  const [tablet] = remindersFromPrescription({
    ownerPhone: "9811044321",
    personName: "Kamla",
    visitId: "v1",
    startDate: "2026-10-30",
    items: [{ ...drop, form: "tablet" }],
  });
  assert.equal(tablet.detail, "0.5% · after food");
});
