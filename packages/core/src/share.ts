/**
 * The fifteen minutes a family gives a doctor.
 *
 * A doctor opens `parcha.web.app/prashant`, is asked for a PIN, and reads the
 * history until the window closes or the family taps Revoke. Four things have
 * to be true at once for that — a name a doctor can type, a PIN, an expiry,
 * and a revoke that reaches a page already handed over — and the last two are
 * why this cannot live only on the phone. A phone cannot reach into a page on
 * somebody else's handset and take it back; something both of them can see
 * has to hold the answer.
 *
 * So the arrangement is this, and the limits are written down rather than
 * dressed up:
 *
 *   - What is shared is encrypted ON THE PHONE with a key worked out from the
 *     PIN. The server is handed ciphertext, a name and a time, and never the
 *     PIN or the key.
 *   - The server's job is only to say yes or no: is this name live, has the
 *     window closed, has it been revoked, and have too many PINs been tried.
 *     Five wrong PINs close the share.
 *   - It deletes itself after fifteen minutes. Revoke deletes it now.
 *
 * What this is NOT: a four-digit PIN is not a password, and a server holding
 * the ciphertext could, with effort, work through ten thousand of them. The
 * protections that actually count here are the short window, the attempt cap
 * and the revoke — not the arithmetic. The screens say so in those words, and
 * the QR in `historyToken.ts` remains the way to hand a history over with no
 * server in the path at all, when the family would rather do that.
 */

/** How long a share lives once it is made. */
export const SHARE_MINUTES = 15;

/** How many wrong PINs close a share for good. */
export const SHARE_MAX_ATTEMPTS = 5;

/** A PIN is four digits, the same as the helper PIN on the phone. */
export const SHARE_PIN_LENGTH = 4;

/** The most a shared, encrypted summary may weigh (base64), so one cannot be used as storage. */
export const SHARE_MAX_BYTES = 128 * 1024;

export const SHARE_LINK = "https://parcha.web.app/";

/**
 * The name in the link, made from the person's own name: lower case, letters
 * and digits, words joined by a dash. "Prabha Devi" becomes `prabha-devi`,
 * which is a thing a doctor can read off a screen and type.
 */
export function shareUsername(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return slug || "parcha";
}

/** Names the server keeps for itself, so a share can never shadow a screen. */
export const RESERVED_USERNAMES = new Set([
  "ask", "me", "records", "schedule", "start", "scan", "rx", "check", "history",
  "link", "book", "visit", "visits", "parcha", "admin", "api", "app", "clinic",
  "doctor", "login", "signin", "sign-in", "privacy", "terms", "help", "about",
]);

/** Whether a name could be a share's. The server decides if it is free. */
export function usableUsername(username: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,27}$/.test(username) && !RESERVED_USERNAMES.has(username);
}

/** The next name to try when one is taken: `prashant`, `prashant-2`, `prashant-3`… */
export function nextUsername(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`.slice(0, 30);
}

/** What the phone sends up. The summary itself is already encrypted. */
export type ShareUpload = {
  /** Who it is about, as the family's own phone names them. */
  person: string;
  /** base64url of the AES-GCM ciphertext of a HistoryPayload. */
  blob: string;
  /** base64url, 16 bytes: the salt the PIN key was worked out with. */
  salt: string;
  /** base64url, 12 bytes: the AES-GCM nonce. */
  iv: string;
};

/** What a doctor's phone is given once the PIN is right. */
export type ShareBlob = Pick<ShareUpload, "blob" | "salt" | "iv"> & { person: string; expiresAt: string };

/** How a share stands, for the family's own screen. */
export type ShareState = {
  username: string;
  person: string;
  createdAt: string;
  expiresAt: string;
  /** Wrong PINs tried so far. */
  attempts: number;
  /** Whether the doctor has opened it. */
  opened: boolean;
};

export const shareExpiry = (from: Date = new Date()): string =>
  new Date(from.getTime() + SHARE_MINUTES * 60_000).toISOString();

/** Seconds left on a share, never below zero. */
export function secondsLeftOnShare(expiresAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000));
}

export const shareIsLive = (expiresAt: string, now: Date = new Date()): boolean =>
  secondsLeftOnShare(expiresAt, now) > 0;

/** `14:59`, for the countdown the family watches. */
export function shareCountdown(expiresAt: string, now: Date = new Date()): string {
  const left = secondsLeftOnShare(expiresAt, now);
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}
