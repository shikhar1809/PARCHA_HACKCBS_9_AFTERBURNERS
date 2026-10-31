import assert from "node:assert/strict";
import { test } from "node:test";

import { abilitiesFromClaims, accountTypeFor, cleanAbilities, cleanSessionRules, countersFor, seatIdFrom, TEMPLATES } from "../src/seats.js";

test("a solo doctor holds both counters and is a doctor", () => {
  const solo = TEMPLATES.find((t) => t.id === "solo")!.seats[0].abilities;
  assert.deepEqual(countersFor(solo), ["compounder", "doctor"]);
  assert.equal(accountTypeFor(solo), "doctor");
});

test("a triage nurse is the desk counter but not a doctor; an office with only Manage has no counter", () => {
  assert.deepEqual(countersFor(["vitals"]), ["compounder"]);
  assert.equal(accountTypeFor(["vitals"]), "staff");
  assert.deepEqual(countersFor(["activity", "manage"]), []);
});

test("every template has its owner seat, and that seat can manage", () => {
  for (const t of TEMPLATES) {
    const owner = t.seats.find((s) => s.id === t.ownerSeat);
    assert.ok(owner, t.id);
    assert.ok(owner.abilities.includes("manage"), t.id);
  }
});

test("abilities are cleaned, and old tokens keep what they could always do", () => {
  assert.deepEqual(cleanAbilities(["manage", "fly", "register", "register"]), ["register", "manage"]);
  assert.deepEqual(abilitiesFromClaims({ accountType: "staff", admin: true }), ["register", "vitals", "activity", "manage"]);
  assert.deepEqual(abilitiesFromClaims({ accountType: "doctor" }), ["consult", "activity"]);
  assert.deepEqual(abilitiesFromClaims({ accountType: "staff", abilities: ["vitals"] }), ["vitals"]);
});

test("seat ids and session rules are tidied", () => {
  assert.equal(seatIdFrom("Triage Nurse (OPD)"), "triage-nurse-opd");
  assert.deepEqual(cleanSessionRules({ moveLimitM: 20, endOnIpChange: false }), { moveLimitM: 100, endOnIpChange: false });
  assert.deepEqual(cleanSessionRules({}), { moveLimitM: 300, endOnIpChange: true });
});
