/**
 * The fifteen-minute share, where it can be tested without a server: the name
 * in the link, the clock, and the lock the PIN makes.
 *
 * The part that matters most here is the last one. A wrong PIN must open
 * nothing at all — not a partial history, not an empty one, nothing — because
 * the whole arrangement rests on the server holding a box it cannot read and
 * a stranger with the link getting the same.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { HistoryPayload } from "../src/historyToken.js";
import {
  RESERVED_USERNAMES,
  SHARE_MINUTES,
  nextUsername,
  secondsLeftOnShare,
  shareCountdown,
  shareExpiry,
  shareIsLive,
  shareUsername,
  usableUsername,
} from "../src/share.js";
import { lockHistory, unlockHistory } from "../src/shareCrypto.js";

const payload: HistoryPayload = {
  v: 1,
  t: "2026-10-31T18:30:00.000Z",
  p: ["Prashant", 48, "male"],
  b: "O+",
  c: ["Diabetes"],
  a: ["Penicillin"],
  r: ["Metformin 500 mg"],
  m: [{ n: "Metformin", s: "500 mg", f: "tablet", q: "1-0-1", d: 30, on: "2026-10-14", by: "Dr. R. Khan", ok: 1 }],
  note: null,
};

test("a person's name becomes a link a doctor can type", () => {
  assert.equal(shareUsername("Prabha Devi"), "prabha-devi");
  assert.equal(shareUsername("Prashant"), "prashant");
  assert.equal(shareUsername("  Priya  "), "priya");
  assert.equal(shareUsername("A. K. Sharma"), "a-k-sharma");
  assert.equal(shareUsername("प्रभा"), "parcha", "a name with no letters it can use still gets a link");
});

test("a link can never shadow one of the app's own screens", () => {
  for (const reserved of ["ask", "me", "records", "schedule", "history", "scan"]) {
    assert.ok(RESERVED_USERNAMES.has(reserved));
    assert.equal(usableUsername(reserved), false, `${reserved} is a screen, not a share`);
  }
  assert.equal(usableUsername("prashant"), true);
  assert.equal(usableUsername("a"), false, "one letter is too short to be meant");
  assert.equal(usableUsername("-prashant"), false);
  assert.equal(usableUsername("Prashant"), false, "links are lower case");
  assert.equal(usableUsername("prashant!"), false);
});

test("a taken name gets a number rather than somebody else's history", () => {
  assert.equal(nextUsername("prashant", 1), "prashant");
  assert.equal(nextUsername("prashant", 2), "prashant-2");
  assert.equal(nextUsername("prashant", 3), "prashant-3");
});

test("the window is fifteen minutes, and the countdown says so", () => {
  const start = new Date("2026-10-31T18:00:00.000Z");
  const expires = shareExpiry(start);
  assert.equal(new Date(expires).getTime() - start.getTime(), SHARE_MINUTES * 60_000);

  assert.equal(shareCountdown(expires, start), "15:00");
  assert.equal(shareCountdown(expires, new Date(start.getTime() + 14 * 60_000 + 1_000)), "0:59");
  assert.equal(shareCountdown(expires, new Date(start.getTime() + SHARE_MINUTES * 60_000)), "0:00");
  assert.equal(shareCountdown(expires, new Date(start.getTime() + 60 * 60_000)), "0:00", "never counts past zero");
});

test("a share is live until the moment it is not", () => {
  const start = new Date("2026-10-31T18:00:00.000Z");
  const expires = shareExpiry(start);
  assert.equal(shareIsLive(expires, start), true);
  assert.equal(shareIsLive(expires, new Date(start.getTime() + 14 * 60_000)), true);
  assert.equal(shareIsLive(expires, new Date(start.getTime() + SHARE_MINUTES * 60_000)), false);
  assert.equal(secondsLeftOnShare(expires, new Date(start.getTime() + 60 * 60_000)), 0);
});

test("the right PIN opens the history, and nothing else about it is readable", async () => {
  const sealed = await lockHistory(payload, "4821", "prashant");
  assert.ok(sealed.blob.length > 0);
  assert.ok(!sealed.blob.includes("Metformin"), "the medicine name must not survive in the clear");
  assert.ok(!sealed.blob.includes("Prashant"));

  const opened = await unlockHistory(sealed, "4821", "prashant");
  assert.deepEqual(opened, payload);
});

test("a wrong PIN opens nothing at all", async () => {
  const sealed = await lockHistory(payload, "4821", "prashant");
  for (const wrong of ["4822", "0000", "9999", "482"]) {
    assert.equal(await unlockHistory(sealed, wrong, "prashant"), null, `${wrong} must open nothing`);
  }
});

test("a box from one link cannot be opened under another", async () => {
  const sealed = await lockHistory(payload, "4821", "prashant");
  assert.equal(await unlockHistory(sealed, "4821", "priya"), null, "the name is part of the key");
});

test("the same PIN twice gives two different boxes", async () => {
  const a = await lockHistory(payload, "4821", "prashant");
  const b = await lockHistory(payload, "4821", "prashant");
  assert.notEqual(a.blob, b.blob, "a new salt and nonce every time");
  assert.notEqual(a.salt, b.salt);
  assert.deepEqual(await unlockHistory(b, "4821", "prashant"), payload);
});

test("a box that was tampered with is refused rather than half-read", async () => {
  const sealed = await lockHistory(payload, "4821", "prashant");
  assert.equal(await unlockHistory({ ...sealed, blob: sealed.blob.slice(0, -4) + "AAAA" }, "4821", "prashant"), null);
  assert.equal(await unlockHistory({ ...sealed, iv: sealed.iv.slice(0, -4) + "AAAA" }, "4821", "prashant"), null);
  assert.equal(await unlockHistory({ ...sealed, salt: sealed.salt.slice(0, -4) + "AAAA" }, "4821", "prashant"), null);
  assert.equal(await unlockHistory({ blob: "", salt: "", iv: "" }, "4821", "prashant"), null);
});
