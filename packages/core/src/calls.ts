/**
 * Reminder phone calls: what is said, and when a call is due.
 *
 * An elderly patient may not read a screen or hear a buzz in a pocket, but
 * answers a phone. So the same reminder rules that drive the in-app schedule
 * can also place a call that says what to take and asks for one key press.
 *
 * Everything here is pure: the script and the scheduling decisions are shared
 * by the server that places calls and by the tests, and no model writes any of
 * it. A reminder about medicine is the wrong place for text that varies.
 */
import { dosesOn, minutesSince, formatClock, type Dose, type Reminder } from "./schedule.js";

export type CallLanguage = "hi" | "en";

/** The wording of the consent shown to the patient. Bump it when the words change. */
export const CALL_CONSENT_VERSION = "2026-10-1";

/** What the patient agrees to when they switch calls on. */
export const CALL_CONSENT = {
  en: "Parcha will phone this number at the times of your medicine reminders. A call is short and free for you. You can switch it off at any time. Calls are made only to the number you signed in with.",
  hi: "पर्चा आपकी दवा के समय पर इसी नंबर पर फ़ोन करेगा। कॉल छोटी होती है और आपके लिए मुफ़्त है। आप इसे कभी भी बंद कर सकते हैं। कॉल केवल उसी नंबर पर की जाती है जिससे आपने साइन इन किया है।",
} as const;

export type CallSettings = {
  id: string;
  ownerPhone: string;
  enabled: boolean;
  language: CallLanguage;
  /** No calls from `quietStart` to `quietEnd` (`HH:MM`, may wrap midnight). */
  quietStart: string;
  quietEnd: string;
  consentAt: string | null;
  consentVersion: string | null;
  updatedAt: string;
};

export type CallStatus = "queued" | "ringing" | "done" | "failed";
/** What happened on the call. `snoozed` and `no_answer` are asked again, once. */
export type CallOutcome = "taken" | "snoozed" | "no_answer" | "no_input" | "failed" | null;

export type CallJob = {
  id: string;
  ownerPhone: string;
  /** The number actually rung: the account's own, or a family member's verified one. */
  toNumber?: string;
  /** What the call is for. A reminder is the usual one. */
  purpose?: "reminder" | "test" | "verify";
  /** The day, `YYYY-MM-DD`, and the time of the doses this call is about. */
  date: string;
  time: string;
  attempt: number;
  doses: { key: string; title: string; personName: string }[];
  script: string;
  language: CallLanguage;
  status: CallStatus;
  outcome: CallOutcome;
  provider: string;
  providerCallId: string | null;
  /** A second attempt is made after this time, if the first was not answered or was snoozed. */
  retryAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const MAX_ATTEMPTS = 2;
export const RETRY_AFTER_MINUTES = 10;
/** A call is placed within this many minutes after the dose time, never long after. */
export const CALL_WINDOW_MINUTES = 8;
export const MAX_CALLS_PER_DAY = 12;

export const DEFAULT_CALL_SETTINGS = { language: "hi" as CallLanguage, quietStart: "22:00", quietEnd: "06:00" };

/** Whether a time falls in the do-not-call window, which may wrap midnight. */
export function inQuietHours(time: string, start: string, end: string): boolean {
  if (start === end) return false;
  return start < end ? time >= start && time < end : time >= start || time < end;
}

const HINDI_PART = (h: number) => (h < 12 ? "सुबह" : h < 17 ? "दोपहर" : h < 21 ? "शाम" : "रात");

/** "रात के 9 बजे" / "सुबह के 8:30 बजे". */
export function spokenTimeHindi(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${HINDI_PART(h)} के ${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} बजे`;
}

const join = (list: string[], and: string) =>
  list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} ${and} ${list[list.length - 1]}`;

/** Who takes what: "Ramesh: Paracetamol and Metformin". */
function byPerson(doses: { title: string; personName: string }[]): { person: string; meds: string[] }[] {
  const map = new Map<string, string[]>();
  for (const d of doses) {
    const first = d.personName.split(" ")[0];
    map.set(first, [...(map.get(first) ?? []), d.title]);
  }
  return [...map.entries()].map(([person, meds]) => ({ person, meds }));
}

/**
 * The words of one call. Short, one question, and the key presses are said
 * last, after the time and the medicines, because that is the order a person
 * needs them in.
 */
export function buildScript(
  language: CallLanguage,
  time: string,
  doses: { title: string; personName: string }[],
  attempt = 1,
): string {
  const groups = byPerson(doses);
  const single = groups.length === 1;
  if (language === "hi") {
    const what = groups.map((g) => (single ? join(g.meds, "और") : `${g.person} के लिए ${join(g.meds, "और")}`)).join("। ");
    const who = single ? ` ${groups[0].person} की` : "";
    return `नमस्ते। यह पर्चा की ओर से दवा की याद दिलाने वाला कॉल है। ${attempt > 1 ? "हमने पहले भी फ़ोन किया था। " : ""}अभी ${spokenTimeHindi(time)} हैं।${who} दवा लेने का समय हो गया है: ${what}। अगर दवा ले ली है तो एक दबाइए। दस मिनट बाद फिर याद दिलाने के लिए दो दबाइए। धन्यवाद।`;
  }
  const what = groups.map((g) => (single ? join(g.meds, "and") : `${g.person}: ${join(g.meds, "and")}`)).join(". ");
  const who = single ? ` for ${groups[0].person}` : "";
  return `Hello, this is Parcha with your medicine reminder. ${attempt > 1 ? "We called a little while ago. " : ""}It is ${formatClock(time)}. It is time to take${who}: ${what}. If you have taken it, press 1. To be reminded again in ten minutes, press 2. Thank you.`;
}

/** What is said after a key press. */
export function replyScript(language: CallLanguage, digit: string): string {
  if (digit === "1") return language === "hi" ? "धन्यवाद। हमने नोट कर लिया है।" : "Thank you. We have noted it.";
  if (digit === "2") return language === "hi" ? "ठीक है। हम दस मिनट बाद फिर याद दिलाएँगे।" : "All right. We will remind you again in ten minutes.";
  return language === "hi" ? "क्षमा करें, यह विकल्प समझ नहीं आया। धन्यवाद।" : "Sorry, we did not understand. Thank you.";
}

export type DueCall = { time: string; doses: Dose[] };

/**
 * The calls due right now for one phone.
 *
 * A dose is due from its time until a few minutes after, so a dispatcher that
 * runs every minute (and misses one) still places the call, but a dose from
 * hours ago is never called about. Doses already ticked off are skipped, as are
 * those inside the quiet hours, and doses at the same time share one call.
 */
export function callsDue(input: {
  reminders: Reminder[];
  date: string;
  now: Date;
  taken: Record<string, unknown>;
  quietStart: string;
  quietEnd: string;
}): DueCall[] {
  const byTime = new Map<string, Dose[]>();
  for (const dose of dosesOn(input.reminders, input.date)) {
    if (dose.reminder.kind !== "medicine") continue;
    if (dose.key in input.taken) continue;
    if (inQuietHours(dose.time, input.quietStart, input.quietEnd)) continue;
    const since = minutesSince(dose.time, input.now);
    if (since < 0 || since > CALL_WINDOW_MINUTES) continue;
    byTime.set(dose.time, [...(byTime.get(dose.time) ?? []), dose]);
  }
  return [...byTime.entries()].map(([time, doses]) => ({ time, doses })).sort((a, b) => a.time.localeCompare(b.time));
}
