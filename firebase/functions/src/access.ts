/**
 * A patient's access needs (low vision, deaf, sign language), set by the desk.
 * Kept on the patient record and copied onto their open visits, so the queue
 * and the doctor's dossier show them before the patient walks in.
 */
import { onCall } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";

import { ACCESS_NEEDS, cleanAccessNeeds } from "../../../packages/core/src/access.js";
import { assertAbility, db, requireString } from "./guards.js";
import { actorLabel, liveCounter, logActivity } from "./session.js";

export const setAccessNeeds = onCall(async (request) => {
  const caller = await liveCounter(request, "compounder");
  assertAbility(caller, "register");
  const patientId = requireString(request.data?.patientId, "Patient", 128);
  const needs = cleanAccessNeeds(request.data?.needs);
  const ref = db().collection("patients").doc(patientId);
  const patient = (await ref.get()).data();
  if (!patient || patient.hospitalId !== caller.hospitalId) throw new HttpsError("not-found", "No such patient.");

  await ref.update({ accessNeeds: needs });
  const open = await db().collection("visits").where("patientId", "==", patientId).where("closedAt", "==", null).get();
  await Promise.all(open.docs.map((d) => d.ref.update({ accessNeeds: needs })));

  const words = needs.map((n) => ACCESS_NEEDS.find((x) => x.id === n)!.label.toLowerCase());
  await logActivity(
    caller,
    "patient.access",
    needs.length
      ? `${actorLabel(caller)} noted that ${patient.fullName} is ${words.join(" and ")}.`
      : `${actorLabel(caller)} cleared ${patient.fullName}'s access needs.`,
    { patientId, request },
  );
  return { ok: true, needs };
});
