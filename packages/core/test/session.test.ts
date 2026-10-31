import assert from "node:assert/strict";
import { test } from "node:test";

import { deviceName, distanceMetres, judgeAddress, movedTooFar, placeText } from "../src/session.js";

const clinic = { lat: 28.6315, lng: 77.2167 };

test("distance: about 1.1 km for a hundredth of a degree of latitude", () => {
  const d = distanceMetres(clinic, { lat: clinic.lat + 0.01, lng: clinic.lng });
  assert.ok(d > 1100 && d < 1120, String(d));
});

test("moving: GPS wander inside the limit, or inside the reading's own accuracy, is not a move", () => {
  assert.equal(movedTooFar(clinic, { lat: clinic.lat + 0.001, lng: clinic.lng }), false); // ~110 m
  assert.equal(movedTooFar(clinic, { lat: clinic.lat + 0.005, lng: clinic.lng }), true); // ~555 m
  assert.equal(movedTooFar(clinic, { lat: clinic.lat + 0.005, lng: clinic.lng, accuracyM: 400 }), false);
});

test("address: the same one is fine; a new one is a change", () => {
  assert.equal(judgeAddress(["49.36.1.2"], "49.36.1.2", 10 * 60_000), "same");
  assert.equal(judgeAddress(["49.36.1.2"], "49.36.1.9", 5_000), "changed");
});

test("address: the other family early in a session is the same device, later it is a change", () => {
  assert.equal(judgeAddress(["49.36.1.2"], "2401:4900::1", 30_000), "learn");
  assert.equal(judgeAddress(["49.36.1.2"], "2401:4900::1", 10 * 60_000), "changed");
  assert.equal(judgeAddress(["49.36.1.2", "2401:4900::1"], "2401:4900::2", 30_000), "changed");
});

test("place: at the clinic, a distance, or not shared", () => {
  assert.equal(placeText(clinic, { lat: clinic.lat + 0.001, lng: clinic.lng }), "At the clinic");
  assert.equal(placeText(clinic, { lat: clinic.lat + 0.02, lng: clinic.lng }), "2.2 km from the clinic");
  assert.equal(placeText(clinic, { lat: null, lng: null }), "Location not shared");
});

test("device: a short name from the user agent", () => {
  assert.equal(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36"), "Chrome on Windows");
  assert.equal(deviceName("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Electron/33.4.11 Safari/537.36"), "Parcha desktop program on Windows");
});
