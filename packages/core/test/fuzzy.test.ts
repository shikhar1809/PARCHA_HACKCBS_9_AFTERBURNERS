import assert from "node:assert/strict";
import { test } from "node:test";

import { drugs as seed } from "../src/demo/formulary.js";
import { searchDrugs } from "../src/fuzzy.js";
import type { Drug } from "../src/types.js";

const drugs = seed.map((d) => ({ id: d.id, genericName: d.generic, commonBrands: d.brands, drugClass: d.drugClass, strengths: d.strengths, defaultStrength: d.defaultStrength })) as unknown as Drug[];
const top = (q: string) => searchDrugs(drugs, q, 3)[0]?.drug.id;

test("a few letters finds the medicine", () => {
  assert.equal(top("para"), "paracetamol");
  assert.equal(top("metfor"), "metformin");
  assert.equal(top("omep"), "omeprazole");
  assert.equal(top("azithro"), "azithromycin");
});

test("a brand finds the generic", () => {
  assert.equal(top("crocin"), "paracetamol");
});

test("a typo still finds it", () => {
  assert.equal(top("parcetamol"), "paracetamol");
  assert.equal(top("augmentn"), "amoxicillin_clavulanate");
});

test("short or empty queries find nothing, and nonsense finds nothing", () => {
  assert.deepEqual(searchDrugs(drugs, "p"), []);
  assert.deepEqual(searchDrugs(drugs, ""), []);
  assert.deepEqual(searchDrugs(drugs, "qqzzxx"), []);
});

test("results are limited and best first", () => {
  const hits = searchDrugs(drugs, "para", 2);
  assert.equal(hits.length, 2);
  assert.ok(hits[0].score >= hits[1].score);
});

test("the formula finds a combination by one of its ingredients", () => {
  const hit = searchDrugs(drugs, "clavulanic", 3)[0];
  assert.equal(hit.drug.id, "amoxicillin_clavulanate");
  assert.equal(hit.via, "ingredient");
  assert.equal(hit.formula, "Amoxicillin + Clavulanic acid");
});

test("several words must all match, so 'amox clav' is the combination, not plain amoxicillin", () => {
  assert.equal(top("amox clav"), "amoxicillin_clavulanate");
});

test("a strength in the query is found and preferred", () => {
  const hit = searchDrugs(drugs, "para 650", 3)[0];
  assert.equal(hit.drug.id, "paracetamol");
  assert.match(hit.strength ?? "", /650/);
});

test("a brand shows the other names with the same formula", () => {
  const hit = searchDrugs(drugs, "augmentin", 3)[0];
  assert.equal(hit.via, "brand");
  assert.ok(hit.sameFormula.includes("Clavam"));
});

test("the class finds medicines too, below a name match", () => {
  const ids = searchDrugs(drugs, "statin", 6).map((h) => h.drug.id);
  assert.ok(ids.includes("atorvastatin"));
});

test("the short forms doctors write find what they stand for", () => {
  assert.equal(top("pcm"), "paracetamol");
  assert.equal(searchDrugs(drugs, "pcm 650", 3)[0]?.strength, "650 mg");
  const ppi = searchDrugs(drugs, "ppi", 6).map((h) => h.drug.drugClass);
  assert.ok(ppi.length > 0 && ppi.every((c) => c === "Proton pump inhibitor"));
});

test("a good match is not buried under letters-in-order long shots", () => {
  const names = searchDrugs(drugs, "crocin", 6).map((h) => h.drug.id);
  assert.deepEqual(names, ["paracetamol"]);
  const statin = searchDrugs(drugs, "statin", 6).map((h) => h.drug.drugClass);
  assert.ok(statin.every((c) => c === "Statin"), statin.join(", "));
});

test("two medicines typed together that no one entry has show each of them", () => {
  const ids = searchDrugs(drugs, "metformin glimepiride", 6).map((h) => h.drug.id);
  assert.ok(ids.includes("metformin") && ids.includes("glimepiride"), ids.join(", "));
});

test("a short form stands for its meaning, not its letters", () => {
  const ids = searchDrugs(drugs, "iron", 6).map((h) => h.drug.id);
  assert.ok(ids.length > 0 && !ids.includes("spironolactone"), ids.join(", "));
});

test("dictation finds short forms and typos, and marks the medicine as a guess", async () => {
  const { parseDictation } = await import("../src/dictation.js");
  const list = seed.map((d) => ({ id: d.id, genericName: d.generic, commonBrands: d.brands, drugClass: d.drugClass, strengths: d.strengths, defaultStrength: d.defaultStrength, defaultForm: "tablet", forms: ["tablet"] }));
  const r = parseDictation("ORS after every loose stool\nazithromicin 500 once a day 3 days\nparacetamol 650 sos", list);
  assert.deepEqual(r.proposals.map((p) => p.item.drugId), ["ors", "azithromycin", "paracetamol"].map((id) => list.find((d) => d.id === id || d.genericName.toLowerCase().startsWith(id === "ors" ? "oral rehydration" : id))!.id));
  assert.ok(r.proposals[0].assumed.includes("medicine"));
  assert.ok(r.proposals[1].assumed.includes("medicine"));
  assert.ok(!r.proposals[2].assumed.includes("medicine"));
});
