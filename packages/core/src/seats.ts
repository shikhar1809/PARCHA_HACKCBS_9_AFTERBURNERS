/**
 * Seats and abilities: how a clinic says who does what.
 *
 * A clinic is not one shape. A doctor practising alone registers, takes vitals
 * and prescribes; a hospital has a reception, a triage nurse, doctors per
 * department and an office. So the roles are not built in. Each hospital keeps
 * a list of SEATS, and each seat switches on ABILITIES. A person sits in one
 * seat. The server checks abilities, never job titles.
 *
 * The visit's stage machine still speaks of two counters (the desk, which
 * registers and takes vitals, and the doctor, who consults). They are worked
 * out from the abilities, so a solo doctor holds both.
 */
import type { AccountType, StaffRole } from "./types.js";

export type Ability = "register" | "vitals" | "consult" | "dispense" | "billing" | "activity" | "manage";

export const ABILITIES: { id: Ability; label: string; detail: string }[] = [
  { id: "register", label: "Register patients", detail: "Look people up, register them, start visits, answer requests, check people in." },
  { id: "vitals", label: "Take vitals", detail: "Record the complaint and vitals, and send the patient to a doctor." },
  { id: "consult", label: "Consult and prescribe", detail: "See patients, run the safety check, sign prescriptions. Makes this seat a doctor." },
  { id: "dispense", label: "Dispense medicines", detail: "A pharmacy counter: give out what was prescribed, swap in a brand with the same formula." },
  { id: "billing", label: "Billing", detail: "Add the fees for a visit, take payment (cash, UPI, card), print a receipt." },
  { id: "activity", label: "Read the activity log", detail: "See who did what, from where." },
  { id: "manage", label: "Manage the clinic", detail: "Open the Manage page (with the PIN): seats, team, settings." },
];

const ALL: Ability[] = ABILITIES.map((a) => a.id);

export type Seat = {
  id: string;
  name: string;
  abilities: Ability[];
  /** Order on screen. */
  order: number;
};

export type TemplateId = "solo" | "clinic" | "hospital";

export type Template = {
  id: TemplateId;
  name: string;
  description: string;
  seats: Omit<Seat, "order">[];
  /** The seat the person setting the clinic up takes. */
  ownerSeat: string;
};

export const TEMPLATES: Template[] = [
  {
    id: "solo",
    name: "A doctor on their own",
    description: "One seat that does everything: register, vitals, consult, and run the clinic.",
    seats: [{ id: "doctor", name: "Doctor", abilities: [...ALL] }],
    ownerSeat: "doctor",
  },
  {
    id: "clinic",
    name: "A small clinic",
    description: "A front desk that registers and takes vitals, doctors who consult, and an admin.",
    seats: [
      { id: "admin", name: "Clinic admin", abilities: ["register", "vitals", "activity", "manage"] },
      { id: "desk", name: "Front desk", abilities: ["register", "vitals"] },
      { id: "doctor", name: "Doctor", abilities: ["consult", "activity"] },
    ],
    ownerSeat: "admin",
  },
  {
    id: "hospital",
    name: "A hospital",
    description: "Reception, a triage nurse for vitals, doctors, a pharmacy, a billing desk, a ward clerk and an office that runs it.",
    seats: [
      { id: "admin", name: "Hospital admin", abilities: ["activity", "manage"] },
      { id: "reception", name: "Reception", abilities: ["register"] },
      { id: "triage", name: "Triage nurse", abilities: ["vitals"] },
      { id: "doctor", name: "Doctor", abilities: ["consult", "activity"] },
      { id: "pharmacy", name: "Pharmacist", abilities: ["dispense"] },
      { id: "billing", name: "Billing desk", abilities: ["billing"] },
      { id: "clerk", name: "Ward clerk", abilities: ["register", "activity"] },
    ],
    ownerSeat: "admin",
  },
];

export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);

/** Keeps only known abilities, once each, in the canonical order. */
export function cleanAbilities(value: unknown): Ability[] {
  const list = Array.isArray(value) ? value : [];
  return ALL.filter((a) => list.includes(a));
}

/** The stage machine's counters for a set of abilities. */
export function countersFor(abilities: readonly Ability[]): StaffRole[] {
  const out: StaffRole[] = [];
  if (abilities.includes("register") || abilities.includes("vitals")) out.push("compounder");
  if (abilities.includes("consult")) out.push("doctor");
  return out;
}

/** Anyone who can consult is a doctor (patients are sent to them); everyone else is staff. */
export const accountTypeFor = (abilities: readonly Ability[]): AccountType =>
  abilities.includes("consult") ? "doctor" : "staff";

/**
 * The abilities on a token. Accounts made before seats existed have only an
 * account type and an admin flag; they keep what they could always do.
 */
export function abilitiesFromClaims(claims: Record<string, unknown>): Ability[] {
  if (Array.isArray(claims.abilities)) return cleanAbilities(claims.abilities);
  const base: Ability[] = claims.accountType === "doctor" ? ["consult", "activity"] : claims.accountType === "staff" ? ["register", "vitals"] : [];
  return cleanAbilities(claims.admin === true ? [...base, "activity", "manage"] : base);
}

/** A seat id from a name: "Triage nurse" -> "triage-nurse". */
export const seatIdFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "seat";

/** A management PIN: four to six digits. */
export const PIN_RE = /^\d{4,6}$/;

/** The clinic's own rules for staff sessions, set on the Manage page. */
export type SessionRules = {
  /** How far a device may move from where its session opened, in metres. */
  moveLimitM: number;
  /** Whether a change of internet address ends the session. */
  endOnIpChange: boolean;
};

export const DEFAULT_SESSION_RULES: SessionRules = { moveLimitM: 300, endOnIpChange: true };

export function cleanSessionRules(value: unknown): SessionRules {
  const v = (value ?? {}) as Partial<SessionRules>;
  const move = Number(v.moveLimitM);
  return {
    moveLimitM: Number.isFinite(move) ? Math.min(5000, Math.max(100, Math.round(move))) : DEFAULT_SESSION_RULES.moveLimitM,
    endOnIpChange: typeof v.endOnIpChange === "boolean" ? v.endOnIpChange : DEFAULT_SESSION_RULES.endOnIpChange,
  };
}
