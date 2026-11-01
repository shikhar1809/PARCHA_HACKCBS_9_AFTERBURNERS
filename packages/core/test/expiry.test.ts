import assert from "node:assert/strict";
import { test } from "node:test";

import { expiryStatus, parseExpiry } from "../src/expiry.js";

test("the ways strips print an expiry are read", () => {
  assert.deepEqual(parseExpiry("B.No. DM2611 MFG 08/2026 EXP 07/2028"), { year: 2028, month: 7 });
  assert.deepEqual(parseExpiry("Exp.07/28"), { year: 2028, month: 7 });
  assert.deepEqual(parseExpiry("EXP: JUL 2028"), { year: 2028, month: 7 });
  assert.deepEqual(parseExpiry("Expiry Date 03-2027"), { year: 2027, month: 3 });
  assert.deepEqual(parseExpiry("Use before NOV.26"), { year: 2026, month: 11 });
});

test("a manufacture date alone, or a garbled one, is not taken for an expiry", () => {
  assert.equal(parseExpiry("MFG 08/2026"), null);
  assert.equal(parseExpiry("EXP 13/2028"), null);
  assert.equal(parseExpiry("EXP ??/20"), null);
  assert.equal(parseExpiry("Metformin 500 mg"), null);
});

test("good to the end of the printed month, and soon in the last sixty days", () => {
  const today = new Date(2026, 10, 1); // 1 Nov 2026
  assert.equal(expiryStatus({ year: 2026, month: 10 }, today).status, "expired");
  assert.equal(expiryStatus({ year: 2026, month: 11 }, today).status, "soon");
  assert.deepEqual(expiryStatus({ year: 2026, month: 11 }, today).lastDay, "2026-11-30");
  assert.equal(expiryStatus({ year: 2028, month: 7 }, today).status, "ok");
});
