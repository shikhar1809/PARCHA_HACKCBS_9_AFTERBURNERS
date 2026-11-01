/**
 * Every write in Parcha.
 *
 * The security rules deny client writes outright, so this file is the whole
 * mutation surface. That is deliberate: the stage machine is the product's
 * one safety-relevant invariant, and a guard that lives in a screen can be
 * skipped by anything that is not that screen.
 *
 * Each callable follows the same shape:
 *   1. check who is calling, and at which counter
 *   2. re-read the visit inside a transaction — the stage as the database has
 *      it, never the stage the screen last saw
 *   3. ask src/stages.ts whether the move is allowed
 *   4. write the record, the denormalised copy, and the audit event together
 */
import "./options.js";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getMessaging } from "firebase-admin/messaging";

import {
  describeTransitionProblem,
} from "../../../packages/core/src/stages.js";
import {
  generateCode,
  generateVisitCode,
  routeId,
} from "../../../packages/core/src/paths.js";
import {
  ENGINE_VERSION,
  conflictKey,
  runConflictEngine,
} from "../../../packages/core/src/conflicts.js";
import { cleanTests, isUnlisted } from "../../../packages/core/src/special.js";
import { loadSafetyContext } from "./safety.js";
import { nextToken } from "./tokens.js";
import { signRx } from "./rxToken.js";
import { rxPayload } from "../../../packages/core/src/rxToken.js";
import type {
  Pregnancy,
  PrescriptionItem,
  Stage,
  StaffRole,
  Visit,
  VitalsSummary,
} from "../../../packages/core/src/types.js";
import {
  activeAccount,
  assertSameHospital,
  assertAssignedTo,
  moveStage,
  wiredTo,
} from "./flow.js";
import {
  CLIENT_ID,
  audit,
  db,
  once,
  optionalNumber,
  rateLimit,
  requireCounter,
  requireRecentSignIn,
  requirePatientPhone,
  requireString,
  tenDigits,
} from "./guards.js";
import { assertAbility } from "./guards.js";
import { liveCounter, logActivity, actorLabel } from "./session.js";
import { cleanAccessNeeds } from "../../../packages/core/src/access.js";
import { validateItem } from "../../../packages/core/src/items.js";
import { missingRequiredVitals } from "../../../packages/core/src/vitals.js";
import { doctorUnavailable } from "./routing.js";

initializeApp();

const iso = (value: unknown): string | null => {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return null;
};

/* ========================================================================= *
 * The front desk
 * ========================================================================= */

export const registerPatient = onCall(async (request) =>
  once(request, async () => {
  const caller = await liveCounter(request, "compounder");
  assertAbility(caller, "register");
  const data = request.data ?? {};

  const fullName = requireString(data.fullName, "Name", 120);
  const phone = tenDigits(requireString(data.phone, "Phone", 20));
  if (phone.length !== 10) {
    throw new HttpsError("invalid-argument", "A ten-digit phone is required.");
  }

  const statedAge = optionalNumber(data.statedAgeYears);
  // An id made up while offline is honoured when it is free.
  let ref = db().collection("patients").doc();
  if (typeof data.clientId === "string" && CLIENT_ID.test(data.clientId)) {
    const wanted = db().collection("patients").doc(data.clientId);
    if (!(await wanted.get()).exists) ref = wanted;
  }

  await ref.set({
    hospitalId: caller.hospitalId,
    fullName,
    phone,
    sex: ["female", "male", "other"].includes(data.sex) ? data.sex : null,
    dateOfBirth: null,
    statedAgeYears: statedAge,
    // Stored so a stated age keeps ageing instead of freezing at first contact.
    ageStatedOn: statedAge === null ? null : FieldValue.serverTimestamp(),
    villageOrArea: typeof data.villageOrArea === "string" ? data.villageOrArea : null,
    accessNeeds: cleanAccessNeeds(data.accessNeeds),
    district: null,
    state: null,
    bloodGroup: null,
    preferredLanguage: "hi",
    notes: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    registeredBy: caller.displayName,
  });

  const ageText = statedAge === null ? "" : `, ${statedAge}`;
  await logActivity(caller, "patient.registered", `${actorLabel(caller)} registered a new patient, ${fullName}${ageText} (phone ending ${phone.slice(-4)}).`, { patientId: ref.id, request });
  return { patientId: ref.id };
  }));

/**
 * What a patient pointed at on the kiosk, before the desk gets to them.
 *
 * The kiosk stands in the waiting room on one of the clinic's own screens, so
 * the call carries the desk's own sign-in; what makes it safe is how little it
 * can do. It writes one complaint onto one visit of its own hospital, that has
 * been registered and has not yet reached a doctor, and it does not move the
 * stage: the desk still takes the vitals and still chooses the doctor. Nothing
 * here is a diagnosis, and nothing here can send a patient anywhere.
 *
 * It is the same `complaints` sub-collection the desk writes, marked
 * `source: "kiosk"`, so a complaint that came from a patient's own finger is
 * told apart from one a desk typed, and the latest copy lands on the visit
 * where every screen already reads it.
 */
export const kioskComplaint = onCall(async (request) =>
  once(request, async () => {
  const caller = await liveCounter(request, "compounder");
  const data = request.data ?? {};
  const visitId = requireString(data.visitId, "Visit");
  const complaint = requireString(data.complaint, "Complaint", 500);
  const severity = ["mild", "moderate", "severe"].includes(data.severity) ? data.severity : null;
  // A screen anybody in the waiting room can touch: one visit a minute is
  // plenty, and a child playing with it cannot fill the database.
  await rateLimit(`kiosk:${caller.hospitalId}`, 60, 3600);

  const visitRef = db().collection("visits").doc(visitId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
    const visit = snap.data() as Visit;
    assertSameHospital(visit, caller);
    // Once the desk has done intake, the doctor is reading this: a kiosk must
    // not change what is in front of them mid-consultation.
    if (visit.stage !== "registered") {
      throw new HttpsError(
        "failed-precondition",
        "This visit has already gone to the desk. Tell them at the counter instead.",
      );
    }
    tx.create(visitRef.collection("complaints").doc(), {
      visitId,
      patientId: visit.patientId,
      body: complaint,
      language: typeof data.language === "string" ? data.language.slice(0, 8) : "hi",
      durationDays: optionalNumber(data.durationDays),
      severity,
      source: "kiosk",
      recordedAt: FieldValue.serverTimestamp(),
      recordedBy: "Kiosk",
      supersedesId: null,
    });
    tx.update(visitRef, { complaint });
  });

  await logActivity(caller, "visit.kiosk", `A patient said at the kiosk what is wrong.`, { visitId, request });
  return { ok: true as const };
  }));

export const startVisit = onCall(async (request) =>
  once(request, async () => {
  const caller = await liveCounter(request, "compounder");
  assertAbility(caller, "register");
  const patientId = requireString(request.data?.patientId, "Patient");

  const patientSnap = await db().collection("patients").doc(patientId).get();
  if (!patientSnap.exists || patientSnap.data()?.hospitalId !== caller.hospitalId) {
    throw new HttpsError("not-found", "That patient does not exist.");
  }
  const patient = patientSnap.data()!;

  // Never a second open visit for one patient: the desk would otherwise make
  // one every time somebody taps twice.
  const open = await db()
    .collection("visits")
    .where("patientId", "==", patientId)
    .where("closedAt", "==", null)
    .limit(1)
    .get();
  if (!open.empty) return { visitId: open.docs[0].id, existing: true };

  const allergies = await db()
    .collection("patients")
    .doc(patientId)
    .collection("allergies")
    .get();
  const retracted = new Set(
    allergies.docs
      .map((d) => d.data().retractsAllergyId)
      .filter((id): id is string => Boolean(id)),
  );
  const hasAllergy = allergies.docs.some(
    (d) => !d.data().retractsAllergyId && !retracted.has(d.id),
  );

  let ref = db().collection("visits").doc();
  const wantedVisit = request.data?.clientVisitId;
  if (typeof wantedVisit === "string" && CLIENT_ID.test(wantedVisit)) {
    const w = db().collection("visits").doc(wantedVisit);
    if (!(await w.get()).exists) ref = w;
  }
  const tokenNumber = await nextToken(caller.hospitalId);
  await ref.set({
    hospitalId: caller.hospitalId,
    patientId,
    visitCode: generateVisitCode(),
    stage: "registered" satisfies Stage,
    department: "general",
    tokenNumber,

    patientName: patient.fullName,
    patientPhone: patient.phone,
    patientAgeYears: patient.statedAgeYears ?? null,
    patientSex: patient.sex ?? null,
    patientVillage: patient.villageOrArea ?? null,
    hasAllergy,
    accessNeeds: cleanAccessNeeds(patient.accessNeeds),

    complaint: null,
    vitals: null,
    diagnosis: null,
    itemCount: 0,
    linkedPhones: [],

    registeredAt: FieldValue.serverTimestamp(),
    intakeCompletedAt: null,
    consultationStartedAt: null,
    prescribedAt: null,
    closedAt: null,
    registeredBy: caller.displayName,
    notes: null,
  });

  await ref.collection("stageEvents").doc().create({
    visitId: ref.id,
    fromStage: null,
    toStage: "registered",
    actor: caller.displayName,
    actorUid: caller.uid,
    actorRole: "compounder",
    reason: null,
    occurredAt: FieldValue.serverTimestamp(),
  });

  await logActivity(caller, "visit.started", `${actorLabel(caller)} started a visit for ${patient.fullName}, token ${tokenNumber}.`, { patientId, visitId: ref.id, request });
  return { visitId: ref.id, existing: false, tokenNumber };
  }));

export const saveIntake = onCall(async (request) =>
  once(request, async () => {
  const caller = await liveCounter(request, "compounder");
  assertAbility(caller, "vitals");
  const data = request.data ?? {};
  const visitId = requireString(data.visitId, "Visit");
  const complaint = requireString(data.complaint, "Complaint");

  // The desk chooses the doctor, and may only choose one it is wired to.
  const doctorUid = requireString(data.doctorUid, "Doctor");
  // A doctor who also takes their own vitals (a solo practice) sends patients to themselves.
  const toSelf = doctorUid === caller.uid && caller.abilities.includes("consult");
  const wire = toSelf
    ? null
    : await db().collection("routes").doc(routeId(caller.uid, doctorUid)).get();
  if (wire && !wire.exists) {
    throw new HttpsError(
      "permission-denied",
      "This desk is not connected to that doctor. A team admin can connect you on the Team page.",
    );
  }
  const doctor = await activeAccount(doctorUid, "doctor", caller.hospitalId);
  if (!doctor) {
    throw new HttpsError("failed-precondition", "That doctor is not available.");
  }
  // A doctor who is off today, or has gone off duty, is not sent patients (they can still send themselves one).
  if (!toSelf && (await doctorUnavailable(doctor, caller.hospitalId))) {
    throw new HttpsError("failed-precondition", `${doctor.displayName ?? "That doctor"} is off right now. Choose another doctor.`);
  }

  const vitals: VitalsSummary = {
    systolicMmhg: optionalNumber(data.systolicMmhg),
    diastolicMmhg: optionalNumber(data.diastolicMmhg),
    pulseBpm: optionalNumber(data.pulseBpm),
    temperatureC: optionalNumber(data.temperatureC),
    respiratoryRate: optionalNumber(data.respiratoryRate),
    spo2Pct: optionalNumber(data.spo2Pct),
    weightKg: optionalNumber(data.weightKg),
    heightCm: optionalNumber(data.heightCm),
    bloodSugarMgdl: optionalNumber(data.bloodSugarMgdl),
    bloodSugarType: null,
  };

  // Blood pressure and weight are taken at every intake.
  const missing = Object.values(missingRequiredVitals(vitals));
  if (missing.length) throw new HttpsError("invalid-argument", missing.join(" "));

  // A sugar reading without a type was rejected by the Postgres schema and is
  // rejected here for the same reason: an untyped number is not interpretable
  // later, and nobody will remember which it was.
  if (vitals.bloodSugarMgdl !== null) {
    const type = data.bloodSugarType;
    if (!["fasting", "random", "post_prandial"].includes(type)) {
      throw new HttpsError(
        "invalid-argument",
        "A blood sugar reading needs a type.",
      );
    }
    vitals.bloodSugarType = type;
  }

  const visitRef = db().collection("visits").doc(visitId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
    const visit = snap.data() as Visit;
    assertSameHospital(visit, caller);

    tx.create(visitRef.collection("vitals").doc(), {
      visitId,
      patientId: visit.patientId,
      ...vitals,
      notes: null,
      recordedAt: FieldValue.serverTimestamp(),
      recordedBy: caller.displayName,
      supersedesId: null,
    });

    tx.create(visitRef.collection("complaints").doc(), {
      visitId,
      patientId: visit.patientId,
      body: complaint,
      language: "hi",
      durationDays: optionalNumber(data.durationDays),
      severity: null,
      source: "desk",
      recordedAt: FieldValue.serverTimestamp(),
      recordedBy: caller.displayName,
      supersedesId: null,
    });

    await moveStage(tx, visitRef, visit.stage, "intake_complete", "compounder", caller, {
      // Copied onto the visit so the doctor's queue is a single read.
      complaint,
      vitals,
      assignedDoctorUid: doctorUid,
      assignedDoctorName: doctor.displayName,
    });
  });

  {
    const v = (await visitRef.get()).data() as Visit;
    const readings = [
      vitals.systolicMmhg != null && vitals.diastolicMmhg != null ? `BP ${vitals.systolicMmhg}/${vitals.diastolicMmhg}` : null,
      vitals.pulseBpm != null ? `pulse ${vitals.pulseBpm}` : null,
      vitals.temperatureC != null ? `temperature ${vitals.temperatureC}°C` : null,
      vitals.spo2Pct != null ? `oxygen ${vitals.spo2Pct}%` : null,
      vitals.bloodSugarMgdl != null ? `sugar ${vitals.bloodSugarMgdl}` : null,
    ].filter(Boolean).join(", ");
    await logActivity(
      caller,
      "visit.intake",
      `${actorLabel(caller)} took ${v.patientName}'s vitals${readings ? ` (${readings})` : ""} and sent them to ${doctor.displayName}.`,
      { patientId: v.patientId, visitId, request },
    );
  }
  return { ok: true };
  }));

/* ========================================================================= *
 * The consultation
 * ========================================================================= */

export const startConsultation = onCall(async (request) =>
  once(request, async () => {
  const caller = await liveCounter(request, "doctor");
  const visitId = requireString(request.data?.visitId, "Visit");
  const visitRef = db().collection("visits").doc(visitId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
    assertSameHospital(snap.data() as Visit, caller);
    assertAssignedTo(snap.data() as Visit, caller);
    await moveStage(
      tx,
      visitRef,
      (snap.data() as Visit).stage,
      "in_consultation",
      "doctor",
      caller,
    );
  });

  const seen = (await visitRef.get()).data() as Visit;
  await logActivity(caller, "visit.consultation", `${actorLabel(caller)} started seeing ${seen.patientName}.`, { patientId: seen.patientId, visitId, request });
  return { ok: true };
  }));

/** Pregnancy as the doctor recorded it, or null when not asked. */
const readPregnancy = (v: unknown): Pregnancy | null => (v === "pregnant" || v === "breastfeeding" || v === "no" ? v : null);

export const signPrescription = onCall(async (request) =>
  once(request, async () => {
  const caller = await liveCounter(request, "doctor");
  // A signature is the one act that cannot be undone and carries the doctor's
  // name, so the password must have been typed in the last five minutes.
  requireRecentSignIn(request);
  await rateLimit(`sign:${caller.uid}`, 300, 3600);
  const data = request.data ?? {};
  const visitId = requireString(data.visitId, "Visit");

  const items = Array.isArray(data.items)
    ? (data.items as PrescriptionItem[])
    : [];
  if (items.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "A prescription needs at least one medicine.",
    );
  }
  if (items.length > 30) {
    throw new HttpsError("invalid-argument", "That is too many medicines for one prescription.");
  }
  // The same check the pad runs on each line: a time of day (or SOS), a duration, how often.
  for (const item of items) {
    const problems = validateItem(item);
    if (problems.length) throw new HttpsError("invalid-argument", `${item.drugName ?? "A medicine"}: ${problems[0]}`);
  }
  for (const text of [data.diagnosis, data.advice]) {
    if (typeof text === "string" && text.length > 1000) {
      throw new HttpsError("invalid-argument", "The diagnosis and advice are too long.");
    }
  }

  // Every line is checked against the formulary again here, because the list
  // arrives from a browser. A medicine the formulary does not know may still be
  // written, but only as a line marked written by hand: the safety check flags
  // it as unchecked, and that flag goes on the record with the rest.
  const drugs = await db().collection("drugs").get();
  const known = new Set(drugs.docs.map((d) => d.id));
  const unknown = items.filter((i) => !known.has(i.drugId) && !(i.unlisted === true && isUnlisted(i)));
  if (unknown.length > 0) {
    throw new HttpsError(
      "invalid-argument",
      `Not in the formulary: ${unknown.map((i) => i.drugName).join(", ")}. Add it as a medicine written by hand.`,
    );
  }
  for (const i of items) {
    if (isUnlisted(i) && (typeof i.drugName !== "string" || !i.drugName.trim() || i.drugName.length > 80)) {
      throw new HttpsError("invalid-argument", "A medicine written by hand needs a name of up to 80 letters.");
    }
  }
  const tests = cleanTests(data.tests);
  const pregnancy = readPregnancy(data.pregnancy);


  const visitRef = db().collection("visits").doc(visitId);
  const prescriptionRef = visitRef.collection("prescriptions").doc();
  const shareCode = generateCode(10);

  // What the safety check reads, gathered before the transaction. The visit is
  // peeked only for whose it is; the transaction below re-reads it and is the
  // authority on stage, owner and vitals.
  const peek = await visitRef.get();
  // The doctor's qualification and registration number go on the prescription as they are today.
  const me = (await db().collection("accounts").doc(caller.uid).get()).data() ?? {};
  const hospitalName = ((await db().collection("hospitals").doc(caller.hospitalId).get()).data()?.name as string | undefined) ?? "Parcha";
  if (!peek.exists) throw new HttpsError("not-found", "No such visit.");
  assertSameHospital(peek.data() as Visit, caller);
  const safety = await loadSafetyContext(
    (peek.data() as Visit).patientId,
    caller.hospitalId,
    visitId,
  );
  // The flags the doctor says they have read, by key.
  const acknowledged = new Set<string>(
    Array.isArray(data.acknowledged) ? data.acknowledged.filter((k: unknown): k is string => typeof k === "string").slice(0, 100) : [],
  );

  let readFlags: string[] = [];
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
    const visit = snap.data() as Visit;
    assertSameHospital(visit, caller);
    assertAssignedTo(visit, caller);

    // The safety check, on the server and against this visit's own intake
    // vitals. It advises and never blocks, but a high-severity flag the doctor
    // has not acknowledged stops the signature: a conflict that was never read
    // is the one case a printed prescription must not carry.
    const flags = runConflictEngine({
      visitId,
      patientId: visit.patientId,
      prescriptionId: prescriptionRef.id,
      items,
      vitals: visit.vitals,
      allergies: safety.allergies,
      currentDrugIds: safety.currentDrugIds,
      patient: { ageYears: visit.patientAgeYears ?? null, sex: visit.patientSex ?? null, pregnancy },
      formulary: {
        drugs: safety.drugs,
        interactions: safety.interactions,
        vitalCautions: safety.vitalCautions,
      },
    });
    const unread = flags.filter((f) => f.severity === "high" && !acknowledged.has(conflictKey(f)));
    readFlags = flags.filter((f) => acknowledged.has(conflictKey(f))).map((f) => `${f.subjectDrugName} with ${f.counterpartLabel}`);
    if (unread.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        `SAFETY_ACK: Please read and confirm: ${unread.map((f) => `${f.subjectDrugName} – ${f.counterpartLabel}`).join("; ")}.`,
      );
    }

    // The printed parcha's QR: the whole prescription, signed, for the patient app to read offline.
    const qr = signRx(
      rxPayload({
        hospitalName,
        doctor: { name: caller.displayName, qualification: (me.qualification as string | undefined) ?? null, regNo: (me.registrationNo as string | undefined) ?? null },
        signedAt: new Date().toISOString(),
        visitCode: visit.visitCode,
        patient: { name: visit.patientName, ageYears: visit.patientAgeYears ?? null, sex: visit.patientSex ?? null },
        diagnosis: typeof data.diagnosis === "string" && data.diagnosis.trim() ? data.diagnosis.trim() : null,
        items,
        tests,
        advice: typeof data.advice === "string" && data.advice.trim() ? data.advice.trim() : null,
        followUpDays: optionalNumber(data.followUpDays),
      }),
    );
    tx.create(prescriptionRef, {
      visitId,
      patientId: visit.patientId,
      qr,
      diagnosisText: typeof data.diagnosis === "string" ? data.diagnosis : null,
      items,
      advice: typeof data.advice === "string" ? data.advice : null,
      tests,
      pregnancy,
      followUpDays: optionalNumber(data.followUpDays),
      prescriberName: caller.displayName,
      prescriberQualification: (me.qualification as string | undefined) ?? null,
      prescriberRegNo: (me.registrationNo as string | undefined) ?? null,
      prescriberUid: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
      signedAt: FieldValue.serverTimestamp(),
      supersedesId: null,
      // Signed on a computer with no connection: when it says it was signed, if that is believable.
      signedOfflineAt: (() => {
        const t = typeof data.queuedAt === "string" ? Date.parse(data.queuedAt) : NaN;
        return Number.isFinite(t) && t < Date.now() + 5 * 60_000 && t > Date.now() - 7 * 86400_000 ? new Date(t).toISOString() : null;
      })(),
      acknowledgedConflicts: flags.map(conflictKey).filter((k) => acknowledged.has(k)),
    });
    for (const flag of flags) {
      tx.create(visitRef.collection("conflicts").doc(), {
        ...flag,
        acknowledged: acknowledged.has(conflictKey(flag)),
        engineVersion: ENGINE_VERSION,
        detectedAt: FieldValue.serverTimestamp(),
      });
    }

    await moveStage(tx, visitRef, visit.stage, "prescribed", "doctor", caller, {
      diagnosis: typeof data.diagnosis === "string" ? data.diagnosis : null,
      itemCount: items.length,
    });

    // The code on the printed slip, for adding this visit to another phone (a
    // family member's). The document id IS the code, so redeeming one is a
    // point read and codes cannot be listed.
    tx.create(db().collection("accessGrants").doc(shareCode), {
      code: shareCode,
      visitId,
      patientId: visit.patientId,
      issuedTo: "patient",
      issuedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 180 * 86400_000),
      revokedAt: null,
      revokedReason: null,
      issuedBy: caller.displayName,
    });
    tx.update(visitRef, { shareCode });
  });

  await audit(caller, "prescription.sign", {
    visitId,
    prescriptionId: prescriptionRef.id,
    itemCount: items.length,
  });
  {
    const v = peek.data() as Visit;
    const names = items.map((i) => i.drugName).join(", ");
    const warned = readFlags.length ? ` Read and accepted ${readFlags.length === 1 ? "a safety warning" : `${readFlags.length} safety warnings`}: ${readFlags.join("; ")}.` : "";
    const offline = typeof data.queuedAt === "string" ? " Signed with no connection and sent when it returned." : "";
    await logActivity(caller, "prescription.signed", `${actorLabel(caller)} signed ${v.patientName}'s prescription: ${names}.${warned}${offline}`, { patientId: v.patientId, visitId, request });
  }
  return { prescriptionId: prescriptionRef.id };
  }));

/**
 * The safety check, as the doctor composes. The same context and the same
 * engine as signing, so what the screen shows is what the signature will be
 * held to; the answer written to the record is only ever the one from signing.
 */
export const checkPrescription = onCall(async (request) => {
  const caller = await liveCounter(request, "doctor");
  await rateLimit(`check:${caller.uid}`, 900, 3600);
  const data = request.data ?? {};
  const visitId = requireString(data.visitId, "Visit");
  const items = (Array.isArray(data.items) ? data.items : []).slice(0, 30) as PrescriptionItem[];
  if (items.length === 0) return { flags: [], version: ENGINE_VERSION };

  const snap = await db().collection("visits").doc(visitId).get();
  if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
  const visit = snap.data() as Visit;
  assertSameHospital(visit, caller);
  assertAssignedTo(visit, caller);

  const safety = await loadSafetyContext(visit.patientId, caller.hospitalId, visitId);
  const known = new Set(safety.drugs.map((d) => d.id));
  const flags = runConflictEngine({
    visitId,
    patientId: visit.patientId,
    prescriptionId: "preview",
    items: items.filter((i) => known.has(i.drugId) || (i.unlisted === true && isUnlisted(i))),
    vitals: visit.vitals,
    allergies: safety.allergies,
    currentDrugIds: safety.currentDrugIds,
    patient: { ageYears: visit.patientAgeYears ?? null, sex: visit.patientSex ?? null, pregnancy: readPregnancy(data.pregnancy) },
    formulary: { drugs: safety.drugs, interactions: safety.interactions, vitalCautions: safety.vitalCautions },
  });
  return { flags: flags.map((f) => ({ ...f, key: conflictKey(f) })), version: ENGINE_VERSION };
});

/* ========================================================================= *
 * The patient app
 * ========================================================================= */

/**
 * Redeems the code printed on a slip.
 *
 * Expiry and revocation are checked here, server-side, where a client cannot
 * skip them — and the link the redemption leaves behind is what the security
 * rules then honour, so this runs once per slip rather than on every read.
 */
export const linkVisitByCode = onCall(async (request) => {
  const phone = requirePatientPhone(request);
  const raw = requireString(request.data?.code, "Code").toUpperCase();
  const code = raw.replace(/[^2-9A-Z]/g, "");
  // A code is a credential: 20 tries an hour per phone makes guessing one hopeless.
  await rateLimit(`link:${phone}`, 20, 3600);

  if (code.length < 6) {
    throw new HttpsError("invalid-argument", "That is not a complete code.");
  }

  const grantRef = db().collection("accessGrants").doc(code);
  const grantSnap = await grantRef.get();
  // One message for every failure, so a caller cannot tell an unknown code
  // from an expired one and probe for which codes exist.
  const dead = new HttpsError(
    "not-found",
    "That code is not valid any more.",
  );
  if (!grantSnap.exists) throw dead;

  const grant = grantSnap.data()!;
  if (grant.revokedAt !== null) throw dead;
  const expires = grant.expiresAt instanceof Timestamp
    ? grant.expiresAt.toMillis()
    : Date.parse(String(grant.expiresAt));
  if (!Number.isFinite(expires) || expires <= Date.now()) throw dead;

  await db()
    .collection("visits")
    .doc(grant.visitId)
    .update({ linkedPhones: FieldValue.arrayUnion(phone) });

  return { visitId: grant.visitId, patientId: grant.patientId };
});

/**
 * Stores the device token this phone should receive reminders on.
 *
 * Follow-up reminders are the reason the patient app earns an install: push
 * costs nothing per message where SMS and WhatsApp both bill per send.
 */
export const registerPushToken = onCall(async (request) => {
  const phone = requirePatientPhone(request);
  const token = requireString(request.data?.token, "Token");

  await db()
    .collection("pushTokens")
    .doc(tenDigits(phone))
    .set(
      { phone: tenDigits(phone), tokens: FieldValue.arrayUnion(token) },
      { merge: true },
    );

  return { ok: true };
});

/** Sends one reminder. Called by the clinic, or later by a scheduled job. */
export const sendFollowUpReminder = onCall(async (request) => {
  await liveCounter(request, "compounder");
  const phone = tenDigits(requireString(request.data?.phone, "Phone"));
  const body = requireString(request.data?.body, "Message");

  const tokensSnap = await db().collection("pushTokens").doc(phone).get();
  const tokens: string[] = tokensSnap.exists
    ? (tokensSnap.data()?.tokens ?? [])
    : [];
  if (tokens.length === 0) {
    return { sent: 0, reason: "That phone has not opened the app yet." };
  }

  const result = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: "Parcha", body },
  });
  return { sent: result.successCount };
});

export { seedDemoData } from "./seed.js";
export { demoPhoneSignIn, demoStaffSignIn, startNewClinic } from "./demo.js";
export { controlVisit, setBringReady, checkInVisit, setAvailability } from "./previsit.js";
export { addDocument, deleteDocument, saveHistory } from "./records.js";
export { deleteReminder, markDose, saveReminders } from "./reminders.js";
export { heardFamilyMessage, sendFamilyMessage } from "./messages.js";
export { deleteProfile, saveProfile } from "./profiles.js";
export { deleteMyData, exportMyData, recordConsent } from "./privacy.js";
export {
  callWebhook,
  clearCallNumber,
  confirmCallNumber,
  dispatchReminderCalls,
  requestTestCall,
  runCallDispatcher,
  saveCallSettings,
  simulateCallOutcome,
  startCallNumberVerification,
} from "./calls.js";
export {
  connectTeamMembers,
  disconnectTeamMembers,
  setDuty,
} from "./team.js";
export {
  assignSeat,
  changeManagePin,
  closeManage,
  createTeamMember,
  deleteSeat,
  manageState,
  manageStats,
  openManage,
  saveMyProfile,
  saveSeat,
  saveSettings,
  setMemberActive,
  setupClinic,
} from "./manage.js";
// One-time set-up of a new live project. Export it, deploy, run
// scripts/bootstrap-live.mjs, then remove it again (it is not exported normally).
// export { bootstrapLive } from "./bootstrap.js";
export { startStaffSession, sessionBeat, endStaffSession } from "./session.js";
export { setAccessNeeds } from "./access.js";
export { sweepExpired } from "./sweep.js";
export { dispensePrescription, recordBill } from "./counter.js";
export { shareHistory, openShare, shareIsOpen, revokeShare, reportShareFailure, myShares } from "./share.js";

// The voice pad's learning. Nothing here is on the signing path: a Meko
// outage degrades recall and can never block a prescription.
//
// NOT DEPLOYED. These declare `defineSecret("MEKO_API_KEY")`, and a secret is
// resolved while the CLI analyses the codebase — before a single function is
// built. On a project without the Secret Manager API enabled that analysis
// fails, and it fails for EVERY function, not only these: one unused feature
// took the whole backend down with it. Meko is off by default and its recall
// is not wired yet, so the export is parked rather than the deploy.
//
// To put it back: enable Secret Manager on the project, set both secrets, and
// uncomment the line below.
// export { mekoRecall, mekoRemember, mekoForget, mekoReview, mekoPromote, mekoCurate } from "./mekoCallables.js";
export { askParcha, hearInstructions, readHandwriting } from "./assistant.js";
