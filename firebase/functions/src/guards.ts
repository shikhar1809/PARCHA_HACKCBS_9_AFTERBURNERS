/**
 * Who is calling, and may they.
 *
 * Every callable in this codebase starts here. The security rules deny all
 * client writes, so these checks are the only thing standing between a
 * caller and the database — which is the point: they run where a client
 * cannot skip them, unlike the same checks in a screen.
 */
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

import { abilitiesFromClaims, countersFor, type Ability } from "../../../packages/core/src/seats.js";
import type {
  AccountType,
  StaffRole,
} from "../../../packages/core/src/types.js";

export const db = () => getFirestore();

export type Caller = {
  uid: string;
  displayName: string;
  accountType: AccountType;
  counters: StaffRole[];
  /** What this person's seat lets them do (seats.ts). From the token's claims. */
  abilities: Ability[];
  /** The seat's name ("Front desk", "Triage nurse"), for the activity log. Null before a seat. */
  seatName: string | null;
  /** Holds the Manage ability. Set by the Admin SDK as a custom claim. Never by a client. */
  admin: boolean;
  /**
   * The hospital this account works at, also a claim. Every read and write a
   * caller makes is confined to it: a hospital is a wall, and nothing a
   * request says can move a caller to the other side.
   */
  hospitalId: string;
};

/** The signed-in staff member, or a thrown error. */
export function requireStaff(request: CallableRequest): Caller {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }

  const accountType: unknown = auth.token.accountType;
  if (accountType !== "staff" && accountType !== "doctor") {
    throw new HttpsError(
      "permission-denied",
      "This account is not a clinic account.",
    );
  }

  const hospitalId: unknown = auth.token.hospitalId;
  if (typeof hospitalId !== "string" || hospitalId === "") {
    throw new HttpsError(
      "permission-denied",
      "This account is not attached to a hospital.",
    );
  }

  return {
    uid: auth.uid,
    hospitalId,
    displayName:
      (auth.token.name as string | undefined) ??
      (auth.token.displayName as string | undefined) ??
      "Clinic staff",
    accountType,
    ...(() => {
      const abilities = abilitiesFromClaims(auth.token as Record<string, unknown>);
      return {
        abilities,
        counters: countersFor(abilities),
        admin: abilities.includes("manage"),
        seatName: typeof auth.token.seatName === "string" ? auth.token.seatName : null,
      };
    })(),
  };
}

/** Refuses a caller whose seat does not have this ability. */
export function assertAbility(caller: Pick<Caller, "abilities">, ability: Ability): void {
  if (!caller.abilities.includes(ability)) {
    const what: Record<Ability, string> = {
      register: "register patients",
      vitals: "take vitals",
      consult: "consult",
      dispense: "dispense medicines",
      billing: "bill visits",
      activity: "read the activity log",
      manage: "manage the clinic",
    };
    throw new HttpsError("permission-denied", `Your seat cannot ${what[ability]}. Someone who manages the clinic can change that.`);
  }
}

/** The signed-in admin, or a thrown error. Managing the team is theirs alone. */
export function requireAdmin(request: CallableRequest): Caller {
  const caller = requireStaff(request);
  if (!caller.admin) {
    throw new HttpsError(
      "permission-denied",
      "Only someone whose seat can manage the clinic can change who is on the team and how they are connected.",
    );
  }
  return caller;
}

/**
 * Asserts the caller may act at a given counter.
 *
 * Counters, not account types, because the audit trail records the counter
 * and the stage guard keys on it. One person working both the desk and the
 * consulting room is ordinary; "the desk passed this patient on"
 * still has to be answerable afterwards.
 */
export function requireCounter(
  request: CallableRequest,
  counter: StaffRole,
): Caller {
  const caller = requireStaff(request);
  if (!caller.counters.includes(counter)) {
    throw new HttpsError(
      "permission-denied",
      `A ${caller.accountType} account cannot act at the ${counter} counter.`,
    );
  }
  return caller;
}

/** The signed-in patient's phone number in E.164, or a thrown error. */
export function requirePatientPhone(request: CallableRequest): string {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");

  const phone = auth.token.phone_number as string | undefined;
  if (!phone) {
    throw new HttpsError(
      "permission-denied",
      "This account has no phone number attached.",
    );
  }
  return phone;
}

/** Records store ten digits; Firebase Auth stores E.164. */
export function tenDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/**
 * Ids a device makes up while it has no connection (`c_` and letters or digits).
 * The server honours one only if nothing else has it, so a made-up id can name a
 * new record but can never take over an existing one.
 */
export const CLIENT_ID = /^c_[a-z0-9]{8,40}$/;

/**
 * Makes an action safe to send twice.
 *
 * A device that was offline sends its saved actions when the connection returns,
 * and a connection that dies mid-reply makes it send one again that the server
 * had already done. The device names each action once (`opId`); the first time
 * the server sees that name it does the work and keeps the answer, and every
 * later time it hands back the same answer without doing anything. Errors are
 * not kept: an action that was refused is refused again, for the same reason.
 *
 * Without an `opId` (an ordinary online tap) the work simply runs.
 */
export async function once<T extends object>(request: CallableRequest, work: () => Promise<T>): Promise<T> {
  const opId = request.data?.opId;
  const uid = request.auth?.uid;
  if (typeof opId !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(opId) || !uid) return work();
  const ref = db().collection("opLog").doc(`${uid}__${opId}`);
  const prior = await ref.get();
  if (prior.exists) return prior.data()!.result as T;
  const result = await work();
  await ref.set({ at: FieldValue.serverTimestamp(), result });
  return result;
}

/** No free-text field in this product needs more than this; longer is abuse or a bug. */
export const MAX_TEXT = 500;

export function requireString(
  value: unknown,
  field: string,
  max: number = MAX_TEXT,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  if (value.length > max) {
    throw new HttpsError(
      "invalid-argument",
      `${field} is too long (${max} characters at most).`,
    );
  }
  return value.trim();
}

/**
 * Insists the caller proved who they are recently, for the few actions that
 * must not be done from a tablet somebody else picked up. `auth_time` is when
 * the password was last typed, and only the Auth service can set it.
 */
export const RECENT_SIGN_IN = "RECENT_SIGN_IN";

export function requireRecentSignIn(
  request: CallableRequest,
  maxAgeSeconds = 300,
): void {
  const at = Number(request.auth?.token.auth_time ?? 0);
  if (!at || Date.now() / 1000 - at > maxAgeSeconds) {
    // The code is the contract with the screen, which answers it by asking for
    // the password again and retrying.
    throw new HttpsError(
      "failed-precondition",
      `${RECENT_SIGN_IN}: please confirm your password to do this.`,
    );
  }
}

/**
 * A fixed-window limit per key, kept in Firestore so it holds across every
 * instance of every function. A key is a person or a phone number, so the
 * documents are spread out and none of them is hot.
 *
 * It is a brake on abuse and runaway clients, not a quota: the numbers are
 * far above anything a person does by hand.
 */
export async function rateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  const ref = db().collection("rateLimits").doc(key.replace(/[/s]/g, "_"));
  const now = Date.now();
  const allowed = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data() as { count: number; windowStart: Timestamp } | undefined;
    if (!d || now - d.windowStart.toMillis() > windowSeconds * 1000) {
      tx.set(ref, { count: 1, windowStart: Timestamp.fromMillis(now) });
      return true;
    }
    if (d.count >= max) return false;
    tx.update(ref, { count: d.count + 1 });
    return true;
  });
  if (!allowed) {
    throw new HttpsError(
      "resource-exhausted",
      "That was a lot of requests in a short time. Please wait a minute and try again.",
    );
  }
}

/**
 * A record that somebody did something sensitive. Written by the server only
 * (the rules deny every client read and write on `audit`), and never edited.
 */
export async function audit(
  caller: Pick<Caller, "uid" | "displayName" | "hospitalId">,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db().collection("audit").add({
    at: FieldValue.serverTimestamp(),
    action,
    uid: caller.uid,
    name: caller.displayName,
    hospitalId: caller.hospitalId,
    ...detail,
  });
}

export function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
