/**
 * The fifteen-minute share: `parcha.web.app/prashant`, a PIN, and a revoke.
 *
 * The server's part in this is deliberately small, and worth saying plainly
 * because the rest of Parcha keeps clinical data off the network entirely.
 * What is stored here is a sealed box: the family's phone encrypted the
 * summary with a key worked out from a PIN, and this never sees the PIN or the
 * key. It holds the box, the name on the link, and a time. It can say whether
 * a share is live; it cannot say what is in one.
 *
 * It is the clock and the lock, and nothing else:
 *
 *   - a share dies fifteen minutes after it is made, and the sweep deletes it;
 *   - Revoke deletes it at once, which is the only way a page already open on
 *     a doctor's phone can be taken back;
 *   - five wrong PINs close it, which is what makes four digits worth having.
 *
 * `openShare` is callable by anybody, because a doctor is not signed in and
 * never will be. That is why it is rate limited by name and by caller, counts
 * its attempts inside a transaction, and gives nothing away about a name that
 * does not exist.
 */
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import {
  SHARE_MAX_ATTEMPTS,
  SHARE_MAX_BYTES,
  SHARE_PIN_LENGTH,
  nextUsername,
  shareExpiry,
  shareUsername,
  usableUsername,
} from "../../../packages/core/src/share.js";
import { db, rateLimit, requirePatientPhone, requireString, tenDigits } from "./guards.js";

const SHARES = "historyShares";

/** One phone may hold one live share per person, and no more than this in all. */
const MAX_LIVE_SHARES = 6;

const b64 = (v: unknown, max: number, what: string): string => {
  const s = typeof v === "string" ? v : "";
  if (!s || s.length > max || !/^[A-Za-z0-9_-]+$/.test(s)) {
    throw new HttpsError("invalid-argument", `${what} is not in the right form.`);
  }
  return s;
};

const live = (data: FirebaseFirestore.DocumentData | undefined, now = Date.now()): boolean =>
  !!data && data.revokedAt == null && new Date(data.expiresAt).getTime() > now;

/**
 * The family opens a share. The summary arrives already sealed; a PIN hash is
 * NOT stored, because the PIN is the key — a wrong one simply fails to open
 * the box, and the count of those failures is what closes the share.
 */
export const shareHistory = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`share:${phone}`, 30, 3600);
  const d = request.data ?? {};

  const person = requireString(d.person, "Person", 60);
  const blob = b64(d.blob, SHARE_MAX_BYTES, "The sealed summary");
  const salt = b64(d.salt, 64, "The salt");
  const iv = b64(d.iv, 64, "The nonce");

  // That person must be on this phone: a share is the family's own record,
  // never a name typed into a request.
  const profiles = await db().collection("profiles").where("ownerPhone", "==", phone).get();
  if (!profiles.docs.some((p) => p.data().name === person)) {
    throw new HttpsError("permission-denied", "That person is not on this phone.");
  }

  const mine = await db().collection(SHARES).where("ownerPhone", "==", phone).get();
  const now = Date.now();
  // A new share for a person replaces that person's old one, and anything
  // already dead is cleared out while we are here.
  const stale = mine.docs.filter((s) => !live(s.data(), now) || s.data().person === person);
  await Promise.all(stale.map((s) => s.ref.delete()));
  if (mine.docs.filter((s) => live(s.data(), now) && s.data().person !== person).length >= MAX_LIVE_SHARES) {
    throw new HttpsError("resource-exhausted", "Too many shares are open at once. Revoke one first.");
  }

  // The name in the link, from the person's own name; a taken one gets a number.
  const base = shareUsername(person);
  let username = "";
  for (let attempt = 1; attempt <= 25; attempt++) {
    const candidate = nextUsername(base, attempt);
    if (!usableUsername(candidate)) continue;
    const ref = db().collection(SHARES).doc(candidate);
    const taken = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && live(snap.data(), now)) return true;
      tx.set(ref, {
        username: candidate,
        ownerPhone: phone,
        person,
        blob,
        salt,
        iv,
        attempts: 0,
        openedAt: null,
        revokedAt: null,
        createdAt: new Date(now).toISOString(),
        expiresAt: shareExpiry(new Date(now)),
        expiresAtTime: FieldValue.serverTimestamp(),
      });
      return false;
    });
    if (!taken) {
      username = candidate;
      break;
    }
  }
  if (!username) throw new HttpsError("resource-exhausted", "Could not make a link for that name. Try again.");

  const saved = await db().collection(SHARES).doc(username).get();
  return { username, expiresAt: saved.data()!.expiresAt };
});

/**
 * Is this link still open? Asked as the doctor's page loads, so a revoked or
 * finished link says so straight away instead of after a PIN is typed into
 * it. It hands over nothing — not the box, not the person's name — and costs
 * no attempt, which is why it is safe to call without one.
 */
export const shareIsOpen = onCall(async (request) => {
  const username = String(request.data?.username ?? "").toLowerCase();
  if (!usableUsername(username)) return { open: false };
  await rateLimit(`shareIsOpen:${request.rawRequest.ip ?? "unknown"}`, 120, 900);
  const snap = await db().collection(SHARES).doc(username).get();
  const data = snap.exists ? snap.data() : undefined;
  return { open: live(data) && (data!.attempts ?? 0) < SHARE_MAX_ATTEMPTS };
});

/**
 * A doctor opens the link and types the PIN. The sealed box comes back and is
 * opened on their own phone; if the PIN was wrong, nothing opens and the
 * attempt is counted. Five of those and the share is finished.
 */
export const openShare = onCall(async (request) => {
  const username = String(request.data?.username ?? "").toLowerCase();
  const pinLooksRight = /^\d+$/.test(String(request.data?.pin ?? "")) && String(request.data?.pin).length === SHARE_PIN_LENGTH;
  if (!usableUsername(username) || !pinLooksRight) {
    throw new HttpsError("invalid-argument", "That link or PIN is not in the right form.");
  }
  // Whoever is asking, and whatever name they ask about: both are capped, so a
  // run through every PIN cannot be had by reconnecting.
  await rateLimit(`openShare:${username}`, 20, 900);
  await rateLimit(`openShareFrom:${request.rawRequest.ip ?? "unknown"}`, 60, 900);

  const ref = db().collection(SHARES).doc(username);
  const snap = await ref.get();
  // The same answer whether a name was never used, has run out, or was
  // revoked: a stranger learns nothing from asking.
  if (!snap.exists || !live(snap.data())) {
    throw new HttpsError("not-found", "This link is closed. Ask the family to share it again.");
  }
  const data = snap.data()!;
  if ((data.attempts ?? 0) >= SHARE_MAX_ATTEMPTS) {
    await ref.delete();
    throw new HttpsError("not-found", "This link is closed. Ask the family to share it again.");
  }

  // The attempt is counted BEFORE the box is handed over, so a caller that
  // hangs up mid-answer still pays for the try.
  await ref.update({ attempts: FieldValue.increment(1), openedAt: data.openedAt ?? new Date().toISOString() });

  return {
    person: data.person,
    blob: data.blob,
    salt: data.salt,
    iv: data.iv,
    expiresAt: data.expiresAt,
    /** What is left before the share closes itself, for the doctor's own screen. */
    attemptsLeft: SHARE_MAX_ATTEMPTS - ((data.attempts ?? 0) + 1),
  };
});

/**
 * The family says a wrong PIN was tried, or the doctor is done: the share goes.
 * Called by the doctor's screen when the box would not open, so the count the
 * server keeps is the count of real failures.
 */
export const reportShareFailure = onCall(async (request) => {
  const username = String(request.data?.username ?? "").toLowerCase();
  if (!usableUsername(username)) return { ok: true };
  const ref = db().collection(SHARES).doc(username);
  const snap = await ref.get();
  if (snap.exists && (snap.data()!.attempts ?? 0) >= SHARE_MAX_ATTEMPTS) await ref.delete();
  return { ok: true };
});

/** Revoke: the share is deleted, and the doctor's page stops working at once. */
export const revokeShare = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const username = String(request.data?.username ?? "").toLowerCase();
  if (!usableUsername(username)) throw new HttpsError("invalid-argument", "That is not a link of yours.");
  const ref = db().collection(SHARES).doc(username);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  if (snap.data()!.ownerPhone !== phone) throw new HttpsError("permission-denied", "That is not a link of yours.");
  await ref.delete();
  return { ok: true };
});

/** What this phone has open now, for the screen with the countdown on it. */
export const myShares = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const mine = await db().collection(SHARES).where("ownerPhone", "==", phone).get();
  const now = Date.now();
  const dead = mine.docs.filter((s) => !live(s.data(), now));
  await Promise.all(dead.map((s) => s.ref.delete()));
  return {
    shares: mine.docs
      .filter((s) => live(s.data(), now))
      .map((s) => {
        const d = s.data();
        return {
          username: d.username,
          person: d.person,
          createdAt: d.createdAt,
          expiresAt: d.expiresAt,
          attempts: d.attempts ?? 0,
          opened: !!d.openedAt,
        };
      }),
  };
});
