/**
 * Before the patient comes.
 *
 * A visit can begin on the patient's own phone: they say what is wrong, or
 * which doctor they want to see again, and on which day. The front desk finds
 * a doctor and asks them; the doctor accepts and names a time, or declines and
 * says why; the patient is told to come. On arrival the desk checks them in
 * and it becomes an ordinary visit. It is one record from the first ask to the
 * last medicine, so none of the later history has to be joined back on.
 *
 *   patient      requestVisit            -> requested
 *   front desk   proposeVisit            -> proposed      (to a wired doctor)
 *   doctor       respondToRequest        -> scheduled     (accepts, names a slot)
 *                                        -> requested     (declines, with a reason)
 *   front desk   checkInVisit            -> registered    (the patient arrives)
 *
 * Every step goes through `moveStage`, so each is checked against the stage
 * rules and recorded in the audit trail like any other.
 */
import { createHash } from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { generateVisitCode, routeId } from "../../../packages/core/src/paths.js";
import {
  SLOT_TIMES,
  isBookableDay,
  slotInstant,
} from "../../../packages/core/src/slots.js";
import { cleanBring } from "../../../packages/core/src/bring.js";
import type { Hospital, Visit } from "../../../packages/core/src/types.js";
import {
  activeAccount,
  assertAssignedTo,
  assertSameHospital,
  hasLiveAllergy,
  moveStage,
} from "./flow.js";
import {
  candidateOrder,
  ensurePatientAt,
  loadHospital,
  loadHospitals,
  nextCandidate,
  readLocation,
  requireHospital,
  startAttempt,
  doctorUnavailable,
} from "./routing.js";
import {
  db,
  rateLimit,
  requireCounter,
  requirePatientPhone,
  requireString,
  tenDigits,
} from "./guards.js";
import { assertAbility } from "./guards.js";
import { liveCounter, logActivity, logVisit, actorLabel, whenText } from "./session.js";
import { nextToken } from "./tokens.js";

/** The longest free text a request may carry. */
const MAX_TEXT = 500;

/* ========================================================================= *
 * The patient asks
 * ========================================================================= */

/** What the visit is written from: a record already held, or a person named now. */
type PersonSource = {
  fullName: string;
  sex: string | null;
  statedAgeYears: number | null;
  villageOrArea: string | null;
  preferredLanguage: string | null;
};

const SEXES = ["female", "male", "other"];

/**
 * A person the family names on their own phone.
 *
 * The first visit from a handset has nobody on it: before this, the app could
 * only send them to a front desk. The record is still opened by the hospital
 * (`ensurePatientAt`), which finds a person of the same name on the same phone
 * rather than opening a second one, so asking twice cannot split a history.
 */
function readNewPerson(value: unknown): PersonSource {
  const d = (value ?? {}) as Record<string, unknown>;
  const fullName = requireString(d.fullName, "Name", 120).trim();
  if (fullName.length < 2) {
    throw new HttpsError("invalid-argument", "Write the full name of the person who is coming.");
  }
  let statedAgeYears: number | null = null;
  if (d.statedAgeYears != null && d.statedAgeYears !== "") {
    const n = Number(d.statedAgeYears);
    if (!Number.isInteger(n) || n < 0 || n > 120) {
      throw new HttpsError("invalid-argument", "Age should be between 0 and 120.");
    }
    statedAgeYears = n;
  }
  return {
    fullName,
    sex: typeof d.sex === "string" && SEXES.includes(d.sex) ? d.sex : null,
    statedAgeYears,
    villageOrArea:
      typeof d.villageOrArea === "string" && d.villageOrArea.trim()
        ? d.villageOrArea.trim().slice(0, 120)
        : null,
    preferredLanguage: null,
  };
}

export const requestVisit = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const data = request.data ?? {};
  // A handset can ask a few times an hour, not hundreds: each ask can start a
  // chain of calls to hospitals, so it is the one patient action worth a brake.
  await rateLimit(`ask:${phone}`, 12, 3600);

  // Who it is for: somebody a hospital has already seen, or somebody the
  // family is adding now. A phone with nobody on it yet is the normal first
  // visit, not an error, so the app can name a new person here.
  const patientId =
    typeof data.patientId === "string" && data.patientId ? data.patientId : null;
  const newPerson = patientId ? null : readNewPerson(data.newPerson);
  const hospitalId = requireString(data.hospitalId, "Hospital");
  const mode = data.mode;
  if (mode !== "new_problem" && mode !== "existing_doctor") {
    throw new HttpsError(
      "invalid-argument",
      "Say whether this is a new problem or a visit to your doctor.",
    );
  }
  if (!isBookableDay(data.preferredDate)) {
    throw new HttpsError(
      "invalid-argument",
      "Choose a day from today up to two weeks ahead.",
    );
  }
  // A retry of the same tap must not book twice. The key is made by the app
  // once per attempt, so repeating it is the same request, not a new one.
  const requestKey =
    typeof data.requestKey === "string" && data.requestKey.length <= 64
      ? data.requestKey
      : null;
  if (requestKey) {
    const again = await db()
      .collection("visits")
      .where("patientPhone", "==", phone)
      .where("requestKey", "==", requestKey)
      .limit(1)
      .get();
    if (!again.empty) return { visitId: again.docs[0].id, repeated: true };
  }

  // The request is for somebody on this handset, and nobody else. The record
  // named may be at any hospital; what matters is whose phone it is. A person
  // being added now belongs to the caller's phone by construction.
  let source: PersonSource;
  if (patientId) {
    const sourceSnap = await db().collection("patients").doc(patientId).get();
    const found = sourceSnap.data();
    if (!sourceSnap.exists || !found || found.phone !== phone) {
      throw new HttpsError(
        "permission-denied",
        "That person is not on your phone number.",
      );
    }
    source = {
      fullName: found.fullName,
      sex: found.sex ?? null,
      statedAgeYears: found.statedAgeYears ?? null,
      villageOrArea: found.villageOrArea ?? null,
      preferredLanguage: found.preferredLanguage ?? null,
    };
  } else {
    source = newPerson!;
    // "My doctor" is read from this person's past visits, and a person being
    // added now has none.
    if (mode === "existing_doctor") {
      throw new HttpsError(
        "invalid-argument",
        "This person has not seen a doctor here yet. Choose a new problem.",
      );
    }
  }

  const chosen = requireHospital(await loadHospital(hospitalId));
  // The clinic decides which requests it takes (Manage, Clinic).
  const h = chosen as typeof chosen & { acceptsNew?: boolean; acceptsFollowUp?: boolean };
  if (mode === "new_problem" && h.acceptsNew === false) {
    throw new HttpsError("failed-precondition", `${chosen.name} is only seeing its own patients again right now. Choose another hospital.`);
  }
  if (mode === "existing_doctor" && h.acceptsFollowUp === false) {
    throw new HttpsError("failed-precondition", `${chosen.name} is not taking follow-up requests from the app right now.`);
  }

  let requirement =
    typeof data.requirement === "string" ? data.requirement.trim() : "";
  if (requirement.length > MAX_TEXT) {
    throw new HttpsError("invalid-argument", "That is too long. Keep it to a few lines.");
  }
  if (mode === "new_problem" && requirement.length < 3) {
    throw new HttpsError("invalid-argument", "Tell us in a few words what is wrong.");
  }

  // One request or visit in progress per person, wherever it is, so nobody
  // holds a place at three hospitals at once.
  const open = await db()
    .collection("visits")
    .where("patientPhone", "==", phone)
    .where("patientName", "==", source.fullName)
    .where("closedAt", "==", null)
    .limit(1)
    .get();
  if (!open.empty) {
    throw new HttpsError(
      "failed-precondition",
      "This person already has a visit or a request in progress. Open it from your records.",
    );
  }

  // This person's record at the chosen hospital: found, or opened for them.
  const here = await ensurePatientAt(chosen.id, {
    fullName: source.fullName,
    phone,
    sex: source.sex,
    statedAgeYears: source.statedAgeYears,
    villageOrArea: source.villageOrArea,
    preferredLanguage: source.preferredLanguage ?? undefined,
  });

  let requestedDoctorUid: string | null = null;
  let requestedDoctorName: string | null = null;
  if (mode === "existing_doctor") {
    // "My doctor" is a doctor this person has seen at THIS hospital, so it
    // cannot be used to book anybody in the building.
    const doctorUid = requireString(data.doctorUid, "Doctor");
    const seen = await db()
      .collection("visits")
      .where("patientId", "==", here.id)
      .where("assignedDoctorUid", "==", doctorUid)
      .limit(1)
      .get();
    const doctor = await activeAccount(doctorUid, "doctor", chosen.id);
    if (seen.empty || !doctor) {
      throw new HttpsError(
        "invalid-argument",
        "You can ask for a doctor you have seen before at this hospital.",
      );
    }
    requestedDoctorUid = doctorUid;
    requestedDoctorName = doctor.displayName;
    if (!requirement) requirement = "Follow-up visit";
  }

  const candidateHospitalIds = candidateOrder(
    chosen,
    await loadHospitals(),
    readLocation(data.from),
  );
  const clock = startAttempt(chosen, []);

  // The visit's id comes from the attempt's key, so two copies of one tap that
  // arrive together (a double tap, a retry on a bad network) write the same
  // document: the second create fails and gets the first one's answer.
  const ref = requestKey
    ? db().collection("visits").doc(`req_${createHash("sha256").update(`${phone}|${requestKey}`).digest("hex").slice(0, 28)}`)
    : db().collection("visits").doc();
  try {
    await ref.create({
      hospitalId: chosen.id,
      patientId: here.id,
      visitCode: generateVisitCode(),
      stage: "requested",
      department: "general",
      tokenNumber: null,

      patientName: source.fullName,
      patientPhone: phone,
      patientAgeYears: source.statedAgeYears ?? null,
      patientSex: source.sex ?? null,
      patientVillage: source.villageOrArea ?? null,
      hasAllergy: here.hasAllergy,

      // What the patient said is the first thing the doctor reads; the desk can
      // add to it at intake.
      complaint: requirement,
      vitals: null,
      diagnosis: null,
      itemCount: 0,
      linkedPhones: [],
      assignedDoctorUid: null,
      assignedDoctorName: null,

      source: "pre_visit",
      requestKey,
      requestMode: mode,
      requestedDoctorUid,
      requestedDoctorName,
      preferredDate: data.preferredDate,
      scheduledFor: null,
      declines: [],

      // The hospital's promise: it has until `respondBy` to answer, or the
      // request moves to the next hospital in `candidateHospitalIds`.
      respondBy: clock.respondBy,
      candidateHospitalIds,
      attempts: clock.attempts,
      exhausted: false,

      registeredAt: FieldValue.serverTimestamp(),
      requestedAt: FieldValue.serverTimestamp(),
      intakeCompletedAt: null,
      consultationStartedAt: null,
      prescribedAt: null,
      closedAt: null,
      registeredBy: "Patient",
      notes: null,
    });
  } catch (e) {
    if ((e as { code?: number }).code === 6) return { visitId: ref.id, repeated: true };
    throw e;
  }

  await ref.collection("stageEvents").doc().create({
    visitId: ref.id,
    fromStage: null,
    toStage: "requested",
    actor: "Patient",
    actorUid: request.auth!.uid,
    actorRole: "system",
    reason: `Asked ${chosen.name}`,
    occurredAt: FieldValue.serverTimestamp(),
  });

  return { visitId: ref.id };
});

/** The patient changes their mind, from their own phone. */
export const cancelMyRequest = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const visitId = requireString(request.data?.visitId, "Visit");
  const visitRef = db().collection("visits").doc(visitId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
    const visit = snap.data() as Visit;
    if (visit.patientPhone !== phone) {
      throw new HttpsError("permission-denied", "That is not your visit.");
    }
    if (!["requested", "proposed", "scheduled"].includes(visit.stage)) {
      throw new HttpsError(
        "failed-precondition",
        "This visit has already started. Ask at the front desk.",
      );
    }
    tx.update(visitRef, {
      stage: "cancelled",
      closedAt: FieldValue.serverTimestamp(),
    });
    tx.create(visitRef.collection("stageEvents").doc(), {
      visitId,
      fromStage: visit.stage,
      toStage: "cancelled",
      actor: "Patient",
      actorUid: request.auth!.uid,
      actorRole: "system",
      reason: "Cancelled by the patient",
      occurredAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

/**
 * After the consultation the patient says how it went: one to five stars, a
 * few tapped words, and an optional line. Kept on the visit, so the hospital
 * sees it beside the visit; saying it again replaces it.
 */
const FEEDBACK_TAGS = new Set(["explained_well", "short_wait", "kind_staff", "long_wait", "rushed", "unclear"]);
export const rateVisit = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const visitId = requireString(request.data?.visitId, "Visit");
  const stars = Number(request.data?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpsError("invalid-argument", "Choose one to five stars.");
  const tags = Array.isArray(request.data?.tags) ? [...new Set((request.data.tags as unknown[]).filter((x): x is string => typeof x === "string" && FEEDBACK_TAGS.has(x)))] : [];
  const note = typeof request.data?.note === "string" ? request.data.note.trim().slice(0, 300) : "";
  const visitRef = db().collection("visits").doc(visitId);
  const snap = await visitRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
  const visit = snap.data() as Visit;
  if (visit.patientPhone !== phone) throw new HttpsError("permission-denied", "That is not your visit.");
  if (visit.stage !== "prescribed") throw new HttpsError("failed-precondition", "You can rate a visit once the doctor has seen you.");
  await visitRef.update({ feedback: { stars, tags, note: note || null, at: new Date().toISOString() } });
  return { ok: true as const };
});

/* ========================================================================= *
 * The front desk finds a doctor
 * ========================================================================= */

export const proposeVisit = onCall(async (request) => {
  const caller = await liveCounter(request, "compounder");
  assertAbility(caller, "register");
  const visitId = requireString(request.data?.visitId, "Visit");
  const doctorUid = requireString(request.data?.doctorUid, "Doctor");

  // The same wire that governs intake governs this: a desk asks only the
  // doctors it is connected to.
  const wire = await db()
    .collection("routes")
    .doc(routeId(caller.uid, doctorUid))
    .get();
  if (!wire.exists) {
    throw new HttpsError(
      "permission-denied",
      "This desk is not connected to that doctor. A team admin can connect you on the Team page.",
    );
  }
  const doctor = await activeAccount(doctorUid, "doctor", caller.hospitalId);
  if (!doctor) {
    throw new HttpsError("failed-precondition", "That doctor is not available.");
  }
  if (await doctorUnavailable(doctor, caller.hospitalId)) {
    throw new HttpsError(
      "failed-precondition",
      `${doctor.displayName} is not taking patients today. Choose another doctor.`,
    );
  }

  const visitRef = db().collection("visits").doc(visitId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
    const visit = snap.data() as Visit;
    assertSameHospital(visit, caller);
    if ((visit.declines ?? []).some((d) => d.doctorUid === doctorUid)) {
      throw new HttpsError(
        "failed-precondition",
        `${doctor.displayName} has already declined this one. Choose another doctor.`,
      );
    }
    await moveStage(tx, visitRef, visit.stage, "proposed", "compounder", caller, {
      assignedDoctorUid: doctorUid,
      assignedDoctorName: doctor.displayName,
    });
  });
  await logVisit(caller, request, visitId, "request.proposed", (n) => `${actorLabel(caller)} asked ${doctor.displayName} to see ${n}.`);
  return { ok: true };
});

/**
 * The desk books a request itself: a doctor it is connected to, a day and a
 * time. The patient is told at once and the doctor sees them in the queue on
 * the day; there is no asking and waiting.
 */
export const bookRequest = onCall(async (request) => {
  const caller = await liveCounter(request, "compounder");
  assertAbility(caller, "register");
  const data = request.data ?? {};
  const visitId = requireString(data.visitId, "Visit");
  const doctorUid = requireString(data.doctorUid, "Doctor");
  const day = data.day;
  const time = data.time;
  if (!isBookableDay(day) || typeof time !== "string" || !SLOT_TIMES.includes(time)) {
    throw new HttpsError("invalid-argument", "Choose a day and one of the listed times.");
  }
  const instant = slotInstant(day, time);
  if (instant.getTime() <= Date.now()) throw new HttpsError("invalid-argument", "That time has already passed.");
  const slot = Timestamp.fromDate(instant);

  const toSelf = doctorUid === caller.uid && caller.abilities.includes("consult");
  if (!toSelf) {
    const wire = await db().collection("routes").doc(routeId(caller.uid, doctorUid)).get();
    if (!wire.exists) {
      throw new HttpsError("permission-denied", "This desk is not connected to that doctor. A team admin can connect you on the Team page.");
    }
  }
  const doctor = await activeAccount(doctorUid, "doctor", caller.hospitalId);
  if (!doctor) throw new HttpsError("failed-precondition", "That doctor is not available.");
  if (!toSelf && (await doctorUnavailable(doctor, caller.hospitalId))) {
    throw new HttpsError("failed-precondition", `${doctor.displayName} is not taking patients today. Choose another doctor.`);
  }

  const visitRef = db().collection("visits").doc(visitId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
    const visit = snap.data() as Visit;
    assertSameHospital(visit, caller);
    if ((visit.declines ?? []).some((d) => d.doctorUid === doctorUid)) {
      throw new HttpsError("failed-precondition", `${doctor.displayName} has already declined this one. Choose another doctor.`);
    }
    const clash = await tx.get(
      db().collection("visits").where("assignedDoctorUid", "==", doctorUid).where("stage", "==", "scheduled").where("scheduledFor", "==", slot).limit(1),
    );
    if (!clash.empty) throw new HttpsError("failed-precondition", `${doctor.displayName} already has somebody at that time. Choose another.`);
    await moveStage(tx, visitRef, visit.stage, "scheduled", "compounder", caller, {
      assignedDoctorUid: doctorUid,
      assignedDoctorName: doctor.displayName,
      scheduledFor: slot,
      // Booked: the hospital has kept its promise, so the clock stops.
      respondBy: null,
      attempts: (visit.attempts ?? []).map((a, i, all) => (i === all.length - 1 ? { ...a, outcome: "answered" } : a)),
    });
  });
  await logVisit(caller, request, visitId, "request.booked", (n) => `${actorLabel(caller)} booked ${n} with ${doctor.displayName} on ${whenText(slot)}.`);
  return { ok: true };
});

/** The desk takes a proposal back, so it can be sent somewhere else. */
export const withdrawProposal = onCall(async (request) => {
  const caller = await liveCounter(request, "compounder");
  assertAbility(caller, "register");
  const visitId = requireString(request.data?.visitId, "Visit");
  const visitRef = db().collection("visits").doc(visitId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
    assertSameHospital(snap.data() as Visit, caller);
    await moveStage(
      tx,
      visitRef,
      (snap.data() as Visit).stage,
      "requested",
      "compounder",
      caller,
      { assignedDoctorUid: null, assignedDoctorName: null },
      "Taken back by the desk",
    );
  });
  await logVisit(caller, request, visitId, "request.withdrawn", (n) => `${actorLabel(caller)} took back the request to a doctor for ${n}.`);
  return { ok: true };
});

/** The desk lets a request go: nobody can see them, or they asked to. */
export const cancelVisitRequest = onCall(async (request) => {
  const caller = await liveCounter(request, "compounder");
  assertAbility(caller, "register");
  const visitId = requireString(request.data?.visitId, "Visit");
  const reason = requireString(request.data?.reason, "Reason");
  const visitRef = db().collection("visits").doc(visitId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
    assertSameHospital(snap.data() as Visit, caller);
    await moveStage(
      tx,
      visitRef,
      (snap.data() as Visit).stage,
      "cancelled",
      "compounder",
      caller,
      { respondBy: null },
      reason,
    );
  });
  await logVisit(caller, request, visitId, "request.cancelled", (n) => `${actorLabel(caller)} cancelled ${n}'s request: ${reason}`);
  return { ok: true };
});

/** The patient has arrived: booked becomes registered, and intake can begin. */
export const checkInVisit = onCall(async (request) => {
  const caller = await liveCounter(request, "compounder");
  assertAbility(caller, "register");
  const visitId = requireString(request.data?.visitId, "Visit");
  const visitRef = db().collection("visits").doc(visitId);
  // A booked patient joins the day's tokens on arrival, like a walk-in.
  const tokenNumber = await nextToken(caller.hospitalId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
    assertSameHospital(snap.data() as Visit, caller);
    await moveStage(
      tx,
      visitRef,
      (snap.data() as Visit).stage,
      "registered",
      "compounder",
      caller,
      { arrivedAt: FieldValue.serverTimestamp(), tokenNumber },
    );
  });
  await logVisit(caller, request, visitId, "visit.checked_in", (n) => `${actorLabel(caller)} checked in ${n}, who arrived for a booked visit.`);
  return { ok: true };
});

/* ========================================================================= *
 * The doctor answers
 * ========================================================================= */

/**
 * Accept (and name a time) or decline (and say why).
 *
 * Only the doctor the desk asked can answer. Accepting books a slot, and a
 * slot can hold one patient: if the doctor already has somebody at that time
 * it is refused, rather than double-booked.
 */
export const respondToRequest = onCall(async (request) => {
  const caller = await liveCounter(request, "doctor");
  const data = request.data ?? {};
  const visitId = requireString(data.visitId, "Visit");
  const accept = data.accept === true;
  const visitRef = db().collection("visits").doc(visitId);

  let slot: Timestamp | null = null;
  let reason = "";
  if (accept) {
    const day = data.day;
    const time = data.time;
    if (!isBookableDay(day) || typeof time !== "string" || !SLOT_TIMES.includes(time)) {
      throw new HttpsError("invalid-argument", "Choose a day and one of the listed times.");
    }
    const instant = slotInstant(day, time);
    if (instant.getTime() <= Date.now()) {
      throw new HttpsError("invalid-argument", "That time has already passed.");
    }
    slot = Timestamp.fromDate(instant);
  } else {
    reason = requireString(data.reason, "Reason");
  }

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
    const visit = snap.data() as Visit;
    assertSameHospital(visit, caller);
    assertAssignedTo(visit, caller);

    if (slot) {
      const clash = await tx.get(
        db()
          .collection("visits")
          .where("assignedDoctorUid", "==", caller.uid)
          .where("stage", "==", "scheduled")
          .where("scheduledFor", "==", slot)
          .limit(1),
      );
      if (!clash.empty) {
        throw new HttpsError(
          "failed-precondition",
          "You already have somebody at that time. Choose another.",
        );
      }
      await moveStage(tx, visitRef, visit.stage, "scheduled", "doctor", caller, {
        scheduledFor: slot,
        // Confirmed: the hospital has kept its promise, so the clock stops.
        respondBy: null,
        attempts: (visit.attempts ?? []).map((a, i, all) =>
          i === all.length - 1 ? { ...a, outcome: "answered" } : a,
        ),
      });
    } else {
      await moveStage(
        tx,
        visitRef,
        visit.stage,
        "requested",
        "doctor",
        caller,
        {
          assignedDoctorUid: null,
          assignedDoctorName: null,
          declines: FieldValue.arrayUnion({
            doctorUid: caller.uid,
            doctorName: caller.displayName,
            reason,
            at: new Date().toISOString(),
          }),
        },
        reason,
      );
    }
  });
  await logVisit(caller, request, visitId, accept ? "request.accepted" : "request.declined", (n) => accept ? `${actorLabel(caller)} agreed to see ${n}${slot ? ` on ${whenText(slot)}` : ""}.` : `${actorLabel(caller)} declined to see ${n}: ${reason}`);
  return { ok: true };
});

/** A doctor's own word on whether the desk can send them people today. */
export const setAvailability = onCall(async (request) => {
  const caller = await liveCounter(request, "doctor");
  const status = request.data?.status;
  if (!["available", "busy", "off"].includes(status)) {
    throw new HttpsError("invalid-argument", "Choose available, busy or off.");
  }
  await db().collection("accounts").doc(caller.uid).update({ availability: status });
  await logActivity(caller, "doctor.availability", `${actorLabel(caller)} set themselves as ${status === "off" ? "off today" : status}.`, { request });
  return { ok: true };
});

/* ========================================================================= *
 * When a hospital does not answer
 * ========================================================================= */

type Why = "timed_out" | "declined";

/**
 * Moves a request from the hospital it is at to the next one in its order, with
 * a fresh clock, or closes it if there is nowhere left to try.
 *
 * Safe to call twice: it only acts on a request that is still waiting, so a
 * second caller (the patient's phone and the sweeper, say) finds it already
 * moved and does nothing.
 */
async function moveOn(
  visitId: string,
  why: Why,
  reason: string,
  actor: { uid: string; name: string },
  mustBeOverdue: boolean,
): Promise<{ moved: boolean; to: string | null; exhausted: boolean }> {
  const visitRef = db().collection("visits").doc(visitId);
  const hospitals = await loadHospitals();

  // Prepare the next hospital's record outside the transaction: it may have to
  // be created, and a transaction should not be held open for that.
  const peek = await visitRef.get();
  if (!peek.exists) throw new HttpsError("not-found", "No such visit.");
  const before = peek.data() as Visit;
  const next = nextCandidate(before, hospitals);
  const there = next
    ? await ensurePatientAt(next.id, {
        fullName: before.patientName,
        phone: before.patientPhone,
        sex: before.patientSex,
        statedAgeYears: before.patientAgeYears,
        villageOrArea: before.patientVillage,
      })
    : null;

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    const visit = snap.data() as Visit;
    if (!["requested", "proposed"].includes(visit.stage)) {
      return { moved: false, to: null, exhausted: false };
    }
    const deadline = visit.respondBy
      ? new Date(visit.respondBy as unknown as string).getTime()
      : 0;
    // The deadline is read from the stored field, as a Timestamp or a string.
    const stored = (snap.data() as { respondBy?: Timestamp | null }).respondBy;
    const due = stored ? stored.toMillis() : deadline;
    if (mustBeOverdue && due > Date.now()) {
      throw new HttpsError(
        "failed-precondition",
        "The hospital still has time to answer.",
      );
    }
    // Another caller already moved it on.
    if (visit.hospitalId !== before.hospitalId) {
      return { moved: false, to: null, exhausted: false };
    }

    const attempts = (visit.attempts ?? []).map((a, i, all) =>
      i === all.length - 1 && a.outcome === "waiting" ? { ...a, outcome: why } : a,
    );
    const from = hospitals.find((h) => h.id === visit.hospitalId);

    if (next && there) {
      const clock = startAttempt(next, attempts);
      tx.update(visitRef, {
        hospitalId: next.id,
        patientId: there.id,
        hasAllergy: there.hasAllergy,
        stage: "requested",
        // Everything that was specific to the old hospital is cleared: its
        // doctor, its refusals, and the doctor the patient had asked for.
        assignedDoctorUid: null,
        assignedDoctorName: null,
        requestedDoctorUid: null,
        requestedDoctorName: null,
        declines: [],
        respondBy: clock.respondBy,
        attempts: clock.attempts,
        exhausted: false,
      });
      tx.create(visitRef.collection("stageEvents").doc(), {
        visitId,
        fromStage: visit.stage,
        toStage: "requested",
        actor: actor.name,
        actorUid: actor.uid,
        actorRole: "system",
        reason: `${reason} Now trying ${next.name}.`,
        occurredAt: FieldValue.serverTimestamp(),
      });
      return { moved: true, to: next.name, exhausted: false };
    }

    // Nowhere left to try. The request is closed, so the patient is free to
    // ask again, and the screen says plainly that nobody answered.
    tx.update(visitRef, {
      stage: "cancelled",
      attempts,
      respondBy: null,
      exhausted: true,
      closedAt: FieldValue.serverTimestamp(),
    });
    tx.create(visitRef.collection("stageEvents").doc(), {
      visitId,
      fromStage: visit.stage,
      toStage: "cancelled",
      actor: actor.name,
      actorUid: actor.uid,
      actorRole: "system",
      reason: `${reason} No other hospital could take it${from ? ` after ${from.name}` : ""}.`,
      occurredAt: FieldValue.serverTimestamp(),
    });
    return { moved: true, to: null, exhausted: true };
  });
}

/**
 * The patient's phone calls this when the countdown reaches zero. It does
 * nothing unless the hospital really is overdue, so a phone with a wrong clock
 * cannot push a request on early.
 */
export const escalateRequest = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const visitId = requireString(request.data?.visitId, "Visit");
  const visit = (await db().collection("visits").doc(visitId).get()).data() as
    | Visit
    | undefined;
  if (!visit || visit.patientPhone !== phone) {
    throw new HttpsError("not-found", "No such visit.");
  }
  return moveOn(
    visitId,
    "timed_out",
    "No answer within the time promised.",
    { uid: request.auth!.uid, name: "Parcha (timer)" },
    true,
  );
});

/**
 * A hospital says it cannot take this one, and passes it on at once instead of
 * letting the clock run out. The reason is kept; the patient is told it is being
 * tried elsewhere, not that it was refused.
 */
export const passOnRequest = onCall(async (request) => {
  const caller = await liveCounter(request, "compounder");
  assertAbility(caller, "register");
  const visitId = requireString(request.data?.visitId, "Visit");
  const reason = requireString(request.data?.reason, "Reason");
  const visit = (await db().collection("visits").doc(visitId).get()).data() as
    | Visit
    | undefined;
  if (!visit) throw new HttpsError("not-found", "No such visit.");
  assertSameHospital(visit, caller);
  const moved = await moveOn(
    visitId,
    "declined",
    `${caller.displayName}: ${reason}.`,
    { uid: caller.uid, name: caller.displayName },
    false,
  );
  await logVisit(caller, request, visitId, "request.passed_on", (n) => `${actorLabel(caller)} passed ${n}'s request on${moved.to ? ` to ${moved.to}` : ""}: ${reason}`);
  return moved;
});

/**
 * Moves every overdue request on. Meant for a scheduler to call every minute in
 * production, so that nothing depends on a patient's phone being open: it is
 * the part that makes the promise hold when nobody is looking. In the emulator
 * it can be called by hand.
 */
/** Moves every request whose time has run out on to the next hospital. */
async function moveOverdueNow(): Promise<{ checked: number; moved: number }> {
  const overdue = await db()
    .collection("visits")
    .where("stage", "in", ["requested", "proposed"])
    .where("respondBy", "<=", Timestamp.now())
    .limit(200)
    .get();
  let moved = 0;
  for (const d of overdue.docs) {
    try {
      const out = await moveOn(
        d.id,
        "timed_out",
        "No answer within the time promised.",
        { uid: "system", name: "Parcha (timer)" },
        true,
      );
      if (out.moved) moved += 1;
    } catch {
      // One bad request must not stop the rest being moved.
    }
  }
  return { checked: overdue.size, moved };
}

/**
 * The every-minute run, on Cloud Scheduler: what keeps the 15-minute promise
 * when no patient's phone is open. One instance at a time, so two runs never
 * move the same request.
 */
export const moveOverdueRequests = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Asia/Kolkata", maxInstances: 1, timeoutSeconds: 120 },
  async () => {
    const r = await moveOverdueNow();
    if (r.moved) console.log("[requests] moved on", r);
  },
);

/** The same, by hand (or from a test), with the SWEEP_KEY. */
export const sweepOverdueRequests = onRequest(async (req, res) => {
  const key = process.env.SWEEP_KEY ?? (process.env.FIRESTORE_EMULATOR_HOST ? "dev-sweep-key" : "");
  if (!key || req.get("x-sweep-key") !== key) {
    res.status(403).json({ error: "Not allowed." });
    return;
  }
  res.json(await moveOverdueNow());
});

export type { Hospital };

/* ========================================================================= *
 * The hospital stays in control of the visit
 * ========================================================================= */

/**
 * Everything a front desk can change about a visit that has not happened yet,
 * through one door so each change is checked and recorded the same way:
 *
 *   bring        tell the patient what to bring, and anything else to know
 *   reschedule   move the booked time (the doctor's slot must be free)
 *   reassign     hand the booking to another doctor, at the same time
 *   no_show      the patient did not come
 *
 * Every change leaves a line in the audit trail, and the patient sees the new
 * plan the moment it is saved.
 */
export const controlVisit = onCall(async (request) => {
  const caller = await liveCounter(request, "compounder");
  assertAbility(caller, "register");
  const data = request.data ?? {};
  const visitId = requireString(data.visitId, "Visit");
  const action = data.action;
  const visitRef = db().collection("visits").doc(visitId);

  const note = (text: string) =>
    visitRef.collection("stageEvents").doc();

  if (action === "bring") {
    const bring = cleanBring(data.bring);
    const bringNote =
      typeof data.bringNote === "string" ? data.bringNote.trim().slice(0, 300) : "";
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(visitRef);
      if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
      const visit = snap.data() as Visit;
      assertSameHospital(visit, caller);
      if (!["requested", "proposed", "scheduled", "registered"].includes(visit.stage)) {
        throw new HttpsError("failed-precondition", "This visit is past the point of changing what to bring.");
      }
      tx.update(visitRef, {
        bring,
        bringNote: bringNote || null,
        // A changed list starts again: the patient ticks what they now have ready.
        bringReady: (visit.bringReady ?? []).filter((id) => bring.includes(id)),
      });
      tx.create(note("bring"), {
        visitId,
        fromStage: visit.stage,
        toStage: visit.stage,
        actor: caller.displayName,
        actorUid: caller.uid,
        actorRole: "compounder",
        reason: bring.length > 0 ? `Asked the patient to bring ${bring.length} thing(s)` : "Cleared the bring list",
        occurredAt: FieldValue.serverTimestamp(),
      });
    });
    await logVisit(caller, request, visitId, "visit.bring", (n) => bring.length ? `${actorLabel(caller)} asked ${n} to bring: ${bring.join(", ")}.` : `${actorLabel(caller)} cleared ${n}'s list of things to bring.`);
    return { ok: true };
  }

  if (action === "reschedule" || action === "reassign") {
    const doctorUid = action === "reassign" ? requireString(data.doctorUid, "Doctor") : null;
    let slot: Timestamp | null = null;
    if (action === "reschedule") {
      const day = data.day;
      const time = data.time;
      if (!isBookableDay(day) || typeof time !== "string" || !SLOT_TIMES.includes(time)) {
        throw new HttpsError("invalid-argument", "Choose a day and one of the listed times.");
      }
      const instant = slotInstant(day, time);
      if (instant.getTime() <= Date.now()) {
        throw new HttpsError("invalid-argument", "That time has already passed.");
      }
      slot = Timestamp.fromDate(instant);
    }

    let newDoctor: { displayName: string } | null = null;
    if (doctorUid) {
      const wire = await db().collection("routes").doc(routeId(caller.uid, doctorUid)).get();
      if (!wire.exists) {
        throw new HttpsError("permission-denied", "This desk is not connected to that doctor.");
      }
      newDoctor = (await activeAccount(doctorUid, "doctor", caller.hospitalId)) as { displayName: string } | null;
      if (!newDoctor) throw new HttpsError("failed-precondition", "That doctor is not available.");
    }

    await db().runTransaction(async (tx) => {
      const snap = await tx.get(visitRef);
      if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
      const visit = snap.data() as Visit;
      assertSameHospital(visit, caller);
      if (visit.stage !== "scheduled") {
        throw new HttpsError("failed-precondition", "Only a booked visit can be moved or handed on.");
      }
      const targetDoctor = doctorUid ?? visit.assignedDoctorUid;
      // The booked time as the database holds it (a Timestamp), kept as it is
      // when only the doctor changes.
      const stored = (snap.data() as { scheduledFor?: Timestamp | null }).scheduledFor ?? null;
      const when = slot ?? stored;
      if (!when || !targetDoctor) {
        throw new HttpsError("failed-precondition", "This booking has no time or doctor to change.");
      }
      const clash = await tx.get(
        db()
          .collection("visits")
          .where("assignedDoctorUid", "==", targetDoctor)
          .where("stage", "==", "scheduled")
          .where("scheduledFor", "==", when)
          .limit(2),
      );
      if (clash.docs.some((d) => d.id !== visitId)) {
        throw new HttpsError("failed-precondition", "That doctor already has somebody at that time.");
      }
      tx.update(visitRef, {
        scheduledFor: when,
        ...(newDoctor && doctorUid
          ? { assignedDoctorUid: doctorUid, assignedDoctorName: newDoctor.displayName }
          : {}),
      });
      tx.create(note("change"), {
        visitId,
        fromStage: "scheduled",
        toStage: "scheduled",
        actor: caller.displayName,
        actorUid: caller.uid,
        actorRole: "compounder",
        reason: action === "reschedule" ? "Moved the booked time" : `Handed to ${newDoctor?.displayName}`,
        occurredAt: FieldValue.serverTimestamp(),
      });
    });
    await logVisit(caller, request, visitId, action === "reschedule" ? "visit.rescheduled" : "visit.reassigned", (n) => action === "reschedule" ? `${actorLabel(caller)} moved ${n}'s visit to ${slot ? whenText(slot) : "a new time"}.` : `${actorLabel(caller)} handed ${n} to ${newDoctor?.displayName ?? "another doctor"}.`);
    return { ok: true };
  }

  if (action === "no_show") {
    const reason = typeof data.reason === "string" && data.reason.trim() ? data.reason.trim() : "Did not come";
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(visitRef);
      if (!snap.exists) throw new HttpsError("not-found", "No such visit.");
      const visit = snap.data() as Visit;
      assertSameHospital(visit, caller);
      await moveStage(tx, visitRef, visit.stage, "cancelled", "compounder", caller, { respondBy: null }, `No-show: ${reason}`);
    });
    await logVisit(caller, request, visitId, "visit.no_show", (n) => `${actorLabel(caller)} marked ${n} as not having come: ${reason}.`);
    return { ok: true };
  }

  throw new HttpsError("invalid-argument", "Unknown action.");
});

/**
 * The patient ticks off what they have ready, so the hospital can see how
 * prepared they are. It changes nothing but that list, and only on the
 * patient's own visit.
 */
export const setBringReady = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const visitId = requireString(request.data?.visitId, "Visit");
  const ready = cleanBring(request.data?.ready);
  const visitRef = db().collection("visits").doc(visitId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(visitRef);
    const visit = snap.data() as Visit | undefined;
    if (!visit || visit.patientPhone !== phone) {
      throw new HttpsError("not-found", "No such visit.");
    }
    tx.update(visitRef, { bringReady: ready.filter((id) => (visit.bring ?? []).includes(id)) });
  });
  return { ok: true };
});
