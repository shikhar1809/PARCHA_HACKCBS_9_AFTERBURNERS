/**
 * Reading the QR on a printed parcha, on the phone, with no network.
 *
 * The QR holds the whole prescription, compressed and signed by the hospital's
 * server (packages/core/src/rxToken.ts). This checks the signature against
 * Parcha's public key before anything is shown: a QR that was not made by
 * Parcha, or was changed after the doctor signed, is refused.
 */
import { RX_LINK, RX_PUBLIC_KEY, fromB64url, type RxPayload } from "@parcha/core";

export type RxRead =
  | { ok: true; payload: RxPayload; token: string }
  | { ok: false; reason: "not-parcha" | "forged" | "damaged" };

let key: Promise<CryptoKey> | null = null;
const publicKey = () =>
  (key ??= crypto.subtle.importKey(
    "spki",
    Uint8Array.from(atob(RX_PUBLIC_KEY), (c) => c.charCodeAt(0)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  ));

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** The token from what a scanner read: the link, the part after "#", or the token itself. */
export function rxTokenFrom(text: string): string | null {
  const t = text.trim();
  if (t.startsWith(RX_LINK)) return t.slice(RX_LINK.length);
  const hash = t.indexOf("#");
  if (hash >= 0 && /\/rx#/.test(t)) return t.slice(hash + 1);
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t) ? t : null;
}

export async function readRx(text: string): Promise<RxRead> {
  const token = rxTokenFrom(text);
  if (!token) return { ok: false, reason: "not-parcha" };
  const [body, sig] = token.split(".");
  try {
    const bytes = fromB64url(body);
    const genuine = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await publicKey(), fromB64url(sig), bytes);
    if (!genuine) return { ok: false, reason: "forged" };
    const payload = JSON.parse(await inflate(bytes)) as RxPayload;
    if (payload.v !== 1 || !Array.isArray(payload.m)) return { ok: false, reason: "damaged" };
    return { ok: true, payload, token };
  } catch {
    return { ok: false, reason: "damaged" };
  }
}
