import assert from "node:assert/strict";
import { test } from "node:test";

import { buildScript, callsDue, inQuietHours, replyScript, spokenTimeHindi } from "../src/calls.js";
import type { Reminder } from "../src/schedule.js";

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: "r1", ownerPhone: "9811044321", personName: "Prashant", kind: "medicine", title: "Paracetamol", detail: null,
  times: ["08:00", "14:00", "21:00"], days: [], startDate: "2026-10-20", endDate: null, enabled: true, source: null, ...over,
});
const at = (hhmm: string) => new Date(`2026-10-22T${hhmm}:00`);

test("quiet hours, including a window that wraps midnight", () => {
  assert.equal(inQuietHours("23:00", "22:00", "06:00"), true);
  assert.equal(inQuietHours("05:59", "22:00", "06:00"), true);
  assert.equal(inQuietHours("06:00", "22:00", "06:00"), false);
  assert.equal(inQuietHours("21:00", "22:00", "06:00"), false);
  assert.equal(inQuietHours("13:00", "13:00", "13:00"), false);
  assert.equal(inQuietHours("14:00", "13:00", "15:00"), true);
});

test("Hindi spoken time", () => {
  assert.equal(spokenTimeHindi("21:00"), "रात के 9 बजे");
  assert.equal(spokenTimeHindi("08:30"), "सुबह के 8:30 बजे");
  assert.equal(spokenTimeHindi("14:00"), "दोपहर के 2 बजे");
});

test("a call is due from the dose time until eight minutes after", () => {
  const args = { reminders: [reminder()], date: "2026-10-22", taken: {}, quietStart: "22:00", quietEnd: "06:00" };
  assert.equal(callsDue({ ...args, now: at("13:59") }).length, 0);
  assert.equal(callsDue({ ...args, now: at("14:00") }).length, 1);
  assert.equal(callsDue({ ...args, now: at("14:08") }).length, 1);
  assert.equal(callsDue({ ...args, now: at("14:09") }).length, 0);
});

test("a dose already ticked off is not called about", () => {
  const due = callsDue({ reminders: [reminder()], date: "2026-10-22", now: at("14:02"), taken: { "r1@1400": "x" }, quietStart: "22:00", quietEnd: "06:00" });
  assert.equal(due.length, 0);
});

test("doses at the same time share one call", () => {
  const due = callsDue({ reminders: [reminder(), reminder({ id: "r2", title: "Metformin" })], date: "2026-10-22", now: at("21:01"), taken: {}, quietStart: "23:00", quietEnd: "06:00" });
  assert.equal(due.length, 1);
  assert.equal(due[0].doses.length, 2);
});

test("quiet hours stop a call", () => {
  const due = callsDue({ reminders: [reminder({ times: ["22:30"] })], date: "2026-10-22", now: at("22:31"), taken: {}, quietStart: "22:00", quietEnd: "06:00" });
  assert.equal(due.length, 0);
});

test("only medicines are phoned about, not appointments", () => {
  const due = callsDue({ reminders: [reminder({ kind: "appointment" })], date: "2026-10-22", now: at("14:01"), taken: {}, quietStart: "22:00", quietEnd: "06:00" });
  assert.equal(due.length, 0);
});

test("scripts say the time, the medicines and both key presses", () => {
  const en = buildScript("en", "14:00", [{ title: "Paracetamol", personName: "Prashant" }, { title: "Metformin", personName: "Prashant" }]);
  assert.match(en, /2 pm/);
  assert.match(en, /Paracetamol and Metformin/);
  assert.match(en, /press 1/);
  assert.match(en, /press 2/);
  const hi = buildScript("hi", "21:00", [{ title: "Paracetamol", personName: "Prashant" }]);
  assert.match(hi, /रात के 9 बजे/);
  assert.match(hi, /Paracetamol/);
  assert.match(hi, /एक दबाइए/);
});

test("a second attempt says so, and two people are told apart", () => {
  assert.match(buildScript("en", "14:00", [{ title: "A", personName: "X" }], 2), /called a little while ago/);
  const two = buildScript("en", "14:00", [{ title: "A", personName: "Prashant" }, { title: "B", personName: "Prabha Devi" }]);
  assert.match(two, /Prashant: A/);
  assert.match(two, /Prabha: B/);
});

test("replies", () => {
  assert.match(replyScript("en", "1"), /noted/);
  assert.match(replyScript("en", "2"), /ten minutes/);
  assert.match(replyScript("en", "9"), /did not understand/);
});
