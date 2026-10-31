import assert from "node:assert/strict";
import { test } from "node:test";

import { drugs as seed } from "../src/demo/formulary.js";
import { nextQuestion, routeSpeech, routeUtterance, lineFromProposal, splitClauses, type PadState, type VoiceAction } from "../src/voice.js";

const drugs = seed.map((d) => ({ id: d.id, genericName: d.generic, commonBrands: d.brands, defaultForm: d.defaultForm, defaultStrength: d.defaultStrength, strengths: d.strengths, forms: d.forms }));
const empty: PadState = { diagnosis: "", followUp: "", items: [], guessed: {}, skipped: [] };
const kinds = (a: VoiceAction[]) => a.map((x) => x.kind);

test("each spoken line goes to its box", () => {
  const dx = routeUtterance("Diagnosis viral fever", drugs, empty, null);
  assert.deepEqual(dx, [{ kind: "diagnosis", value: "Viral fever" }]);
  const adv = routeUtterance("advice rest and drink plenty of fluids", drugs, empty, null);
  assert.deepEqual(adv, [{ kind: "advice", value: "Rest and drink plenty of fluids" }]);
  const fu = routeUtterance("follow up in 5 days", drugs, empty, null);
  assert.deepEqual(fu, [{ kind: "followUp", days: 5 }]);
  assert.deepEqual(routeUtterance("review after 2 weeks", drugs, empty, null), [{ kind: "followUp", days: 14 }]);
  const tests = routeUtterance("get CBC and dengue NS1 done", drugs, empty, null);
  assert.deepEqual(tests, [{ kind: "tests", values: ["CBC", "Dengue NS1"] }]);
  const rm = routeUtterance("remove paracetamol", drugs, empty, null);
  assert.deepEqual(rm, [{ kind: "remove", drugName: "paracetamol" }]);
});

test("medicines are read with their schedule, and what was only defaulted is known", () => {
  const [m] = routeUtterance("paracetamol 650 TDS for 3 days after food", drugs, empty, null);
  assert.equal(m.kind, "medicines");
  if (m.kind !== "medicines") return;
  const line = lineFromProposal(m.proposals[0]);
  assert.equal(line.drugName, "Paracetamol");
  assert.equal(line.frequency, "1-1-1");
  assert.equal(line.durationDays, 3);
  assert.equal(line.quantity, 9);
  assert.deepEqual(m.proposals[0].assumed, []);
  const [bare] = routeUtterance("dolo 650", drugs, empty, null);
  assert.ok(bare.kind === "medicines" && bare.proposals[0].assumed.includes("duration") && bare.proposals[0].assumed.includes("frequency"));
});

test("one sentence can fill several boxes", () => {
  const a = routeUtterance("paracetamol 650 BD 5 days, CBC, follow up in 3 days", drugs, empty, null);
  assert.deepEqual(kinds(a), ["followUp", "tests", "medicines"]);
});

test("what is missing is asked, one question at a time, and the answer fills it", () => {
  const item = { drugId: "paracetamol", drugName: "Paracetamol", form: "tablet", strength: "650 mg", frequency: "1-0-0", durationDays: 5, timing: "any", quantity: 5, instructions: "" } as never;
  let state: PadState = { ...empty, items: [item], guessed: { paracetamol: ["frequency", "duration"] } };
  const q1 = nextQuestion(state)!;
  assert.equal(q1.kind, "frequency");
  const [a1] = routeUtterance("twice a day", drugs, state, q1);
  assert.equal(a1.kind, "answer");
  assert.deepEqual(a1.kind === "answer" && a1.patch, { frequency: "1-0-1" });

  state = { ...state, guessed: { paracetamol: ["duration"] } };
  const q2 = nextQuestion(state)!;
  assert.equal(q2.kind, "duration");
  const [a2] = routeUtterance("5 din", drugs, state, q2);
  assert.deepEqual(a2.kind === "answer" && a2.patch, { durationDays: 5 });

  state = { ...state, guessed: {} };
  const q3 = nextQuestion(state)!;
  assert.equal(q3.kind, "diagnosis");
  const [a3] = routeUtterance("acute pharyngitis", drugs, state, q3);
  assert.deepEqual(a3.kind === "answer" && a3.patch, { diagnosis: "Acute pharyngitis" });

  // A long-term condition with no follow-up asks for one; a skipped question is not asked again.
  const chronic: PadState = { ...state, diagnosis: "Type 2 diabetes" };
  assert.equal(nextQuestion(chronic)?.kind, "followUp");
  assert.equal(nextQuestion({ ...chronic, skipped: ["followUp"] }), null);
});

test("a medicine said while a question waits is still a medicine", () => {
  const state: PadState = { ...empty, items: [{ drugId: "x", drugName: "X" } as never] };
  const q = nextQuestion(state)!;
  assert.equal(q.kind, "diagnosis");
  const a = routeUtterance("azithromycin 500 OD 3 days", drugs, state, q);
  assert.deepEqual(kinds(a), ["medicines"]);
});

test("words that are nothing it knows are said back, not guessed", () => {
  const a = routeUtterance("qwerty zxcv", drugs, empty, null);
  assert.deepEqual(a, [{ kind: "unplaced", words: "qwerty zxcv" }]);
});

test("a whole consultation said in one breath is cut into its boxes", () => {
  const said = "diagnosis urinary tract infection ciprofloxacin 500 BD 5 days after food paracetamol 650 urine routine and CBC follow up in 5 days";
  assert.deepEqual(splitClauses(said, drugs).slice(0, 2), ["diagnosis urinary tract infection", "ciprofloxacin 500 BD 5 days after food"]);
  const a = routeSpeech(said, drugs, empty, null);
  const of = (k: string) => a.filter((x) => x.kind === k);
  assert.equal(a[0].kind === "diagnosis" && a[0].value, "Urinary tract infection");
  assert.deepEqual(of("medicines").flatMap((m) => (m.kind === "medicines" ? m.proposals.map((p) => p.item.drugName) : [])), ["Ciprofloxacin", "Paracetamol"]);
  assert.deepEqual(of("tests").flatMap((t) => (t.kind === "tests" ? t.values : [])).sort(), ["CBC", "Urine routine"]);
  assert.deepEqual(of("followUp"), [{ kind: "followUp", days: 5 }]);
  assert.deepEqual(of("unplaced"), []);
  // A medicine not in the list is said back, not dropped or guessed.
  const unknown = routeSpeech("nitrofurantoin 100 BD 5 days", drugs, empty, null);
  assert.deepEqual(kinds(unknown), ["unplaced"]);
  // With full stops, the same.
  const b = routeSpeech("Diagnosis viral fever. Paracetamol 650 TDS 3 days. Advice rest. Follow up in 3 days.", drugs, empty, null);
  assert.deepEqual(kinds(b), ["diagnosis", "medicines", "advice", "followUp"]);
  // "Type 2 diabetes" stays the diagnosis.
  assert.deepEqual(splitClauses("diagnosis type 2 diabetes metformin 500 BD", drugs), ["diagnosis type 2 diabetes", "metformin 500 BD"]);
});
