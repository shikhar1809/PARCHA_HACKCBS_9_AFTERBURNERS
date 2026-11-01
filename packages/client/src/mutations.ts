/**
 * Every write, as a typed call to a Cloud Function.
 *
 * There is no Firestore write anywhere in either app: the security rules deny
 * them outright. That is what makes the stage machine trustworthy — a screen
 * that forgot a check, or a client that is not one of these screens, still
 * cannot move a patient along the chain.
 *
 * Errors come back carrying a sentence meant for a person, so callers can
 * show `error.message` as it is.
 */
import type {
  AccountType,
  Availability,
  Patient,
  PrescriptionItem,
  Visit,
  VitalsSummary,
} from "@parcha/core";

import { call } from "./firebase";
import { getHospitalScope } from "./hooks";
import { callQueued, newClientId } from "./outbox";
import type { LocalOp } from "./overlay";

export type IntakeInput = Partial<VitalsSummary> & {
  visitId: string;
  /** One of the doctors this desk is wired to. The server checks the wire. */
  doctorUid: string;
  complaint: string;
  durationDays?: number | null;
};

const iso = () => new Date().toISOString();

/**
 * The clinic's day-to-day actions. Each works with no connection: it is kept on
 * this computer, shown as done, and sent when the connection returns (see
 * outbox.ts). Online, they behave as plain calls.
 */
export type PatientInput = {
  fullName: string;
  phone: string;
  sex?: string | null;
  statedAgeYears?: number | null;
  villageOrArea?: string | null;
  /** Low vision, deaf, sign language (access.ts). */
  accessNeeds?: import("@parcha/core").AccessNeed[];
};

/** The desk notes (or clears) a patient's access needs; their open visits show them too. */
export const setAccessNeeds = (patientId: string, needs: import("@parcha/core").AccessNeed[]) =>
  call<{ patientId: string; needs: import("@parcha/core").AccessNeed[] }, { ok: true; needs: import("@parcha/core").AccessNeed[] }>("setAccessNeeds", { patientId, needs });

export const registerPatient = (input: PatientInput) => {
  const clientId = newClientId();
  const patient = {
    id: clientId,
    hospitalId: getHospitalScope() ?? "",
    fullName: input.fullName.trim(),
    phone: input.phone.replace(/\D/g, "").slice(-10),
    sex: (input.sex ?? null) as Patient["sex"],
    dateOfBirth: null,
    statedAgeYears: input.statedAgeYears ?? null,
    ageStatedOn: null,
    villageOrArea: input.villageOrArea ?? null,
    district: null,
    state: null,
    bloodGroup: null,
    preferredLanguage: "hi",
    notes: null,
    createdAt: iso(),
    updatedAt: iso(),
  } satisfies Patient;
  const local: LocalOp = { kind: "patient", patient };
  return callQueued<PatientInput & { clientId: string }, { patientId: string }>(
    "registerPatient",
    { ...input, clientId },
    () => ({ patientId: clientId }),
    { local, durable: true },
  );
};

/** `patient` is what the desk already has on screen; offline it is what the new visit is drawn from. */
export const startVisit = (
  patientId: string,
  patient?: Pick<Patient, "fullName" | "phone" | "statedAgeYears" | "sex" | "villageOrArea">,
) => {
  const clientVisitId = newClientId();
  const local: LocalOp | undefined = patient
    ? {
        kind: "visit",
        visit: {
          id: clientVisitId,
          hospitalId: getHospitalScope() ?? "",
          patientId,
          visitCode: "—",
          stage: "registered",
          department: "general",
          tokenNumber: null,
          patientName: patient.fullName,
          patientPhone: patient.phone,
          patientAgeYears: patient.statedAgeYears,
          patientSex: patient.sex,
          patientVillage: patient.villageOrArea,
          hasAllergy: false,
          assignedDoctorUid: null,
          assignedDoctorName: null,
          complaint: null,
          vitals: null,
          diagnosis: null,
          itemCount: 0,
          registeredAt: iso(),
          intakeCompletedAt: null,
          consultationStartedAt: null,
          prescribedAt: null,
          closedAt: null,
          registeredBy: null,
          notes: null,
        } as unknown as Visit,
      }
    : undefined;
  return callQueued<{ patientId: string; clientVisitId: string }, { visitId: string; existing: boolean }>(
    "startVisit",
    { patientId, clientVisitId },
    () => ({ visitId: clientVisitId, existing: false }),
    { local, durable: true },
  );
};

const VITAL_KEYS = [
  "systolicMmhg",
  "diastolicMmhg",
  "pulseBpm",
  "temperatureC",
  "respiratoryRate",
  "spo2Pct",
  "weightKg",
  "heightCm",
  "bloodSugarMgdl",
  "bloodSugarType",
] as const;

/**
 * What a patient pointed at on the waiting-room kiosk, onto their visit.
 *
 * Plain `call`, not the offline queue: a kiosk that is offline has nothing
 * useful to promise the person standing at it, and the desk is three steps
 * away. The server refuses it once the desk has done intake.
 */
export const kioskComplaint = (input: {
  visitId: string;
  complaint: string;
  durationDays?: number | null;
  severity?: "mild" | "moderate" | "severe" | null;
  language?: string;
}) => call<typeof input, { ok: true }>("kioskComplaint", input);

export const saveIntake = (input: IntakeInput, meta?: { doctorName: string }) => {
  const any = VITAL_KEYS.some((k) => input[k] != null);
  const vitals = any
    ? (Object.fromEntries(VITAL_KEYS.map((k) => [k, input[k] ?? null])) as unknown as VitalsSummary)
    : null;
  const local: LocalOp = {
    kind: "intake",
    visitId: input.visitId,
    vitals,
    complaint: input.complaint,
    doctorUid: input.doctorUid,
    doctorName: meta?.doctorName ?? "Doctor",
  };
  return callQueued<IntakeInput, { ok: true }>("saveIntake", input, () => ({ ok: true }), { local, durable: true });
};

export const startConsultation = (visitId: string) =>
  callQueued<{ visitId: string }, { ok: true }>("startConsultation", { visitId }, () => ({ ok: true }), {
    local: { kind: "consult", visitId } satisfies LocalOp,
    durable: true,
  });

export type SignInput = {
  visitId: string;
  diagnosis: string;
  advice: string;
  followUpDays: number | null;
  items: PrescriptionItem[];
  /** Tests to get done. */
  tests?: string[];
  /** Asked at the consultation; null when not asked. */
  pregnancy?: import("@parcha/core").Pregnancy | null;
  /** Keys of the safety flags the doctor has read. */
  acknowledged?: string[];
};

/**
 * Signs a prescription. `meta` lets a computer with no connection show it signed
 * and print it straight away; the server checks it again, with the safety check
 * and the doctor's password, when it is sent.
 */
export const signPrescription = (input: SignInput, meta?: { prescriberName: string; prescriberUid: string; patientId: string }) => {
  const prescriptionId = newClientId();
  const local: LocalOp | undefined = meta
    ? {
        kind: "rx",
        visitId: input.visitId,
        prescription: {
          id: prescriptionId,
          visitId: input.visitId,
          patientId: meta.patientId,
          diagnosisText: input.diagnosis || null,
          items: input.items,
          advice: input.advice || null,
          tests: input.tests ?? [],
          pregnancy: input.pregnancy ?? null,
          followUpDays: input.followUpDays,
          prescriberName: meta.prescriberName,
          prescriberUid: meta.prescriberUid,
          createdAt: iso(),
          signedAt: iso(),
          supersedesId: null,
          unconfirmed: true,
        },
      }
    : undefined;
  return callQueued<SignInput, { prescriptionId: string }>("signPrescription", input, () => ({ prescriptionId }), { local, durable: true });
};

/** A safety flag as the screen shows it. `key` is what an acknowledgement names. */
export type SafetyFlag = import("@parcha/core").DetectedConflict & { key: string };

/** Runs the safety check on the medicines so far. Advisory; signing runs it again. */
export const checkPrescription = (visitId: string, items: PrescriptionItem[], pregnancy: import("@parcha/core").Pregnancy | null = null) =>
  call<{ visitId: string; items: PrescriptionItem[]; pregnancy: import("@parcha/core").Pregnancy | null }, { flags: SafetyFlag[]; version: string }>(
    "checkPrescription",
    { visitId, items, pregnancy },
  );

export const linkVisitByCode = (code: string) =>
  call<{ code: string }, { visitId: string; patientId: string }>(
    "linkVisitByCode",
    { code },
  );

export const registerPushToken = (token: string) =>
  call<{ token: string }, { ok: true }>("registerPushToken", { token });

/**
 * Creating a person on the team, and wiring two of them together. Admin-only:
 * the functions check the `admin` claim, so a screen that forgot to hide
 * these still cannot change who is on the team.
 */
/* ------------------------------------------------------------------------ *
 * Running the clinic: set-up, a person's own profile, and the Manage page.
 * The Manage calls carry the pass that the PIN gave (openManage).
 * ------------------------------------------------------------------------ */

export type ManageSeat = { id: string; name: string; abilities: import("@parcha/core").Ability[]; order: number };
export type ManageMember = {
  uid: string;
  displayName: string;
  email: string;
  seatId: string | null;
  seatIds: string[];
  seatName: string | null;
  abilities: import("@parcha/core").Ability[];
  active: boolean;
  department: string | null;
};
export type ManageState = {
  seats: ManageSeat[];
  team: ManageMember[];
  sessionRules: import("@parcha/core").SessionRules;
  clinic: { name: string; address: string; phone: string; hours: string; template: string | null };
  status: ClinicStatus;
  me: string;
};

/** What patients see when they look for a clinic, and what it takes. */
export type ClinicStatus = {
  accepting: boolean;
  load: "low" | "medium" | "high";
  respondMinutes: number;
  acceptsNew: boolean;
  acceptsFollowUp: boolean;
  departments: string[];
  consultationFee: number | null;
  razorpayPage: string | null;
  charges: import("@parcha/core").BillLine[];
};

export type ManageStats = {
  days: number;
  since: string;
  visits: { total: number; walkIns: number; fromRequests: number; prescribed: number; cancelled: number; waitingNow: number };
  minutes: { waitForVitals: number | null; waitForDoctor: number | null; consultation: number | null; wholeVisit: number | null };
  requests: { asked: number; answered: number; timedOut: number; declined: number; waiting: number };
  doctors: { name: string; seen: number; consultation: number | null }[];
  byHour: number[];
  counters: { dispensed: number; billedTotal: number; paid: number; unpaid: number };
};

export const setupClinic = (input: {
  template: import("@parcha/core").TemplateId;
  name: string;
  area?: string;
  address?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  pin: string;
}) => call<typeof input, { ok: true; seatName: string }>("setupClinic", input);

export const saveMyProfile = (input: {
  displayName: string;
  qualification?: string;
  registrationNo?: string;
  department?: string;
  phone?: string;
  consultingHours?: string;
}) => call<typeof input, { ok: true }>("saveMyProfile", input);

export const openManage = (pin: string) => call<{ pin: string }, { token: string; expiresAt: number }>("openManage", { pin });
export const closeManage = () => call<object, { ok: true }>("closeManage", {});
export const manageState = (manageToken: string) => call<{ manageToken: string }, ManageState>("manageState", { manageToken });
export const saveSeat = (manageToken: string, seat: { id?: string; name: string; abilities: import("@parcha/core").Ability[] }) =>
  call<object, { id: string }>("saveSeat", { manageToken, seat });
export const deleteSeat = (manageToken: string, id: string) => call<object, { ok: true }>("deleteSeat", { manageToken, id });
/** A person's roles: one or several, which add up. */
export const assignSeat = (manageToken: string, uid: string, seatIds: string[]) => call<object, { ok: true }>("assignSeat", { manageToken, uid, seatIds });
export const setMemberActive = (manageToken: string, uid: string, active: boolean) =>
  call<object, { ok: true }>("setMemberActive", { manageToken, uid, active });
export const saveSettings = (
  manageToken: string,
  input: {
    sessionRules?: import("@parcha/core").SessionRules;
    clinic?: { name?: string; address?: string; phone?: string; hours?: string };
    status?: Partial<ClinicStatus>;
  },
) => call<object, { ok: true }>("saveSettings", { manageToken, ...input });
export const manageStats = (manageToken: string, days: 1 | 7 | 30) => call<object, ManageStats>("manageStats", { manageToken, days });

/** The pharmacy gives out the signed prescription; one line per medicine, in order. */
export const dispensePrescription = (visitId: string, lines: { given: boolean; substitute?: string | null }[]) =>
  call<object, { ok: true; given: number; of: number }>("dispensePrescription", { visitId, lines });

/** The billing desk records the fees and how they were paid. */
export const recordBill = (
  visitId: string,
  input: { lines: import("@parcha/core").BillLine[]; paid: boolean; mode?: import("@parcha/core").PayMode; paidRef?: string },
) => call<object, { ok: true; total: number }>("recordBill", { visitId, ...input });

export const changeManagePin = (manageToken: string, pin: string) => call<object, { ok: true }>("changeManagePin", { manageToken, pin });

/** Adds a person in a seat. The first password comes back once, to pass on. */
export const createTeamMember = (
  manageToken: string,
  input: { displayName: string; email: string; seatIds: string[]; department?: string },
) => call<object, { uid: string; email: string; password: string }>("createTeamMember", { manageToken, ...input });

/** Who sends patients to whom. Management only, with the pass the PIN gave. */
export const connectTeamMembers = (manageToken: string, fromUid: string, toUid: string) =>
  call<{ manageToken: string; fromUid: string; toUid: string }, { kind: string }>(
    "connectTeamMembers",
    { manageToken, fromUid, toUid },
  );

export const disconnectTeamMembers = (manageToken: string, fromUid: string, toUid: string) =>
  call<{ manageToken: string; fromUid: string; toUid: string }, { ok: true }>(
    "disconnectTeamMembers",
    { manageToken, fromUid, toUid },
  );

/**
 * Before the patient comes. They ask from their own phone; the desk finds a
 * doctor; the doctor accepts and names a time, or declines with a reason; and
 * on arrival the desk checks them in. See firebase/functions/src/previsit.ts.
 */
export type VisitRequest = {
  /** Any record of this person, at any hospital: the server finds or opens theirs at the one chosen. */
  patientId?: string;
  /** Somebody no hospital has seen yet, named on the phone. Used when there is no `patientId`. */
  newPerson?: {
    fullName: string;
    sex?: "female" | "male" | "other" | null;
    statedAgeYears?: number | null;
    villageOrArea?: string | null;
  };
  /** The hospital asked first. It has its promised time to answer before it is tried elsewhere. */
  hospitalId: string;
  /** Where the patient is, if they chose to share it. Only used to order the fallback hospitals. */
  from?: { lat: number; lng: number };
  /** Made once per attempt, so repeating the same tap is the same request. */
  requestKey?: string;
  mode: "new_problem" | "existing_doctor";
  /** What is wrong, in their own words. Optional when asking for a doctor again. */
  requirement?: string;
  /** For `existing_doctor`: a doctor this person has seen before. */
  doctorUid?: string;
  /** YYYY-MM-DD, in the clinic's time zone. */
  preferredDate: string;
};

/** What a front desk can change about a visit that has not happened yet. */
export const controlVisit = (
  input:
    | { visitId: string; action: "bring"; bring: string[]; bringNote?: string }
    | { visitId: string; action: "reschedule"; day: string; time: string }
    | { visitId: string; action: "reassign"; doctorUid: string }
    | { visitId: string; action: "no_show"; reason?: string },
) => call<typeof input, { ok: true }>("controlVisit", input);

/** The patient says which of the things they were asked to bring they have ready. */
export const setBringReady = (visitId: string, ready: string[]) =>
  call<{ visitId: string; ready: string[] }, { ok: true }>("setBringReady", { visitId, ready });

export const checkInVisit = (visitId: string) =>
  call<{ visitId: string }, { ok: true }>("checkInVisit", { visitId });

export const setAvailability = (status: Availability) =>
  call<{ status: Availability }, { ok: true }>("setAvailability", { status });

/** Turns a Firebase callable error into something worth showing a person. */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: unknown }).message);
    // The SDK prefixes thrown HttpsErrors; the sentence after it is ours.
    // The SDK also appends the HTTP status ("... [404]"), which is for
    // developers, not for the person reading the screen.
    return message
      .replace(/^(FirebaseError:\s*)?/, "")
      .replace(/\s*\[\d{3}\]\s*$/, "")
      // Machine-readable prefixes the server uses for the screen (SAFETY_ACK: ...).
      .replace(/^[A-Z][A-Z_]{3,}:\s*/, "");
  }
  return "Something went wrong.";
}
