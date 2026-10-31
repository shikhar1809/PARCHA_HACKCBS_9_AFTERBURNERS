import assert from "node:assert/strict";
import { test } from "node:test";

import { crossCheck, heardIn } from "../src/crossCheck.js";
import { frequencyAbbr, rxHindi, rxName, rxSig } from "../src/rxTerms.js";

test("times are heard in Hinglish, Hindi and English", () => {
  assert.deepEqual(heardIn("Crocin subah shaam khane ke baad"), { frequency: "1-0-1", timing: "after_food" });
  assert.deepEqual(heardIn("दिन में तीन बार, खाने से पहले"), { frequency: "1-1-1", timing: "before_food" });
  assert.deepEqual(heardIn("take one at night"), { frequency: "0-0-1", timing: null });
  assert.deepEqual(heardIn("1-0-1 after food"), { frequency: "1-0-1", timing: "after_food" });
  assert.deepEqual(heardIn("bukhar ho to zaroorat par"), { frequency: "SOS", timing: null });
});

test("green when the words agree, yellow when they say nothing, red when they differ", () => {
  const said = "Paracetamol subah dopahar raat khane ke baad. Cetirizine raat ko. Amoxicillin ke baare mein doctor ne kuch nahi kaha";
  const out = crossCheck(
    [
      { name: "Paracetamol", frequency: "1-1-1", timing: "after_food" },
      { name: "Cetirizine", frequency: "1-0-1", timing: "after_food" },
      { name: "Pantoprazole", frequency: "1-0-0", timing: "before_food" },
      { name: "Amoxicillin", frequency: "1-1-1", timing: "after_food" },
    ],
    said,
  );
  assert.deepEqual(out.map((o) => [o.name, o.status, o.reason]), [
    ["Paracetamol", "green", "agree"],
    ["Cetirizine", "red", "times-differ"],
    ["Pantoprazole", "yellow", "not-mentioned"],
    ["Amoxicillin", "yellow", "no-times"],
  ]);
});

test("a brand name in the words counts for its medicine", () => {
  const [o] = crossCheck([{ name: "Paracetamol", aliases: ["Dolo 650"], frequency: "1-0-1", timing: "after_food" }], "Dolo subah shaam");
  assert.equal(o.status, "green");
});

test("the slip reads like a prescription to the chemist and in Hindi to the family", () => {
  const item = { drugName: "Paracetamol", strength: "650 mg", form: "tablet", frequency: "1-0-1", timing: "after_food" as const };
  assert.equal(rxName(item), "Tab. PARACETAMOL 650 mg");
  assert.equal(rxSig(item), "1-0-1 (BD) p.c.");
  assert.equal(rxHindi(item), "सुबह 1 गोली · रात 1 गोली · खाने के बाद");
  assert.equal(frequencyAbbr("1-1-1"), "TDS");
  assert.equal(frequencyAbbr("SOS"), "SOS");
  assert.equal(rxHindi({ frequency: "SOS", timing: "any" }), "ज़रूरत पड़ने पर");
  // Shorthand as typed reads the same.
  assert.equal(rxHindi({ frequency: "BD", timing: "after_food" }), "सुबह 1 गोली · रात 1 गोली · खाने के बाद");
  assert.equal(rxSig({ frequency: "tds", timing: "before_food" }), "1-1-1 (TDS) a.c.");
});
