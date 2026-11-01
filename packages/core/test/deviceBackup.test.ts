/**
 * The backup is the only copy of a family's records that outlives the phone,
 * so two things have to hold: the right PIN brings everything back exactly as
 * it was, and a wrong one brings back nothing at all.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  backupCounts,
  backupFileName,
  backupIsNewer,
  isBackupFile,
  openBackup,
  sealBackup,
  type BackupContents,
} from "../src/deviceBackup.js";

const contents: BackupContents = {
  vault: {
    "parcha:RCH7420": { person: "Prashant", savedAt: "2026-10-19T10:00:00.000Z", payload: { v: 1, m: [["Metformin", "500 mg", "tablet", "1-0-1", 30, "after_food"]] } },
    "parcha:RCH7188": { person: "Priya", savedAt: "2026-10-05T10:00:00.000Z" },
    "check:1": { person: "Priya", medicines: [{ name: "Amlodipine", frequency: "1-0-0" }] },
  },
  profiles: [{ name: "Prashant" }, { name: "Priya" }, { name: "Prabha Devi" }],
  reminders: [{ id: "a" }, { id: "b" }],
  histories: [{ personName: "Prashant", conditions: ["Diabetes"] }],
  doseLogs: [{ date: "2026-10-31" }],
  documents: [{ id: "doc1" }],
};

test("what is in a backup is counted for the screen that offers it back", () => {
  const counts = backupCounts(contents);
  assert.deepEqual(counts, { parchas: 3, people: 3, reminders: 2, papers: 1 });
});

test("the right PIN brings everything back exactly as it was", async () => {
  const file = await sealBackup(contents, "4821", "9811044321");
  assert.equal(file.v, 1);
  assert.equal(file.phone, "9811044321");
  assert.deepEqual(file.counts, { parchas: 3, people: 3, reminders: 2, papers: 1 });

  const back = await openBackup(file, "4821");
  assert.deepEqual(back, contents);
});

test("nothing readable is left in the file itself", async () => {
  const file = await sealBackup(contents, "4821", "9811044321");
  assert.ok(!file.blob.includes("Metformin"));
  assert.ok(!file.blob.includes("Prashant"));
  assert.ok(!file.blob.includes("Diabetes"));
  // The phone number is deliberately in the clear, so a phone can refuse
  // somebody else's backup before asking anybody for a PIN.
  assert.equal(file.phone, "9811044321");
});

test("a wrong PIN brings back nothing", async () => {
  const file = await sealBackup(contents, "4821", "9811044321");
  for (const wrong of ["4822", "0000", "1234"]) {
    assert.equal(await openBackup(file, wrong), null);
  }
});

test("a backup of one phone does not open under another's number", async () => {
  const file = await sealBackup(contents, "4821", "9811044321");
  assert.equal(await openBackup({ ...file, phone: "9999999999" }, "4821"), null, "the number is part of the key");
});

test("a damaged or foreign file is refused rather than half-read", async () => {
  const file = await sealBackup(contents, "4821", "9811044321");
  assert.equal(await openBackup({ ...file, blob: file.blob.slice(0, -4) + "AAAA" }, "4821"), null);
  assert.equal(isBackupFile(file), true);
  assert.equal(isBackupFile({ v: 2, phone: "x", blob: "y", salt: "s", iv: "i" }), false);
  assert.equal(isBackupFile({ hello: "world" }), false);
  assert.equal(isBackupFile(null), false);
});

test("the newer copy is the one that gets offered", () => {
  const file = { madeAt: "2026-10-31T12:00:00.000Z" };
  assert.equal(backupIsNewer(file, null), true, "a phone with nothing on it takes the backup");
  assert.equal(backupIsNewer(file, "2026-10-30T12:00:00.000Z"), true);
  assert.equal(backupIsNewer(file, "2026-11-01T12:00:00.000Z"), false, "a phone with newer data is left alone");
  assert.equal(backupIsNewer(file, "2026-10-31T12:00:00.000Z"), false, "a tie goes to the phone in front of the person");
});

test("a saved copy is named so a person can find it again", () => {
  assert.equal(backupFileName("9811044321", new Date("2026-10-31T18:00:00.000Z")), "parcha-9811044321-2026-10-31.parcha");
});
