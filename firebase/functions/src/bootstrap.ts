/**
 * One-time set-up of a live project: the medicine list, a hospital, and a
 * first team (a front desk who is the admin, and a doctor wired to that desk).
 * After this the admin adds everyone else from the Team page.
 *
 *   curl -X POST -H "x-bootstrap-key: $KEY" https://asia-south1-<project>.cloudfunctions.net/bootstrapLive
 *
 * Guarded three ways: it needs BOOTSTRAP_KEY (set only in the deploy's env
 * file, never committed), it refuses to run in the emulator (use the seed), and
 * it refuses if the project already has a team, so it cannot overwrite one.
 * Delete the function once it has run: `firebase functions:delete bootstrapLive`.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";

import { COUNTERS_FOR } from "../../../packages/core/src/stages.js";
import { routeId } from "../../../packages/core/src/paths.js";
import { db } from "./guards.js";
import { HOSPITALS, writeFormulary } from "./seed.js";

const password = () => randomBytes(12).toString("base64url");

const sameKey = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const bootstrapLive = onRequest({ timeoutSeconds: 300, memory: "1GiB" }, async (req, res) => {
  const key = process.env.BOOTSTRAP_KEY ?? "";
  if (req.method !== "POST" || !key || !sameKey(String(req.get("x-bootstrap-key") ?? ""), key)) {
    res.status(403).json({ error: "Not allowed." });
    return;
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    res.status(400).json({ error: "Use the demo seed in the emulator." });
    return;
  }
  if (!(await db().collection("accounts").limit(1).get()).empty) {
    res.status(409).json({ error: "This project already has a team. Nothing was changed." });
    return;
  }

  const body = (req.body ?? {}) as { deskEmail?: string; doctorEmail?: string };
  const hospital = HOSPITALS[0];

  await writeFormulary();
  await db().collection("hospitals").doc(hospital.id).set({ ...hospital, departments: [...hospital.departments] });

  const team = [
    { email: body.deskEmail ?? "desk@parcha.clinic", displayName: "Front desk", accountType: "staff" as const, admin: true },
    { email: body.doctorEmail ?? "doctor@parcha.clinic", displayName: "Doctor", accountType: "doctor" as const, admin: false, department: "General medicine" },
  ];
  const made: { email: string; password: string; uid: string; role: string }[] = [];
  for (const m of team) {
    const pw = password();
    const user = await getAuth().createUser({ email: m.email, password: pw, displayName: m.displayName });
    await getAuth().setCustomUserClaims(user.uid, {
      accountType: m.accountType,
      name: m.displayName,
      admin: m.admin,
      hospitalId: hospital.id,
    });
    await db().collection("accounts").doc(user.uid).set({
      uid: user.uid,
      displayName: m.displayName,
      accountType: m.accountType,
      counters: COUNTERS_FOR[m.accountType],
      hospitalId: hospital.id,
      department: m.department ?? null,
      admin: m.admin,
      active: true,
      ...(m.accountType === "doctor" ? { availability: "available" } : {}),
    });
    made.push({ email: m.email, password: pw, uid: user.uid, role: m.admin ? "front desk, admin" : m.accountType });
  }

  const [desk, doctor] = made;
  await db().collection("routes").doc(routeId(desk.uid, doctor.uid)).set({
    hospitalId: hospital.id,
    fromUid: desk.uid,
    toUid: doctor.uid,
    kind: "desk_doctor",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: "Set-up",
  });

  res.json({ hospital: hospital.name, accounts: made.map(({ email, password, role }) => ({ email, password, role })) });
});
