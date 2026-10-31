/**
 * Moving a visit along the chain, and the wiring checks around it.
 *
 * Shared by every callable that changes a visit's stage, so there is one
 * place where "is this move allowed, and who did it" is decided and recorded.
 */
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

import { describeTransitionProblem } from "../../../packages/core/src/stages.js";
import type {
  Stage,
  StaffRole,
  Visit,
} from "../../../packages/core/src/types.js";
import { db } from "./guards.js";

/** Which timestamp each stage stamps on arrival. */
export const STAGE_TIMESTAMP: Partial<Record<Stage, keyof Visit>> = {
  intake_complete: "intakeCompletedAt",
  in_consultation: "consultationStartedAt",
  prescribed: "prescribedAt",
};

/**
 * The wiring, enforced.
 *
 * A desk may only send a patient to a doctor it is wired to, a doctor may only
 * act on a patient sent to them. These run here, where a client cannot
 * skip them, so a screen that forgot to filter a list still cannot move a
 * patient the wiring does not allow.
 */
export async function activeAccount(
  uid: string,
  type: string,
  hospitalId?: string,
) {
  const snap = await db().collection("accounts").doc(uid).get();
  const data = snap.data();
  const ok =
    snap.exists &&
    data?.accountType === type &&
    data?.active !== false &&
    // A person at another hospital is not "on the team" here, whatever id was
    // sent: the hospital wall holds for accounts as much as for visits.
    (hospitalId === undefined || data?.hospitalId === hospitalId);
  return ok ? data : null;
}

/** The people a given account is wired to, who are still on the team. */
export async function wiredTo(
  fromUid: string,
  type: string,
  hospitalId: string,
): Promise<string[]> {
  const wires = await db()
    .collection("routes")
    .where("fromUid", "==", fromUid)
    .get();
  const out: string[] = [];
  for (const w of wires.docs) {
    const toUid = w.data().toUid as string;
    if (await activeAccount(toUid, type, hospitalId)) out.push(toUid);
  }
  return out;
}

/** Whether a patient has an allergy on record that nobody has retracted. */
export async function hasLiveAllergy(patientId: string): Promise<boolean> {
  const all = await db()
    .collection("patients")
    .doc(patientId)
    .collection("allergies")
    .get();
  const retracted = new Set(
    all.docs
      .map((d) => d.data().retractsAllergyId)
      .filter((id): id is string => Boolean(id)),
  );
  return all.docs.some((d) => !d.data().retractsAllergyId && !retracted.has(d.id));
}

/**
 * A visit at another hospital does not exist, as far as this caller can tell.
 * "Not found" rather than "forbidden", so the answer does not confirm that the
 * id belongs to somebody else's records.
 */
export function assertSameHospital(
  visit: { hospitalId?: string },
  caller: { hospitalId: string },
) {
  if (visit.hospitalId !== caller.hospitalId) {
    throw new HttpsError("not-found", "No such visit.");
  }
}

export function assertAssignedTo(visit: Visit, doctor: { uid: string }) {
  if (visit.assignedDoctorUid !== doctor.uid) {
    throw new HttpsError(
      "permission-denied",
      visit.assignedDoctorName
        ? `This patient was sent to ${visit.assignedDoctorName}, not to you.`
        : "This patient has not been sent to you.",
    );
  }
}

/**
 * Moves one visit along the chain, inside a transaction.
 *
 * The transaction is what makes "somebody else moved this patient on" a
 * clean failure rather than a double-advance: the stage is read and compared
 * in the same atomic unit as the write.
 */
export async function moveStage(
  tx: FirebaseFirestore.Transaction,
  visitRef: FirebaseFirestore.DocumentReference,
  current: Stage,
  to: Stage,
  role: StaffRole,
  actor: { uid: string; displayName: string },
  extra: Record<string, unknown> = {},
  reason: string | null = null,
) {
  const problem = describeTransitionProblem(role, current, to);
  if (problem) throw new HttpsError("failed-precondition", problem);

  const patch: Record<string, unknown> = {
    ...extra,
    stage: to,
  };
  const stamp = STAGE_TIMESTAMP[to];
  if (stamp) patch[stamp] = FieldValue.serverTimestamp();
  // A visit is closed when it ends either way: the prescription is signed, or
  // it was called off. A cancelled visit left "open" would block the patient
  // booking again.
  if (to === "prescribed" || to === "cancelled") {
    patch.closedAt = FieldValue.serverTimestamp();
  }

  tx.update(visitRef, patch);

  // Append-only: who passed this patient on, from where to where, and when.
  // The audit trail the paper slip never had.
  tx.create(visitRef.collection("stageEvents").doc(), {
    visitId: visitRef.id,
    fromStage: current,
    toStage: to,
    actor: actor.displayName,
    actorUid: actor.uid,
    actorRole: role,
    reason,
    occurredAt: FieldValue.serverTimestamp(),
  });
}

