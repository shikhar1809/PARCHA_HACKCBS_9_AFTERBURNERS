import assert from "node:assert/strict";
import { test } from "node:test";

import { spokenDose } from "../src/access.js";
import { everyText, fromFourSlots, suggestedQuantity, toFourSlots, validateItem } from "../src/items.js";
import { occursOn, remindersFromPrescription, timesForFrequency } from "../src/schedule.js";

test("subah, dopahar, shaam, raat: four slots, stored as three when there is no evening dose", () => {
  assert.deepEqual(toFourSlots("BD"), [1, 0, 0, 1]);
  assert.deepEqual(toFourSlots("1-1-1"), [1, 1, 0, 1]);
  assert.equal(fromFourSlots([1, 0, 0, 1]), "1-0-1");
  assert.equal(fromFourSlots([1, 0, 1, 1]), "1-0-1-1");
  assert.deepEqual(timesForFrequency("1-0-1-1"), ["08:00", "18:00", "22:00"]);
});

test("every few days: fewer tablets, and reminders only on those days", () => {
  assert.equal(suggestedQuantity("1-0-0", 14, 7), 2);
  assert.equal(suggestedQuantity("1-0-1", 5, 2), 6);
  const [r] = remindersFromPrescription({ ownerPhone: "9", personName: "A", visitId: "v", startDate: "2026-10-01", items: [{ drugId: "d", drugName: "Vit D", frequency: "1-0-0", durationDays: 28, timing: "after_food", everyDays: 7 }] });
  const reminder = { ...r, id: "x" };
  assert.equal(occursOn(reminder, "2026-10-01"), true);
  assert.equal(occursOn(reminder, "2026-10-02"), false);
  assert.equal(occursOn(reminder, "2026-10-08"), true);
});

test("how often is said and checked", () => {
  assert.equal(everyText(7), "Once a week");
  assert.equal(everyText(5), "Every 5 days");
  const line = { drugId: "d", drugName: "Vitamin D3", form: "capsule", strength: "60000 IU", frequency: "1-0-0", durationDays: 28, timing: "after_food" as const, quantity: 4, everyDays: 7 };
  assert.equal(spokenDose(line), "Vitamin D3 60000 IU: one capsule in the morning, once a week, after food, for 28 days.");
  assert.match(spokenDose({ ...line, frequency: "0-0-1-1", everyDays: 1 }), /one capsule in the evening and one capsule at night/);
  assert.deepEqual(validateItem({ ...line, frequency: "0-0-0" }), ["Choose at least one time of day, or Only when needed."]);
  assert.deepEqual(validateItem({ ...line, everyDays: 0 }), ["How often must be every 1 to 90 days."]);
});
