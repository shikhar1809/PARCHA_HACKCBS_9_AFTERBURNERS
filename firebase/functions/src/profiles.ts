/**
 * The people on a patient's phone: their faces, ages, nicknames, who helps them.
 *
 * Profiles belong to the phone number and are readable only by it. A person
 * who has been to a hospital appears on the phone without being added; this is
 * where the family's own details about them (and about people who have never
 * been to a hospital) are kept. Nothing here touches a hospital's record.
 */
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { cleanAccess } from "../../../packages/core/src/access.js";
import { cleanLook, profileId } from "../../../packages/core/src/profile.js";
import { db, rateLimit, requirePatientPhone, requireString, tenDigits } from "./guards.js";

const MAX_PROFILES = 12;

const digits = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const d = v.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? d : null;
};

export const saveProfile = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`profile:${phone}`, 120, 3600);
  const d = request.data ?? {};
  const name = requireString(d.name, "Name", 60);
  const id = profileId(phone, name);
  const ref = db().collection("profiles").doc(id);
  const existing = await ref.get();

  if (!existing.exists) {
    const count = await db().collection("profiles").where("ownerPhone", "==", phone).count().get();
    if (count.data().count >= MAX_PROFILES) {
      throw new HttpsError("resource-exhausted", "That is as many people as one phone can hold.");
    }
  }

  const age = d.ageYears === null || d.ageYears === undefined || d.ageYears === "" ? null : Number(d.ageYears);
  if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
    throw new HttpsError("invalid-argument", "Age must be a whole number from 0 to 120.");
  }
  const nickname = typeof d.nickname === "string" && d.nickname.trim() ? d.nickname.trim().slice(0, 30) : null;
  const helperNumber = d.helperNumber ? digits(d.helperNumber) : null;
  if (d.helperNumber && !helperNumber) throw new HttpsError("invalid-argument", "A phone number has ten digits.");

  // The call number is only ever set by the verification step, never here: a
  // number nobody has proved they own must not be phoned.
  await ref.set(
    {
      ownerPhone: phone,
      name,
      nickname,
      ageYears: age,
      sex: ["female", "male", "other"].includes(d.sex) ? d.sex : null,
      look: cleanLook(d.look),
      needsHelp: d.needsHelp === true,
      helperName: typeof d.helperName === "string" && d.helperName.trim() ? d.helperName.trim().slice(0, 40) : null,
      helperNumber,
      callNumber: existing.data()?.callNumber ?? null,
      callNumberVerified: existing.data()?.callNumberVerified === true,
      access: cleanAccess(d.access),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { id };
});

/** Removes the family's details for a person. A hospital's own record of them is untouched. */
export const deleteProfile = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const name = requireString(request.data?.name, "Name", 60);
  const ref = db().collection("profiles").doc(profileId(phone, name));
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.ownerPhone !== phone) throw new HttpsError("not-found", "No such person.");
  await ref.delete();
  return { ok: true };
});
