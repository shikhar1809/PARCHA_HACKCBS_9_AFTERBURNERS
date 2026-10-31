/**
 * Integration tests against the running emulators.
 *
 *   npm run emulators          (in one terminal)
 *   npm run test:integration   (in another)
 *
 * or in one go, as CI does:
 *   firebase emulators:exec --only auth,firestore,functions --project parcha-dev "npm run test:integration"
 *
 * These check what the unit tests cannot: that the security rules and the
 * Cloud Functions, together, hold. They reseed the demo data first, so they
 * leave the emulator in the demo state.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

const PROJECT = "parcha-dev";
const AUTH = "http://127.0.0.1:9099";
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-south1`;

const json = (r) => r.json().catch(() => ({}));

const CLINIC = { lat: 28.5276, lng: 77.2117, accuracy: 20 };

/** A staff member signs in and opens a session at the clinic, as the app does before it shows anything. */
async function signIn(email, password = "parcha123", { session = true } = {}) {
  const who = await signInOnly(email, password);
  if (session) {
    const s = await call("startStaffSession", CLINIC, who.token);
    assert.ok(s.ok, `no session for ${email}: ${s.error}`);
    who.sessionId = s.result.sessionId;
  }
  return who;
}

async function signInOnly(email, password = "parcha123") {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const b = await json(r);
  assert.ok(b.idToken, `could not sign in ${email}`);
  return { token: b.idToken, uid: b.localId };
}

/** A patient signs in with a phone number, the way the app does on the emulator. */
async function signInPhone(tenDigits) {
  const send = await json(await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=x`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: `+91${tenDigits}`, recaptchaToken: "test" }),
  }));
  const codes = await json(await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/verificationCodes`));
  const code = codes.verificationCodes.filter((c) => c.phoneNumber.endsWith(tenDigits)).at(-1).code;
  const done = await json(await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=x`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionInfo: send.sessionInfo, code }),
  }));
  assert.ok(done.idToken, "phone sign-in failed");
  return { token: done.idToken, uid: done.localId };
}

const auth = (token) => ({ authorization: `Bearer ${token}` });

async function call(name, data, token, headers = {}) {
  const r = await fetch(`${FN}/${name}`, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? auth(token) : {}), ...headers },
    body: JSON.stringify({ data }),
  });
  const b = await json(r);
  return { ok: r.ok, result: b.result, error: b.error?.message ?? null, status: r.status };
}

/** One document, read as a signed-in user (rules apply), or as the emulator owner (rules bypassed). */
const read = (path, token) => fetch(`${FS}/${path}`, { headers: token ? auth(token) : {} });
const owner = (path) => fetch(`${FS}/${path}`, { headers: auth("owner") });

async function ownerQuery(collection, where) {
  // The activity log is read newest first, as the app reads it: the seed's month of history sits behind today's entries.
  const orderBy = collection === "activity" ? [{ field: { fieldPath: "at" }, direction: "DESCENDING" }] : undefined;
  const r = await fetch(`${FS}:runQuery`, {
    method: "POST", headers: { ...auth("owner"), "content-type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where, orderBy, limit: 50 } }),
  });
  return (await json(r)).filter((x) => x.document).map((x) => ({ id: x.document.name.split("/").pop(), fields: x.document.fields }));
}
const eq = (field, value) => ({ fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } });
const and = (...filters) => ({ compositeFilter: { op: "AND", filters } });

before(async () => {
  const r = await json(await fetch(`${FN}/seedDemoData`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: {} }) }));
  assert.ok(r.result, `seed failed: ${JSON.stringify(r)}`);
});

describe("the hospital wall", () => {
  test("nobody signed out can read a visit", async () => {
    const visit = (await ownerQuery("visits", eq("hospitalId", "h-cp")))[0];
    assert.equal((await read(`visits/${visit.id}`)).status, 403);
  });

  test("a desk reads its own hospital's visit but not another's", async () => {
    const desk = await signIn("staff@parcha.test");
    const mine = (await ownerQuery("visits", eq("hospitalId", "h-cp")))[0];
    const theirs = (await ownerQuery("visits", eq("hospitalId", "h-noida")))[0];
    assert.equal((await read(`visits/${mine.id}`, desk.token)).status, 200);
    assert.equal((await read(`visits/${theirs.id}`, desk.token)).status, 403);
  });

  test("no client can write a visit", async () => {
    const desk = await signIn("staff@parcha.test");
    const mine = (await ownerQuery("visits", eq("hospitalId", "h-cp")))[0];
    const r = await fetch(`${FS}/visits/${mine.id}?updateMask.fieldPaths=stage`, {
      method: "PATCH", headers: { ...auth(desk.token), "content-type": "application/json" },
      body: JSON.stringify({ fields: { stage: { stringValue: "prescribed" } } }),
    });
    assert.equal(r.status, 403);
  });

  test("another hospital's doctor cannot act on a visit here, and is told it does not exist", async () => {
    const noidaDoctor = await signIn("noida.doctor@parcha.test");
    const visit = (await ownerQuery("visits", and(eq("hospitalId", "h-cp"), eq("stage", "intake_complete"))))[0];
    const r = await call("startConsultation", { visitId: visit.id }, noidaDoctor.token);
    assert.equal(r.ok, false);
    assert.match(r.error, /No such visit/);
  });
});

describe("a patient's own papers are private", () => {
  test("a hospital account cannot read documents, histories, reminders or call logs", async () => {
    const desk = await signIn("staff@parcha.test");
    for (const col of ["documents", "histories", "reminders", "doseLogs", "callJobs", "callSettings", "consents"]) {
      const r = await fetch(`${FS}/${col}`, { headers: auth(desk.token) });
      assert.equal(r.status, 403, `${col} should be unreadable to staff`);
    }
  });

  test("a patient can add a paper only for someone on their own phone, and only a photo or PDF", async () => {
    const p = await signInPhone("9811044321");
    const tiny = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const stranger = await call("addDocument", { personName: "Nobody Here", title: "x", kind: "report", mime: "image/png", data: tiny }, p.token);
    assert.match(stranger.error, /not on this phone/);
    const wrongType = await call("addDocument", { personName: "Sunita Devi", title: "x", kind: "report", mime: "text/html", data: tiny }, p.token);
    assert.match(wrongType.error, /photo or a PDF/);
    const ok = await call("addDocument", { personName: "Sunita Devi", title: "Blood test", kind: "report", mime: "image/png", data: tiny }, p.token);
    assert.ok(ok.ok, ok.error);
    // Another phone cannot delete it.
    const other = await signInPhone("9700881122");
    const del = await call("deleteDocument", { id: ok.result.id }, other.token);
    assert.match(del.error, /No such document/);
    assert.ok((await call("deleteDocument", { id: ok.result.id }, p.token)).ok);
  });
});

describe("signing a prescription", () => {
  let doctor;
  let visitId;
  const line = (drugId, drugName) => ({ drugId, drugName, form: "tablet", strength: "10 mg", frequency: "BD", durationDays: 5, timing: "after_food", quantity: 10 });
  const items = [line("prednisolone", "Prednisolone"), line("ibuprofen", "Ibuprofen")];
  const byHand = { ...line("unlisted:rabeprazole", "Rabeprazole"), strength: "20 mg", unlisted: true };

  before(async () => {
    // The seed spreads patients across the three City doctors; use whichever has one waiting.
    let found;
    for (const email of ["doctor@parcha.test", "doctor2@parcha.test", "doctor3@parcha.test"]) {
      doctor = await signIn(email);
      found = (await ownerQuery("visits", and(eq("assignedDoctorUid", doctor.uid), eq("stage", "intake_complete"))))[0];
      if (found) break;
    }
    assert.ok(found, "the seed should leave some doctor a patient");
    visitId = found.id;
    assert.ok((await call("startConsultation", { visitId }, doctor.token)).ok);
  });

  test("a medicine the formulary does not know is refused", async () => {
    const r = await call("signPrescription", { visitId, diagnosis: "x", items: [line("not_a_drug", "Nothing")] }, doctor.token);
    assert.match(r.error, /Not in the formulary/);
  });

  test("a medicine written by hand is allowed, and flagged as not checked", async () => {
    const r = await call("checkPrescription", { visitId, items: [byHand] }, doctor.token);
    assert.ok(r.ok, r.error);
    assert.ok(r.result.flags.some((f) => f.rule === "unlisted" && f.subjectDrugName === "Rabeprazole"));
    // Without the marker it is still refused, so a typo cannot slip past the list.
    const bare = await call("signPrescription", { visitId, diagnosis: "x", items: [{ ...byHand, unlisted: undefined }] }, doctor.token);
    assert.match(bare.error, /Not in the formulary/);
  });

  test("the safety check finds the steroid-with-painkiller interaction", async () => {
    const r = await call("checkPrescription", { visitId, items }, doctor.token);
    assert.ok(r.ok, r.error);
    const hit = r.result.flags.find((f) => f.rule === "drug_drug" && f.severity === "high");
    assert.ok(hit, "expected a high-severity interaction");
  });

  test("a high-severity flag that was not acknowledged stops the signature", async () => {
    const r = await call("signPrescription", { visitId, diagnosis: "Knee pain", items }, doctor.token);
    assert.equal(r.ok, false);
    assert.match(r.error, /SAFETY_ACK/);
  });

  test("acknowledged, it signs with its tests; the visit ends, and gets a share code", async () => {
    const all = [...items, byHand];
    const check = await call("checkPrescription", { visitId, items: all, pregnancy: "no" }, doctor.token);
    const acknowledged = check.result.flags.filter((f) => f.severity === "high").map((f) => f.key);
    const r = await call(
      "signPrescription",
      { visitId, diagnosis: "Knee pain", items: all, tests: ["CBC", " cbc ", "X-ray knee"], pregnancy: "no", acknowledged },
      doctor.token,
    );
    assert.ok(r.ok, r.error);
    const rx = (await (await owner(`visits/${visitId}/prescriptions/${r.result.prescriptionId}`)).json()).fields;
    assert.deepEqual(rx.tests.arrayValue.values.map((v) => v.stringValue), ["CBC", "X-ray knee"]);
    assert.equal(rx.pregnancy.stringValue, "no");
    // The printed parcha's QR: the whole prescription, signed, as a link to the patient app.
    assert.match(rx.qr.stringValue, /^https:\/\/parcha\.web\.app\/rx#[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{80,}$/);

    const visit = (await (await owner(`visits/${visitId}`)).json()).fields;
    assert.equal(visit.stage.stringValue, "prescribed");
    assert.ok(visit.closedAt.timestampValue, "a signed visit is closed");
    assert.match(visit.shareCode.stringValue, /^[2-9A-Z]{10}$/);
  });

  test("it cannot be signed twice", async () => {
    const r = await call("signPrescription", { visitId, diagnosis: "x", items: [line("paracetamol", "Paracetamol")], acknowledged: [] }, doctor.token);
    assert.equal(r.ok, false);
  });
});

describe("phone calls", () => {
  test("cannot be switched on without agreeing, and go only to the signed-in number", async () => {
    // Start clean: a consent recorded by an earlier run would still count.
    await fetch(`${FS}/callSettings/9700881122`, { method: "DELETE", headers: auth("owner") });
    const p = await signInPhone("9700881122");
    const noConsent = await call("saveCallSettings", { enabled: true, language: "hi" }, p.token);
    assert.match(noConsent.error, /agree/);
    const ok = await call("saveCallSettings", { enabled: true, language: "en", consent: true }, p.token);
    assert.ok(ok.ok, ok.error);
    const settings = (await (await owner("callSettings/9700881122")).json()).fields;
    assert.equal(settings.ownerPhone.stringValue, "9700881122");
    assert.ok(settings.consentAt.stringValue);
  });

  test("the by-hand dispatcher refuses a missing key", async () => {
    const r = await fetch(`${FN}/runCallDispatcher`);
    assert.equal(r.status, 403);
  });
});

describe("people on a phone", () => {
  let p;
  before(async () => {
    p = await signInPhone("9845512077");
    await fetch(`${FS}/profiles/9845512077__asha-nayak`, { method: "DELETE", headers: auth("owner") });
  });

  test("an age outside 0 to 120 is refused", async () => {
    const r = await call("saveProfile", { name: "Asha Nayak", ageYears: 200 }, p.token);
    assert.match(r.error, /Age must be/);
  });

  test("a family member can be added by hand, and reminders can be made for them", async () => {
    const made = await call("saveProfile", { name: "Asha Nayak", nickname: "Maa", ageYears: 71, sex: "female", look: { skin: 2, hairStyle: "bun", skin2: 9 }, needsHelp: true }, p.token);
    assert.ok(made.ok, made.error);
    const doc = (await (await owner("profiles/9845512077__asha-nayak")).json()).fields;
    assert.equal(doc.nickname.stringValue, "Maa");
    assert.equal(doc.needsHelp.booleanValue, true);
    assert.equal(doc.look.mapValue.fields.skin2, undefined, "unknown look fields are dropped");
    const day = new Date().toISOString().slice(0, 10);
    const rem = await call("saveReminders", { reminders: [{ personName: "Asha Nayak", kind: "medicine", title: "Test tablet", times: ["08:00"], days: [], startDate: day, endDate: day, enabled: true }] }, p.token);
    assert.ok(rem.ok, rem.error);
    await call("deleteReminder", { id: rem.result.ids[0] }, p.token);
  });

  test("a number is only phoned after the code read to it is typed back", async () => {
    const start = await call("startCallNumberVerification", { name: "Asha Nayak", number: "9876500011" }, p.token);
    assert.ok(start.ok, start.error);
    assert.match(start.result.demoCode, /^\d{4}$/);
    const wrong = await call("confirmCallNumber", { name: "Asha Nayak", code: start.result.demoCode === "0000" ? "1111" : "0000" }, p.token);
    assert.match(wrong.error, /not the right code/);
    let doc = (await (await owner("profiles/9845512077__asha-nayak")).json()).fields;
    assert.notEqual(doc.callNumberVerified?.booleanValue, true, "unverified until the right code");
    const right = await call("confirmCallNumber", { name: "Asha Nayak", code: start.result.demoCode }, p.token);
    assert.ok(right.ok, right.error);
    doc = (await (await owner("profiles/9845512077__asha-nayak")).json()).fields;
    assert.equal(doc.callNumber.stringValue, "9876500011");
    assert.equal(doc.callNumberVerified.booleanValue, true);
    assert.ok((await call("clearCallNumber", { name: "Asha Nayak" }, p.token)).ok);
  });

  test("a number cannot be the account's own, or not a mobile number", async () => {
    assert.match((await call("startCallNumberVerification", { name: "Asha Nayak", number: "9845512077" }, p.token)).error, /signed in with/);
    assert.match((await call("startCallNumberVerification", { name: "Asha Nayak", number: "1234567890" }, p.token)).error, /mobile number/);
  });

  test("a reminder id made up offline is kept, and cannot take over somebody else's", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const make = (title, person) => ({ id: "c_testoffline0001", personName: person, kind: "other", title, times: ["09:00"], days: [], startDate: day, endDate: day, enabled: true });
    const mine = await call("saveReminders", { reminders: [make("Mine", "Asha Nayak")] }, p.token);
    assert.deepEqual(mine.result.ids, ["c_testoffline0001"]);
    // Another phone sending the same id must not overwrite it.
    const other = await signInPhone("9700881122");
    await call("saveReminders", { reminders: [make("Theirs", "Imran")] }, other.token);
    const still = (await (await owner("reminders/c_testoffline0001")).json()).fields;
    assert.equal(still.title.stringValue, "Mine");
    await call("deleteReminder", { id: "c_testoffline0001" }, p.token);
  });
});

describe("privacy", () => {
  test("consent is recorded, and the export holds it", async () => {
    const p = await signInPhone("9845512077");
    assert.match((await call("recordConsent", { agree: false }, p.token)).error, /agree/);
    assert.ok((await call("recordConsent", { agree: true, language: "en" }, p.token)).ok);
    const data = await call("exportMyData", {}, p.token);
    assert.ok(data.ok, data.error);
    assert.ok(data.result.consent.version.length > 0);
  });
});

describe("working offline", () => {
  let desk;
  let doctor;
  const cid = `c_${Date.now().toString(36)}aa`;
  const vid = `c_${Date.now().toString(36)}bb`;

  before(async () => {
    desk = await signIn("staff@parcha.test");
    doctor = await signIn("doctor@parcha.test");
  });

  test("a patient made on the desk's own computer keeps its name, and sending twice makes one", async () => {
    const data = { opId: "op1" + cid, clientId: cid, fullName: "Offline Test", phone: "9000011122" };
    const a = await call("registerPatient", data, desk.token);
    assert.ok(a.ok, a.error);
    assert.equal(a.result.patientId, cid);
    const b = await call("registerPatient", data, desk.token);
    assert.equal(b.result.patientId, cid);
    assert.equal((await ownerQuery("patients", eq("phone", "9000011122"))).length, 1);
  });

  test("the same visit, intake and consultation arrive in order and can be repeated", async () => {
    const v = await call("startVisit", { opId: "op2" + cid, patientId: cid, clientVisitId: vid }, desk.token);
    assert.ok(v.ok, v.error);
    assert.equal(v.result.visitId, vid);
    const intake = { opId: "op3" + cid, visitId: vid, doctorUid: doctor.uid, complaint: "Cough two days", systolicMmhg: 120, diastolicMmhg: 80, weightKg: 64 };
    assert.ok((await call("saveIntake", intake, desk.token)).ok);
    assert.ok((await call("saveIntake", intake, desk.token)).ok, "a repeat is answered, not refused");
    assert.ok((await call("startConsultation", { opId: "op4" + cid, visitId: vid }, doctor.token)).ok);
  });

  test("a prescription signed offline keeps when it was signed", async () => {
    const queuedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    const items = [{ drugId: "paracetamol", drugName: "Paracetamol", form: "tablet", strength: "500 mg", frequency: "BD", durationDays: 3, timing: "after_food", quantity: 6 }];
    const send = { opId: "op5" + cid, visitId: vid, diagnosis: "Cold", items, acknowledged: [], queuedAt };
    const r = await call("signPrescription", send, doctor.token);
    assert.ok(r.ok, r.error);
    const again = await call("signPrescription", send, doctor.token);
    assert.ok(again.ok, "a repeat of the same action returns the first answer");
    assert.equal(again.result.prescriptionId, r.result.prescriptionId);
    const rx = ((await (await owner(`visits/${vid}/prescriptions`)).json()).documents ?? []).length;
    assert.equal(rx, 1);
  });
});

/** Whether a hospital is an example set-up (opens without a location). */
const setExample = (hospitalId, on) =>
  fetch(`${FS}/hospitals/${hospitalId}?updateMask.fieldPaths=example`, {
    method: "PATCH", headers: { ...auth("owner"), "content-type": "application/json" },
    body: JSON.stringify({ fields: { example: { booleanValue: on } } }),
  });

describe("staff sessions and the activity log", () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // These are a real clinic's rules: location is required.
  before(() => setExample("h-cp", false));
  after(() => setExample("h-cp", true));

  test("without an open session, a staff account reads nothing", async () => {
    const anil = await signIn("staff2@parcha.test", "parcha123", { session: false });
    const visits = await ownerQuery("visits", eq("hospitalId", "h-cp"));
    const id = visits[0].id;
    assert.equal((await read(`visits/${id}`, anil.token)).status, 403);
    assert.equal((await call("startStaffSession", {}, anil.token)).ok, false, "no location, no session");
    const s = await call("startStaffSession", CLINIC, anil.token);
    assert.ok(s.ok, s.error);
    assert.equal((await read(`visits/${id}`, anil.token)).status, 200);
  });

  test("a new internet address ends the session at once, and only a fresh sign-in opens another", async () => {
    const anil = await signIn("staff2@parcha.test");
    const beat = await call("sessionBeat", { sessionId: anil.sessionId, ...CLINIC }, anil.token, { "x-forwarded-for": "203.0.113.9" });
    assert.equal(beat.result.ended, true);
    assert.match(beat.result.reason, /internet address changed/);
    const after = await call("registerPatient", { fullName: "After End", phone: "9000099999" }, anil.token);
    assert.match(after.error, /SESSION_ENDED/);
    assert.match((await call("startStaffSession", CLINIC, anil.token)).error, /SESSION_ENDED/, "the old sign-in cannot reopen it");
    await sleep(1100);
    assert.ok((await signIn("staff2@parcha.test")).sessionId, "signing in again opens a new one");
  });

  test("a forged forwarded address does not change who the server sees", async () => {
    const anil = await signIn("staff2@parcha.test");
    // A client can send its own header; the real address is appended after it.
    // (The emulator gives no address, so use whatever the session recorded.)
    const real = (await (await owner(`staffSessions/${anil.uid}`)).json()).fields.ips.arrayValue.values[0].stringValue;
    const beat = await call("sessionBeat", { sessionId: anil.sessionId, ...CLINIC }, anil.token, { "x-forwarded-for": `203.0.113.9, ${real}` });
    assert.equal(beat.result.ended, false);
  });

  test("moving away, or turning location off, ends the session", async () => {
    let anil = await signIn("staff2@parcha.test");
    const moved = await call("sessionBeat", { sessionId: anil.sessionId, lat: CLINIC.lat + 0.01, lng: CLINIC.lng, accuracy: 20 }, anil.token);
    assert.equal(moved.result.ended, true);
    assert.match(moved.result.reason, /moved away/);
    await sleep(1100);
    anil = await signIn("staff2@parcha.test");
    const dark = await call("sessionBeat", { sessionId: anil.sessionId }, anil.token);
    assert.equal(dark.result.ended, true);
    assert.match(dark.result.reason, /location/);
  });

  test("the doctor reads who did what, in sentences; a desk that is not an admin cannot", async () => {
    const desk = await signIn("staff@parcha.test");
    const made = await call("registerPatient", { fullName: "Log Reader", phone: "9000077777", statedAgeYears: 50 }, desk.token);
    assert.ok(made.ok, made.error);
    const doctor = await signIn("doctor@parcha.test");
    const q = (token) => fetch(`${FS}:runQuery`, {
      method: "POST", headers: { ...auth(token), "content-type": "application/json" },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "activity" }], where: eq("hospitalId", "h-cp"), orderBy: [{ field: { fieldPath: "at" }, direction: "DESCENDING" }], limit: 200 } }),
    });
    const rows = (await (await q(doctor.token)).json()).filter((x) => x.document).map((x) => x.document.fields.text.stringValue);
    const want = "Rekha (management) registered a new patient, Log Reader, 50 (phone ending 7777).";
    assert.ok(rows.includes(want), rows.join("\n"));
    assert.ok(rows.some((t) => /opened Parcha/.test(t)));
    await sleep(1100);
    const anil = await signIn("staff2@parcha.test");
    assert.equal((await q(anil.token)).status, 403);
  });
});

describe("seats, clinic set-up and the Manage page", () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const claimsOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));

  test("the Manage page needs the PIN; a right one gives a pass that shows the seats and the team", async () => {
    const rekha = await signIn("staff@parcha.test");
    assert.match((await call("openManage", { pin: "9999" }, rekha.token)).error, /Wrong PIN/);
    assert.match((await call("manageState", { manageToken: "made-up" }, rekha.token)).error, /MANAGE_PIN/);
    const open = await call("openManage", { pin: "1234" }, rekha.token);
    assert.ok(open.ok, open.error);
    const state = await call("manageState", { manageToken: open.result.token }, rekha.token);
    assert.ok(state.ok, state.error);
    assert.deepEqual(state.result.seats.map((x) => x.id), ["management", "reception", "triage", "doctor", "pharmacy", "billing", "clerk"]);
    assert.ok(state.result.team.some((m) => m.displayName === "Anil (reception)" && m.seatId === "reception"));
  });

  test("a desk without Manage cannot open it, however right the PIN", async () => {
    const anil = await signIn("staff2@parcha.test");
    assert.match((await call("openManage", { pin: "1234" }, anil.token)).error, /cannot manage the clinic/);
  });

  test("rewiring who sends to whom needs the Manage PIN, even for a manager; a desk cannot at all", async () => {
    const rekha = await signIn("staff@parcha.test");
    const anil = await signIn("staff2@parcha.test");
    const mehta = await signIn("doctor2@parcha.test");
    const mary = await signIn("triage@parcha.test");
    const wire = { fromUid: mary.uid, toUid: mehta.uid };
    assert.match((await call("connectTeamMembers", wire, rekha.token)).error, /MANAGE_PIN/);
    assert.match((await call("connectTeamMembers", { ...wire, manageToken: "made-up" }, anil.token)).error, /cannot manage the clinic/);
    const { result: { token } } = await call("openManage", { pin: "1234" }, rekha.token);
    const made = await call("connectTeamMembers", { ...wire, manageToken: token }, rekha.token);
    assert.ok(made.ok, made.error);
    assert.match((await call("disconnectTeamMembers", wire, rekha.token)).error, /MANAGE_PIN/);
    assert.ok((await call("disconnectTeamMembers", { ...wire, manageToken: token }, rekha.token)).ok);
  });

  test("a new seat is what a person can do: a triage nurse takes vitals but cannot register", async () => {
    const rekha = await signIn("staff@parcha.test");
    const { result: { token } } = await call("openManage", { pin: "1234" }, rekha.token);
    const seat = await call("saveSeat", { manageToken: token, seat: { name: "Triage nurse", abilities: ["vitals"] } }, rekha.token);
    assert.ok(seat.ok, seat.error);
    assert.equal(seat.result.id, "triage-nurse");
    const email = `nurse${Date.now()}@parcha.test`;
    const made = await call("createTeamMember", { manageToken: token, displayName: "Sister Grace", email, seatId: "triage-nurse" }, rekha.token);
    assert.ok(made.ok, made.error);
    const nurse = await signIn(email, made.result.password);
    const c = claimsOf(nurse.token);
    assert.deepEqual(c.abilities, ["vitals"]);
    assert.equal(c.seatName, "Triage nurse");
    assert.match((await call("registerPatient", { fullName: "Nope", phone: "9000012345" }, nurse.token)).error, /cannot register patients/);
  });

  test("the last person who can manage cannot lose it", async () => {
    const rekha = await signIn("staff@parcha.test");
    const { result: { token } } = await call("openManage", { pin: "1234" }, rekha.token);
    const strip = await call("saveSeat", { manageToken: token, seat: { id: "management", name: "Hospital management", abilities: ["register", "vitals"] } }, rekha.token);
    assert.match(strip.error, /nobody able to manage/);
    assert.match((await call("assignSeat", { manageToken: token, uid: rekha.uid, seatId: "reception" }, rekha.token)).error, /nobody able to manage/);
    assert.match((await call("setMemberActive", { manageToken: token, uid: rekha.uid, active: false }, rekha.token)).error, /yourself/);
  });

  test("five wrong PINs lock the Manage page, even for the right one", async () => {
    const sneha = await signIn("dwarka.desk@parcha.test");
    for (let i = 0; i < 4; i++) assert.match((await call("openManage", { pin: "0000" }, sneha.token)).error, /Wrong PIN/);
    assert.match((await call("openManage", { pin: "0000" }, sneha.token)).error, /locked for 15 minutes/);
    assert.match((await call("openManage", { pin: "1234" }, sneha.token)).error, /Too many wrong PINs/);
  });

  test("a clinic that is not set up is set up once, and its owner becomes a doctor who does everything", async () => {
    let meera = await signIn("solo@parcha.test");
    const setup = await call("setupClinic", { template: "solo", name: "Dr. Meera's Clinic", area: "Lajpat Nagar", pin: "4321", lat: 28.5677, lng: 77.2433 }, meera.token);
    assert.ok(setup.ok, setup.error);
    assert.equal(setup.result.seatName, "Doctor");
    assert.match((await call("setupClinic", { template: "clinic", name: "Again", pin: "4321" }, meera.token)).error, /already set up/);
    await sleep(1100);
    meera = await signIn("solo@parcha.test");
    const c = claimsOf(meera.token);
    assert.deepEqual(c.abilities, ["register", "vitals", "consult", "dispense", "billing", "activity", "manage"]);
    assert.equal(c.accountType, "doctor");
    const hospital = (await (await owner("hospitals/h-solo")).json()).fields;
    assert.equal(hospital.setupDone.booleanValue, true);
    assert.equal(hospital.name.stringValue, "Dr. Meera's Clinic");
    // She registers, takes vitals and sends the patient to herself: no desk needed.
    const p = await call("registerPatient", { fullName: "Solo Patient", phone: "9000044444" }, meera.token);
    assert.ok(p.ok, p.error);
    const v = await call("startVisit", { patientId: p.result.patientId }, meera.token);
    assert.ok(v.ok, v.error);
    const intake = await call("saveIntake", { visitId: v.result.visitId, doctorUid: meera.uid, complaint: "Fever", systolicMmhg: 120, diastolicMmhg: 80, weightKg: 58 }, meera.token);
    assert.ok(intake.ok, intake.error);
  });

  test("a clinic can allow address changes; the session then carries on and the log says so", async () => {
    // A real clinic's rules (the example set-ups relax them).
    await setExample("h-solo", false);
    const meera = await signIn("solo@parcha.test");
    const { result: { token } } = await call("openManage", { pin: "4321" }, meera.token);
    assert.ok((await call("saveSettings", { manageToken: token, sessionRules: { moveLimitM: 500, endOnIpChange: false } }, meera.token)).ok);
    const beat = await call("sessionBeat", { sessionId: meera.sessionId, ...CLINIC }, meera.token, { "x-forwarded-for": "198.51.100.7" });
    assert.equal(beat.result.ended, false);
    const log = await ownerQuery("activity", eq("hospitalId", "h-solo"));
    assert.ok(log.some((x) => /allow this, so the session carried on/.test(x.fields.text.stringValue)));
  });

  test("a doctor's first sign-in profile needs a registration number, and the prescription carries it", async () => {
    const iyer = await signIn("doctor3@parcha.test");
    assert.match((await call("saveMyProfile", { displayName: "Dr. R. Iyer" }, iyer.token)).error, /registration number/);
    const ok = await call("saveMyProfile", { displayName: "Dr. R. Iyer", qualification: "MBBS, MD (Paediatrics)", registrationNo: "DMC/R/07781", department: "Paediatrics" }, iyer.token);
    assert.ok(ok.ok, ok.error);
    const acct = (await (await owner(`accounts/${iyer.uid}`)).json()).fields;
    assert.equal(acct.profileDone.booleanValue, true);
    assert.equal(acct.registrationNo.stringValue, "DMC/R/07781");
  });
});

describe("access needs, manual schedules, share codes", () => {
  test("the desk notes a patient is deaf; the open visit and the activity log show it", async () => {
    const rekha = await signIn("staff@parcha.test");
    const p = await call("registerPatient", { fullName: "Access Patient", phone: "9000066666", accessNeeds: ["deaf"] }, rekha.token);
    assert.ok(p.ok, p.error);
    const v = await call("startVisit", { patientId: p.result.patientId }, rekha.token);
    const visit = (await (await owner(`visits/${v.result.visitId}`)).json()).fields;
    assert.deepEqual(visit.accessNeeds.arrayValue.values.map((x) => x.stringValue), ["deaf"]);
    // Every visit started at the desk gets the day's next token.
    assert.ok(Number(visit.tokenNumber.integerValue) > 0, "a token number");
    const set = await call("setAccessNeeds", { patientId: p.result.patientId, needs: ["low_vision", "sign_language", "nonsense"] }, rekha.token);
    assert.deepEqual(set.result.needs, ["low_vision", "sign_language"]);
    const again = (await (await owner(`visits/${v.result.visitId}`)).json()).fields;
    assert.deepEqual(again.accessNeeds.arrayValue.values.map((x) => x.stringValue), ["low_vision", "sign_language"]);
    const log = await ownerQuery("activity", eq("hospitalId", "h-cp"));
    assert.ok(log.some((x) => /noted that Access Patient is blind or low vision and uses sign language/.test(x.fields.text.stringValue)));
  });

  test("a desk that cannot register cannot change access needs", async () => {
    const doctor = await signIn("doctor@parcha.test");
    const patients = await ownerQuery("patients", eq("hospitalId", "h-cp"));
    assert.match((await call("setAccessNeeds", { patientId: patients[0].id, needs: ["deaf"] }, doctor.token)).error, /cannot act at the compounder counter|cannot register/);
  });

  test("a line with no time of day is refused; a weekly line keeps its schedule and a safe share code", async () => {
    const rekha = await signIn("staff@parcha.test");
    const doctor = await signIn("doctor@parcha.test");
    const p = await call("registerPatient", { fullName: "Weekly Patient", phone: "9000077788" }, rekha.token);
    const v = await call("startVisit", { patientId: p.result.patientId }, rekha.token);
    const visitId = v.result.visitId;
    assert.ok((await call("saveIntake", { visitId, doctorUid: doctor.uid, complaint: "Low vitamin D", systolicMmhg: 118, diastolicMmhg: 76, weightKg: 55 }, rekha.token)).ok);
    assert.ok((await call("startConsultation", { visitId }, doctor.token)).ok);
    const base = { drugId: "paracetamol", drugName: "Paracetamol", form: "tablet", strength: "500 mg", durationDays: 28, timing: "after_food", quantity: 4 };
    const none = await call("signPrescription", { visitId, diagnosis: "x", items: [{ ...base, frequency: "0-0-0" }], acknowledged: [] }, doctor.token);
    assert.match(none.error, /at least one time of day/);
    const ok = await call("signPrescription", { visitId, diagnosis: "Weekly", items: [{ ...base, frequency: "1-0-0", everyDays: 7 }], acknowledged: [] }, doctor.token);
    assert.ok(ok.ok, ok.error);
    const rx = (await (await owner(`visits/${visitId}/prescriptions/${ok.result.prescriptionId}`)).json()).fields;
    assert.equal(rx.items.arrayValue.values[0].mapValue.fields.everyDays.integerValue, "7");
    const code = (await (await owner(`visits/${visitId}`)).json()).fields.shareCode.stringValue;
    assert.match(code, /^[2-9A-HJ-NP-Z]{10}$/);
  });
});

describe("the pharmacy, the billing desk, the clinic's status and its stats", () => {
  let visitId;
  before(async () => {
    const done = await ownerQuery("visits", and(eq("hospitalId", "h-cp"), eq("stage", "prescribed")));
    done.sort((a, b) => String(b.fields.registeredAt?.timestampValue).localeCompare(String(a.fields.registeredAt?.timestampValue)));
    visitId = done[0]?.id;
    assert.ok(visitId, "the seed has a signed prescription at the large hospital");
  });

  test("only a seat that dispenses can give out medicines", async () => {
    const anil = await signIn("staff2@parcha.test");
    assert.match((await call("dispensePrescription", { visitId, lines: [] }, anil.token)).error, /cannot dispense medicines/);
  });

  test("the Management seat works every counter but cannot prescribe", async () => {
    const rekha = await signIn("staff@parcha.test");
    const claims = JSON.parse(Buffer.from(rekha.token.split(".")[1], "base64url").toString("utf8"));
    assert.deepEqual(claims.abilities, ["register", "vitals", "dispense", "billing", "activity", "manage"]);
    assert.equal(claims.accountType, "staff");
    assert.match((await call("startConsultation", { visitId }, rekha.token)).error, /cannot|counter/);
  });

  test("the pharmacy gives out a prescription with a same-formula swap; the doctor reads it in the log", async () => {
    const pooja = await signIn("pharmacy@parcha.test");
    const r = await call("dispensePrescription", { visitId, lines: [{ given: true, substitute: "Crocin" }, { given: false }] }, pooja.token);
    assert.ok(r.ok, r.error);
    const visit = (await (await owner(`visits/${visitId}`)).json()).fields;
    assert.ok(visit.dispensedAt.timestampValue);
    assert.equal(visit.dispensedBy.stringValue, "Pooja (pharmacy)");
    const log = await ownerQuery("activity", eq("visitId", visitId));
    assert.ok(log.some((x) => /^Pooja \(pharmacy\).* gave .* given as Crocin/.test(x.fields.text.stringValue)), JSON.stringify(log.map((x) => x.fields.text.stringValue)));
  });

  test("the billing desk bills a visit; paying needs cash, UPI, card or Razorpay", async () => {
    const vikram = await signIn("billing@parcha.test");
    const lines = [{ label: "Consultation", amount: 300 }, { label: "Dressing", amount: 150 }];
    assert.match((await call("recordBill", { visitId, lines, paid: true }, vikram.token)).error, /cash, UPI, card or Razorpay/);
    assert.match((await call("recordBill", { visitId, lines: [{ label: "", amount: 5 }], paid: true, mode: "upi" }, vikram.token)).error, /at least one fee/);
    const r = await call("recordBill", { visitId, lines, paid: true, mode: "upi" }, vikram.token);
    assert.ok(r.ok, r.error);
    assert.equal(r.result.total, 450);
    const visit = (await (await owner(`visits/${visitId}`)).json()).fields;
    assert.equal(Number(visit.billTotal.integerValue), 450);
    assert.equal(visit.paidMode.stringValue, "upi");
    assert.match((await call("dispensePrescription", { visitId, lines: [] }, vikram.token)).error, /cannot dispense/);
  });

  test("Manage sets the price list and the Razorpay page; a bill paid there keeps its payment id", async () => {
    const hospital = (await (await owner("hospitals/h-cp")).json()).fields;
    assert.equal(hospital.razorpayPage.stringValue, "https://rzp.io/rzp/WuRzdD7T");
    const rekha = await signIn("staff@parcha.test");
    const { result: { token } } = await call("openManage", { pin: "1234" }, rekha.token);
    assert.match((await call("saveSettings", { manageToken: token, status: { razorpayPage: "https://evil.example/pay" } }, rekha.token)).error, /not a Razorpay payment page/);
    // The price list: set on Manage, each name once, the consultation kept to its own fee.
    const saved = await call("saveSettings", { manageToken: token, status: { charges: [{ label: "Dressing", amount: 150 }, { label: "dressing", amount: 99 }, { label: "Consultation", amount: 1 }, { label: "X-ray", amount: 450 }] } }, rekha.token);
    assert.ok(saved.ok, saved.error);
    const listed = (await call("manageState", { manageToken: token }, rekha.token)).result.status.charges;
    assert.deepEqual(listed, [{ label: "Dressing", amount: 150 }, { label: "X-ray", amount: 450 }]);

    const vikram = await signIn("billing@parcha.test");
    const [other] = (await ownerQuery("visits", and(eq("hospitalId", "h-cp"), eq("stage", "prescribed")))).filter((v) => v.id !== visitId && v.fields.paid?.booleanValue !== true);
    assert.ok(other, "a second signed visit, not yet paid, to bill");
    const lines = [{ label: "Consultation", amount: 300 }];
    assert.match((await call("recordBill", { visitId: other.id, lines, paid: true, mode: "razorpay", paidRef: "12345" }, vikram.token)).error, /not a Razorpay payment id/);
    const r = await call("recordBill", { visitId: other.id, lines, paid: true, mode: "razorpay", paidRef: "pay_Q1w2E3r4T5y6U7" }, vikram.token);
    assert.ok(r.ok, r.error);
    const visit = (await (await owner(`visits/${other.id}`)).json()).fields;
    assert.equal(visit.paidMode.stringValue, "razorpay");
    assert.equal(visit.paidRef.stringValue, "pay_Q1w2E3r4T5y6U7");
    const log = await ownerQuery("activity", eq("visitId", other.id));
    assert.ok(log.some((x) => /paid by Razorpay \(pay_Q1w2E3r4T5y6U7\)/.test(x.fields.text.stringValue)), JSON.stringify(log.map((x) => x.fields.text.stringValue)));
  });

  test("a clinic that takes no new problems refuses them from the app, and still takes follow-ups", async () => {
    const rekha = await signIn("staff@parcha.test");
    const { result: { token } } = await call("openManage", { pin: "1234" }, rekha.token);
    const saved = await call("saveSettings", { manageToken: token, status: { acceptsNew: false, consultationFee: 350, departments: ["General medicine", "Cardiology", "Paediatrics", "Orthopaedics", "Neurology", "Gynaecology", "ENT"] } }, rekha.token);
    assert.ok(saved.ok, saved.error);
    const state = await call("manageState", { manageToken: token }, rekha.token);
    assert.equal(state.result.status.acceptsNew, false);
    assert.equal(state.result.status.consultationFee, 350);
    const p = await signInPhone("9811044321");
    const [mine] = await ownerQuery("patients", eq("phone", "9811044321"));
    const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const ask = await call("requestVisit", { patientId: mine.id, hospitalId: "h-cp", mode: "new_problem", requirement: "Fever since two days", preferredDate: day }, p.token);
    assert.match(ask.error, /only seeing its own patients/);
    const log = await ownerQuery("activity", eq("hospitalId", "h-cp"));
    const said = log.map((x) => x.fields.text.stringValue).filter((t) => /changed the settings/.test(t)).join("\n");
    // Only what changed: the departments sent were the same as before, so they are not mentioned.
    assert.match(said, /the clinic now takes follow-ups from the app, charges ₹350 for a consultation/);
    assert.doesNotMatch(said, /departments/);
    assert.ok((await call("saveSettings", { manageToken: token, status: { acceptsNew: true } }, rekha.token)).ok);
  });

  test("the stats count visits, waits, doctors and the counters, and need the Manage pass", async () => {
    const rekha = await signIn("staff@parcha.test");
    assert.match((await call("manageStats", { manageToken: "nope", days: 30 }, rekha.token)).error, /MANAGE_PIN/);
    const { result: { token } } = await call("openManage", { pin: "1234" }, rekha.token);
    const r = await call("manageStats", { manageToken: token, days: 30 }, rekha.token);
    assert.ok(r.ok, r.error);
    assert.equal(r.result.days, 30);
    assert.ok(r.result.visits.total > 0);
    assert.equal(r.result.byHour.length, 24);
    assert.ok(r.result.doctors.length > 0);
    assert.ok(r.result.counters.dispensed >= 1);
    assert.ok(r.result.counters.billedTotal >= 450);
  });
});

describe("the 15-minute promise", () => {
  test("a request nobody answered in time moves on to the next hospital; the sweep needs its key", async () => {
    assert.equal((await fetch(`${FN}/sweepOverdueRequests`, { method: "POST" })).status, 403);
    const [sunil] = (await ownerQuery("visits", eq("patientPhone", "9958770044"))).filter((v) => v.fields.stage.stringValue === "requested");
    assert.ok(sunil, "the seed has Sunil's request waiting");
    const from = sunil.fields.hospitalId.stringValue;
    // Time has run out.
    const past = new Date(Date.now() - 60_000).toISOString();
    const patch = await fetch(`${FS}/visits/${sunil.id}?updateMask.fieldPaths=respondBy`, {
      method: "PATCH", headers: { ...auth("owner"), "content-type": "application/json" },
      body: JSON.stringify({ fields: { respondBy: { timestampValue: past } } }),
    });
    assert.ok(patch.ok);
    const r = await (await fetch(`${FN}/sweepOverdueRequests`, { method: "POST", headers: { "x-sweep-key": "dev-sweep-key" } })).json();
    assert.ok(r.moved >= 1, JSON.stringify(r));
    const after = (await (await owner(`visits/${sunil.id}`)).json()).fields;
    assert.notEqual(after.hospitalId.stringValue, from, "it is now at the next hospital");
  });
});

describe("demo handsets", () => {
  test("a seeded demo number signs in with one tap and its token carries the number; any other number is refused", async () => {
    assert.match((await call("demoPhoneSignIn", { phone: "6386620642" })).error, /not one of the demo handsets/);
    const r = await call("demoPhoneSignIn", { phone: "9811044321" });
    assert.ok(r.ok, r.error);
    const signed = await json(await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: r.result.token, returnSecureToken: true }),
    }));
    assert.ok(signed.idToken, JSON.stringify(signed));
    const claims = JSON.parse(Buffer.from(signed.idToken.split(".")[1], "base64url").toString("utf8"));
    assert.equal(claims.phone_number, "+919811044321");
    // The same handset as a code sign-in: it reads that household's people.
    const people = await call("exportMyData", {}, signed.idToken);
    assert.ok(people.ok, people.error);
  });
});

describe("demo handsets without token signing", () => {
  test("the password way signs a demo handset in, and the token still carries its phone number", async () => {
    const r = await call("demoPhoneSignIn", { phone: "9700881122", mode: "password" });
    assert.ok(r.ok, r.error);
    assert.equal(r.result.email, "9700881122@handset.parcha.test");
    const signed = await json(await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: r.result.email, password: r.result.password, returnSecureToken: true }),
    }));
    assert.ok(signed.idToken, JSON.stringify(signed));
    const claims = JSON.parse(Buffer.from(signed.idToken.split(".")[1], "base64url").toString("utf8"));
    assert.equal(claims.phone_number, "+919700881122");
    const mine = await call("exportMyData", {}, signed.idToken);
    assert.ok(mine.ok, mine.error);
  });
});

describe("the clinic demo opens signed in", () => {
  test("a demo staff account signs in with no password and lands at its hospital; anything else is refused", async () => {
    assert.match((await call("demoStaffSignIn", { email: "someone@gmail.com" })).error, /not a demo account/);
    assert.match((await call("demoStaffSignIn", { email: "nobody@parcha.test" })).error, /No such demo account/);
    const r = await call("demoStaffSignIn", { email: "staff@parcha.test" });
    assert.ok(r.ok, r.error);
    const signed = await json(await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=x`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: r.result.token, returnSecureToken: true }),
    }));
    const claims = JSON.parse(Buffer.from(signed.idToken.split(".")[1], "base64url").toString("utf8"));
    assert.equal(claims.hospitalId, "h-cp");
    assert.equal(claims.seatName, "Hospital management");
    const hospital = (await (await owner("hospitals/h-cp")).json()).fields;
    assert.equal(hospital.name.stringValue, "Rohini City Hospital");
  });
});

describe("example set-ups open without a location", () => {
  test("an example hospital opens and keeps a session with no location; a real one does not", async () => {
    const sneha = await signInOnly("medium.desk@parcha.test");
    const s = await call("startStaffSession", {}, sneha.token);
    assert.ok(s.ok, s.error);
    const beat = await call("sessionBeat", { sessionId: s.result.sessionId }, sneha.token);
    assert.equal(beat.result.ended, false);
    const log = await ownerQuery("activity", eq("hospitalId", "h-dwarka"));
    assert.ok(log.some((x) => /without sharing a location/.test(x.fields.text.stringValue)));
    await setExample("h-dwarka", false);
    try {
      const doc = await signInOnly("dwarka.doctor@parcha.test");
      assert.match((await call("startStaffSession", {}, doc.token)).error, /needs this device's location/);
    } finally {
      await setExample("h-dwarka", true);
    }
  });

  test("two computers on the same example account do not sign each other out", async () => {
    const a = await signInOnly("dwarka.doctor@parcha.test");
    const b = await signInOnly("dwarka.doctor@parcha.test");
    const sa = await call("startStaffSession", CLINIC, a.token, { "x-forwarded-for": "198.51.100.1" });
    const sb = await call("startStaffSession", CLINIC, b.token, { "x-forwarded-for": "203.0.113.2" });
    assert.ok(sa.ok && sb.ok, sa.error ?? sb.error);
    const beatA = await call("sessionBeat", { sessionId: sa.result.sessionId, ...CLINIC }, a.token, { "x-forwarded-for": "198.51.100.1" });
    assert.equal(beatA.result.ended, false);
    assert.ok((await call("endStaffSession", {}, b.token)).ok);
    const still = await call("sessionBeat", { sessionId: sa.result.sessionId, ...CLINIC }, a.token, { "x-forwarded-for": "198.51.100.1" });
    assert.equal(still.result.ended, false);
    const patients = await ownerQuery("patients", eq("hospitalId", "h-dwarka"));
    assert.equal((await read(`patients/${patients[0].id}`, a.token)).status, 200, "the first computer can still read");
  });

  test("a double tap is one request: the same attempt sent twice at once books once", async () => {
    const p = await signInPhone("9845512077");
    const [mine] = await ownerQuery("patients", eq("phone", "9845512077"));
    const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const ask = { patientId: mine.id, hospitalId: "h-dwarka", mode: "new_problem", requirement: "Double tap test", preferredDate: day, requestKey: `tap-${Date.now()}` };
    const [a, b] = await Promise.all([call("requestVisit", ask, p.token), call("requestVisit", ask, p.token)]);
    assert.ok(a.ok && b.ok, a.error ?? b.error);
    assert.equal(a.result.visitId, b.result.visitId);
    const made = await ownerQuery("visits", eq("complaint", "Double tap test"));
    assert.equal(made.length, 1);
    assert.ok((await call("cancelMyRequest", { visitId: a.result.visitId }, p.token)).ok);
  });

  test("a real hospital near the college can be asked from the app, with no made-up fee or rating", async () => {
    const jackson = (await (await owner("hospitals/h-jackson")).json()).fields;
    assert.equal(jackson.accepting.booleanValue, true);
    assert.equal(jackson.consultationFee.nullValue, null);
    assert.equal(jackson.rating, undefined);
    const p = await signInPhone("9845512077");
    const [mine] = await ownerQuery("patients", eq("phone", "9845512077"));
    const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const ask = await call("requestVisit", { patientId: mine.id, hospitalId: "h-jackson", mode: "new_problem", requirement: "Fever", preferredDate: day }, p.token);
    assert.ok(ask.ok, ask.error);
    const visit = (await (await owner(`visits/${ask.result.visitId}`)).json()).fields;
    assert.equal(visit.hospitalId.stringValue, "h-jackson");
    assert.equal(visit.stage.stringValue, "requested");
    assert.ok(visit.respondBy.timestampValue, "the 15-minute clock is running");
    assert.ok((await call("cancelMyRequest", { visitId: ask.result.visitId }, p.token)).ok);
  });
});

describe("Custom: a new clinic of your own", () => {
  test("each Custom gets its own empty clinic, which its owner then sets up", async () => {
    const a = await call("startNewClinic", {});
    const b = await call("startNewClinic", {});
    assert.ok(a.ok && b.ok, a.error ?? b.error);
    assert.notEqual(a.result.email, b.result.email);
    const boss = await signIn(a.result.email, a.result.password);
    const claims = JSON.parse(Buffer.from(boss.token.split(".")[1], "base64url").toString("utf8"));
    assert.match(claims.hospitalId, /^h-new-/);
    assert.deepEqual(claims.abilities, ["manage"]);
    const setup = await call("setupClinic", { template: "clinic", name: "Lajpat Clinic", pin: "2468", lat: 28.57, lng: 77.24 }, boss.token);
    assert.ok(setup.ok, setup.error);
    const hospital = (await (await owner(`hospitals/${claims.hospitalId}`)).json()).fields;
    assert.equal(hospital.setupDone.booleanValue, true);
    assert.equal(hospital.name.stringValue, "Lajpat Clinic");
    // The other new clinic is untouched.
    const other = JSON.parse(Buffer.from((await signIn(b.result.email, b.result.password)).token.split(".")[1], "base64url").toString("utf8"));
    const untouched = (await (await owner(`hospitals/${other.hospitalId}`)).json()).fields;
    assert.equal(untouched.setupDone.booleanValue, false);
  });
});

describe("several roles for one person", () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const claimsOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));

  test("a person can hold several roles, and can do what each of them can", async () => {
    const rekha = await signIn("staff@parcha.test");
    const { result: { token } } = await call("openManage", { pin: "1234" }, rekha.token);
    const email = `both${Date.now()}@parcha.test`;
    const made = await call("createTeamMember", { manageToken: token, displayName: "Two Hats", email, seatIds: ["pharmacy", "billing"] }, rekha.token);
    assert.ok(made.ok, made.error);
    let p = await signIn(email, made.result.password);
    let c = claimsOf(p.token);
    assert.ok(c.abilities.includes("dispense") && c.abilities.includes("billing"));
    assert.equal(c.seatName, "Pharmacist + Billing desk");

    const moved = await call("assignSeat", { manageToken: token, uid: p.uid, seatIds: ["doctor", "pharmacy"] }, rekha.token);
    assert.ok(moved.ok, moved.error);
    await sleep(1100);
    p = await signIn(email, made.result.password);
    c = claimsOf(p.token);
    assert.equal(c.accountType, "doctor");
    assert.ok(c.abilities.includes("consult") && c.abilities.includes("dispense") && !c.abilities.includes("billing"));
    const state = await call("manageState", { manageToken: token }, rekha.token);
    assert.deepEqual(state.result.team.find((m) => m.uid === p.uid).seatIds, ["doctor", "pharmacy"]);
    assert.match((await call("assignSeat", { manageToken: token, uid: p.uid, seatIds: [] }, rekha.token)).error, /at least one role/);
    // A role someone holds, even alongside another, cannot be removed.
    assert.match((await call("deleteSeat", { manageToken: token, id: "pharmacy" }, rekha.token)).error, /away from everyone/);
  });
});

describe("messages inside the team", () => {
  const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
  const s = (v) => ({ stringValue: v });
  const arr = (...v) => ({ arrayValue: { values: v.map(s) } });
  const commit = async (token, writes) => fetch(`${FS}:commit`, {
    method: "POST", headers: { ...auth(token), "content-type": "application/json" }, body: JSON.stringify({ writes }),
  });
  const now = (field) => ({ fieldPath: field, setToServerValue: "REQUEST_TIME" });
  const thread = (id) => `hospitals/h-cp/threads/${id}`;
  const openDm = (who, a, b) => {
    const [x, y] = [a, b].sort();
    return commit(who.token, [{
      update: { name: `${DOCS}/${thread(`dm_${x}_${y}`)}`, fields: { kind: s("dm"), hospitalId: s("h-cp"), members: arr(x, y), createdBy: s(who.uid) } },
      currentDocument: { exists: false },
      updateTransforms: [now("createdAt")],
    }]);
  };
  // The shape the app sends: everything that matters is ciphertext. (The rules
  // cannot decrypt, so a stand-in is enough to test who may write and read.)
  const sealed = (text) => ({
    v: { integerValue: "1" },
    eph: { mapValue: { fields: { kty: s("EC"), crv: s("P-256"), x: s("x"), y: s("y") } } },
    iv: s("aXY="),
    ct: s(Buffer.from(text).toString("base64")),
    keys: { mapValue: { fields: { someDevice: { mapValue: { fields: { iv: s("aXY="), k: s("aw==") } } } } } },
  });
  const message = (threadId, fromUid, fields) => ({
    update: { name: `${DOCS}/${thread(threadId)}/messages/m${Date.now()}${Math.random().toString(36).slice(2, 6)}`, fields: { fromUid: s(fromUid), fromName: s("x"), fromRole: { nullValue: null }, fromDevice: s(`${fromUid}__dev`), mentions: arr(), ...fields } },
    currentDocument: { exists: false },
    updateTransforms: [now("at")],
  });
  const touch = (threadId, fromUid) => ({
    update: { name: `${DOCS}/${thread(threadId)}`, fields: { lastFromUid: s(fromUid), lastFromName: s("x"), lastMentions: arr() } },
    updateMask: { fieldPaths: ["lastFromUid", "lastFromName", "lastMentions"] },
    updateTransforms: [now("lastAt")],
  });
  const send = (who, threadId, text, fromUid = who.uid) => commit(who.token, [message(threadId, fromUid, sealed(text)), touch(threadId, fromUid)]);

  test("a direct message is read by its two people only; nobody writes as someone else", async () => {
    const anil = await signIn("staff2@parcha.test");
    const khan = await signIn("doctor@parcha.test");
    const pooja = await signIn("pharmacy@parcha.test");
    const [x, y] = [anil.uid, khan.uid].sort();
    const id = `dm_${x}_${y}`;
    await fetch(`${FS}/${thread(id)}`, { method: "DELETE", headers: auth("owner") });

    assert.equal((await openDm(anil, anil.uid, khan.uid)).status, 200);
    assert.equal((await send(anil, id, "Bed 4 needs you")).status, 200);
    const seen = await json(await read(`${thread(id)}/messages`, khan.token));
    assert.ok(seen.documents?.some((d) => d.fields.ct.stringValue === Buffer.from("Bed 4 needs you").toString("base64")));
    // Words in the clear are refused: a message is accepted only sealed.
    const plain = await commit(anil.token, [message(id, anil.uid, { text: s("Bed 4 needs you"), voice: { booleanValue: false } }), touch(id, anil.uid)]);
    assert.equal(plain.status, 403);

    // Anyone else at the hospital, even on duty, is refused.
    assert.equal((await read(`${thread(id)}/messages`, pooja.token)).status, 403);
    assert.equal((await send(pooja, id, "Let me in")).status, 403);
    // Nobody can open a thread for two other people, or write as the other person.
    assert.equal((await openDm(pooja, anil.uid, khan.uid)).status, 403);
    assert.equal((await send(anil, id, "Signed, Dr. Khan", khan.uid)).status, 403);
  });

  test("a channel is the hospital's own: another hospital and a patient cannot read it", async () => {
    const anil = await signIn("staff2@parcha.test");
    const general = thread("general");
    await commit(anil.token, [{
      update: { name: `${DOCS}/${general}`, fields: { kind: s("channel"), hospitalId: s("h-cp"), name: s("general"), topic: s(""), createdBy: s(anil.uid) } },
      currentDocument: { exists: false },
      updateTransforms: [now("createdAt")],
    }]);
    assert.equal((await send(anil, "general", "Morning, everyone")).status, 200);
    const khan = await signIn("doctor@parcha.test");
    assert.equal((await read(`${general}/messages`, khan.token)).status, 200);
    const verma = await signIn("noida.doctor@parcha.test");
    assert.equal((await read(`${general}/messages`, verma.token)).status, 403);
    const patient = await signInPhone("9811044321");
    assert.equal((await read(`${general}/messages`, patient.token)).status, 403);
  });
});

describe("device keys for messages", () => {
  const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
  const s = (v) => ({ stringValue: v });
  const put = (who, uid, deviceId) =>
    fetch(`${FS}/hospitals/h-cp/commsKeys/${uid}__${deviceId}`, {
      method: "PATCH",
      headers: { ...auth(who.token), "content-type": "application/json" },
      body: JSON.stringify({
        name: `${DOCS}/hospitals/h-cp/commsKeys/${uid}__${deviceId}`,
        fields: { uid: s(uid), deviceId: s(deviceId), pub: { mapValue: { fields: { kty: s("EC"), crv: s("P-256"), x: s("x"), y: s("y") } } }, label: s("Chrome on Windows") },
      }),
    });

  test("a person publishes their own device key, never someone else's, and only the team reads them", async () => {
    const anil = await signIn("staff2@parcha.test");
    const khan = await signIn("doctor@parcha.test");
    assert.equal((await put(anil, anil.uid, "d1")).status, 200);
    assert.equal((await put(anil, khan.uid, "d1")).status, 403);
    assert.equal((await read(`hospitals/h-cp/commsKeys/${anil.uid}__d1`, khan.token)).status, 200);
    const verma = await signIn("noida.doctor@parcha.test");
    assert.equal((await read(`hospitals/h-cp/commsKeys/${anil.uid}__d1`, verma.token)).status, 403);
  });
});

describe("ticking a dose", () => {
  test("a dose is ticked and unticked, for the demo's reminders and the app's own; nobody else's", async () => {
    const p = await signInPhone("9811044321");
    const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    // The demo family's seeded reminder (an id with dashes).
    const seeded = await call("markDose", { date: day, key: "seed-kamla-metoprolol@0800" }, p.token);
    assert.ok(seeded.ok, seeded.error);
    // One the app made (an id like c_...).
    const id = `c_${Date.now().toString(36)}abcdef`;
    const made = await call("saveReminders", { reminders: [{ id, personName: "Ramesh Chand", kind: "medicine", title: "Test tablet", times: ["21:00"], days: [], startDate: day, endDate: day, enabled: true }] }, p.token);
    assert.ok(made.ok, made.error);
    assert.ok((await call("markDose", { date: day, key: `${id}@2100` }, p.token)).ok);
    const log = (await (await owner(`doseLogs/9811044321__${day}`)).json()).fields.taken.mapValue.fields;
    assert.ok(log["seed-kamla-metoprolol@0800"] && log[`${id}@2100`]);
    assert.ok((await call("markDose", { date: day, key: `${id}@2100`, taken: false }, p.token)).ok);
    // Someone else's reminder, and a key that is not a dose.
    const other = await signInPhone("9845512077");
    assert.match((await call("markDose", { date: day, key: "seed-kamla-metoprolol@0800" }, other.token)).error, /No such reminder/);
    assert.match((await call("markDose", { date: day, key: "x/../y@0800" }, p.token)).error, /not valid/);
  });
});

describe("the desk books, and only doctors on duty get patients", () => {
  const day = () => {
    const d = new Date(Date.now() + 5.5 * 3600_000 + 86400_000);
    return d.toISOString().slice(0, 10);
  };

  test("the front desk books a patient's request itself: doctor, day and time; a taken time is refused", async () => {
    // Rekha's desk is connected to Dr. Khan (Anil's is not).
    const anil = await signIn("staff@parcha.test");
    const [req] = await ownerQuery("visits", and(eq("hospitalId", "h-cp"), eq("stage", "requested")));
    assert.ok(req, "a request at the large hospital");
    const khan = await signIn("doctor@parcha.test");
    await call("setAvailability", { status: "available" }, khan.token);
    const booked = await call("bookRequest", { visitId: req.id, doctorUid: khan.uid, day: day(), time: "16:30" }, anil.token);
    assert.ok(booked.ok, booked.error);
    const v = (await (await owner(`visits/${req.id}`)).json()).fields;
    assert.equal(v.stage.stringValue, "scheduled");
    assert.equal(v.assignedDoctorUid.stringValue, khan.uid);
    assert.equal(v.respondBy.nullValue, null);
    // The same doctor and time for somebody else is refused.
    const [other] = (await ownerQuery("visits", and(eq("hospitalId", "h-cp"), eq("stage", "proposed")))).filter((x) => x.id !== req.id);
    if (other) assert.match((await call("bookRequest", { visitId: other.id, doctorUid: khan.uid, day: day(), time: "16:30" }, anil.token)).error, /already has somebody/);
    // A doctor cannot book this way: it is the desk's.
    assert.ok((await call("bookRequest", { visitId: req.id, doctorUid: khan.uid, day: day(), time: "16:00" }, khan.token)).error);
  });

  test("an intake needs blood pressure and weight", async () => {
    const anil = await signIn("triage@parcha.test");
    const [v] = await ownerQuery("visits", and(eq("hospitalId", "h-cp"), eq("stage", "registered")));
    assert.ok(v, "a registered visit");
    const khan = await signIn("doctor@parcha.test");
    const base = { visitId: v.id, doctorUid: khan.uid, complaint: "Fever" };
    assert.match((await call("saveIntake", { ...base, weightKg: 60 }, anil.token)).error, /blood pressure/);
    assert.match((await call("saveIntake", { ...base, systolicMmhg: 120, diastolicMmhg: 80 }, anil.token)).error, /Weigh them/);
  });

  test("a doctor who is Off is not sent patients; in a demo set-up, switching seats (off duty) does not stop it", async () => {
    const mary = await signIn("triage@parcha.test");
    const [v] = await ownerQuery("visits", and(eq("hospitalId", "h-cp"), eq("stage", "registered")));
    const khan = await signIn("doctor@parcha.test");
    const intake = { visitId: v.id, doctorUid: khan.uid, complaint: "Fever", systolicMmhg: 120, diastolicMmhg: 80, weightKg: 60 };
    assert.ok((await call("setAvailability", { status: "off" }, khan.token)).ok);
    assert.match((await call("saveIntake", intake, mary.token)).error, /off right now/);
    await call("setAvailability", { status: "available" }, khan.token);
    // The example hospital: one person switching seats signs the doctor out.
    assert.ok((await call("setDuty", { onDuty: false }, khan.token)).ok);
    const sent = await call("saveIntake", intake, mary.token);
    assert.ok(sent.ok, sent.error);
    await call("setDuty", { onDuty: true }, khan.token);
  });
});
