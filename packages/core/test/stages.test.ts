import assert from "node:assert/strict";
import { test } from "node:test";

import { COUNTERS_FOR, QUEUE_STAGES, allowedNext, describeTransitionProblem } from "../src/stages.js";

test("the desk takes intake, the doctor consults and signs", () => {
  assert.deepEqual(allowedNext("compounder", "registered"), ["intake_complete"]);
  assert.deepEqual(allowedNext("doctor", "intake_complete"), ["in_consultation"]);
  assert.deepEqual(allowedNext("doctor", "in_consultation"), ["prescribed"]);
});

test("nobody but a doctor can sign a prescription", () => {
  assert.deepEqual(allowedNext("compounder", "in_consultation"), []);
  assert.ok(!COUNTERS_FOR.staff.includes("doctor"));
});

test("a signed visit is finished: nothing moves it on", () => {
  for (const role of ["compounder", "doctor"] as const) assert.deepEqual(allowedNext(role, "prescribed"), []);
  assert.match(describeTransitionProblem("doctor", "prescribed", "in_consultation") ?? "", /already complete/);
});

test("stages cannot be skipped", () => {
  assert.match(describeTransitionProblem("doctor", "intake_complete", "prescribed") ?? "", /next step/);
  assert.equal(describeTransitionProblem("doctor", "intake_complete", "in_consultation"), null);
});

test("a stage cannot move to itself, and a cancelled visit stays cancelled", () => {
  assert.match(describeTransitionProblem("doctor", "in_consultation", "in_consultation") ?? "", /already/);
  assert.match(describeTransitionProblem("doctor", "cancelled", "registered") ?? "", /cancelled/);
});

test("each queue reads only its own stages", () => {
  assert.deepEqual(QUEUE_STAGES.compounder, ["registered"]);
  assert.deepEqual(QUEUE_STAGES.doctor, ["intake_complete", "in_consultation"]);
});

test("the desk can book a request itself, but never sign or consult", () => {
  assert.ok(allowedNext("compounder", "requested").includes("scheduled"));
  assert.ok(allowedNext("compounder", "proposed").includes("scheduled"));
  assert.deepEqual(allowedNext("compounder", "intake_complete"), []);
});
