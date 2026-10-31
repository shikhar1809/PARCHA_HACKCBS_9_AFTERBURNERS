/**
 * The pharmacy counter and the billing desk, for clinics that have them (a seat
 * with the "dispense" or "billing" ability). Each writes an append-only record
 * under the visit and a summary on the visit itself, so the queues are one
 * query, and says what it did in the activity log.
 */
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { billTotal, cleanBillLines, cleanPaymentRef, PAY_MODES, rupees, type DispensedLine, type PayMode } from "../../../packages/core/src/counter.js";
import type { PrescriptionItem, Visit } from "../../../packages/core/src/types.js";
import { assertAbility, db, rateLimit, requireString } from "./guards.js";
import { actorLabel, liveStaff, logActivity } from "./session.js";

async function visitAtMyHospital(visitId: string, hospitalId: string) {
  const ref = db().collection("visits").doc(visitId);
  const visit = (await ref.get()).data() as Visit | undefined;
  if (!visit || visit.hospitalId !== hospitalId) throw new HttpsError("not-found", "No such visit.");
  return { ref, visit };
}

/** The pharmacy gives out a signed prescription: what was given, and any same-formula swaps. */
export const dispensePrescription = onCall(async (request) => {
  const caller = await liveStaff(request);
  assertAbility(caller, "dispense");
  await rateLimit(`dispense:${caller.uid}`, 600, 3600);
  const visitId = requireString(request.data?.visitId, "Visit", 128);
  const { ref, visit } = await visitAtMyHospital(visitId, caller.hospitalId);
  if (visit.stage !== "prescribed") throw new HttpsError("failed-precondition", "There is no signed prescription to give out yet.");

  const rx = await ref.collection("prescriptions").orderBy("createdAt", "desc").limit(1).get();
  if (rx.empty) throw new HttpsError("failed-precondition", "There is no signed prescription to give out yet.");
  const items = (rx.docs[0].data().items ?? []) as PrescriptionItem[];
  const sent = Array.isArray(request.data?.lines) ? (request.data.lines as unknown[]) : [];
  const lines: DispensedLine[] = items.map((item, i) => {
    const l = (sent[i] ?? {}) as { given?: unknown; substitute?: unknown };
    const substitute = typeof l.substitute === "string" && l.substitute.trim() ? l.substitute.trim().slice(0, 60) : null;
    return { drugName: item.drugName, given: l.given !== false, substitute };
  });

  await ref.collection("dispensing").add({
    lines,
    prescriptionId: rx.docs[0].id,
    by: caller.displayName,
    byUid: caller.uid,
    at: FieldValue.serverTimestamp(),
  });
  await ref.update({ dispensedAt: FieldValue.serverTimestamp(), dispensedBy: caller.displayName });

  const given = lines.filter((l) => l.given);
  const swaps = given.filter((l) => l.substitute).map((l) => `${l.drugName} given as ${l.substitute}`);
  const notGiven = lines.filter((l) => !l.given).map((l) => l.drugName);
  await logActivity(
    caller,
    "visit.dispensed",
    `${actorLabel(caller)} gave ${visit.patientName} ${given.length} of ${lines.length} medicines${swaps.length ? ` (${swaps.join("; ")})` : ""}${notGiven.length ? `. Not given: ${notGiven.join(", ")}` : ""}.`,
    { patientId: visit.patientId, visitId, request },
  );
  return { ok: true, given: given.length, of: lines.length };
});

/** The billing desk records the fees for a visit and how they were paid. */
export const recordBill = onCall(async (request) => {
  const caller = await liveStaff(request);
  assertAbility(caller, "billing");
  await rateLimit(`bill:${caller.uid}`, 600, 3600);
  const visitId = requireString(request.data?.visitId, "Visit", 128);
  const { ref, visit } = await visitAtMyHospital(visitId, caller.hospitalId);
  const lines = cleanBillLines(request.data?.lines);
  if (lines.length === 0) throw new HttpsError("invalid-argument", "Add at least one fee.");
  const mode = request.data?.mode as PayMode;
  const paid = request.data?.paid !== false;
  if (paid && !PAY_MODES.includes(mode)) throw new HttpsError("invalid-argument", "Choose cash, UPI, card or Razorpay.");
  // Razorpay's payment id, when the desk wrote it down: on the receipt and in the log.
  const ref_ = request.data?.paidRef ? cleanPaymentRef(request.data.paidRef) : null;
  if (request.data?.paidRef && !ref_) throw new HttpsError("invalid-argument", "That is not a Razorpay payment id. It starts pay_ and is on the patient's payment confirmation.");
  const total = billTotal(lines);

  await ref.collection("bills").add({
    lines,
    total,
    paid,
    mode: paid ? mode : null,
    paidRef: paid ? ref_ : null,
    by: caller.displayName,
    byUid: caller.uid,
    at: FieldValue.serverTimestamp(),
  });
  await ref.update({ billTotal: total, paid, paidMode: paid ? mode : null, paidRef: paid ? ref_ : null });
  await logActivity(
    caller,
    "visit.billed",
    `${actorLabel(caller)} billed ${visit.patientName} ${rupees(total)} (${lines.map((l) => `${l.label} ${rupees(l.amount)}`).join(", ")})${paid ? `, paid by ${mode === "upi" ? "UPI" : mode === "razorpay" ? `Razorpay${ref_ ? ` (${ref_})` : ""}` : mode}` : ", not yet paid"}.`,
    { patientId: visit.patientId, visitId, request },
  );
  return { ok: true, total };
});
