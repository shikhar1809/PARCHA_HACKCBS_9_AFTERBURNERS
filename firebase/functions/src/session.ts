/**
 * Clinic sessions, and the activity log.
 *
 * A staff device opens a session before it shows anything: the server records
 * the internet address it sees (which the device cannot choose) and the place
 * the device reports. The device checks in every minute and whenever it moves.
 * If the address changes, or the device moves away, or it stops sharing its
 * location, the session ends at once: the account's refresh tokens are revoked,
 * the security rules stop answering its reads (they require an active session),
 * and every staff function refuses it. Signing in again starts a new session.
 *
 * What it cannot do: a location is what the device says, and a determined
 * person can fake one. The address is the part the server sees for itself.
 *
 * The activity log is the other half: every action a doctor might need to
 * account for, written as a sentence a person can read, with when, from which
 * address, and where.
 */
import { randomBytes } from "node:crypto";

import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import { COL } from "../../../packages/core/src/paths.js";
import { cleanSessionRules, DEFAULT_SESSION_RULES, type SessionRules } from "../../../packages/core/src/seats.js";
import {
  deviceName,
  judgeAddress,
  movedTooFar,
  placeText,
} from "../../../packages/core/src/session.js";
import { db, rateLimit, requireAdmin, requireCounter, requireStaff, type Caller } from "./guards.js";
import type { StaffRole } from "../../../packages/core/src/types.js";

export const SESSION_ENDED = "SESSION_ENDED";

type SessionDoc = {
  uid: string;
  hospitalId: string;
  sessionId: string;
  active: boolean;
  startedAt: Timestamp;
  lastBeatAt: Timestamp;
  ips: string[];
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  device: string;
  endedAt: Timestamp | null;
  endReason: string | null;
};

/**
 * The address the request came from, as Google's front end saw it. That front
 * end APPENDS the real address to X-Forwarded-For, after anything the client
 * sent itself, so only the last entry can be trusted; the first can be forged.
 */
export function clientIp(request: CallableRequest): string {
  const raw = request.rawRequest;
  const forwarded = String(raw.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (forwarded.at(-1) || raw.ip || "unknown").replace(/^::ffff:/, "");
}

type Who = Pick<Caller, "displayName" | "accountType"> & { seatName?: string | null };

/** The seat, in lower case ("triage nurse"); for accounts from before seats, "doctor" or "front desk". */
const roleOf = (c: Who) => (c.seatName ? c.seatName.toLowerCase() : c.accountType === "doctor" ? "doctor" : "front desk");

/**
 * How a person is named in the log: "Dr. A. Khan" and "Rekha (front desk)" stay
 * as they are; otherwise the seat is added, "Grace" becomes "Grace (triage nurse)".
 */
export const actorLabel = (c: Who) => {
  if (/\(/.test(c.displayName) || /^dr\.?\s/i.test(c.displayName)) return c.displayName;
  if (c.seatName) return `${c.displayName} (${c.seatName.toLowerCase()})`;
  return c.accountType === "doctor" ? c.displayName : `${c.displayName} (front desk)`;
};

const hospitalCache = new Map<string, { lat: number; lng: number } | null>();
async function hospitalAt(hospitalId: string) {
  if (!hospitalCache.has(hospitalId)) {
    const h = (await db().collection(COL.hospitals).doc(hospitalId).get()).data();
    hospitalCache.set(hospitalId, h && typeof h.lat === "number" ? { lat: h.lat, lng: h.lng } : null);
  }
  return hospitalCache.get(hospitalId) ?? null;
}

/**
 * The example set-ups (the seeded hospitals and each "Custom" clinic) open
 * without a location, so a laptop that blocks it can still see the product.
 * The address is still pinned and logged; real clinics keep the location lock.
 */
/**
 * The example set-ups are shared: everyone who taps "Large hospital" signs in
 * as the same account, from their own computer. So there the session rules
 * are relaxed: a missing location is allowed, and opening from another
 * address or device does not end anyone's session. Real clinics keep the
 * one-place rule. Remembered for a minute, as most clinical calls ask.
 */
const exampleCache = new Map<string, { value: boolean; at: number }>();
async function isExample(hospitalId: string) {
  const hit = exampleCache.get(hospitalId);
  if (hit && Date.now() - hit.at < 60_000 && process.env.FUNCTIONS_EMULATOR !== "true") return hit.value;
  const h = (await db().collection(COL.hospitals).doc(hospitalId).get()).data();
  const value = h?.example === true || h?.sandbox === true;
  exampleCache.set(hospitalId, { value, at: Date.now() });
  return value;
}

/**
 * Writes one line of the activity log. Never throws: a log that failed to write
 * must not undo the clinical action it describes (that action is also in the
 * append-only records).
 */
export async function logActivity(
  caller: Pick<Caller, "uid" | "displayName" | "accountType" | "hospitalId"> & { seatName?: string | null },
  kind: string,
  text: string,
  extra: { patientId?: string | null; visitId?: string | null; request?: CallableRequest; place?: string | null } = {},
): Promise<void> {
  try {
    let place = extra.place ?? null;
    if (place === null && extra.request) {
      const s = (await db().collection(COL.staffSessions).doc(caller.uid).get()).data() as SessionDoc | undefined;
      if (s) place = placeText(await hospitalAt(caller.hospitalId), s);
    }
    await db().collection(COL.activity).add({
      hospitalId: caller.hospitalId,
      at: FieldValue.serverTimestamp(),
      actorUid: caller.uid,
      actorName: caller.displayName,
      actorRole: caller.uid === "system" ? "system" : roleOf(caller),
      kind,
      text,
      patientId: extra.patientId ?? null,
      visitId: extra.visitId ?? null,
      ip: extra.request ? clientIp(extra.request) : null,
      place,
    });
  } catch (e) {
    console.error("[activity] could not write", kind, e);
  }
}

async function endSession(caller: Caller, s: SessionDoc, reason: string, request: CallableRequest, logText: string, where?: { lat: number; lng: number }) {
  await db().collection(COL.staffSessions).doc(caller.uid).update({
    active: false,
    endedAt: FieldValue.serverTimestamp(),
    endReason: reason,
  });
  // The refresh token is what keeps a browser signed in; without it the
  // current token lapses within the hour and cannot be renewed.
  await getAuth().revokeRefreshTokens(caller.uid).catch(() => undefined);
  await logActivity(caller, "session.ended", logText, { request, place: placeText(await hospitalAt(caller.hospitalId), where ?? s) });
}

/** The clinic's own session rules (set on the Manage page). Cached for a minute per instance. */
const rulesCache = new Map<string, { at: number; rules: SessionRules }>();
export async function sessionRulesFor(hospitalId: string): Promise<SessionRules> {
  const hit = rulesCache.get(hospitalId);
  if (hit && Date.now() - hit.at < 60_000) return hit.rules;
  const p = (await db().collection("hospitalPrivate").doc(hospitalId).get()).data();
  const rules = p?.sessionRules ? cleanSessionRules(p.sessionRules) : DEFAULT_SESSION_RULES;
  rulesCache.set(hospitalId, { at: Date.now(), rules });
  return rules;
}
export const forgetSessionRules = (hospitalId: string) => void rulesCache.delete(hospitalId);

/**
 * The address verdict under this clinic's rules. A clinic may choose to allow
 * address changes: then a new address is learned (and logged) instead of
 * ending the session.
 */
async function judge(caller: Caller, s: SessionDoc, ip: string, request: CallableRequest): Promise<"same" | "learn" | "changed"> {
  const verdict = judgeAddress(s.ips, ip, Date.now() - s.startedAt.toMillis());
  if (verdict !== "changed") return verdict;
  if ((await sessionRulesFor(caller.hospitalId)).endOnIpChange) return "changed";
  await logActivity(caller, "session.address_changed", `${actorLabel(caller)}'s device changed internet address from ${s.ips.join(" / ")} to ${ip}. The clinic's settings allow this, so the session carried on.`, { request });
  return "learn";
}

const ended = (reason: string) => new HttpsError("unauthenticated", `${SESSION_ENDED}: ${reason}`);

function readLocation(data: unknown) {
  const d = (data ?? {}) as { lat?: unknown; lng?: unknown; accuracy?: unknown };
  const lat = Number(d.lat);
  const lng = Number(d.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const acc = Number(d.accuracy);
  return { lat, lng, accuracyM: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null };
}

/**
 * Opens a session (or resumes the open one on a reload from the same place).
 * Without a location the app does not open.
 */
export const startStaffSession = onCall(async (request) => {
  const caller = requireStaff(request);
  await rateLimit(`session:${caller.uid}`, 120, 3600);
  const at = readLocation(request.data);
  if (!at && !(await isExample(caller.hospitalId))) {
    throw new HttpsError("failed-precondition", "LOCATION_NEEDED: Parcha needs this device's location before it opens.");
  }
  const ip = clientIp(request);
  const ref = db().collection(COL.staffSessions).doc(caller.uid);
  const s = (await ref.get()).data() as SessionDoc | undefined;
  const hospital = await hospitalAt(caller.hospitalId);
  const device = deviceName(String(request.rawRequest.headers["user-agent"] ?? ""));

  if (await isExample(caller.hospitalId)) {
    const sessionId = randomBytes(12).toString("hex");
    await ref.set(
      {
        uid: caller.uid,
        hospitalId: caller.hospitalId,
        sessionId,
        active: true,
        startedAt: FieldValue.serverTimestamp(),
        lastBeatAt: FieldValue.serverTimestamp(),
        ips: FieldValue.arrayUnion(ip),
        lat: at?.lat ?? null,
        lng: at?.lng ?? null,
        accuracyM: at?.accuracyM ?? null,
        device,
        endedAt: null,
        endReason: null,
      },
      { merge: true },
    );
    await logActivity(caller, "session.started", `${actorLabel(caller)} opened Parcha on ${device}${at ? "" : " without sharing a location"}.`, {
      request,
      place: at ? placeText(hospital, at) : null,
    });
    return { sessionId, resumed: false };
  }

  if (s?.active) {
    const address = await judge(caller, s, ip, request);
    const limit = (await sessionRulesFor(caller.hospitalId)).moveLimitM;
    const moved = at != null && s.lat != null && s.lng != null && movedTooFar({ lat: s.lat, lng: s.lng }, at, limit);
    if (address !== "changed" && !moved) {
      await ref.update({
        lastBeatAt: FieldValue.serverTimestamp(),
        ...(address === "learn" ? { ips: FieldValue.arrayUnion(ip) } : {}),
      });
      return { sessionId: s.sessionId, resumed: true };
    }
    // Opened again from somewhere else while the first is still open: the first ends.
    const why = address === "changed" ? `it was opened again from a different internet address (${ip})` : "it was opened again from a different place";
    await endSession(caller, s, `Your session ended because ${why}. Sign in again.`, request, `${actorLabel(caller)} was signed out because ${why}.`);
    throw ended(`Your session ended because ${why}. Sign in again.`);
  }

  // A session that ended needs a fresh sign-in, not just a still-valid token.
  const signedInAt = Number(request.auth?.token.auth_time ?? 0) * 1000;
  if (s?.endedAt && signedInAt <= s.endedAt.toMillis()) {
    throw ended(s.endReason ?? "Your session has ended. Sign in again.");
  }

  const sessionId = randomBytes(12).toString("hex");
  await ref.set({
    uid: caller.uid,
    hospitalId: caller.hospitalId,
    sessionId,
    active: true,
    startedAt: FieldValue.serverTimestamp(),
    lastBeatAt: FieldValue.serverTimestamp(),
    ips: [ip],
    lat: at?.lat ?? null,
    lng: at?.lng ?? null,
    accuracyM: at?.accuracyM ?? null,
    device,
    endedAt: null,
    endReason: null,
  });
  await logActivity(caller, "session.started", `${actorLabel(caller)} opened Parcha on ${device}${at ? "" : " without sharing a location"}.`, {
    request,
    place: at ? placeText(hospital, at) : null,
  });
  return { sessionId, resumed: false };
});

/**
 * The minute check-in. Ends the session if the address changed, the device
 * moved away, or it stopped sharing its location.
 */
export const sessionBeat = onCall(async (request) => {
  const caller = requireStaff(request);
  await rateLimit(`beat:${caller.uid}`, 600, 3600);
  const ref = db().collection(COL.staffSessions).doc(caller.uid);
  const s = (await ref.get()).data() as SessionDoc | undefined;
  const sessionId = String((request.data as { sessionId?: unknown } | undefined)?.sessionId ?? "");
  if (await isExample(caller.hospitalId)) {
    await ref.set({ active: true, lastBeatAt: FieldValue.serverTimestamp(), endedAt: null, endReason: null }, { merge: true });
    return { ended: false };
  }
  if (!s?.active || s.sessionId !== sessionId) {
    return { ended: true, reason: s?.endReason ?? "This session has ended. Sign in again." };
  }

  const ip = clientIp(request);
  const address = await judge(caller, s, ip, request);
  if (address === "changed") {
    const reason = "Your session ended because this device's internet address changed. Sign in again.";
    await endSession(caller, s, reason, request, `${actorLabel(caller)} was signed out because the device's internet address changed from ${s.ips.join(" / ")} to ${ip}.`);
    return { ended: true, reason };
  }

  const at = readLocation(request.data);
  if (!at && (await isExample(caller.hospitalId))) {
    await ref.update({
      lastBeatAt: FieldValue.serverTimestamp(),
      ...(address === "learn" ? { ips: FieldValue.arrayUnion(ip) } : {}),
    });
    return { ended: false };
  }
  if (!at) {
    const reason = "Your session ended because this device stopped sharing its location. Sign in again.";
    await endSession(caller, s, reason, request, `${actorLabel(caller)} was signed out because the device stopped sharing its location.`);
    return { ended: true, reason };
  }
  const limit = (await sessionRulesFor(caller.hospitalId)).moveLimitM;
  if (s.lat != null && s.lng != null && movedTooFar({ lat: s.lat, lng: s.lng }, at, limit)) {
    const hospital = await hospitalAt(caller.hospitalId);
    const reason = "Your session ended because this device moved away from where it was opened. Sign in again.";
    await endSession(caller, s, reason, request, `${actorLabel(caller)} was signed out because the device moved away from where it was opened (now ${placeText(hospital, at).toLowerCase()}).`, at);
    return { ended: true, reason };
  }

  await ref.update({
    lastBeatAt: FieldValue.serverTimestamp(),
    ...(address === "learn" ? { ips: FieldValue.arrayUnion(ip) } : {}),
  });
  return { ended: false };
});

/** Signing out closes the session, so the log shows the person left. */
export const endStaffSession = onCall(async (request) => {
  const caller = requireStaff(request);
  const ref = db().collection(COL.staffSessions).doc(caller.uid);
  const s = (await ref.get()).data() as SessionDoc | undefined;
  if (s?.active && (await isExample(caller.hospitalId))) {
    await logActivity(caller, "session.signed_out", `${actorLabel(caller)} signed out.`, { request });
    return { ok: true };
  }
  if (s?.active) {
    await ref.update({ active: false, endedAt: FieldValue.serverTimestamp(), endReason: "Signed out." });
    await logActivity(caller, "session.signed_out", `${actorLabel(caller)} signed out.`, { request });
  }
  return { ok: true };
});

/**
 * The staff checks every clinical function uses: the usual role checks, and
 * then an open session from the same address. One read per call.
 */
async function liveSession(request: CallableRequest, caller: Caller): Promise<Caller> {
  const s = (await db().collection(COL.staffSessions).doc(caller.uid).get()).data() as SessionDoc | undefined;
  if (!s?.active) throw ended(s?.endReason ?? "Open Parcha again to start a session.");
  if (await isExample(caller.hospitalId)) return caller;
  const ip = clientIp(request);
  const address = await judge(caller, s, ip, request);
  if (address === "changed") {
    const reason = "Your session ended because this device's internet address changed. Sign in again.";
    await endSession(caller, s, reason, request, `${actorLabel(caller)} was signed out because the device's internet address changed from ${s.ips.join(" / ")} to ${ip}.`);
    throw ended(reason);
  }
  if (address === "learn") await db().collection(COL.staffSessions).doc(caller.uid).update({ ips: FieldValue.arrayUnion(ip) });
  return caller;
}

export const liveStaff = (request: CallableRequest) => liveSession(request, requireStaff(request));
export const liveCounter = (request: CallableRequest, counter: StaffRole) => liveSession(request, requireCounter(request, counter));
export const liveAdmin = (request: CallableRequest) => liveSession(request, requireAdmin(request));

/** "Thu 23 Oct, 10:30 am" in the clinic's time zone. */
export const whenText = (t: { toDate(): Date } | Date) =>
  ("toDate" in t ? t.toDate() : t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Logs an action on a visit, naming the patient: `say` gets their name. */
export async function logVisit(
  caller: Caller,
  request: CallableRequest,
  visitId: string,
  kind: string,
  say: (patientName: string) => string,
): Promise<void> {
  const v = (await db().collection("visits").doc(visitId).get()).data() as { patientName?: string; patientId?: string } | undefined;
  await logActivity(caller, kind, say(v?.patientName ?? "a patient"), { patientId: v?.patientId ?? null, visitId, request });
}
