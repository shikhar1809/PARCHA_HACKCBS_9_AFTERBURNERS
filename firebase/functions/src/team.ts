/**
 * The team and its wiring.
 *
 * A hospital has many desks and many doctors, and who
 * sends patients to whom is something somebody has to be able to change
 * without a deploy. These three callables are how: create a member of the
 * team, and connect or disconnect two of them.
 *
 * All three are admin-only, and the check is the `admin` custom claim, which
 * only the Admin SDK can set. A desk account cannot grant itself the right to
 * rewire the hospital.
 */
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { generateCode, routeId } from "../../../packages/core/src/paths.js";
import { cleanAbilities } from "../../../packages/core/src/seats.js";
import type {
  AccountType,
  RouteKind,
} from "../../../packages/core/src/types.js";
import { audit, db, rateLimit, requireAdmin, requireRecentSignIn, requireStaff, requireString } from "./guards.js";
import { requireManage } from "./manage.js";
import { logActivity, actorLabel } from "./session.js";

// Adding people is on the Manage page now: see createTeamMember in manage.ts.

/** Which wire joins these two, or why none can. */
async function kindFor(
  fromUid: string,
  toUid: string,
  hospitalId: string,
): Promise<RouteKind> {
  const [from, to] = await Promise.all([
    db().collection("accounts").doc(fromUid).get(),
    db().collection("accounts").doc(toUid).get(),
  ]);
  // Both must be on the admin's own team. Somebody at another hospital is
  // "not on the team" here, however well their id is known.
  if (
    !from.exists ||
    !to.exists ||
    from.data()?.hospitalId !== hospitalId ||
    to.data()?.hospitalId !== hospitalId
  ) {
    throw new HttpsError("not-found", "One of those people is not on the team.");
  }
  if (from.data()?.active === false || to.data()?.active === false) {
    throw new HttpsError("failed-precondition", "That account is deactivated.");
  }

  // A wire carries a patient from whoever takes the vitals to a doctor.
  const can = (d: FirebaseFirestore.DocumentData | undefined) =>
    cleanAbilities(d?.abilities ?? (d?.accountType === "doctor" ? ["consult"] : d?.accountType === "staff" ? ["vitals"] : []));
  if (can(from.data()).includes("vitals") && can(to.data()).includes("consult") && fromUid !== toUid) return "desk_doctor";
  throw new HttpsError(
    "invalid-argument",
    "A desk connects to a doctor. A patient always passes a doctor first.",
  );
}

// Rewiring who sends patients to whom is Management's, behind the Manage PIN,
// like people and roles: a manager's session left open at a shared desk is not enough.
export const connectTeamMembers = onCall(async (request) => {
  const admin = await requireManage(request);
  await rateLimit(`team:${admin.uid}`, 30, 3600);
  const fromUid = requireString(request.data?.fromUid, "From");
  const toUid = requireString(request.data?.toUid, "To");

  const kind = await kindFor(fromUid, toUid, admin.hospitalId);
  await db()
    .collection("routes")
    .doc(routeId(fromUid, toUid))
    .set({
      hospitalId: admin.hospitalId,
      fromUid,
      toUid,
      kind,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: admin.displayName,
    });
  await audit(admin, "team.connect", { fromUid, toUid, kind });
  const [from, to] = await Promise.all([nameOf(fromUid), nameOf(toUid)]);
  await logActivity(admin, "team.connected", `${actorLabel(admin)} connected ${from} to ${to}, so ${from} can send patients to ${to}.`, { request });
  return { kind };
});

const nameOf = async (uid: string) => ((await db().collection("accounts").doc(uid).get()).data()?.displayName as string | undefined) ?? "someone";

export const disconnectTeamMembers = onCall(async (request) => {
  const admin = await requireManage(request);
  const fromUid = requireString(request.data?.fromUid, "From");
  const toUid = requireString(request.data?.toUid, "To");
  const ref = db().collection("routes").doc(routeId(fromUid, toUid));
  const wire = await ref.get();
  // Only a wire inside the admin's own hospital can be cut.
  if (wire.exists && wire.data()?.hospitalId === admin.hospitalId) {
    await ref.delete();
    await audit(admin, "team.disconnect", { fromUid, toUid });
    const [from, to] = await Promise.all([nameOf(fromUid), nameOf(toUid)]);
    await logActivity(admin, "team.disconnected", `${actorLabel(admin)} disconnected ${from} from ${to}.`, { request });
  }
  return { ok: true };
});

/**
 * "I am here" / "I have left". The app calls it every minute while a clinic
 * device is open and unlocked, and once with `false` on sign-out or lock. The
 * team page reads it to show who is on duty. It touches only the caller's own
 * account, and only these two fields.
 */
export const setDuty = onCall(async (request) => {
  const caller = requireStaff(request);
  // A heartbeat a minute is 60 an hour; the limit leaves room for several tabs.
  await rateLimit(`duty:${caller.uid}`, 300, 3600);
  await db()
    .collection("accounts")
    .doc(caller.uid)
    .update({
      onDuty: request.data?.onDuty !== false,
      lastSeenAt: FieldValue.serverTimestamp(),
    });
  return { ok: true };
});
