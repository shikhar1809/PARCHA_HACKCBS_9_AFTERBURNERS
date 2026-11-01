/**
 * Reminders and the record of doses taken.
 *
 * A reminder is a rule the patient owns (see core/schedule.ts); a dose log is
 * one document per phone per day holding which doses were ticked. Both belong
 * to the phone number on the sign-in and are readable only by it. Writes go
 * through these callables so shape, size and count are checked server-side.
 */
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { assertOnThisPhone } from "./records.js";
import { db, rateLimit, requirePatientPhone, requireString, tenDigits } from "./guards.js";

const KINDS = ["medicine", "appointment", "followup", "other"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_REMINDERS = 80;

type Clean = Record<string, unknown> & { id?: string };

function clean(input: unknown, phone: string): Clean {
  const r = (input ?? {}) as Record<string, unknown>;
  const title = requireString(r.title, "Name", 80);
  const times = [...new Set(Array.isArray(r.times) ? r.times.filter((t): t is string => typeof t === "string" && TIME.test(t)) : [])].sort();
  if (times.length === 0 || times.length > 6) {
    throw new HttpsError("invalid-argument", "Choose between one and six times.");
  }
  const days = [...new Set(Array.isArray(r.days) ? r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6) : [])].sort();
  if (typeof r.startDate !== "string" || !DATE.test(r.startDate)) {
    throw new HttpsError("invalid-argument", "Choose a start date.");
  }
  const endDate = typeof r.endDate === "string" && DATE.test(r.endDate) ? r.endDate : null;
  if (endDate && endDate < r.startDate) {
    throw new HttpsError("invalid-argument", "The end date is before the start.");
  }
  const src = r.source as { visitId?: unknown; drugId?: unknown } | null;
  return {
    id: typeof r.id === "string" && r.id.length <= 40 ? r.id : undefined,
    ownerPhone: phone,
    personName: requireString(r.personName, "Who it is for", 120),
    kind: KINDS.includes(r.kind as string) ? r.kind : "other",
    title,
    detail: typeof r.detail === "string" && r.detail.trim() ? r.detail.trim().slice(0, 120) : null,
    times,
    days,
    // Every N days from the start (a weekly vitamin); 1 is every day.
    ...(Number.isInteger(r.everyDays) && (r.everyDays as number) > 1 && (r.everyDays as number) <= 90 ? { everyDays: r.everyDays as number } : {}),
    startDate: r.startDate,
    endDate,
    enabled: r.enabled !== false,
    source:
      src && typeof src.visitId === "string"
        ? { visitId: src.visitId.slice(0, 40), drugId: typeof src.drugId === "string" ? src.drugId.slice(0, 40) : null }
        : null,
    locked: r.locked === true,
  };
}

export const saveReminders = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`rem:${phone}`, 120, 3600);
  const list: unknown[] = Array.isArray(request.data?.reminders) ? request.data.reminders : [];
  if (list.length === 0 || list.length > 20) {
    throw new HttpsError("invalid-argument", "Send between one and twenty reminders.");
  }
  const cleaned = list.map((r) => clean(r, phone));
  for (const name of new Set(cleaned.map((c) => c.personName as string))) {
    await assertOnThisPhone(phone, name);
  }

  const col = db().collection("reminders");
  const existing = await col.where("ownerPhone", "==", phone).get();
  const mine = new Set(existing.docs.map((d) => d.id));
  const adding = cleaned.filter((c) => !c.id || !mine.has(c.id)).length;
  if (existing.size + adding > MAX_REMINDERS) {
    throw new HttpsError("resource-exhausted", "You have reached the limit of reminders. Delete some to add more.");
  }

  const batch = db().batch();
  const ids: string[] = [];
  for (const c of cleaned) {
    // Somebody else's id is treated as new: it can never overwrite their document.
    // An id the phone made up while offline ("c_...") is honoured when it is free,
    // so a reminder added with no signal keeps its name when it is sent.
    let ref = c.id && mine.has(c.id) ? col.doc(c.id) : col.doc();
    if (c.id && !mine.has(c.id) && /^c_[a-z0-9]{8,40}$/.test(c.id)) {
      const wanted = col.doc(c.id);
      if (!(await wanted.get()).exists) ref = wanted;
    }
    const { id: _ignored, ...fields } = c;
    // A locked reminder keeps the times that were checked. The only change it
    // takes is an end date no later than its own, which is how a newer Parcha
    // replaces it while keeping its history.
    const stored = existing.docs.find((d) => d.id === ref.id)?.data();
    if (stored?.locked === true) {
      const end = fields.endDate as string | null;
      const was = (stored.endDate as string | null) ?? null;
      if (!end || (was && end > was)) continue;
      batch.set(ref, { endDate: end, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      ids.push(ref.id);
      continue;
    }
    batch.set(ref, { ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    ids.push(ref.id);
  }
  await batch.commit();
  return { ids };
});

export const deleteReminder = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const id = requireString(request.data?.id, "Reminder", 40);
  const ref = db().collection("reminders").doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.ownerPhone !== phone) {
    throw new HttpsError("not-found", "No such reminder.");
  }
  if (snap.data()?.locked === true) {
    throw new HttpsError("failed-precondition", "This schedule is locked. A new Parcha replaces it.");
  }
  await ref.delete();
  return { ok: true };
});

/** Ticks a dose off, or takes the tick back. One document per phone per day. */
export const markDose = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`dose:${phone}`, 600, 3600);
  const date = requireString(request.data?.date, "Day", 10);
  const key = requireString(request.data?.key, "Dose", 60);
  // Reminder ids are the app's own ("c_..."), the server's, or the demo's ("seed-..."), then "@HHMM".
  if (!DATE.test(date) || !/^[A-Za-z0-9_-]{1,40}@\d{4}$/.test(key)) {
    throw new HttpsError("invalid-argument", "That dose is not valid.");
  }
  const reminder = await db().collection("reminders").doc(key.split("@")[0]).get();
  if (!reminder.exists || reminder.data()?.ownerPhone !== phone) {
    throw new HttpsError("not-found", "No such reminder.");
  }
  const ref = db().collection("doseLogs").doc(`${phone}__${date}`);
  if (request.data?.taken === false) {
    await ref.set({ ownerPhone: phone, date, taken: { [key]: FieldValue.delete() } }, { merge: true });
  } else {
    await ref.set({ ownerPhone: phone, date, taken: { [key]: new Date().toISOString() } }, { merge: true });
  }
  return { ok: true };
});
