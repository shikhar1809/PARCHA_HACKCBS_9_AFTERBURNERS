import assert from "node:assert/strict";
import { test } from "node:test";

import { drugs as seed } from "../src/demo/formulary.js";
import { medicinesIn, stripShows, type ReadLine } from "../src/reading.js";
import type { Drug } from "../src/types.js";

const drugs = seed.map((d) => ({ id: d.id, genericName: d.generic, commonBrands: d.brands, drugClass: d.drugClass, strengths: d.strengths, defaultStrength: d.defaultStrength })) as unknown as Drug[];
const byName = (n: string) => drugs.find((d) => d.genericName === n)!;

/** A line as the reader would return it, every word clear unless given a confidence. */
function line(text: string, y: number, unclear: string[] = []): ReadLine {
  let x = 0;
  const words = text.split(/\s+/).map((w) => {
    const box = { x0: x, y0: y, x1: x + w.length * 10, y1: y + 20 };
    x += w.length * 10 + 10;
    return { text: w, confidence: unclear.includes(w) ? 40 : 92, box };
  });
  return { text, words, box: { x0: 0, y0: y, x1: x, y1: y + 20 } };
}

test("a bill's printed names are found, each with why, and the rest of the bill is ignored", () => {
  const found = medicinesIn(
    [
      line("SHIV MEDICAL STORE ROHINI", 0),
      line("1 DOLO 650 TAB 15 2.10 31.50", 40),
      line("2 PANTOPRAZOLE 40MG TAB 10 6.00 60.00", 70),
      line("BATCH EXP MRP TOTAL 91.50", 100),
    ],
    drugs,
  );
  const names = found.map((f) => f.drug.genericName);
  assert.ok(names.includes("Paracetamol"), names.join(", "));
  assert.ok(names.includes("Pantoprazole"), names.join(", "));
  assert.equal(found.length, 2, names.join(", "));
  const dolo = found.find((f) => f.drug.genericName === "Paracetamol")!;
  assert.equal(dolo.via, "brand");
  assert.equal(dolo.sure, true);
  assert.equal(dolo.word, "DOLO");
  assert.equal(dolo.strength, "650 mg");
  assert.match(dolo.why, /"DOLO" is Dolo 650, a brand of Paracetamol/);
  assert.deepEqual(dolo.box, { x0: 20, y0: 40, x1: 60, y1: 60 });
});

test("a three-letter name counts only spelt exactly, with a strength or its form on the line", () => {
  const names = (text: string) => medicinesIn([line(text, 0)], drugs).map((f) => f.drug.genericName);
  assert.deepEqual(names("2 PAN 40 TAB 10 98.00"), ["Pantoprazole"]);
  assert.deepEqual(names("5 ORS SACHET 4 88.00"), ["Oral rehydration salts"]);
  assert.deepEqual(names("PAN CARD COPY ATTACHED"), []);
  assert.deepEqual(names("PAM 40 TAB"), []);
});

test("a slip in the print is offered to check, never taken as sure", () => {
  const [f] = medicinesIn([line("PANTOPRAZOEL 40", 0)], drugs);
  assert.equal(f.drug.genericName, "Pantoprazole");
  assert.equal(f.sure, false);
  assert.match(f.why, /1 letter away from Pantoprazole.*Check the photo/);
});

test("letters the reader could not see clearly are not sure either", () => {
  const [f] = medicinesIn([line("CETIRIZINE 10", 0, ["CETIRIZINE"])], drugs);
  assert.equal(f.drug.genericName, "Cetirizine");
  assert.equal(f.sure, false);
  assert.match(f.why, /hard to read/);
});

test("nothing is made up: words that are not medicines find nothing", () => {
  assert.deepEqual(medicinesIn([line("CASH MEMO TOTAL AMOUNT PAID THANK YOU VISIT AGAIN", 0)], drugs), []);
  assert.deepEqual(medicinesIn([line("ABC 12 XY", 0)], drugs), []);
});

test("a strip photo shows the medicine's name, or says it does not", () => {
  const para = byName("Paracetamol");
  assert.equal(stripShows([line("Crocin 650 Paracetamol Tablets IP", 0)], para)?.sure, true);
  assert.equal(stripShows([line("Pantoprazole Gastro-resistant Tablets", 0)], para), null);
});
