/**
 * The gate between the clinic and Meko.
 *
 * Nothing reaches a hosted service without passing through here. What we are
 * willing to send is a prescribing *pattern* ("this doctor writes paracetamol
 * 650 twice a day for three days"); what we will never send is a patient
 * *event* (who was ill, when, with what). A full leak of our Meko account
 * should reveal a prescribing style and a clinic's drug vocabulary, and not
 * that anybody was ever unwell.
 *
 * It FAILS, it does not scrub. A scrubber that half-works is worse than a
 * gate that refuses: the caller trusts it and the identifier goes out anyway
 * in a form nobody checked. Here, one hit means the whole text is refused and
 * the agent silently falls back to its rules. Nothing is lost but learning.
 *
 * The same function runs again on the server (see firebase/functions), which
 * is the real boundary — this copy only saves a round trip.
 */

/** Refused, with what was found; or allowed, with the text to send. */
export type Redaction =
  | { ok: true; text: string }
  | { ok: false; reason: string; found: string[] };

/** What the caller already knows about this patient, so an exact match is caught. */
export type Known = {
  patientName?: string | null;
  phone?: string | null;
};

/**
 * Patterns that mean "this is about a person". Deliberately broad: a false
 * refusal costs one unlearned habit, a false pass costs a confidence.
 */
export const PHI_PATTERNS: { name: string; re: RegExp }[] = [
  // Ten digits, however they are spaced or punctuated: an Indian mobile.
  { name: "phone", re: /(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}\b/ },
  // Twelve digits in three groups: Aadhaar-shaped.
  { name: "aadhaar", re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ },
  { name: "email", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { name: "upi", re: /\b[a-z0-9._-]{3,}@(?:ok[a-z]+|paytm|ybl|upi|axl|ibl)\b/i },
  // Our own identifiers, which are long opaque strings beside a label.
  { name: "visitId", re: /\bvisit[_\s-]?id\b|\bvisits?\/[A-Za-z0-9]{12,}/i },
  { name: "patientId", re: /\bpatient[_\s-]?id\b|\bpatients?\/[A-Za-z0-9]{12,}/i },
  // An age attached to a person rather than to a dose.
  { name: "age", re: /\b\d{1,3}\s*(?:years?|yrs?|saal|year)[\s-]?old\b|\bage\s*[:\-]?\s*\d{1,3}\b/i },
  // A date of birth, or any full calendar date: a prescribing pattern never needs one.
  { name: "date", re: /\b(?:dob|date of birth)\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/i },
  // Honorific plus a name: "Mr Sharma", "Smt. Devi".
  { name: "honorific", re: /\b(?:mr|mrs|ms|miss|smt|shri|sri|master|baby|b\/o|w\/o|s\/o|d\/o)\.?\s+[a-z]/i },
  // Address-ish words that only appear when describing where someone lives.
  { name: "address", re: /\b(?:house no|h\.?no|flat no|village|gali|mohalla|pin\s?code|pincode)\b/i },
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Words too common to treat as a name even when they are one (Asha, Lata, Hema…). */
const NAME_MIN = 3;

/**
 * Every word of a known name, so "Asha" is caught inside "Asha Devi" and on
 * its own. Parts shorter than NAME_MIN are dropped: a two-letter token would
 * match half the dictionary.
 */
function nameParts(patientName: string | null | undefined): string[] {
  if (!patientName) return [];
  return norm(patientName)
    .split(/[^a-z]+/)
    .filter((w) => w.length >= NAME_MIN);
}

/**
 * Whether `text` may be sent to Meko.
 *
 * `known` carries this visit's patient name and phone so an exact match is
 * caught even when it reads as an ordinary word — "Asha" is a name here, so
 * "asha feels better" is refused, and that is the correct trade.
 */
export function deidentify(text: string, known: Known = {}): Redaction {
  const found: string[] = [];

  for (const { name, re } of PHI_PATTERNS) {
    if (re.test(text)) found.push(name);
  }

  const hay = norm(text);
  for (const part of nameParts(known.patientName)) {
    // Whole word only: "ram" must not fire on "ramipril".
    if (new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay)) {
      found.push("patientName");
      break;
    }
  }

  if (known.phone) {
    const digits = known.phone.replace(/\D/g, "");
    if (digits.length >= 6 && text.replace(/\D/g, "").includes(digits)) found.push("patientPhone");
  }

  if (found.length) {
    return {
      ok: false,
      reason: `Not sent: it carries ${[...new Set(found)].join(", ")}.`,
      found: [...new Set(found)],
    };
  }
  return { ok: true, text: text.replace(/\s+/g, " ").trim() };
}

/** `deidentify`, as a boolean, for call sites that only branch on it. */
export const sendable = (text: string, known: Known = {}): boolean => deidentify(text, known).ok;
