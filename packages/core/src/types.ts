/**
 * The Firestore document shapes.
 *
 * Two things changed in the move from Postgres, and both are deliberate.
 *
 * **`sessions` is now `visits`.** "Session" meant a patient visit in the SQL
 * schema and an auth session everywhere else, which is one word doing two
 * jobs. A visit is a visit.
 *
 * **Queue-critical fields are denormalised onto the visit.** Firestore has no
 * joins, and a queue screen must be one query — so the patient's name, age,
 * allergy flag, latest complaint and latest vitals are copied onto the visit
 * document when they are written. The sub-collections remain the record; these
 * copies exist so a counter screen renders from a single read.
 *
 * Append-only still holds, and is enforced in firestore.rules rather than by a
 * Postgres trigger: `vitals`, `complaints`, `prescriptions`, `stageEvents` and
 * `conflicts` allow create and deny update and delete, for everybody. A
 * correction is a new document naming the one it supersedes.
 */

export type Stage =
  // Before the patient is in the building. The patient asks, the desk finds
  // a doctor, the doctor accepts and names a time.
  | "requested"
  | "proposed"
  | "scheduled"
  // From the moment they arrive.
  | "registered"
  | "intake_complete"
  | "in_consultation"
  // The visit ends here: the doctor signs, and the prescription is printed.
  | "prescribed"
  | "cancelled";

export type Severity = "info" | "caution" | "high";
export type Sex = "female" | "male" | "other";
export type SugarReading = "fasting" | "random" | "post_prandial";
export type ConflictRule =
  | "drug_allergy"
  | "drug_drug"
  | "drug_vitals"
  /** Too young for this medicine. */
  | "drug_age"
  /** More than the most a day, for an adult or by a child's weight. */
  | "drug_dose"
  /** Pregnant or breastfeeding, or a woman who might be and was not asked. */
  | "drug_pregnancy"
  /** Written by hand, not in the medicine list: nothing could be checked. */
  | "unlisted";

/** Asked by the doctor at the consultation. "no" means asked, and neither. */
export type Pregnancy = "pregnant" | "breastfeeding" | "no";

/** ISO-8601. Stored as a Firestore Timestamp, read back as a string. */
export type Iso = string;

export type Patient = {
  id: string;
  /** Which hospital's records this is. Each hospital keeps its own. */
  hospitalId: string;
  fullName: string;
  /** Set by the desk: low vision, deaf, sign language (access.ts). Copied onto each visit. */
  accessNeeds?: import("./access.js").AccessNeed[];
  /** Not unique, and not meant to be: handsets are shared within a family. */
  phone: string;
  sex: Sex | null;
  dateOfBirth: Iso | null;
  /** Most patients have no document to read a birth date off. */
  statedAgeYears: number | null;
  /** So a stated age keeps ageing instead of being frozen at first contact. */
  ageStatedOn: Iso | null;
  villageOrArea: string | null;
  district: string | null;
  state: string | null;
  bloodGroup: string | null;
  preferredLanguage: string;
  notes: string | null;
  createdAt: Iso;
  updatedAt: Iso;
};

/** patients/{id}/allergies/{id} — append-only. */
export type Allergy = {
  id: string;
  patientId: string;
  allergyClassId: string | null;
  /** Denormalised from the formulary so a record stays readable on its own. */
  label: string;
  freeText: string | null;
  reaction: string | null;
  severity: Severity;
  recordedAt: Iso;
  recordedBy: string;
  source: string;
  /** A tombstone: this document retracts the one it names. */
  retractsAllergyId: string | null;
};

/** The intake reading, copied onto the visit for the queues. */
export type VitalsSummary = {
  systolicMmhg: number | null;
  diastolicMmhg: number | null;
  pulseBpm: number | null;
  temperatureC: number | null;
  respiratoryRate: number | null;
  spo2Pct: number | null;
  weightKg: number | null;
  heightCm: number | null;
  bloodSugarMgdl: number | null;
  bloodSugarType: SugarReading | null;
};

/** visits/{id}/vitals/{id} — append-only. */
export type Vitals = VitalsSummary & {
  id: string;
  visitId: string;
  patientId: string;
  notes: string | null;
  recordedAt: Iso;
  recordedBy: string;
  supersedesId: string | null;
};

/** visits/{id}/complaints/{id} — append-only. */
export type Complaint = {
  id: string;
  visitId: string;
  patientId: string;
  body: string;
  language: string;
  durationDays: number | null;
  severity: "mild" | "moderate" | "severe" | null;
  source: string;
  recordedAt: Iso;
  recordedBy: string;
  supersedesId: string | null;
};

export const TIMINGS = [
  "before_food",
  "after_food",
  "with_food",
  "empty_stomach",
  "any",
] as const;

export type Timing = (typeof TIMINGS)[number];

export type PrescriptionItem = {
  /** References formulary drug ids. The engine's way into the formulary. */
  drugId: string;
  /** Denormalised so a prescription survives the formulary changing. */
  drugName: string;
  form: string;
  strength: string;
  /** Indian OPD three-slot pattern ("1-0-1"), which the pictogram draws. */
  frequency: string;
  durationDays: number;
  timing: Timing;
  quantity: number;
  instructions?: string;
  /** 1 (or absent) is every day; 2 every other day, 7 once a week, and so on (items.ts EVERY_DAYS). */
  everyDays?: number;
  /**
   * Written by hand because it is not in the medicine list. Its drugId is
   * "unlisted:" and the name; the safety check cannot read it, and says so.
   */
  unlisted?: boolean;
};

/** visits/{id}/prescriptions/{id} — append-only. */
export type Prescription = {
  id: string;
  visitId: string;
  patientId: string;
  diagnosisText: string | null;
  items: PrescriptionItem[];
  advice: string | null;
  /** Tests and investigations to get done ("CBC", "USG abdomen"). */
  tests?: string[];
  /** What the doctor recorded about pregnancy, when it was asked. */
  pregnancy?: Pregnancy | null;
  /** The printed parcha's QR: the whole prescription, signed (rxToken.ts). */
  qr?: string | null;
  followUpDays: number | null;
  prescriberName: string;
  prescriberUid: string;
  /** From the doctor's profile at the moment of signing, for the printed slip. */
  prescriberQualification?: string | null;
  prescriberRegNo?: string | null;
  createdAt: Iso;
  signedAt: Iso | null;
  supersedesId: string | null;
  /** Signed on a computer with no connection and not yet confirmed by the server. */
  unconfirmed?: boolean;
};

/** visits/{id}/stageEvents/{id} — append-only. The audit trail. */
export type StageEvent = {
  id: string;
  visitId: string;
  fromStage: Stage | null;
  toStage: Stage;
  actor: string;
  actorUid: string;
  /** The counter, not the person: "passed on from the pharmacy counter". */
  actorRole: StaffRole | "system";
  reason: string | null;
  occurredAt: Iso;
};

/**
 * The four counters.
 *
 * Separate from the two account types on purpose. One person often works both
 * the desk and the medicine window, but the audit trail and the transition
 * guard both care which counter acted.
 */
export type StaffRole = "compounder" | "doctor";

/**
 * The three kinds of clinic account.
 *
 * A hospital has many of each, so the type says what a person does, not
 * which individual they are: a desk account takes intake, a doctor account
 * consults and signs. Which doctor a desk sends patients to is the wiring,
 * held as `Route`s.
 */
export type AccountType = "staff" | "doctor";

/** accounts/{uid} — a member of the team. Role also lives in a custom claim. */
export type Account = {
  uid: string;
  displayName: string;
  accountType: AccountType;
  counters: StaffRole[];
  /** The hospital this person works at. Also a custom claim. */
  hospitalId: string;
  /** Doctors: the department they see patients for. Null for the rest. */
  department?: string | null;
  /** Who may manage the team and its wiring. Also a custom claim. */
  admin?: boolean;
  /** A deactivated member keeps their history but cannot sign in. */
  active?: boolean;
  /** Doctors: whether they are taking patients today. */
  availability?: Availability;
  /** Set by the server on each heartbeat from the signed-in app. */
  lastSeenAt?: string | null;
  /** False once the person signs out or locks the device. */
  onDuty?: boolean;
  /** The seat this person sits in, and what it lets them do (see seats.ts). Also claims. */
  seatId?: string | null;
  /** Every seat this person sits in; their abilities add up. `seatId` is the first. */
  seatIds?: string[];
  seatName?: string | null;
  abilities?: import("./seats.js").Ability[];
  /** Doctors' own details, from their first sign-in. Shown on the prescription. */
  qualification?: string | null;
  registrationNo?: string | null;
  phone?: string | null;
  consultingHours?: string | null;
  /** Set once the person has finished their first-sign-in profile. */
  profileDone?: boolean;
};

/**
 * A doctor's own word on whether the desk can send them people today. "Off"
 * means do not: the server refuses to propose a visit to them.
 */
export type Availability = "available" | "busy" | "off";

/**
 * hospitals/{id}. Readable by anyone signed in, because it is what a patient
 * chooses from; written only by seeding, and later by a platform admin.
 */
export type Hospital = {
  id: string;
  /** False until someone with the Manage ability has run the clinic set-up. */
  setupDone?: boolean;
  /**
   * Whether the voice pad may learn how this clinic's doctors prescribe.
   * Absent means off: learning is opted into, never out of, because it sends
   * prescribing patterns to a hosted service (see docs/plans/MEKO-VOICE-AGENT.md).
   */
  mekoEnabled?: boolean;
  /** Meko datapack id per agent, written once by scripts/meko-bootstrap.mjs. */
  mekoDatapacks?: Record<"habit" | "formulary" | "scribe", string>;
  /** Which requests from the patient app it takes (both, when absent). */
  acceptsNew?: boolean;
  acceptsFollowUp?: boolean;
  /** The consultation fee the billing desk starts from, in rupees. */
  consultationFee?: number | null;
  /** The clinic's Razorpay payment page, which billing shows as a QR to pay online. */
  razorpayPage?: string | null;
  /** The clinic's price list besides the consultation (dressing, injection, ECG...): one tap each at billing. */
  charges?: { label: string; amount: number }[];
  /** The template it was set up from (solo, clinic, hospital). */
  template?: string | null;
  name: string;
  shortName: string;
  address: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  phone: string;
  departments: string[];
  /** The hospital's own promise: minutes before a request is tried elsewhere. */
  respondMinutes: number;
  /** Taking requests from the app right now. */
  accepting: boolean;
  /** A rough read of how busy it is, so a patient can choose. */
  load: "low" | "medium" | "high";
  hours: string;
  /** How big it is, which is what a patient means by "what kind of place". */
  size?: "large" | "medium" | "small";
  /** Out of 5. Made up in the demo; would come from patients' feedback. */
  rating?: number | null;
  /** False for a real hospital shown on the map that does not use Parcha: never bookable. */
  onParcha?: boolean;
  /** An example set-up (opens without a location); `sandbox` is a "Custom" one made for one visitor. */
  example?: boolean;
  sandbox?: boolean;
};

/**
 * One wire on the team diagram.
 *
 * A desk connects to the doctors it can send patients to. A patient always
 * passes a doctor, so there is one kind of wire.
 */
export type RouteKind = "desk_doctor";

/** routes/{fromUid}__{toUid} */
export type Route = {
  id: string;
  hospitalId: string;
  fromUid: string;
  toUid: string;
  kind: RouteKind;
  createdAt: Iso;
  createdBy: string;
};

export type Visit = {
  id: string;
  /** The hospital this visit is at. Staff of other hospitals cannot see it. */
  hospitalId: string;
  patientId: string;
  visitCode: string;
  stage: Stage;
  department: string;
  tokenNumber: number | null;

  // Denormalised from the patient, so a queue is one read.
  patientName: string;
  patientAgeYears: number | null;
  patientSex: Sex | null;
  patientVillage: string | null;
  patientPhone: string;
  hasAllergy: boolean;
  /** The patient's access needs, copied from the record so the queue can show them. */
  accessNeeds?: import("./access.js").AccessNeed[];
  /** Set by the pharmacy counter, when the clinic has one (counter.ts). */
  dispensedAt?: Iso | null;
  dispensedBy?: string | null;
  /** Set by the billing desk, when the clinic has one. Rupees. */
  billTotal?: number | null;
  paid?: boolean;
  paidMode?: string | null;
  /** The payment's own id when it was paid online (Razorpay's "pay_..."), as the desk wrote it down. */
  paidRef?: string | null;

  /**
   * Routing, from the team's wiring.
   *
   * The doctor is chosen by the desk at intake, from the doctors that desk is
   * wired to.
   */
  assignedDoctorUid: string | null;
  assignedDoctorName: string | null;
  /** The code printed on the prescription, for adding the visit to another phone. */
  shareCode?: string;
  /** Shown from this computer's own saved actions: the server has not confirmed it yet. */
  unsent?: boolean;

  /**
   * Before the patient comes (all absent on a walk-in).
   *
   * A visit can begin as a request from the patient's own phone: they say what
   * is wrong, or which doctor they want to see again, and when. The desk then
   * finds the doctor, the doctor accepts and names a time, and it becomes an
   * ordinary visit when the patient arrives. One record from the first ask to
   * the last medicine.
   */
  source?: "walk_in" | "pre_visit";
  requestMode?: "new_problem" | "existing_doctor" | null;
  /** The doctor the patient asked for, if they asked for one by name. */
  requestedDoctorUid?: string | null;
  requestedDoctorName?: string | null;
  /** YYYY-MM-DD, in the clinic's time zone. */
  preferredDate?: string | null;
  /** The confirmed slot, once a doctor has accepted. */
  scheduledFor?: Iso | null;
  requestedAt?: Iso | null;
  /**
   * The hospital's promise, held to. A request must be answered by
   * `respondBy`; if the hospital has not acted by then it is tried at the next
   * nearest one. `candidateHospitalIds` is that order, fixed when the patient
   * asked, and `attempts` is each hospital already tried and what happened.
   */
  respondBy?: Iso | null;
  /** An idempotency key from the app, so a retried tap is not a second booking. */
  requestKey?: string | null;
  candidateHospitalIds?: string[];
  attempts?: {
    hospitalId: string;
    hospitalName: string;
    at: Iso;
    outcome: "waiting" | "answered" | "timed_out" | "declined";
  }[];
  /** Every hospital in reach has been tried and none answered. */
  exhausted?: boolean;
  /**
   * What the hospital has asked the patient to bring (ids from `BRING_ITEMS`),
   * a line of its own, and which of them the patient says they have ready.
   */
  bring?: string[];
  bringNote?: string | null;
  bringReady?: string[];
  /** Doctors who said no, and why, so the desk does not ask them again. */
  declines?: { doctorUid: string; doctorName: string; reason: string; at: Iso }[];

  // Denormalised latest, written alongside the append-only sub-collections.
  complaint: string | null;
  vitals: VitalsSummary | null;
  diagnosis: string | null;
  itemCount: number;

  registeredAt: Iso;
  intakeCompletedAt: Iso | null;
  consultationStartedAt: Iso | null;
  prescribedAt: Iso | null;
  closedAt: Iso | null;
  registeredBy: string | null;
  notes: string | null;
  /** What the patient said about the visit afterwards (stars 1 to 5). */
  feedback?: { stars: number; tags: string[]; note: string | null; at: Iso } | null;
};

/** accessGrants/{code} — the document id IS the code printed on the slip. */
export type AccessGrant = {
  code: string;
  visitId: string;
  patientId: string;
  issuedTo: "patient" | "caretaker";
  issuedAt: Iso;
  expiresAt: Iso;
  revokedAt: Iso | null;
  revokedReason: string | null;
  issuedBy: string;
};

/* ------------------------------------------------------------------------ *
 * The formulary — reference data, world-readable, written only by seeding.
 * ------------------------------------------------------------------------ */

export type Drug = {
  id: string;
  genericName: string;
  commonBrands: string[];
  drugClass: string;
  forms: string[];
  strengths: string[];
  defaultForm: string;
  defaultStrength: string;
  isOtc: boolean;
  isSteroid: boolean;
  allergyClasses: string[];
  notes: string | null;
};

export type AllergyClass = {
  id: string;
  label: string;
  description: string;
};

/** Stored once per pair, with `a` < `b`, so a lookup normalises the pair. */
export type DrugInteraction = {
  id: string;
  a: string;
  b: string;
  severity: Severity;
  mechanism: string;
  advice: string;
};

export type VitalCaution = {
  id: string;
  drugId: string | null;
  drugClass: string | null;
  vitalKey: keyof VitalsSummary;
  comparator: "gt" | "gte" | "lt" | "lte";
  threshold: number;
  severity: Severity;
  message: string;
};

/** visits/{id}/conflicts/{id} — append-only, written by the engine. */
export type Conflict = {
  id: string;
  visitId: string;
  prescriptionId: string;
  patientId: string;
  rule: ConflictRule;
  severity: Severity;
  subjectDrugId: string | null;
  subjectDrugName: string;
  counterpartKind: "drug" | "allergy_class" | "vital" | "patient";
  counterpartRef: string | null;
  counterpartLabel: string;
  message: string;
  /** Which documents the rule read, so a flag can be explained. */
  evidence: Record<string, unknown>;
  engineVersion: string;
  detectedAt: Iso;
};

/** The kinds of paper a patient can keep. */
export type DocKind = "report" | "scan" | "prescription" | "insurance" | "other";

/** documents/{id} — one of the patient's own files. The bytes live beside it, not in it. */
export type PatientDocument = {
  id: string;
  ownerPhone: string;
  personName: string;
  title: string;
  kind: DocKind;
  mime: string;
  size: number;
  /** The day on the paper, YYYY-MM-DD, if the patient said. */
  takenOn: string | null;
  createdAt: Iso;
};

/** histories/{id} — what the patient says about themselves; not a clinical record. */
export type PatientHistory = {
  id: string;
  ownerPhone: string;
  personName: string;
  conditions: string[];
  allergies: string[];
  medicines: string[];
  bloodGroup: string | null;
  notes: string;
  updatedAt: Iso;
};

/**
 * staffSessions/{uid} — the one open session of a clinic account. Written only
 * by the server. The address is what the server saw, not what the device said;
 * the location is what the device reported.
 */
export type StaffSession = {
  uid: string;
  hospitalId: string;
  sessionId: string;
  active: boolean;
  startedAt: Iso;
  lastBeatAt: Iso;
  /** Internet addresses this session has been seen from (one, or a device's IPv4 and IPv6 pair). */
  ips: string[];
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  device: string;
  endedAt: Iso | null;
  endReason: string | null;
};

/**
 * activity/{id} — who did what, in a sentence a person can read. Written only
 * by the server; doctors and admins of the same hospital can read it.
 */
export type ActivityEntry = {
  id: string;
  hospitalId: string;
  at: Iso;
  actorUid: string;
  actorName: string;
  /** "front desk", "doctor", or "system". */
  actorRole: string;
  kind: string;
  /** The whole story, e.g. "Rekha (front desk) took Priya's vitals and sent her to Dr. A. Khan." */
  text: string;
  patientId: string | null;
  visitId: string | null;
  ip: string | null;
  /** "At the clinic", "2.4 km from the clinic", or "Location not shared". */
  place: string | null;
};
