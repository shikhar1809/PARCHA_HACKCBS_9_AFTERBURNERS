import assert from "node:assert/strict";
import { test } from "node:test";

import { AVATAR_PALETTE, cleanLook, profileId, shownName } from "../src/profile.js";

test("a profile id is the phone and a tidy form of the name", () => {
  assert.equal(profileId("9811044321", "Prashant"), "9811044321__prashant");
  assert.equal(profileId("9811044321", "Dr. A. Khan!!"), "9811044321__dr-a-khan-");
  assert.equal(profileId("9811044321", "x".repeat(200)).length, "9811044321__".length + 60);
});

test("the nickname is what is shown, when there is one", () => {
  assert.equal(shownName({ name: "Prabha Devi", nickname: "Dadi" }), "Dadi");
  assert.equal(shownName({ name: "Prabha Devi", nickname: "   " }), "Prabha Devi");
  assert.equal(shownName({ name: "Prabha Devi" }), "Prabha Devi");
});

test("a look keeps what the palettes allow and drops the rest", () => {
  const look = cleanLook({
    skin: 2, hairColor: 99, shirt: -1, bg: 5.5, hairStyle: "bun", headwear: "turban",
    glasses: true, beard: "yes", bindi: false, extra: "ignored",
  });
  assert.deepEqual(look, { skin: 2, hairStyle: "bun", headwear: "turban", glasses: true, bindi: false });
});

test("every swatch index up to the palette size is accepted", () => {
  for (const [field, n] of Object.entries(AVATAR_PALETTE)) {
    assert.equal((cleanLook({ [field]: n - 1 }) as Record<string, number>)[field], n - 1);
    assert.equal((cleanLook({ [field]: n }) as Record<string, number>)[field], undefined);
  }
});

test("garbage in is an empty look, not an error", () => {
  assert.deepEqual(cleanLook(null), {});
  assert.deepEqual(cleanLook("face"), {});
  assert.deepEqual(cleanLook({ hairStyle: "mohawk", headwear: "crown" }), {});
});
