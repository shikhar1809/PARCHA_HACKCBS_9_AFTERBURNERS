/**
 * Nightly housekeeping: removes what has served its purpose, so the database
 * holds what is useful and nothing grows without end.
 *
 *   accessGrants   share codes past their expiry (180 days after signing). A
 *                  QR or code on an old slip then says "expired" instead of
 *                  opening the prescription; the prescription itself stays.
 *   opLog          the "already done" record of an offline action, after 30 days
 *                  (a device does not hold an unsent action that long).
 *   historyShares  the fifteen-minute links a family gives a doctor, once the
 *                  window has closed. They delete themselves on the next read
 *                  too; this is the backstop for one nobody looks at again.
 *   rateLimits     counters whose window ended more than a day ago.
 *   passes         Manage-page passes that have run out.
 *   Custom clinics the empty clinics the first screen makes for a visitor
 *                  ("Custom"), two days after they were made, with all that
 *                  was made in them: sign-ins, team, seats, PIN, sessions,
 *                  patients, visits and the activity log.
 *
 * Deleted in batches of 400, a few thousand per run, so lakhs of old records
 * clear over a few nights without one huge job. Each query is on a single
 * field, which Firestore indexes by itself.
 */
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { db } from "./guards.js";

const BATCH = 400;
const MAX_PER_KIND = 20_000;

async function sweep(query: FirebaseFirestore.Query): Promise<number> {
  let removed = 0;
  while (removed < MAX_PER_KIND) {
    const page = await query.limit(BATCH).get();
    if (page.empty) break;
    const batch = db().batch();
    page.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += page.size;
    if (page.size < BATCH) break;
  }
  return removed;
}

/** How long a "Custom" clinic lasts. */
const SANDBOX_DAYS = 2;

/** Removes one Custom clinic and everything made in it. */
async function removeSandbox(hospitalId: string) {
  const store = db();
  const byHospital = (col: string) => store.collection(col).where("hospitalId", "==", hospitalId);
  const accounts = await byHospital("accounts").get();
  const uids = accounts.docs.map((d) => d.id);
  if (uids.length) await getAuth().deleteUsers(uids);
  for (const uid of uids) {
    await store.collection("accounts").doc(uid).delete();
    await store.collection("staffSessions").doc(uid).delete();
  }
  for (const col of ["visits", "patients"]) {
    const docs = await byHospital(col).limit(500).get();
    for (const d of docs.docs) await store.recursiveDelete(d.ref);
  }
  await sweep(byHospital("routes"));
  await sweep(byHospital("activity"));
  await store.recursiveDelete(store.collection("hospitalPrivate").doc(hospitalId));
  await store.recursiveDelete(store.collection("hospitals").doc(hospitalId));
}

/** Custom clinics older than SANDBOX_DAYS. One field in the query, so no extra index. */
export async function sweepSandboxes(now = Date.now()): Promise<number> {
  const cutoff = now - SANDBOX_DAYS * 86_400_000;
  const all = await db().collection("hospitals").where("sandbox", "==", true).limit(200).get();
  const old = all.docs.filter((d) => {
    const made = d.data().createdAt as Timestamp | undefined;
    return made && made.toMillis() < cutoff;
  });
  for (const d of old) await removeSandbox(d.id);
  return old.length;
}

export async function sweepExpiredNow(now = Date.now()) {
  const at = (ms: number) => Timestamp.fromMillis(ms);
  const [grants, ops, limits, passes, shares] = await Promise.all([
    sweep(db().collection("accessGrants").where("expiresAt", "<", at(now))),
    sweep(db().collection("opLog").where("at", "<", at(now - 30 * 86_400_000))),
    sweep(db().collection("rateLimits").where("windowStart", "<", at(now - 86_400_000))),
    sweep(db().collectionGroup("passes").where("expiresAt", "<", at(now))),
    // expiresAt on a share is an ISO string, which sorts the same way a time does.
    sweep(db().collection("historyShares").where("expiresAt", "<", new Date(now).toISOString())),
  ]);
  const sandboxes = await sweepSandboxes(now);
  return { grants, ops, limits, passes, shares, sandboxes };
}

export const sweepExpired = onSchedule(
  { schedule: "every day 03:00", timeZone: "Asia/Kolkata", timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    const r = await sweepExpiredNow();
    console.log("[sweep] removed", r);
  },
);
