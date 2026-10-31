import assert from "node:assert/strict";
import { test } from "node:test";

import { drugs as seed } from "../src/demo/formulary.js";
import { CLASS_SCHEDULES, startingLine } from "../src/usual.js";
import type { Drug } from "../src/types.js";

const drugs = seed.map((d) => ({ id: d.id, genericName: d.generic, commonBrands: d.brands, drugClass: d.drugClass, forms: d.forms ?? ["tablet"], strengths: d.strengths, defaultForm: d.defaultForm ?? "tablet", defaultStrength: d.defaultStrength })) as unknown as Drug[];
const drug = (id: string) => drugs.find((d) => d.id === id)!;

test("a statin starts at night for a month, metformin twice a day for a month", () => {
  const s = startingLine(drug("atorvastatin"));
  assert.equal(s.source, "class");
  assert.deepEqual([s.item.frequency, s.item.durationDays, s.item.quantity], ["0-0-1", 30, 30]);
  const m = startingLine(drug("metformin")).item;
  assert.deepEqual([m.frequency, m.durationDays, m.quantity], ["1-0-1", 30, 60]);
});

test("the doctor's own habit beats the class, including the strength they use", () => {
  const p = drug("paracetamol");
  const s = startingLine(p, { frequency: "1-0-1", durationDays: 5, timing: "after_food", strength: "650 mg" });
  assert.equal(s.source, "yours");
  assert.deepEqual([s.item.frequency, s.item.durationDays, s.item.strength, s.item.quantity], ["1-0-1", 5, "650 mg", 10]);
});

test("a strength the medicine does not come in is not carried over", () => {
  const s = startingLine(drug("paracetamol"), { frequency: "1-1-1", durationDays: 3, timing: "after_food", strength: "9000 mg" });
  assert.equal(s.item.strength, drug("paracetamol").defaultStrength);
});

test("every class with a usual schedule is a class in the formulary", () => {
  const classes = new Set(drugs.map((d) => d.drugClass));
  for (const c of Object.keys(CLASS_SCHEDULES)) assert.ok(classes.has(c), c);
});
