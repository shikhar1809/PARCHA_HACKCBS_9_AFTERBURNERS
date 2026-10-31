/**
 * The prescription inside the QR on a printed parcha.
 *
 * The paper is the record the patient takes home, so the QR carries the whole
 * prescription, compressed and signed by the hospital's server when the doctor
 * signs. The patient app reads it with no network and checks the signature
 * against the public key below: a QR that was not made by Parcha, or was
 * changed after signing, is refused. Nothing is looked up, so the medical
 * details go from the paper to the phone and nowhere else.
 *
 * The QR is a link (RX_LINK + token) so any phone camera opens the patient
 * app on it. The token is after the "#", which a browser never sends to a
 * server.
 *
 *   token = base64url(deflate-raw(JSON payload)) "." base64url(ECDSA P-256 SHA-256 signature, r||s)
 *
 * The signature is over the compressed bytes, exactly as they appear in the QR.
 */
import type { Timing } from "./types.js";

export const RX_LINK = "https://parcha.web.app/rx#";

/** The public half of the signing key (SPKI, base64). The private half is the functions' RX_SIGNING_KEY. */
export const RX_PUBLIC_KEY =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE0WY+GpSrMhIPDfrKdvGHrmxBnxkGYt1uIlGBkWT+VSyNz7lORIDwW1HHUVdxUsTKxcEM23FysSBdMfk/mdzZ5Q==";

/** One medicine: [name, strength, form, frequency, days, timing, every N days, instructions]. */
export type RxLine = [string, string, string, string, number, Timing, number?, string?];

/** Short keys: every byte is a smaller QR. */
export type RxPayload = {
  v: 1;
  /** Hospital name. */
  h: string;
  /** Doctor: name, qualification, registration number. */
  d: [string, string | null, string | null];
  /** Signed at, ISO. */
  t: string;
  /** Visit code, as printed on the slip. */
  c: string;
  /** Patient: name, age, sex. */
  p: [string, number | null, string | null];
  /** Diagnosis. */
  x: string | null;
  m: RxLine[];
  /** Tests to get done. */
  k: string[];
  /** Advice (shortened to fit), and follow-up in days. */
  a: string | null;
  f: number | null;
};

export const ADVICE_MAX = 220;

/** Builds the payload from what was signed. */
export function rxPayload(input: {
  hospitalName: string;
  doctor: { name: string; qualification?: string | null; regNo?: string | null };
  signedAt: string;
  visitCode: string;
  patient: { name: string; ageYears: number | null; sex: string | null };
  diagnosis: string | null;
  items: { drugName: string; strength: string; form: string; frequency: string; durationDays: number; timing: Timing; everyDays?: number; instructions?: string }[];
  tests: string[];
  advice: string | null;
  followUpDays: number | null;
}): RxPayload {
  return {
    v: 1,
    h: input.hospitalName,
    d: [input.doctor.name, input.doctor.qualification ?? null, input.doctor.regNo ?? null],
    t: input.signedAt,
    c: input.visitCode,
    p: [input.patient.name, input.patient.ageYears, input.patient.sex],
    x: input.diagnosis,
    m: input.items.map((i) => {
      const line: RxLine = [i.drugName, i.strength, i.form, i.frequency, i.durationDays, i.timing];
      if ((i.everyDays ?? 1) > 1 || i.instructions) line.push(i.everyDays ?? 1);
      if (i.instructions) line.push(i.instructions.slice(0, 80));
      return line;
    }),
    k: input.tests,
    a: input.advice ? input.advice.slice(0, ADVICE_MAX) : null,
    f: input.followUpDays,
  };
}

export const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
