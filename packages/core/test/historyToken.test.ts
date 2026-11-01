/**
 * The QR a family shows a doctor must survive the trip and refuse a bad code.
 *
 * The whole summary travels inside the link, so these tests stand in for the
 * camera: pack what the phone packs, read it back the way the doctor's phone
 * reads it, and check that something altered on the way is refused rather than
 * shown as a patient's history.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HISTORY_LINK,
  historyLink,
  historyTokenFrom,
  readHistoryToken,
  type HistoryPayload,
} from "../src/historyToken.js";

const payload: HistoryPayload = {
  v: 1,
  t: "2026-10-31T18:30:00.000Z",
  p: ["Prashant", 48, "male"],
  b: "O+",
  c: ["Diabetes"],
  a: ["Penicillin"],
  r: ["Metformin 500 mg"],
  m: [
    { n: "Metformin", s: "500 mg", f: "tablet", q: "1-0-1", d: 30, on: "2026-10-14", by: "Dr. R. Khan", ok: 1 },
    { n: "Glimepiride", s: "1 mg", f: "tablet", q: "1-0-0", d: 30, on: "2026-10-14", by: "Dr. R. Khan" },
  ],
  note: "Sugar high for two weeks.",
};

test("the whole summary goes into the link and comes back out of it", async () => {
  const link = await historyLink(payload);
  assert.ok(link.startsWith(HISTORY_LINK), "the QR is a link any camera opens");
  assert.ok(link.includes("#"), "the summary sits after the #, which a browser never sends to a server");

  const token = historyTokenFrom(link);
  assert.ok(token);
  const back = await readHistoryToken(token);
  assert.deepEqual(back, payload);
});

test("which medicines came off a signed Parcha survives the trip", async () => {
  const back = await readHistoryToken(historyTokenFrom(await historyLink(payload))!);
  assert.equal(back!.m.filter((m) => m.ok).length, 1, "only the checked one is marked");
  assert.equal(back!.m[1].ok, undefined, "one entered by hand claims nothing");
});

test("the token is read from the link, the fragment, or on its own", async () => {
  const link = await historyLink(payload);
  const token = link.slice(HISTORY_LINK.length);
  assert.equal(historyTokenFrom(link), token);
  assert.equal(historyTokenFrom(`https://example.test/history#${token}`), token);
  assert.equal(historyTokenFrom(token), token);
  assert.equal(historyTokenFrom("https://example.test/something-else"), null);
});

test("a code that was altered, or is not one, is refused rather than half-read", async () => {
  const token = historyTokenFrom(await historyLink(payload))!;
  assert.equal(await readHistoryToken(token.slice(0, -4) + "AAAA"), null);
  assert.equal(await readHistoryToken("not-a-token"), null);
  assert.equal(await readHistoryToken(""), null);
});

test("a payload of the wrong shape is refused, whatever it compresses to", async () => {
  const bytes = await new Response(
    new Blob([new TextEncoder().encode(JSON.stringify({ v: 2, p: ["Someone"] }))])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw")),
  ).arrayBuffer();
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  const token = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(await readHistoryToken(token), null);
});
