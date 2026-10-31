/** Reminders and doses taken (see firebase/functions/src/reminders.ts). */
import { limit, orderBy, where } from "firebase/firestore";

import type { CallJob, CallLanguage, CallSettings, DoseLog, Reminder } from "@parcha/core";

import { call } from "./firebase";
import { useDoc, useQuery, useQueryFactory, type Loadable } from "./hooks";
import { callQueued, newClientId, useOutbox, type QueuedCall } from "./outbox";

export type ReminderInput = Omit<Reminder, "id" | "ownerPhone"> & { id?: string };

/**
 * What the screen should show once changes that are still waiting to be sent are
 * laid over what the server last said: a reminder just added is there, one just
 * deleted is gone, and a dose just ticked is ticked, with or without a signal.
 */
function withQueuedReminders(list: Reminder[], queued: QueuedCall[], phone: string): Reminder[] {
  let out = list;
  for (const q of queued) {
    if (q.name === "saveReminders") {
      for (const r of (q.args as { reminders: ReminderInput[] }).reminders) {
        const id = r.id;
        if (!id) continue;
        const next = { ...r, id, ownerPhone: phone } as Reminder;
        out = out.some((x) => x.id === id) ? out.map((x) => (x.id === id ? { ...x, ...next } : x)) : [...out, next];
      }
    } else if (q.name === "deleteReminder") {
      const id = (q.args as { id: string }).id;
      out = out.filter((x) => x.id !== id);
    }
  }
  return out;
}

function withQueuedDoses(log: DoseLog | null, queued: QueuedCall[], phone: string, date: string): DoseLog | null {
  let taken = { ...(log?.taken ?? {}) };
  let changed = false;
  for (const q of queued) {
    if (q.name !== "markDose") continue;
    const a = q.args as { date: string; key: string; taken: boolean };
    if (a.date !== date) continue;
    changed = true;
    if (a.taken) taken[a.key] = new Date(q.at).toISOString();
    else delete taken[a.key];
  }
  if (!changed) return log;
  taken = { ...taken };
  return { id: log?.id ?? `${phone}__${date}`, ownerPhone: phone, date, taken };
}

export function useReminders(phone: string | null): Loadable<Reminder[]> {
  const build = useQueryFactory("reminders", [where("ownerPhone", "==", phone ?? "__none__"), limit(100)], [phone]);
  const live = useQuery<Reminder>(phone ? build : null, phone ? "reminders" : undefined);
  const queued = useOutbox();
  return { ...live, data: phone ? withQueuedReminders(live.data, queued, phone) : live.data };
}

/** Which doses were ticked on one day. Absent until the first tick. */
export function useDoseLog(phone: string | null, date: string): Loadable<DoseLog | null> {
  const live = useDoc<DoseLog>(phone ? `doseLogs/${phone}__${date}` : null, phone ? `dose:${date}` : undefined);
  const queued = useOutbox();
  return { ...live, data: phone ? withQueuedDoses(live.data, queued, phone, date) : live.data };
}

/** Saves reminders. With no connection they are kept on the device and sent later. */
export const saveReminders = (reminders: ReminderInput[]) => {
  // A new reminder gets its name here, so it can be shown, edited and sent without waiting for the server.
  const withIds = reminders.map((r) => ({ ...r, id: r.id ?? newClientId() }));
  return callQueued<{ reminders: ReminderInput[] }, { ids: string[] }>("saveReminders", { reminders: withIds }, (a) => ({
    ids: a.reminders.map((r) => r.id as string),
  }));
};

export const deleteReminder = (id: string) => callQueued<{ id: string }, { ok: true }>("deleteReminder", { id }, () => ({ ok: true }));

/** Ticks a dose off, or takes the tick back. Works with no connection. */
export const markDose = (date: string, key: string, taken: boolean) =>
  callQueued<{ date: string; key: string; taken: boolean }, { ok: true }>("markDose", { date, key, taken }, () => ({ ok: true }));

/* ------------------------------------------------------ phone-call reminders */

export function useCallSettings(phone: string | null): Loadable<CallSettings | null> {
  return useDoc<CallSettings>(phone ? `callSettings/${phone}` : null, phone ? "callSettings" : undefined);
}

/** The latest calls made to this phone, newest first. */
export function useCallJobs(phone: string | null): Loadable<CallJob[]> {
  const build = useQueryFactory(
    "callJobs",
    [where("ownerPhone", "==", phone ?? "__none__"), orderBy("createdAt", "desc"), limit(8)],
    [phone],
  );
  return useQuery<CallJob>(phone ? build : null);
}

export const saveCallSettings = (input: {
  enabled: boolean;
  language: CallLanguage;
  quietStart: string;
  quietEnd: string;
  /** True only when the person has just agreed on screen. */
  consent?: boolean;
}) => call<typeof input, { ok: true }>("saveCallSettings", input);

export const requestTestCall = () => call<Record<string, never>, { id: string }>("requestTestCall", {});

/** Demo phone line only: press a key on a call that is "ringing". */
export const simulateCallOutcome = (id: string, press: "1" | "2" | "none") =>
  call<{ id: string; press: string }, { ok: true }>("simulateCallOutcome", { id, press });

/* ----------------------------------------- a family member's own phone number */

/** Reads a code to a number. The demo phone line also returns the code, since nobody can answer it. */
export const startCallNumberVerification = (name: string, number: string) =>
  call<{ name: string; number: string }, { ok: true; demoCode?: string }>("startCallNumberVerification", { name, number });

export const confirmCallNumber = (name: string, code: string) =>
  call<{ name: string; code: string }, { ok: true }>("confirmCallNumber", { name, code });

export const clearCallNumber = (name: string) => call<{ name: string }, { ok: true }>("clearCallNumber", { name });
