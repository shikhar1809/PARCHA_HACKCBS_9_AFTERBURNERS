/**
 * Firestore collection paths, in one place.
 *
 * Paths are strings scattered through query code by default, and a typo in
 * one is a silent empty result rather than an error. Naming them once means
 * the security rules, the seed script and both apps are talking about the
 * same collections.
 */

export const COL = {
  patients: "patients",
  visits: "visits",
  accounts: "accounts",
  accessGrants: "accessGrants",
  drugs: "drugs",
  allergyClasses: "allergyClasses",
  interactions: "drugInteractions",
  vitalCautions: "drugVitalCautions",
  routes: "routes",
  hospitals: "hospitals",
  staffSessions: "staffSessions",
  activity: "activity",
} as const;

/** Sub-collections of a visit. All append-only. */
export const VISIT_SUB = {
  vitals: "vitals",
  complaints: "complaints",
  prescriptions: "prescriptions",
  stageEvents: "stageEvents",
  conflicts: "conflicts",
} as const;

/** Sub-collections of a patient. */
export const PATIENT_SUB = {
  allergies: "allergies",
} as const;

/** One wire's document id: from, then to, so a pair can only exist once. */
export const routeId = (fromUid: string, toUid: string) =>
  `${fromUid}__${toUid}`;

export const patientPath = (id: string) => `${COL.patients}/${id}`;
export const allergiesPath = (patientId: string) =>
  `${COL.patients}/${patientId}/${PATIENT_SUB.allergies}`;

export const visitPath = (id: string) => `${COL.visits}/${id}`;
export const visitSubPath = (
  visitId: string,
  sub: (typeof VISIT_SUB)[keyof typeof VISIT_SUB],
) => `${COL.visits}/${visitId}/${sub}`;

/** The document id IS the code printed on the slip. */
export const accessGrantPath = (code: string) =>
  `${COL.accessGrants}/${code.toUpperCase()}`;

/**
 * The alphabet access codes are drawn from.
 *
 * No 0/1/O/I: a code is read off a printed slip, often in bad light, by
 * somebody typing it into a phone.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * A random code. A share code is a credential (it opens a prescription), so the
 * letters come from the platform's cryptographic generator, not Math.random.
 * 32 letters, 10 long: about 10^15 codes, so even crores of them collide
 * almost never, and the server creates each one only if it is free.
 */
export function generateCode(length = 10): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  // 256 is a multiple of 32, so taking the low five bits is unbiased.
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Short, human-facing visit number. Same alphabet, same reason. */
export function generateVisitCode(): string {
  return generateCode(6);
}
