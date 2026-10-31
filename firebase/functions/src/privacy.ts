/**
 * A patient's rights over their own data: agree to the notice, take a copy,
 * and have it erased.
 *
 * What can be erased, and what cannot, is stated plainly because it is not the
 * same for everything. What the patient made themselves (papers, health notes,
 * reminders, doses ticked, call settings and call logs) is theirs and is
 * deleted when they ask. The clinical record a hospital made about a visit is
 * the hospital's record, and medical-record rules require hospitals to keep it;
 * deleting it from here would also erase evidence of what a doctor prescribed.
 * That part is NOT deleted. The request is recorded so the hospital can handle
 * it under its own retention rules.
 *
 * This is engineering, not legal advice: the wording and the retention
 * position must be checked by a lawyer before real patients use it.
 */
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { PRIVACY_VERSION } from "../../../packages/core/src/privacy.js";
import { db, rateLimit, requirePatientPhone, tenDigits } from "./guards.js";

export const recordConsent = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`consent:${phone}`, 20, 3600);
  if (request.data?.agree !== true) {
    throw new HttpsError("failed-precondition", "Please agree to continue.");
  }
  await db()
    .collection("consents")
    .doc(phone)
    .set({
      ownerPhone: phone,
      version: PRIVACY_VERSION,
      language: ["hi", "hg"].includes(request.data?.language) ? request.data.language : "en",
      acceptedAt: new Date().toISOString(),
    });
  return { version: PRIVACY_VERSION };
});

const strip = (data: FirebaseFirestore.DocumentData) => JSON.parse(JSON.stringify(data, (_k, v) => (v && typeof v === "object" && "toDate" in v ? v.toDate().toISOString() : v)));

/** Everything held that is tied to this number, as one document the patient can keep. */
export const exportMyData = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`export:${phone}`, 5, 3600);

  const byPhone = async (col: string, field = "ownerPhone") =>
    (await db().collection(col).where(field, "==", phone).get()).docs.map((d) => ({ id: d.id, ...strip(d.data()) }));

  const [patients, visits, reminders, doseLogs, histories, callJobs, documents] = await Promise.all([
    byPhone("patients", "phone"),
    byPhone("visits", "patientPhone"),
    byPhone("reminders"),
    byPhone("doseLogs"),
    byPhone("histories"),
    byPhone("callJobs"),
    byPhone("documents"),
  ]);

  // The prescriptions, allergies and conflicts that hang off each visit and patient.
  const sub = async (parent: { id: string }[], path: (id: string) => string) =>
    Promise.all(
      parent.map(async (p) => ({
        parentId: p.id,
        items: (await db().collection(path(p.id)).get()).docs.map((d) => ({ id: d.id, ...strip(d.data()) })),
      })),
    );
  const [prescriptions, conflicts, allergies] = await Promise.all([
    sub(visits, (id) => `visits/${id}/prescriptions`),
    sub(visits, (id) => `visits/${id}/conflicts`),
    sub(patients, (id) => `patients/${id}/allergies`),
  ]);

  const callSettings = (await db().collection("callSettings").doc(phone).get()).data();
  const consent = (await db().collection("consents").doc(phone).get()).data();

  return {
    exportedAt: new Date().toISOString(),
    phone,
    note: "Papers are listed by name; the files themselves are in the app under Records.",
    consent: consent ? strip(consent) : null,
    patients,
    visits,
    prescriptions,
    allergies,
    conflicts,
    reminders,
    doseLogs,
    histories,
    callSettings: callSettings ? strip(callSettings) : null,
    callJobs,
    documents,
  };
});

/** Deletes what the patient made, asks the hospitals about the rest, and closes the sign-in. */
export const deleteMyData = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`erase:${phone}`, 3, 3600);
  if (request.data?.confirm !== "DELETE") {
    throw new HttpsError("failed-precondition", "Type DELETE to confirm.");
  }

  const removed: Record<string, number> = {};
  const wipe = async (col: string, field = "ownerPhone", withFiles = false) => {
    const snap = await db().collection(col).where(field, "==", phone).get();
    for (const d of snap.docs) {
      if (withFiles) await d.ref.collection("files").doc("main").delete();
      await d.ref.delete();
    }
    removed[col] = snap.size;
  };
  await wipe("documents", "ownerPhone", true);
  await wipe("histories");
  await wipe("reminders");
  await wipe("doseLogs");
  await wipe("callJobs");
  await db().collection("callSettings").doc(phone).delete();
  await db().collection("consents").doc(phone).delete();

  // The hospitals' own records are not deleted from here; the request is logged for them.
  const visits = await db().collection("visits").where("patientPhone", "==", phone).get();
  const hospitals = [...new Set(visits.docs.map((v) => v.data().hospitalId as string))];
  await db().collection("privacyRequests").add({
    phoneLast4: phone.slice(-4),
    kind: "erasure",
    hospitals,
    requestedAt: FieldValue.serverTimestamp(),
    note: "Patient-owned data deleted. Clinical records at these hospitals are retained under medical-record rules; the hospital decides what else may be removed.",
  });

  // Last, close the sign-in itself.
  await getAuth().deleteUser(request.auth!.uid);
  return { removed, retainedAt: hospitals };
});
