/**
 * Locking a history with a PIN, on whichever phone is holding it.
 *
 * The family's phone locks; the doctor's phone unlocks. Nothing in between
 * sees the key, because the key is never sent: both ends work it out from the
 * PIN the family read out loud and the salt that travels with the ciphertext.
 * The server stores what it is given and can say nothing about it.
 *
 *   key        = PBKDF2-SHA256(PIN + "@" + username, salt, 310k) -> AES-256-GCM
 *   ciphertext = AES-GCM(key, iv, JSON of the history)
 *
 * The username is mixed into the key so the same PIN on two shares does not
 * give the same key. The iteration count is the cost a wrong guess pays, and
 * it is the only thing standing between ten thousand possible PINs and the
 * ciphertext — which is why the server also counts attempts and the share
 * expires. Said plainly in `share.ts`: the window and the cap are the real
 * protection, not the arithmetic.
 *
 * Runs in a browser, in the Android app and in Node, all of which have Web
 * Crypto; nothing here is specific to one of them.
 */
import type { HistoryPayload } from "./historyToken.js";
import { b64url, fromB64url } from "./rxToken.js";

const ITERATIONS = 310_000;

// The key type is left to inference: this file is compiled both with the DOM
// library (the apps) and without it (the functions), and only one of those
// knows the name `CryptoKey`.
async function keyFromPin(pin: string, username: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${pin}@${username}`),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.slice().buffer as ArrayBuffer, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Locks a history for one share. New salt and nonce every time. */
export async function lockHistory(
  payload: HistoryPayload,
  pin: string,
  username: string,
): Promise<{ blob: string; salt: string; iv: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromPin(pin, username, salt);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.slice().buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return { blob: b64url(new Uint8Array(sealed)), salt: b64url(salt), iv: b64url(iv) };
}

/**
 * Opens one, or returns null when the PIN is wrong. AES-GCM refuses to decrypt
 * under the wrong key rather than handing back rubbish, so a wrong PIN is a
 * clean no — there is no half-read history to show anybody.
 */
export async function unlockHistory(
  sealed: { blob: string; salt: string; iv: string },
  pin: string,
  username: string,
): Promise<HistoryPayload | null> {
  try {
    const key = await keyFromPin(pin, username, fromB64url(sealed.salt));
    const open = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(sealed.iv).slice().buffer as ArrayBuffer },
      key,
      fromB64url(sealed.blob).slice().buffer as ArrayBuffer,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(open));
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as HistoryPayload;
    return p.v === 1 && Array.isArray(p.m) && Array.isArray(p.p) ? p : null;
  } catch {
    return null;
  }
}
