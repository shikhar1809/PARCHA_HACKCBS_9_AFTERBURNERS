import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addCalendarDays, dayPart, doseKey, dosesOn, formatClock, occursOn, remindersFromPrescription, shiftTime, timesForFrequency, type Reminder,
} from "../src/schedule.js";

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: "r1", ownerPhone: "1", personName: "A", kind: "medicine", title: "Para", detail: null,
  times: ["21:00", "08:00"], days: [], startDate: "2026-10-22", endDate: "2026-10-24", enabled: true, source: null, ...over,
});

test("dose patterns become clock times", () => {
  assert.deepEqual(timesForFrequency("1-0-1"), ["08:00", "21:00"]);
  assert.deepEqual(timesForFrequency("1-1-1"), ["08:00", "14:00", "21:00"]);
  assert.deepEqual(timesForFrequency("0-0-1"), ["21:00"]);
  assert.deepEqual(timesForFrequency("1-1-1-1"), ["08:00", "13:00", "18:00", "22:00"]);
});

test("before food and empty stomach move a time half an hour earlier", () => {
  assert.deepEqual(timesForFrequency("1-0-1", "before_food"), ["07:30", "20:30"]);
  assert.deepEqual(timesForFrequency("1-0-1", "empty_stomach"), ["07:30", "20:30"]);
  assert.deepEqual(timesForFrequency("1-0-1", "after_food"), ["08:00", "21:00"]);
});

test("patterns with no arithmetic have no times", () => {
  assert.deepEqual(timesForFrequency("SOS"), []);
  assert.deepEqual(timesForFrequency("STAT"), []);
});

test("shifting wraps within the day", () => {
  assert.equal(shiftTime("00:10", -30), "23:40");
  assert.equal(shiftTime("23:50", 20), "00:10");
});

test("calendar arithmetic crosses months and years", () => {
  assert.equal(addCalendarDays("2026-10-30", 3), "2026-11-02");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28");
});

test("a reminder applies from its start to its end, and only when enabled", () => {
  assert.equal(occursOn(reminder(), "2026-10-21"), false);
  assert.equal(occursOn(reminder(), "2026-10-22"), true);
  assert.equal(occursOn(reminder(), "2026-10-24"), true);
  assert.equal(occursOn(reminder(), "2026-10-25"), false);
  assert.equal(occursOn(reminder({ enabled: false }), "2026-10-23"), false);
});

test("weekday rules", () => {
  const mondays = reminder({ days: [1], endDate: null });
  assert.equal(occursOn(mondays, "2026-10-26"), true); // a Monday
  assert.equal(occursOn(mondays, "2026-10-27"), false);
});

test("a day's doses come out in clock order with stable keys", () => {
  const doses = dosesOn([reminder()], "2026-10-23");
  assert.deepEqual(doses.map((d) => d.key), ["r1@0800", "r1@2100"]);
  assert.equal(doseKey("r1", "08:00"), "r1@0800");
});

test("parts of the day and spoken clock", () => {
  assert.deepEqual(["07:00", "13:00", "18:30", "22:00"].map(dayPart), ["Morning", "Afternoon", "Evening", "Night"]);
  assert.deepEqual(["00:30", "12:00", "14:30", "21:00"].map(formatClock), ["12:30 am", "12 pm", "2:30 pm", "9 pm"]);
});

test("a prescription yields one reminder per medicine with fixed times, ending on the last day", () => {
  const made = remindersFromPrescription({
    ownerPhone: "1", personName: "A", visitId: "v", startDate: "2026-10-22",
    items: [
      { drugId: "p", drugName: "Para", strength: "650 mg", frequency: "1-1-1", durationDays: 3, timing: "after_food" },
      { drugId: "s", drugName: "Syrup", frequency: "SOS", durationDays: 3, timing: "any" },
    ],
  });
  assert.equal(made.length, 1);
  assert.equal(made[0].endDate, "2026-10-24");
  assert.equal(made[0].source?.visitId, "v");
});

test("a new prescription's medicine already in the reminders is a clash; the person's choice decides", async () => {
  const { clashesWith, applyClashChoices } = await import("../src/schedule.js");
  const base = { ownerPhone: "9811044321", personName: "Prashant", kind: "medicine" as const, detail: null, days: [], enabled: true };
  const old = { ...base, id: "r1", title: "Metformin", times: ["08:00", "20:00"], startDate: "2026-10-01", endDate: null, source: { visitId: "v0", drugId: "metformin" } };
  const other = { ...base, id: "r2", title: "Amlodipine", times: ["09:00"], startDate: "2026-10-01", endDate: "2026-10-10", source: null };
  const priya = { ...old, id: "r3", personName: "Priya" };
  const newMet = { ...base, title: "Metformin", times: ["08:00", "14:00", "20:00"], startDate: "2026-10-28", endDate: "2026-11-26", source: { visitId: "v1", drugId: "metformin" } };
  const newPara = { ...base, title: "Paracetamol", times: ["08:00"], startDate: "2026-10-28", endDate: "2026-10-30", source: { visitId: "v1", drugId: "paracetamol" } };
  const planned = clashesWith([old, other, priya], [newMet, newPara]);
  assert.equal(planned[0].clash?.id, "r1", "same medicine, same person, still running");
  assert.equal(planned[1].clash, null);
  // A reminder typed by hand ("Metformin 500 mg") is the same medicine as "Metformin".
  assert.equal(clashesWith([{ ...old, title: "Metformin 500 mg", source: null }], [newMet])[0].clash?.title, "Metformin 500 mg");
  // Amlodipine ended before the new start: no clash with anything named like it.
  assert.equal(clashesWith([other], [{ ...newPara, title: "Amlodipine", source: null }])[0].clash, null);

  const replace = applyClashChoices(planned, { 0: "replace" });
  assert.deepEqual(replace.save.map((r) => r.title), ["Metformin", "Paracetamol"]);
  assert.deepEqual(replace.end, [{ reminder: old, endDate: "2026-10-27" }]);
  const keep = applyClashChoices(planned, { 0: "keep" });
  assert.deepEqual(keep.save.map((r) => r.title), ["Paracetamol"]);
  assert.deepEqual(keep.end, []);
  const both = applyClashChoices(planned, { 0: "both" });
  assert.equal(both.save.length, 2);
  assert.deepEqual(both.end, []);
});
