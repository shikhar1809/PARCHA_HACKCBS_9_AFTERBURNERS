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
