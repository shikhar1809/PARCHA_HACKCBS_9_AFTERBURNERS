/**
 * Signs the prescription that goes into the printed parcha's QR
 * (packages/core/src/rxToken.ts explains the format).
 *
 * The key is RX_SIGNING_KEY (PKCS#8, base64) from the functions' env file,
 * never committed. Without it a prescription is still signed and printed; its
 * QR simply carries the share link instead, so a missing key never blocks a
 * doctor.
 *
 * On the emulator with no key (CI, or a fresh checkout) a throwaway key is
 * made for that run, so signing is still exercised end to end. Its QRs do not
 * verify in the apps, which only trust the real key's public half; nothing
 * outside the emulator ever uses it.
 */
import { createPrivateKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import { b64url, RX_LINK, type RxPayload } from "../../../packages/core/src/rxToken.js";

let key: KeyObject | null | undefined;
function signingKey(): KeyObject | null {
  if (key === undefined) {
    const raw = process.env.RX_SIGNING_KEY;
    key = raw
      ? createPrivateKey({ key: Buffer.from(raw, "base64"), format: "der", type: "pkcs8" })
      : process.env.FUNCTIONS_EMULATOR === "true"
        ? generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey
        : null;
  }
  return key;
}

/** The QR's text for this prescription, or null when no key is configured. */
export function signRx(payload: RxPayload): string | null {
  const k = signingKey();
  if (!k) return null;
  const body = deflateRawSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });
  const sig = sign("sha256", body, { key: k, dsaEncoding: "ieee-p1363" });
  return `${RX_LINK}${b64url(new Uint8Array(body))}.${b64url(new Uint8Array(sig))}`;
}
