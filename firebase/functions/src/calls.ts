/**
 * The reminder calling agent.
 *
 * Once a minute a dispatcher looks at every patient who has switched calls on,
 * works out which medicine doses are due (the same rules as the in-app
 * schedule), and places one short call per time of day. The call says what to
 * take and asks for a key press: 1 means taken, 2 means ask again in ten
 * minutes. A call that is not answered is tried once more.
 *
 * The telephone itself sits behind a small adapter, so the logic here does not
 * change with the provider:
 *
 *   mock    (default, and the only one in the emulator) places no real call. A
 *           job shows as "ringing" and the demo screen offers the key presses,
 *           so the whole loop can be shown without a phone.
 *   twilio  places real calls. Needs CALL_PROVIDER=twilio and TWILIO_ACCOUNT_SID,
 *           TWILIO_AUTH_TOKEN, TWILIO_FROM and PUBLIC_FUNCTIONS_URL. NOT tested
 *           against a live account in this repository.
 *
 * Safety rails: a call goes only to the number the patient signed in with
 * (never one supplied in a request), needs a recorded consent, respects quiet
 * hours, and is capped per phone per day.
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";

import {
  CALL_CONSENT_VERSION,
  DEFAULT_CALL_SETTINGS,
  MAX_ATTEMPTS,
  MAX_CALLS_PER_DAY,
  RETRY_AFTER_MINUTES,
  buildScript,
  callsDue,
  replyScript,
  type CallJob,
  type CallLanguage,
} from "../../../packages/core/src/calls.js";
import type { Reminder } from "../../../packages/core/src/schedule.js";
import { profileId } from "../../../packages/core/src/profile.js";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

import { db, rateLimit, requirePatientPhone, requireString, tenDigits } from "./guards.js";
import { assertOnThisPhone } from "./records.js";

/* ------------------------------------------------------------------ provider */

type PlaceInput = { to: string; script: string; language: CallLanguage; jobId: string; /** Ask for a key press. A code being read out does not. */ gather?: boolean };
type CallProvider = { name: string; place(input: PlaceInput): Promise<{ providerCallId: string }> };

const mock: CallProvider = {
  name: "mock",
  async place() {
    return { providerCallId: `mock-${Date.now().toString(36)}` };
  },
};

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The full address Twilio is told to call back (no query string). Cloud
 * Functions can serve a function at more than one address, and Twilio's
 * signature covers the exact one it called, so this is set explicitly rather
 * than guessed from the request.
 */
const webhookBase = () =>
  (process.env.TWILIO_WEBHOOK_URL ?? (process.env.PUBLIC_FUNCTIONS_URL ? `${process.env.PUBLIC_FUNCTIONS_URL.replace(/\/$/, "")}/callWebhook` : "")).replace(/\/$/, "");

/** A voice that speaks both Hindi and Indian English. Override with TWILIO_VOICE. */
const voice = () => process.env.TWILIO_VOICE ?? "Polly.Aditi";

const twilio: CallProvider = {
  name: "twilio",
  async place({ to, script, language, jobId, gather = true }) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from || !webhookBase()) {
      throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, and TWILIO_WEBHOOK_URL or PUBLIC_FUNCTIONS_URL).");
    }
    const action = `${webhookBase()}?job=${encodeURIComponent(jobId)}`;
    const say = `<Say voice="${xml(voice())}" language="${language === "hi" ? "hi-IN" : "en-IN"}">${xml(script)}</Say>`;
    const twiml = gather
      ? `<Response><Gather input="dtmf" numDigits="1" timeout="10" method="POST" action="${xml(action)}">${say}</Gather></Response>`
      : `<Response>${say}</Response>`;
    const body = new URLSearchParams({
      To: `+91${to}`,
      From: from,
      Twiml: twiml,
      StatusCallback: `${action}&event=status`,
      StatusCallbackEvent: "completed",
      Timeout: "30",
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok || !json.sid) throw new Error(json.message ?? `Twilio returned ${res.status}`);
    return { providerCallId: json.sid };
  },
};

const provider = (): CallProvider => (process.env.CALL_PROVIDER === "twilio" ? twilio : mock);

/* ------------------------------------------------------------------- helpers */

/** The calendar day and clock in India, as a Date whose local getters read as IST. */
function indiaNow(): { date: string; time: string; local: Date } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  const date = `${g("year")}-${g("month")}-${g("day")}`;
  const hh = g("hour") === "24" ? "00" : g("hour");
  return { date, time: `${hh}:${g("minute")}`, local: new Date(Number(g("year")), Number(g("month")) - 1, Number(g("day")), Number(hh), Number(g("minute"))) };
}

/** A short name for a set of doses, so a medicine added later at the same time is its own call. */
const doseSet = (keys: string[]) => createHash("sha1").update([...keys].sort().join(",")).digest("hex").slice(0, 6);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const iso = () => new Date().toISOString();

type JobDoc = Omit<CallJob, "id">;

/** Writes the job (once: the id says which call it is) and places the call. */
async function startCall(job: JobDoc & { id: string }): Promise<boolean> {
  const ref = db().collection("callJobs").doc(job.id);
  try {
    const { id: _id, ...fields } = job;
    await ref.create(fields);
  } catch (e) {
    if ((e as { code?: number }).code === 6) return false; // ALREADY_EXISTS: another run got there first
    throw e;
  }
  try {
    const placed = await provider().place({
      to: job.toNumber ?? job.ownerPhone, script: job.script, language: job.language, jobId: job.id,
      gather: job.purpose !== "verify",
    });
    // A code read out needs no answer: it is finished once it has been said.
    await ref.update({ status: job.purpose === "verify" && provider().name === "mock" ? "done" : "ringing", providerCallId: placed.providerCallId, updatedAt: iso() });
  } catch (e) {
    console.error("call failed to start", job.id, e);
    await ref.update({ status: "failed", outcome: "failed", updatedAt: iso() });
  }
  return true;
}

/** What a key press or a hang-up means for the job and for the doses. */
async function applyOutcome(jobId: string, outcome: "taken" | "snoozed" | "no_answer" | "no_input" | "failed"): Promise<void> {
  const ref = db().collection("callJobs").doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "No such call.");
  const job = snap.data() as JobDoc;
  if (job.status === "done" || job.status === "failed") return; // a second report of the same call changes nothing

  const retry = (outcome === "snoozed" || outcome === "no_answer" || outcome === "no_input") && job.attempt < MAX_ATTEMPTS;
  await ref.update({
    status: "done",
    outcome,
    retryAt: retry ? new Date(Date.now() + RETRY_AFTER_MINUTES * 60_000).toISOString() : null,
    updatedAt: iso(),
  });

  if (outcome === "taken" && job.doses.length > 0) {
    const taken: Record<string, string> = {};
    for (const d of job.doses) taken[d.key] = iso();
    await db().collection("doseLogs").doc(`${job.ownerPhone}__${job.date}`).set({ ownerPhone: job.ownerPhone, date: job.date, taken }, { merge: true });
  }
}

/* --------------------------------------------------------------- patient API */

export const saveCallSettings = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`callset:${phone}`, 60, 3600);
  const d = request.data ?? {};
  const enabled = d.enabled === true;
  const language: CallLanguage = d.language === "en" ? "en" : "hi";
  const quietStart = typeof d.quietStart === "string" && TIME.test(d.quietStart) ? d.quietStart : DEFAULT_CALL_SETTINGS.quietStart;
  const quietEnd = typeof d.quietEnd === "string" && TIME.test(d.quietEnd) ? d.quietEnd : DEFAULT_CALL_SETTINGS.quietEnd;

  const ref = db().collection("callSettings").doc(phone);
  const existing = (await ref.get()).data();
  // Calls start only after a recorded yes. Without one in this request, an
  // earlier consent for the same wording still counts.
  const consented = d.consent === true || (existing?.consentVersion === CALL_CONSENT_VERSION && existing?.consentAt);
  if (enabled && !consented) {
    throw new HttpsError("failed-precondition", "Please agree to the phone calls first.");
  }
  await ref.set(
    {
      ownerPhone: phone,
      enabled,
      language,
      quietStart,
      quietEnd,
      ...(d.consent === true
        ? { consentAt: new Date().toISOString(), consentVersion: CALL_CONSENT_VERSION }
        : { consentAt: existing?.consentAt ?? null, consentVersion: existing?.consentVersion ?? null }),
      updatedAt: iso(),
    },
    { merge: true },
  );
  return { ok: true };
});

/** A call now, to the patient's own phone, so they can hear what it will be like. */
export const requestTestCall = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`testcall:${phone}`, 3, 3600);
  const settings = (await db().collection("callSettings").doc(phone).get()).data();
  if (!settings?.enabled) throw new HttpsError("failed-precondition", "Switch phone calls on first.");
  const language: CallLanguage = settings.language === "en" ? "en" : "hi";
  const script =
    language === "hi"
      ? "नमस्ते। यह पर्चा की ओर से एक परीक्षण कॉल है। असली कॉल में हम आपको दवा का नाम और समय बताएँगे। एक दबाइए। धन्यवाद।"
      : "Hello, this is a test call from Parcha. In a real call we will tell you which medicine to take and when. Press 1 to finish. Thank you.";
  const { date, time } = indiaNow();
  const id = `${phone}__test__${Date.now()}`;
  await startCall({
    id, ownerPhone: phone, date, time, attempt: 1, doses: [], script, language, status: "queued", outcome: null,
    provider: provider().name, providerCallId: null, retryAt: null, createdAt: iso(), updatedAt: iso(),
  });
  return { id };
});

/** Demo only: press a key on a call that the mock provider is "ringing". */
export const simulateCallOutcome = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  if (provider().name !== "mock") throw new HttpsError("failed-precondition", "Only available with the demo phone line.");
  const id = String(request.data?.id ?? "");
  const snap = await db().collection("callJobs").doc(id).get();
  if (!snap.exists || snap.data()?.ownerPhone !== phone) throw new HttpsError("not-found", "No such call.");
  const press = String(request.data?.press ?? "");
  const outcome = press === "1" ? "taken" : press === "2" ? "snoozed" : press === "none" ? "no_answer" : null;
  if (!outcome) throw new HttpsError("invalid-argument", "Press 1, 2, or none.");
  await applyOutcome(id, outcome);
  return { ok: true };
});

/* ---------------------------------------------------------------- dispatcher */

/** How many accounts are read at a time while walking every enabled account. */
const DISPATCH_PAGE = 300;

export async function runDispatcher(): Promise<{ placed: number; retried: number; expired: number }> {
  const { date, local } = indiaNow();
  const nowIso = iso();
  let placed = 0;
  let retried = 0;
  let expired = 0;

  // 1. First calls: everyone who has switched calls on.
  //
  // Paged by document id rather than capped, because a cap is not a cap: with
  // more than a page of accounts the ones past the end are never looked at,
  // and nobody finds out — their phone simply does not ring. The id order is
  // stable, so the cursor walks the whole set exactly once per run.
  const everyone: QueryDocumentSnapshot[] = [];
  for (let after: QueryDocumentSnapshot | null = null; ; ) {
    let q = db().collection("callSettings").where("enabled", "==", true).orderBy("__name__").limit(DISPATCH_PAGE);
    if (after) q = q.startAfter(after);
    const page = await q.get();
    everyone.push(...page.docs);
    if (page.size < DISPATCH_PAGE) break;
    after = page.docs[page.size - 1];
  }
  for (const s of everyone) {
    const cfg = s.data();
    const phone = s.id;
    const reminders = (await db().collection("reminders").where("ownerPhone", "==", phone).get()).docs.map(
      (d) => ({ ...(d.data() as Omit<Reminder, "id">), id: d.id }),
    );
    if (reminders.length === 0) continue;
    const log = (await db().collection("doseLogs").doc(`${phone}__${date}`).get()).data();
    const due = callsDue({
      reminders, date, now: local, taken: (log?.taken as Record<string, unknown>) ?? {},
      quietStart: cfg.quietStart ?? DEFAULT_CALL_SETTINGS.quietStart, quietEnd: cfg.quietEnd ?? DEFAULT_CALL_SETTINGS.quietEnd,
    });
    if (due.length === 0) continue;

    // Each person's calls go to their own verified number if they have one, and
    // otherwise to the account's number; so one time of day can mean two calls.
    const verified = new Map<string, string>();
    // Someone who cannot hear is not phoned: their reminders flash and vibrate on the phone instead.
    const deaf = new Set<string>();
    for (const p of (await db().collection("profiles").where("ownerPhone", "==", phone).get()).docs) {
      const v = p.data();
      if (v.callNumberVerified === true && typeof v.callNumber === "string") verified.set(v.name, v.callNumber);
      if (v.access?.deaf === true) deaf.add(v.name);
    }

    const today = await db().collection("callJobs").where("ownerPhone", "==", phone).where("date", "==", date).count().get();
    let count = today.data().count;
    for (const call of due) {
      const language: CallLanguage = cfg.language === "en" ? "en" : "hi";
      const byRecipient = new Map<string, { key: string; title: string; personName: string }[]>();
      for (const d of call.doses) {
        if (deaf.has(d.reminder.personName)) continue;
        const to = verified.get(d.reminder.personName) ?? phone;
        byRecipient.set(to, [...(byRecipient.get(to) ?? []), { key: d.key, title: d.reminder.title, personName: d.reminder.personName }]);
      }
      for (const [to, doses] of byRecipient) {
        if (count >= MAX_CALLS_PER_DAY) break;
        const ok = await startCall({
          id: `${phone}__${date}__${call.time.replace(":", "")}__${to}__${doseSet(doses.map((d) => d.key))}__a1`, ownerPhone: phone, toNumber: to, purpose: "reminder",
          date, time: call.time, attempt: 1, doses, script: buildScript(language, call.time, doses, 1), language, status: "queued", outcome: null,
          provider: provider().name, providerCallId: null, retryAt: null, createdAt: nowIso, updatedAt: nowIso,
        });
        if (ok) {
          placed += 1;
          count += 1;
        }
      }
    }
  }

  // 2. The demo line has no real network to hang up: a call nobody pressed a key on
  //    for two minutes counts as unanswered.
  if (provider().name === "mock") {
    const stale = await db().collection("callJobs").where("status", "==", "ringing").limit(100).get();
    for (const j of stale.docs) {
      if (Date.now() - new Date(j.data().updatedAt).getTime() > 2 * 60_000) {
        await applyOutcome(j.id, "no_answer");
        expired += 1;
      }
    }
  }

  // 3. Second attempts, for calls that were not answered or were snoozed.
  const retries = await db().collection("callJobs").where("retryAt", "<=", nowIso).limit(100).get();
  for (const j of retries.docs) {
    const job = j.data() as JobDoc;
    await j.ref.update({ retryAt: null });
    if (job.attempt >= MAX_ATTEMPTS || job.doses.length === 0) continue;
    // Doses taken in the meantime (in the app, say) are not asked about again.
    const log = (await db().collection("doseLogs").doc(`${job.ownerPhone}__${job.date}`).get()).data();
    const doses = job.doses.filter((d) => !(d.key in ((log?.taken as Record<string, unknown>) ?? {})));
    if (doses.length === 0) continue;
    const ok = await startCall({
      id: `${job.ownerPhone}__${job.date}__${job.time.replace(":", "")}__${job.toNumber ?? job.ownerPhone}__${doseSet(doses.map((d) => d.key))}__a${job.attempt + 1}`, ownerPhone: job.ownerPhone, toNumber: job.toNumber, purpose: "reminder", date: job.date,
      time: job.time, attempt: job.attempt + 1, doses, script: buildScript(job.language, job.time, doses, job.attempt + 1), language: job.language,
      status: "queued", outcome: null, provider: provider().name, providerCallId: null, retryAt: null, createdAt: nowIso, updatedAt: nowIso,
    });
    if (ok) retried += 1;
  }
  return { placed, retried, expired };
}

/** Every minute, in production. (The emulator does not fire schedules; use `runCallDispatcher`.) */
export const dispatchReminderCalls = onSchedule({ schedule: "every 1 minutes", timeoutSeconds: 120, maxInstances: 1 }, async () => {
  await runDispatcher();
});

/** The same run, by hand: `curl -H "x-sweep-key: dev-sweep-key" <url>`. */
export const runCallDispatcher = onRequest(async (req, res) => {
  const key = process.env.SWEEP_KEY ?? (process.env.FIRESTORE_EMULATOR_HOST ? "dev-sweep-key" : "");
  if (!key || req.get("x-sweep-key") !== key) {
    res.status(403).json({ error: "Not allowed." });
    return;
  }
  res.json(await runDispatcher());
});

/* ------------------------------------------------------------------- webhook */

/** Twilio signs its requests; a webhook that does not verify is somebody else. */
function validTwilioSignature(url: string, params: Record<string, string>, signature: string | undefined): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", token).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Where the provider reports a key press or the end of a call. */
export const callWebhook = onRequest(async (req, res) => {
  if (provider().name !== "twilio") {
    res.status(404).send("Not available.");
    return;
  }
  const params = Object.fromEntries(Object.entries(req.body ?? {}).map(([k, v]) => [k, String(v)]));
  // The exact address Twilio called: our configured one, with the query it sent.
  const url = `${webhookBase()}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
  if (!validTwilioSignature(url, params, req.get("x-twilio-signature"))) {
    res.status(403).send("Bad signature.");
    return;
  }
  const jobId = String(req.query.job ?? "");
  const snap = await db().collection("callJobs").doc(jobId).get();
  if (!snap.exists) {
    res.status(404).send("No such call.");
    return;
  }
  const job = snap.data() as JobDoc;

  if (req.query.event === "status") {
    const s = params.CallStatus;
    if (s === "no-answer" || s === "busy") await applyOutcome(jobId, "no_answer");
    else if (s === "failed" || s === "canceled") await applyOutcome(jobId, "failed");
    else if (s === "completed") await applyOutcome(jobId, "no_input"); // hung up without pressing anything
    res.status(204).send();
    return;
  }

  const digit = params.Digits ?? "";
  await applyOutcome(jobId, digit === "1" ? "taken" : digit === "2" ? "snoozed" : "no_input");
  res.type("text/xml").send(`<Response><Say language="${job.language === "hi" ? "hi-IN" : "en-IN"}">${xml(replyScript(job.language, digit))}</Say></Response>`);
});

/* ------------------------------------------------ a family member's own phone */

const digits = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const d = v.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? d : null;
};
const codeHash = (code: string, id: string) => createHash("sha256").update(`parcha-call-number:${id}:${code}`).digest("hex");

/**
 * Starts proving that a number belongs to somebody on this phone. A call reads a
 * four-digit code to that number; typing it back proves whoever answered is
 * holding it. Until then reminder calls for that person keep going to the
 * account's own number: a number nobody has proved is never phoned.
 */
export const startCallNumberVerification = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`verifycall:${phone}`, 5, 3600);
  const d = request.data ?? {};
  const name = requireString(d.name, "Name", 60);
  await assertOnThisPhone(phone, name);
  const number = digits(d.number);
  if (!number || !/^[6-9]/.test(number)) throw new HttpsError("invalid-argument", "Enter a ten-digit mobile number.");
  if (number === phone) throw new HttpsError("failed-precondition", "That is the number you signed in with. Calls already go there.");

  const id = profileId(phone, name);
  const code = String(randomInt(1000, 10000));
  await db().collection("callVerifications").doc(id).set({
    ownerPhone: phone, name, number, codeHash: codeHash(code, id), attempts: 0,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), createdAt: iso(),
  });

  const settings = (await db().collection("callSettings").doc(phone).get()).data();
  const language: CallLanguage = settings?.language === "en" ? "en" : "hi";
  const spoken = code.split("").join(" ");
  const script =
    language === "hi"
      ? `नमस्ते। यह पर्चा की ओर से कॉल है। ${name.split(" ")[0]} के फ़ोन की पुष्टि के लिए आपका कोड है: ${spoken}। दोबारा: ${spoken}। धन्यवाद।`
      : `Hello, this is Parcha. To confirm this phone for ${name.split(" ")[0]}, your code is ${spoken}. Again, ${spoken}. Thank you.`;
  const { date, time } = indiaNow();
  await startCall({
    id: `${phone}__verify__${Date.now()}`, ownerPhone: phone, toNumber: number, purpose: "verify", date, time, attempt: 1, doses: [], script, language,
    status: "queued", outcome: null, provider: provider().name, providerCallId: null, retryAt: null, createdAt: iso(), updatedAt: iso(),
  });
  // On the demo phone line nobody can answer, so the code is shown. Never with a real provider.
  return { ok: true, demoCode: provider().name === "mock" ? code : undefined };
});

export const confirmCallNumber = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`confirmcall:${phone}`, 20, 3600);
  const name = requireString(request.data?.name, "Name", 60);
  const code = requireString(request.data?.code, "Code", 8);
  const id = profileId(phone, name);
  const ref = db().collection("callVerifications").doc(id);
  const snap = await ref.get();
  const v = snap.data();
  if (!snap.exists || v?.ownerPhone !== phone) throw new HttpsError("failed-precondition", "Ask for a code first.");
  if (new Date(v.expiresAt).getTime() < Date.now()) throw new HttpsError("failed-precondition", "That code has expired. Ask for a new one.");
  if ((v.attempts ?? 0) >= 5) throw new HttpsError("resource-exhausted", "Too many wrong codes. Ask for a new one.");
  const ok = (() => {
    const a = Buffer.from(codeHash(code, id));
    const b = Buffer.from(String(v.codeHash));
    return a.length === b.length && timingSafeEqual(a, b);
  })();
  if (!ok) {
    await ref.update({ attempts: (v.attempts ?? 0) + 1 });
    throw new HttpsError("invalid-argument", "That is not the right code.");
  }
  const profile = db().collection("profiles").doc(id);
  const existing = await profile.get();
  await profile.set(
    {
      ownerPhone: phone, name, callNumber: v.number, callNumberVerified: true,
      ...(existing.exists ? {} : { nickname: null, ageYears: null, sex: null, look: {}, needsHelp: false, helperName: null, helperNumber: null }),
      updatedAt: iso(),
    },
    { merge: true },
  );
  await ref.delete();
  return { ok: true };
});

/** Calls for this person go back to the account's own number. */
export const clearCallNumber = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const name = requireString(request.data?.name, "Name", 60);
  const profile = db().collection("profiles").doc(profileId(phone, name));
  const snap = await profile.get();
  if (snap.exists && snap.data()?.ownerPhone === phone) {
    await profile.update({ callNumber: null, callNumberVerified: false, updatedAt: iso() });
  }
  return { ok: true };
});
