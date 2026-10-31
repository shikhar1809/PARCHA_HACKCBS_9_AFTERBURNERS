/**
 * The patient's own papers: reports, scans, old prescriptions, insurance cards,
 * and a short medical history they keep up themselves.
 *
 * These belong to the patient and to nobody else. They are keyed by the phone
 * number on the sign-in, readable only by it, and no hospital account can read
 * them. Writes go through these callables like everything else, so size, type
 * and count are checked where a modified app cannot skip them.
 *
 * Storage here is Firestore: a small metadata document the list reads, and the
 * file itself in a sub-document opened only when somebody taps it. Images are
 * shrunk by the app before upload, so a photo of a report is a couple of
 * hundred kilobytes. A production build would move the bytes to Cloud Storage
 * and keep these same documents as the index; nothing outside this file and the
 * client's `records.ts` would change.
 */
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { profileId } from "../../../packages/core/src/profile.js";
import { audit, db, rateLimit, requirePatientPhone, requireString, tenDigits } from "./guards.js";

export const DOC_KINDS = ["report", "scan", "prescription", "insurance", "other"] as const;
const MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
/** Base64 characters; about 690 KB of file, inside Firestore's 1 MB document. */
const MAX_BASE64 = 920_000;
const MAX_DOCS_PER_PHONE = 60;

/** Somebody on this phone: a name that appears on one of the phone's patient records. */
export async function assertOnThisPhone(phone: string, personName: string): Promise<void> {
  // Somebody the family added by hand counts as much as somebody a hospital registered.
  const added = await db().collection("profiles").doc(profileId(phone, personName)).get();
  if (added.exists && added.data()?.ownerPhone === phone) return;
  const snap = await db().collection("patients").where("phone", "==", phone).get();
  if (!snap.docs.some((d) => d.data().fullName === personName)) {
    throw new HttpsError("not-found", "That person is not on this phone.");
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);

export const addDocument = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`doc:${phone}`, 40, 3600);
  const data = request.data ?? {};

  const personName = requireString(data.personName, "Who it is for", 120);
  const title = requireString(data.title, "Name", 80);
  const kind = DOC_KINDS.includes(data.kind) ? data.kind : "other";
  const mime = typeof data.mime === "string" ? data.mime : "";
  const base64 = typeof data.data === "string" ? data.data : "";
  if (!MIME.includes(mime)) {
    throw new HttpsError("invalid-argument", "Add a photo or a PDF.");
  }
  if (base64.length === 0 || base64.length > MAX_BASE64) {
    throw new HttpsError("invalid-argument", "That file is too big. Try a smaller photo or PDF.");
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new HttpsError("invalid-argument", "That file could not be read.");
  }
  const takenOn = typeof data.takenOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.takenOn) ? data.takenOn : null;

  await assertOnThisPhone(phone, personName);

  const mine = await db().collection("documents").where("ownerPhone", "==", phone).count().get();
  if (mine.data().count >= MAX_DOCS_PER_PHONE) {
    throw new HttpsError("resource-exhausted", "You have reached the limit of saved documents. Delete one to add another.");
  }

  const ref = db().collection("documents").doc();
  const batch = db().batch();
  batch.set(ref, {
    ownerPhone: phone,
    personName,
    title,
    kind,
    mime,
    size: Math.floor((base64.length * 3) / 4),
    takenOn,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(ref.collection("files").doc("main"), { data: base64 });
  await batch.commit();
  return { id: ref.id };
});

export const deleteDocument = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const id = requireString(request.data?.id, "Document", 40);
  const ref = db().collection("documents").doc(id);
  const snap = await ref.get();
  // Somebody else's document is "not found", never "forbidden": it is not
  // confirmed to exist.
  if (!snap.exists || snap.data()?.ownerPhone !== phone) {
    throw new HttpsError("not-found", "No such document.");
  }
  const batch = db().batch();
  batch.delete(ref.collection("files").doc("main"));
  batch.delete(ref);
  await batch.commit();
  return { ok: true };
});

const clean = (value: unknown, max: number, n: number): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => v && v.length <= max))].slice(0, n)
    : [];

const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export const saveHistory = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`history:${phone}`, 200, 3600);
  const data = request.data ?? {};
  const personName = requireString(data.personName, "Who it is for", 120);
  await assertOnThisPhone(phone, personName);

  const notes = typeof data.notes === "string" ? data.notes.trim().slice(0, 600) : "";
  const doc = {
    ownerPhone: phone,
    personName,
    conditions: clean(data.conditions, 60, 30),
    allergies: clean(data.allergies, 60, 30),
    medicines: clean(data.medicines, 80, 30),
    bloodGroup: BLOOD.includes(data.bloodGroup) ? data.bloodGroup : null,
    notes,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db().collection("histories").doc(`${phone}__${slug(personName)}`).set(doc);
  await audit({ uid: request.auth!.uid, displayName: "patient", hospitalId: "-" }, "history.save", { phone });
  return { ok: true };
});
