/**
 * The history a family hands a doctor, carried in a QR.
 *
 * The same arrangement as the prescription QR (`rxToken.ts`), turned around:
 * the family holds the record, and when a doctor needs to see it they scan it
 * off the phone's screen. The whole summary is compressed into the part of the
 * link after the "#", which a browser never sends to a server, so the doctor's
 * phone renders it with no network and nothing is fetched, logged or stored
 * anywhere. Nothing is uploaded to show it.
 *
 *   token = base64url(deflate-raw(JSON payload))
 *
 * It carries no signature, and that is deliberate rather than an omission:
 * unlike a prescription, nobody signed this. It is what the family wrote down
 * and what their own Parchas say, and the page that shows it says so in those
 * words. A doctor is told the provenance of every line: `certain` marks the
 * medicines that came off a signed Parcha whose QR this phone checked.
 */
import { b64url, fromB64url } from "./rxToken.js";

export const HISTORY_LINK = "https://parcha.web.app/history#";

/** One medicine on the summary, with where it came from. */
export type HistoryMedicine = {
  /** Name, strength, form as the Parcha wrote them. */
  n: string;
  s?: string | null;
  f?: string | null;
  /** How often, and for how many days. */
  q?: string | null;
  d?: number | null;
  /** The day of the Parcha it came from, and who wrote it. */
  on?: string | null;
  by?: string | null;
  /** True only for a signed Parcha this phone verified. */
  ok?: 1;
};

export type HistoryPayload = {
  v: 1;
  /** Made at, ISO. */
  t: string;
  /** Person: name, age, sex. */
  p: [string, number | null, string | null];
  /** Blood group. */
  b?: string | null;
  /** Long-term conditions, allergies, and regular medicines, as the family wrote them. */
  c: string[];
  a: string[];
  r: string[];
  /** Medicines from the Parchas on the phone, newest first. */
  m: HistoryMedicine[];
  /** A note the family added for the doctor. */
  note?: string | null;
};

export const HISTORY_NOTE_MAX = 300;
/** More than this many medicines will not fit a QR a phone camera can read. */
export const HISTORY_MEDICINE_MAX = 24;

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

/** The link to put in the QR, with the whole summary after the "#". */
export async function historyLink(payload: HistoryPayload): Promise<string> {
  return HISTORY_LINK + b64url(await deflate(JSON.stringify(payload)));
}

/** The token out of whatever a scanner read: the link, the fragment, or the token. */
export function historyTokenFrom(text: string): string | null {
  const s = text.trim();
  if (s.startsWith(HISTORY_LINK)) return s.slice(HISTORY_LINK.length);
  const hash = s.indexOf("#");
  if (hash >= 0 && /\/history#/.test(s)) return s.slice(hash + 1);
  return /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
}

/**
 * The summary a token carries, or null when it is not one. Nothing here trusts
 * the contents: a token is only ever shown as what the family wrote.
 */
export async function readHistoryToken(token: string): Promise<HistoryPayload | null> {
  try {
    const parsed: unknown = JSON.parse(await inflate(fromB64url(token)));
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as HistoryPayload;
    if (p.v !== 1 || !Array.isArray(p.m) || !Array.isArray(p.c) || !Array.isArray(p.a) || !Array.isArray(p.r)) return null;
    if (!Array.isArray(p.p) || typeof p.p[0] !== "string") return null;
    return p;
  } catch {
    return null;
  }
}
