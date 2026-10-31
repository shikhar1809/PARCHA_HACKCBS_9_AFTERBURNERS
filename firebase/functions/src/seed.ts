/**
 * Loads the demo clinic into the emulator.
 *
 * Writes the formulary, fifteen patients with two years of history, the
 * visits sitting at every stage of the chain, and the two staff accounts —
 * then asserts the handful of things the walkthrough depends on, so a broken
 * fixture fails here rather than halfway through a demo.
 *
 * Refuses to run against a real project. It writes with the Admin SDK, which
 * bypasses the security rules, and it deletes what it owns first.
 */
import { timingSafeEqual } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import {
  allergyClasses,
  drugs,
  interactions,
  patients,
  vitalCautions,
  type ItemSeed,
  type PatientSeed,
  type VisitSeed,
} from "../../../packages/core/src/demo/index.js";
import {
  normaliseFrequency,
  suggestedQuantity,
} from "../../../packages/core/src/items.js";
import { generateCode, generateVisitCode } from "../../../packages/core/src/paths.js";
import { accountTypeFor, countersFor, DEFAULT_SESSION_RULES, templateById, type Ability, type TemplateId } from "../../../packages/core/src/seats.js";
import { hashPin } from "./manage.js";
import { seedHistory, type HistoryHospital } from "./seedHistory.js";
import { profileId } from "../../../packages/core/src/profile.js";
import type {
  AccountType,
  PrescriptionItem,
  Stage,
  VitalsSummary,
} from "../../../packages/core/src/types.js";
import { routeId } from "../../../packages/core/src/paths.js";
import {
  addDays,
  slotInstant,
  todayInClinic,
} from "../../../packages/core/src/slots.js";

const db = () => getFirestore();

const daysAgo = (n: number) =>
  Timestamp.fromMillis(Date.now() - n * 86400_000);

/**
 * When each step of a seeded visit happened, so the Manage page's waits and
 * busy hours look like a real OPD instead of everything at one instant.
 * Earlier days open at 9 am India time, a token every twelve minutes; today
 * is laid out backwards from now, the last token about half an hour ago.
 * The waits vary a little from visit to visit.
 */
function visitTimes(days: number, token: number | null, n: number) {
  const now = Date.now();
  const t = token ?? 10 + (n % 10);
  const ist = 5.5 * 3_600_000;
  const morning = Math.floor((now + ist) / 86_400_000) * 86_400_000 - ist - days * 86_400_000 + 9 * 3_600_000;
  const reg = days === 0 ? now - (26 - Math.min(t, 24)) * 9 * 60_000 : morning + t * 12 * 60_000;
  const cap = (ms: number) => Timestamp.fromMillis(Math.min(ms, now - 60_000));
  const intake = reg + (6 + (n * 7) % 9) * 60_000;
  const consult = intake + (12 + (n * 11) % 23) * 60_000;
  const rx = consult + (5 + (n * 5) % 8) * 60_000;
  return { reg: cap(reg), intake: cap(intake), consult: cap(consult), rx: cap(rx) };
}

/** Fixture vital names (the old SQL columns) to VitalsSummary field names. */
const VITAL_KEYS: Record<string, keyof VitalsSummary> = {
  blood_sugar_mgdl: "bloodSugarMgdl",
  systolic_mmhg: "systolicMmhg",
  diastolic_mmhg: "diastolicMmhg",
  pulse_bpm: "pulseBpm",
  spo2_pct: "spo2Pct",
  temperature_c: "temperatureC",
  weight_kg: "weightKg",
};

/**
 * Three demo set-ups, one of each size, so every shape of the product is on
 * show: a large hospital with every counter, a medium hospital with a desk,
 * doctors and management, and a doctor's own practice.
 * Each has a Management seat that can do everything but prescribe. The
 * patients, staff and phone numbers are made up. A fourth hospital is not
 * taking requests, and one clinic is not set up yet (to show the set-up).
 */
const HOME = "h-cp";

/** Parcha's Razorpay payment page, for the demo clinics' "Pay with Razorpay" QR. */
const DEMO_RAZORPAY_PAGE = "https://rzp.io/rzp/WuRzdD7T";

/** The demo clinics' price list besides the consultation, in rupees. */
const DEMO_CHARGES = [
  { label: "Dressing", amount: 150 },
  { label: "Injection", amount: 100 },
  { label: "Nebulisation", amount: 200 },
  { label: "ECG", amount: 300 },
  { label: "Blood sugar test", amount: 80 },
  { label: "CBC test", amount: 350 },
];

/** Minutes from one "HH:MM" to a later one on the same day. */
const minutesBetween = (a: string, b: string) => {
  const m = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  return m(b) - m(a);
};
export const HOSPITALS = [
  // The three example set-ups, placed around Shaheed Sukhdev College in Rohini
  // (where Parcha is demonstrated), so they are the nearest on the patients' map.
  {
    id: "h-cp",
    size: "large",
    // A made-up rating for the demo; real ones would come from patients' feedback.
    rating: 4.5,
    name: "Rohini City Hospital",
    shortName: "Rohini City Hospital",
    address: "Sector 13, Rohini",
    area: "Sector 13, Rohini",
    city: "New Delhi",
    lat: 28.7262,
    lng: 77.1268,
    phone: "011 4000 1111",
    departments: ["General medicine","Cardiology","Paediatrics","Orthopaedics","Neurology","Gynaecology","ENT"],
    respondMinutes: 15,
    accepting: true,
    load: "medium",
    hours: "Open 24 hours",
  },
  {
    id: "h-noida",
    size: "small",
    // A made-up rating for the demo; real ones would come from patients' feedback.
    rating: 4.6,
    name: "Dr. Verma's Clinic",
    shortName: "Dr. Verma's Clinic",
    address: "Sector 15, Rohini",
    area: "Sector 15, Rohini",
    city: "New Delhi",
    lat: 28.7349,
    lng: 77.1281,
    phone: "011 4000 2222",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "high",
    hours: "9 am to 1 pm, 5 pm to 9 pm",
  },
  {
    id: "h-dwarka",
    size: "medium",
    // A made-up rating for the demo; real ones would come from patients' feedback.
    rating: 4.3,
    name: "Sector 9 Care Hospital",
    shortName: "Sector 9 Care",
    address: "Sector 9, Rohini",
    area: "Sector 9, Rohini",
    city: "New Delhi",
    lat: 28.7186,
    lng: 77.1152,
    phone: "011 4000 3333",
    departments: ["General medicine","Paediatrics","Gynaecology"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "Open 24 hours",
  },
  // Real hospitals around the college, at their OpenStreetMap positions. For the
  // demo they take requests from the app like the set-ups do (a request to one
  // waits its 15 minutes and then moves on, as nobody works their desk); their
  // fee and rating are left blank rather than made up.
  {
    id: "h-jackson",
    size: "medium",
    name: "Jackson Hospital & Research Centre",
    shortName: "Jackson Hospital",
    address: "Azad Hind Fauj Marg, Sector 16, Rohini",
    area: "Sector 16, Rohini",
    city: "New Delhi",
    lat: 28.7375,
    lng: 77.1213,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "",
  },
  {
    id: "h-ambedkar",
    size: "large",
    name: "Dr. Baba Saheb Ambedkar Hospital",
    shortName: "Ambedkar Hospital",
    address: "HL Parwana Road, Sector 6, Rohini",
    area: "Sector 6, Rohini",
    city: "New Delhi",
    lat: 28.714,
    lng: 77.1137,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "",
  },
  {
    id: "h-saroj",
    size: "large",
    name: "Saroj Super Speciality Hospital",
    shortName: "Saroj Hospital",
    address: "Sector 14 Extension, Madhuban Chowk, Rohini",
    area: "Sector 14, Rohini",
    city: "New Delhi",
    lat: 28.7062,
    lng: 77.129,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "",
  },
  {
    id: "h-jaipur-golden",
    size: "large",
    name: "Jaipur Golden Hospital",
    shortName: "Jaipur Golden",
    address: "Institutional Area, Sector 3, Rohini",
    area: "Sector 3, Rohini",
    city: "New Delhi",
    lat: 28.6977,
    lng: 77.1098,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "",
  },
  {
    id: "h-brahm-shakti",
    size: "medium",
    name: "Brahm Shakti Hospital",
    shortName: "Brahm Shakti",
    address: "Kanjhawala Road, Sector 21, Rohini",
    area: "Sector 21, Rohini",
    city: "New Delhi",
    lat: 28.712,
    lng: 77.0808,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "",
  },
  {
    id: "h-bhagwan-mahavir",
    size: "large",
    name: "Bhagwan Mahavir Hospital",
    shortName: "Bhagwan Mahavir",
    address: "Guru Harkishan Marg, Pitampura",
    area: "Pitampura",
    city: "New Delhi",
    lat: 28.6885,
    lng: 77.1179,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "",
  },
  {
    id: "h-max-shalimar",
    size: "large",
    name: "Max Super Speciality Hospital, Shalimar Bagh",
    shortName: "Max Shalimar Bagh",
    address: "Shalimar Bagh",
    area: "Shalimar Bagh",
    city: "New Delhi",
    lat: 28.7278,
    lng: 77.1526,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "",
  },
  {
    id: "h-fortis-shalimar",
    size: "large",
    name: "Fortis Hospital, Shalimar Bagh",
    shortName: "Fortis Shalimar Bagh",
    address: "Shahid Udham Singh Marg, Shalimar Bagh",
    area: "Shalimar Bagh",
    city: "New Delhi",
    lat: 28.7093,
    lng: 77.1703,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "",
  },
  {
    id: "h-sgm",
    size: "large",
    name: "Sanjay Gandhi Memorial Hospital",
    shortName: "Sanjay Gandhi",
    address: "Maharishi Valmiki Marg, Mangolpuri",
    area: "Mangolpuri",
    city: "New Delhi",
    lat: 28.6944,
    lng: 77.0805,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "",
  },
  {
    id: "h-deep-chand",
    size: "large",
    name: "Deep Chand Bandhu Hospital",
    shortName: "Deep Chand Bandhu",
    address: "Bharat Nagar Main Road, Ashok Vihar",
    area: "Ashok Vihar",
    city: "New Delhi",
    lat: 28.6819,
    lng: 77.1784,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "",
  },
  {
    id: "h-agrasen",
    size: "large",
    name: "Maharaja Agrasen Hospital",
    shortName: "Maharaja Agrasen",
    address: "Rohtak Road, Punjabi Bagh",
    area: "Punjabi Bagh",
    city: "New Delhi",
    lat: 28.6741,
    lng: 77.1341,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: true,
    load: "low",
    hours: "",
  },
  {
    id: "h-solo",
    size: "small",
    name: "New clinic",
    shortName: "New clinic",
    address: "",
    area: "Sector 11, Rohini",
    city: "New Delhi",
    lat: 28.7302,
    lng: 77.1102,
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: false,
    load: "low",
    hours: "",
  },
] as const;

/** The demo Manage PIN for every set-up hospital. */
export const DEMO_PIN = "1234";

/** Where each seeded person sits, by the "small clinic" template's seats. */
const seatFor = (m: { accountType: AccountType; admin?: boolean; seat?: string }) => m.seat ?? (m.admin ? "management" : m.accountType === "doctor" ? "doctor" : "desk");

/** Management: runs the hospital and can work every counter, but does not prescribe. */
const management = (name: string) => ({ id: "management", name, abilities: ["register", "vitals", "dispense", "billing", "activity", "manage"] as Ability[] });

/**
 * Each demo hospital's seats and the template it was set up from. The big
 * hospital has every counter, the small one a desk and doctors, the practice
 * one doctor who does everything (and so needs no Management seat).
 */
const LAYOUTS: Record<string, { template: TemplateId; seats: { id: string; name: string; abilities: Ability[] }[] }> = {
  "h-cp": { template: "hospital", seats: [management("Hospital management"), ...templateById("hospital")!.seats.filter((s) => s.id !== "admin")] },
  "h-dwarka": { template: "clinic", seats: [management("Hospital management"), ...templateById("clinic")!.seats.filter((s) => s.id !== "admin")] },
  // One doctor, one seat that does everything: no desk, no manager.
  "h-noida": { template: "solo", seats: templateById("solo")!.seats },
};
const layoutOf = (hospitalId: string) => LAYOUTS[hospitalId] ?? LAYOUTS["h-dwarka"];

type TeamSeed = {
  hospital: string;
  key: string;
  email: string;
  displayName: string;
  accountType: AccountType;
  department?: string;
  admin?: boolean;
  /** Doctors: whether they are taking patients today. */
  availability?: "available" | "busy" | "off";
  qualification?: string;
  registrationNo?: string;
  /** False leaves the first-sign-in profile to be filled in (to show it). */
  profileDone?: boolean;
  /** Someone at a clinic that is not set up yet: may only manage, until set-up seats them. */
  owner?: boolean;
  /** A seat other than the one the account type implies. */
  seat?: string;
};

/**
 * A small hospital's team: two desks and three doctors.
 *
 * Enough that the wiring is a picture worth drawing: one desk feeds two
 * doctors, and nobody is a dead end.
 * Everyone signs in with the same demo password.
 */
const CP_TEAM: Omit<TeamSeed, "hospital">[] = [
  { key: "rekha", email: "staff@parcha.test", displayName: "Rekha (management)", accountType: "staff", admin: true },
  { key: "anil", email: "staff2@parcha.test", displayName: "Anil (reception)", accountType: "staff", seat: "reception" },
  { key: "mary", email: "triage@parcha.test", displayName: "Sister Mary (triage)", accountType: "staff", seat: "triage" },
  { key: "khan", email: "doctor@parcha.test", displayName: "Dr. A. Khan", accountType: "doctor", department: "General medicine", availability: "available", qualification: "MBBS, MD (Medicine)", registrationNo: "DMC/R/04512" },
  { key: "mehta", email: "doctor2@parcha.test", displayName: "Dr. S. Mehta", accountType: "doctor", department: "Cardiology", availability: "busy", qualification: "MBBS, DM (Cardiology)", registrationNo: "DMC/R/02287" },
  // Dr. Iyer has not filled in a profile yet, to show the first sign-in.
  { key: "iyer", email: "doctor3@parcha.test", displayName: "Dr. R. Iyer", accountType: "doctor", department: "Paediatrics", availability: "available", profileDone: false },
  { key: "pooja", email: "pharmacy@parcha.test", displayName: "Pooja (pharmacy)", accountType: "staff", seat: "pharmacy" },
  { key: "vikram", email: "billing@parcha.test", displayName: "Vikram (billing)", accountType: "staff", seat: "billing" },
];

/** The smaller hospitals: a desk (and admin) and a doctor each. */
const OTHER_TEAMS: TeamSeed[] = [
  { hospital: "h-dwarka", key: "sneha", email: "dwarka.desk@parcha.test", displayName: "Sneha (management)", accountType: "staff", admin: true },
  { hospital: "h-dwarka", key: "dwarkadesk", email: "medium.desk@parcha.test", displayName: "Farhan (front desk)", accountType: "staff", seat: "desk" },
  { hospital: "h-dwarka", key: "dwarkadoc", email: "dwarka.doctor@parcha.test", displayName: "Dr. P. Nair", accountType: "doctor", department: "General medicine", availability: "available", qualification: "MBBS, MD (Medicine)", registrationNo: "DMC/R/07741" },
  // The practice's own doctor does everything: registers, takes vitals, prescribes.
  { hospital: "h-noida", key: "noidadoc", email: "noida.doctor@parcha.test", displayName: "Dr. S. Verma", accountType: "doctor", department: "General medicine", availability: "busy", qualification: "MBBS, DNB (Family Medicine)", registrationNo: "UPMC/52318" },
];

const TEAM: TeamSeed[] = [
  ...CP_TEAM.map((m) => ({ ...m, hospital: HOME })),
  ...OTHER_TEAMS,
  // The owner of a clinic that is not set up yet: signing in shows the set-up.
  { hospital: "h-solo", key: "meera", email: "solo@parcha.test", displayName: "Dr. Meera Rao", accountType: "staff", owner: true, profileDone: false },
];

const DEMO_PASSWORD = "parcha123";

/** The wires: which doctors each desk sends patients to. */
const WIRES: [string, string][] = [
  ["rekha", "khan"],
  ["rekha", "mehta"],
  ["anil", "mehta"],
  ["anil", "iyer"],
  ["mary", "khan"],
  ["mary", "mehta"],
  ["mary", "iyer"],
  // The other hospitals
  ["sneha", "dwarkadoc"],
  ["dwarkadesk", "dwarkadoc"],
];

function vitalsFrom(seed: PatientSeed, visit: VisitSeed): VitalsSummary | null {
  const v = { ...seed.baseline, ...(visit.vitals ?? {}) };
  if (Object.keys(v).length === 0) return null;
  return {
    systolicMmhg: v.systolic ?? null,
    diastolicMmhg: v.diastolic ?? null,
    pulseBpm: v.pulse ?? null,
    temperatureC: v.temperatureC ?? null,
    respiratoryRate: v.respiratoryRate ?? null,
    spo2Pct: v.spo2 ?? null,
    weightKg: v.weightKg ?? null,
    heightCm: v.heightCm ?? null,
    bloodSugarMgdl: v.sugar ?? null,
    bloodSugarType: v.sugar == null ? null : (v.sugarType ?? "random"),
  };
}

function itemsFrom(seeds: ItemSeed[]): PrescriptionItem[] {
  return seeds.map((s) => {
    const drug = drugs.find((d) => d.id === s.drug);
    if (!drug) throw new Error(`seed references unknown drug "${s.drug}"`);
    const frequency = normaliseFrequency(s.freq);
    return {
      drugId: drug.id,
      drugName: drug.generic,
      form: s.form ?? drug.defaultForm,
      strength: s.strength ?? drug.defaultStrength,
      frequency,
      durationDays: s.days,
      timing: s.timing ?? "any",
      quantity: suggestedQuantity(frequency, s.days) ?? s.days,
      ...(s.instructions ? { instructions: s.instructions } : {}),
    };
  });
}

/** Deletes every document in a collection, in batches. */
async function wipe(path: string) {
  const snap = await db().collection(path).get();
  while (snap.docs.length > 0) {
    const batch = db().batch();
    for (const doc of snap.docs.splice(0, 400)) batch.delete(doc.ref);
    await batch.commit();
  }
}

/**
 * The medicine list and the tables the safety check reads. Shared by the demo
 * seed and by the one-time set-up of the live project (bootstrap.ts).
 */
export async function writeFormulary(): Promise<void> {
  let batch = db().batch();
  let queued = 0;
  const flush = async (force = false) => {
    if (queued >= 400 || (force && queued > 0)) {
      await batch.commit();
      batch = db().batch();
      queued = 0;
    }
  };

  for (const cls of allergyClasses) {
    batch.set(db().collection("allergyClasses").doc(cls.id), {
      label: cls.label,
      description: cls.description,
    });
    queued += 1;
    await flush();
  }

  for (const drug of drugs) {
    batch.set(db().collection("drugs").doc(drug.id), {
      genericName: drug.generic,
      commonBrands: drug.brands,
      drugClass: drug.drugClass,
      forms: drug.forms,
      strengths: drug.strengths,
      defaultForm: drug.defaultForm,
      defaultStrength: drug.defaultStrength,
      isOtc: drug.otc ?? false,
      isSteroid: drug.steroid ?? false,
      allergyClasses: drug.allergyClasses ?? [],
      notes: drug.notes ?? null,
    });
    queued += 1;
    await flush();
  }

  for (const pair of interactions) {
    // Stored once with a < b, so a lookup normalises the pair first.
    const [a, b] = [pair.a, pair.b].sort();
    batch.set(db().collection("drugInteractions").doc(`${a}__${b}`), {
      a,
      b,
      severity: pair.severity,
      mechanism: pair.mechanism,
      advice: pair.advice,
    });
    queued += 1;
    await flush();
  }

  for (const caution of vitalCautions) {
    batch.set(db().collection("drugVitalCautions").doc(caution.id), {
      drugId: caution.drugId ?? null,
      drugClass: caution.drugClass ?? null,
      // The fixture names vitals the way the SQL columns did; the documents
      // use the field names on VitalsSummary, so the rule can read a caution
      // and a visit's reading with the same key.
      vitalKey: VITAL_KEYS[caution.vital],
      comparator: caution.comparator,
      threshold: caution.threshold,
      severity: caution.severity,
      message: caution.message,
    });
    queued += 1;
    await flush();
  }
  await flush(true);
}

export const seedDemoData = onCall({ timeoutSeconds: 540, memory: "1GiB", cpu: 1 }, async (request) => {
  // The Admin SDK ignores the security rules, and this wipes and replaces the
  // demo data, so anywhere but the emulator it needs the project's secret key
  // (BOOTSTRAP_KEY, kept in the deploy's env file, never committed). Used to
  // load the demo into the live hackathon project: scripts/seed-live.mjs.
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    const key = process.env.BOOTSTRAP_KEY ?? "";
    const given = String((request.data as { seedKey?: unknown } | undefined)?.seedKey ?? "");
    if (!key || given.length !== key.length || !timingSafeEqual(Buffer.from(given), Buffer.from(key))) {
      throw new HttpsError("failed-precondition", "Seeding only runs against the emulator.");
    }
  }

  // ---------------------------------------------------------------- wipe
  // Visits and patients go as whole trees: every sub-collection with them.
  await db().recursiveDelete(db().collection("visits"));
  await db().recursiveDelete(db().collection("patients"));
  for (const col of [
    "drugs",
    "allergyClasses",
    "drugInteractions",
    "drugVitalCautions",
    "accessGrants",
    "routes",
    "hospitals",
    "rateLimits",
    "staffSessions",
    "activity",
    "opLog",
  ]) {
    await wipe(col);
  }

  // ------------------------------------------------------------ formulary
  await writeFormulary();

  // -------------------------------------------------------------- patients
  const patientIds = new Map<string, string>();
  // ------------------------------------------------------------- hospitals
  for (const h of HOSPITALS) {
    // Only the example set-ups have seats and a team; the real hospitals around them do not.
    const ready = h.id in LAYOUTS;
    await db().collection("hospitals").doc(h.id).set({
      ...h,
      departments: [...h.departments],
      setupDone: ready || h.id !== "h-solo",
      template: ready ? layoutOf(h.id).template : null,
      // The examples open without a location (session.ts); the real hospitals are not on Parcha.
      example: ready || h.id === "h-solo",
      consultationFee: h.id === HOME ? 300 : ready ? 200 : null,
      // The demo set-ups take online payments on Parcha's own Razorpay page.
      razorpayPage: ready ? DEMO_RAZORPAY_PAGE : null,
      charges: ready ? DEMO_CHARGES : [],
    });
    await wipe(`hospitals/${h.id}/seats`);
    await wipe(`hospitalPrivate/${h.id}/passes`);
    if (ready) {
      for (const [i, s] of layoutOf(h.id).seats.entries()) {
        await db().collection("hospitals").doc(h.id).collection("seats").doc(s.id).set({ name: s.name, abilities: s.abilities, order: i });
      }
      await db().collection("hospitalPrivate").doc(h.id).set({ ...(await hashPin(DEMO_PIN)), failures: 0, lockedUntil: null, sessionRules: DEFAULT_SESSION_RULES });
    } else {
      await db().collection("hospitalPrivate").doc(h.id).delete();
    }
  }

  // ----------------------------------------------------------------- team
  // The seed owns the team. Anyone added through the Team page since the last
  // run is cleared, so the demo always starts from the same picture.
  const keep = new Set(TEAM.map((m) => m.email));
  const listed = await getAuth().listUsers(1000);
  for (const user of listed.users) {
    if (user.email && !keep.has(user.email)) {
      await getAuth().deleteUser(user.uid);
    }
  }
  await wipe("accounts");

  const uidByKey = new Map<string, string>();
  for (const member of TEAM) {
    const auth = getAuth();
    let uid: string;
    try {
      uid = (await auth.getUserByEmail(member.email)).uid;
    } catch {
      uid = (
        await auth.createUser({
          email: member.email,
          password: DEMO_PASSWORD,
          displayName: member.displayName,
        })
      ).uid;
    }
    uidByKey.set(member.key, uid);
    // The role is a custom claim, not a field a client could set. The
    // security rules read it, and so does every callable.
    const seat = member.owner ? null : layoutOf(member.hospital).seats.find((s) => s.id === seatFor(member))!;
    const abilities: Ability[] = member.owner ? ["manage"] : [...seat!.abilities];
    const accountType = accountTypeFor(abilities);
    await auth.setCustomUserClaims(uid, {
      accountType,
      name: member.displayName,
      admin: abilities.includes("manage"),
      hospitalId: member.hospital,
      seatId: seat?.id ?? null,
      seatName: seat?.name ?? null,
      abilities,
    });
    await db()
      .collection("accounts")
      .doc(uid)
      .set({
        uid,
        displayName: member.displayName,
        accountType,
        counters: countersFor(abilities),
        seatId: seat?.id ?? null,
        seatName: seat?.name ?? null,
        abilities,
        hospitalId: member.hospital,
        department: member.department ?? null,
        admin: abilities.includes("manage"),
        active: true,
        qualification: member.qualification ?? null,
        registrationNo: member.registrationNo ?? null,
        profileDone: member.profileDone ?? true,
        ...(member.availability ? { availability: member.availability } : {}),
      });
  }

  // ---------------------------------------------------------------- wiring
  for (const [from, to] of WIRES) {
    const fromUid = uidByKey.get(from)!;
    const toUid = uidByKey.get(to)!;
    const fromType = TEAM.find((m) => m.key === from)!.accountType;
    await db()
      .collection("routes")
      .doc(routeId(fromUid, toUid))
      .set({
        hospitalId: TEAM.find((m) => m.key === from)!.hospital,
        fromUid,
        toUid,
        kind: "desk_doctor",
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "Seed",
      });
  }


  // The demo clinic's patients are all at the first hospital.
  const doctors = TEAM.filter(
    (m) => m.accountType === "doctor" && m.hospital === HOME,
  );
  let doctorTurn = 0;

  let visitCount = 0;
  // For the pre-visit examples below: people with nothing open, and the
  // doctor each of them last saw.
  const seeded: { id: string; seed: PatientSeed; hasAllergy: boolean }[] = [];
  const openPatients = new Set<string>();
  const lastDoctor = new Map<string, { uid: string; name: string }>();
  let grantCode: string | null = null;

  for (const seed of patients) {
    const patientRef = db().collection("patients").doc();
    patientIds.set(seed.key, patientRef.id);

    await patientRef.set({
      hospitalId: HOME,
      fullName: seed.name,
      phone: seed.phone,
      sex: seed.sex,
      dateOfBirth: null,
      statedAgeYears: seed.age,
      ageStatedOn: daysAgo(seed.visits[0]?.daysAgo ?? 0),
      villageOrArea: seed.village ?? null,
      district: seed.district ?? null,
      state: seed.state ?? null,
      bloodGroup: seed.bloodGroup ?? null,
      preferredLanguage: seed.language ?? "hi",
      notes: seed.notes ?? null,
      createdAt: daysAgo(seed.visits[0]?.daysAgo ?? 0),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const live = (seed.allergies ?? []).filter((a) => a.classId || a.freeText);
    for (const allergy of live) {
      const cls = allergyClasses.find((c) => c.id === allergy.classId);
      await patientRef.collection("allergies").doc().set({
        patientId: patientRef.id,
        allergyClassId: allergy.classId ?? null,
        label: cls?.label ?? allergy.freeText ?? "Unknown",
        freeText: allergy.freeText ?? null,
        reaction: allergy.reaction,
        severity: allergy.severity,
        recordedAt: daysAgo(allergy.daysAgo),
        recordedBy: "Clinic record",
        source: allergy.source ?? "patient",
        retractsAllergyId: null,
      });
    }

    seeded.push({ id: patientRef.id, seed, hasAllergy: live.length > 0 });
    for (const visit of seed.visits) {
      const visitRef = db().collection("visits").doc();
      const vitals = vitalsFrom(seed, visit);
      const items = visit.items ? itemsFrom(visit.items) : [];
      const times = visitTimes(visit.daysAgo, visit.tokenNumber ?? null, visitCount);
      const at = times.reg;
      const closed = visit.stage === "prescribed";

      // A visit past the desk was sent to one of the doctors the desk is wired
      // to. Taken in turn, so every doctor has something in their queue.
      const routed = visit.stage !== "registered";
      const doctor = routed ? doctors[doctorTurn++ % doctors.length] : null;
      if (!closed) openPatients.add(patientRef.id);
      if (doctor) {
        lastDoctor.set(patientRef.id, {
          uid: uidByKey.get(doctor.key)!,
          name: doctor.displayName,
        });
      }

      await visitRef.set({
        hospitalId: HOME,
        patientId: patientRef.id,
        visitCode: generateVisitCode(),
        stage: visit.stage as Stage,
        department: visit.department ?? "general",
        tokenNumber: visit.tokenNumber ?? null,

        patientName: seed.name,
        patientPhone: seed.phone,
        patientAgeYears: seed.age,
        patientSex: seed.sex,
        patientVillage: seed.village ?? null,
        hasAllergy: live.length > 0,

        complaint: visit.complaint?.body ?? null,
        // Only from intake onwards: a visit still at the desk has no reading,
        // and showing one would be a lie on the doctor's queue.
        vitals: visit.stage === "registered" ? null : vitals,
        diagnosis: visit.diagnosis ?? null,
        itemCount: items.length,
        linkedPhones: [],
        assignedDoctorUid: doctor ? uidByKey.get(doctor.key)! : null,
        assignedDoctorName: doctor ? doctor.displayName : null,
        registeredAt: at,
        intakeCompletedAt: visit.stage === "registered" ? null : times.intake,
        consultationStartedAt: ["in_consultation", "prescribed"].includes(visit.stage) ? times.consult : null,
        prescribedAt: visit.stage === "prescribed" ? times.rx : null,
        closedAt: closed ? times.rx : null,
        registeredBy: "Front desk",
        notes: null,
      });
      visitCount += 1;

      if (visit.complaint) {
        await visitRef.collection("complaints").doc().set({
          visitId: visitRef.id,
          patientId: patientRef.id,
          body: visit.complaint.body,
          language: visit.complaint.language ?? seed.language ?? "hi",
          durationDays: visit.complaint.durationDays ?? null,
          severity: visit.complaint.severity ?? null,
          source: visit.complaint.source ?? "patient",
          recordedAt: at,
          recordedBy: "Front desk",
          supersedesId: null,
        });
      }

      if (vitals && visit.stage !== "registered") {
        await visitRef.collection("vitals").doc().set({
          visitId: visitRef.id,
          patientId: patientRef.id,
          ...vitals,
          notes: null,
          recordedAt: at,
          recordedBy: "Front desk",
          supersedesId: null,
        });
      }

      if (items.length > 0) {
        await visitRef.collection("prescriptions").doc().set({
          visitId: visitRef.id,
          patientId: patientRef.id,
          diagnosisText: visit.diagnosis ?? null,
          items,
          advice: visit.advice ?? null,
          followUpDays: visit.followUpDays ?? null,
          prescriberName: visit.prescriber ?? "Dr. A. Khan",
          prescriberUid: "seed",
          createdAt: times.rx,
          signedAt: times.rx,
          supersedesId: null,
        });
      }

      if (visit.grant) {
        const code = generateCode(10);
        const expired = visit.grant === "expired";
        await db().collection("accessGrants").doc(code).set({
          code,
          visitId: visitRef.id,
          patientId: patientRef.id,
          issuedTo: "patient",
          issuedAt: at,
          expiresAt: expired ? daysAgo(1) : daysAgo(-180),
          revokedAt: visit.grant === "revoked" ? at : null,
          revokedReason:
            visit.grant === "revoked" ? "Slip reported lost" : null,
          issuedBy: "Medicine counter",
        });
        if (visit.grant === "live" && !grantCode) grantCode = code;
      }
    }
  }

  // ------------------------------------------------------ pre-visit requests
  // Three people who have not come in yet, one at each early stage, so the
  // desk's inbox, a doctor's requests and the patient's own status all have
  // something real to show: a request nobody has picked up, one waiting on a
  // doctor, and one that is confirmed for tomorrow morning.
  const today = todayInClinic();
  // Not the demo family phone: Ramesh on it is left free to ask for a visit himself.
  const free = seeded.filter((x) => !openPatients.has(x.id) && x.seed.phone !== "9811044321");
  const demoRequests: {
    who: (typeof free)[number] | undefined;
    stage: "requested" | "proposed" | "scheduled";
    mode: "new_problem" | "existing_doctor";
    complaint: string;
    day: string;
  }[] = [
    { who: free[0], stage: "requested", mode: "new_problem", complaint: "Pet mein dard aur ulti, kal raat se.", day: addDays(today, 1) },
    { who: free[1], stage: "proposed", mode: "existing_doctor", complaint: "Follow-up visit", day: addDays(today, 1) },
    { who: free[2], stage: "scheduled", mode: "existing_doctor", complaint: "Sugar ki jaanch aur dawa badalni hai.", day: addDays(today, 1) },
  ];
  for (const r of demoRequests) {
    if (!r.who) continue;
    const { id, seed, hasAllergy } = r.who;
    const saw = lastDoctor.get(id) ?? null;
    const named = r.mode === "existing_doctor" ? saw : null;
    const assigned = r.stage === "requested" ? null : saw;
    await db()
      .collection("visits")
      .doc()
      .set({
        hospitalId: HOME,
        patientId: id,
        visitCode: generateVisitCode(),
        stage: r.stage,
        department: "general",
        tokenNumber: null,
        patientName: seed.name,
        patientPhone: seed.phone,
        patientAgeYears: seed.age,
        patientSex: seed.sex,
        patientVillage: seed.village ?? null,
        hasAllergy,
        complaint: r.complaint,
        vitals: null,
        diagnosis: null,
        itemCount: 0,
        linkedPhones: [],
        assignedDoctorUid: assigned?.uid ?? null,
        assignedDoctorName: assigned?.name ?? null,
        source: "pre_visit",
        requestMode: r.mode,
        requestedDoctorUid: named?.uid ?? null,
        requestedDoctorName: named?.name ?? null,
        preferredDate: r.day,
        scheduledFor:
          r.stage === "scheduled"
            ? Timestamp.fromDate(slotInstant(r.day, "10:30"))
            : null,
        declines: [],
        // The hospital's clock: a request still waiting has minutes left, and a
        // confirmed one has kept its promise.
        respondBy:
          r.stage === "scheduled"
            ? null
            : Timestamp.fromDate(
                new Date(Date.now() + (r.stage === "requested" ? 9 : 12) * 60_000),
              ),
        candidateHospitalIds: ["h-cp", "h-noida", "h-dwarka"],
        attempts: [
          {
            hospitalId: "h-cp",
            hospitalName: "Rohini City Hospital",
            at: new Date().toISOString(),
            outcome: r.stage === "scheduled" ? "answered" : "waiting",
          },
        ],
        exhausted: false,
        // The confirmed booking comes with a list to bring, half of it ready, so
        // the checklist has something on it from the first sign-in.
        ...(r.stage === "scheduled"
          ? {
              bring: ["id_proof", "reports", "fasting"],
              bringNote: "Come to Gate 2, ground floor.",
              bringReady: ["id_proof"],
            }
          : {}),
        registeredAt: FieldValue.serverTimestamp(),
        requestedAt: FieldValue.serverTimestamp(),
        intakeCompletedAt: null,
        consultationStartedAt: null,
        prescribedAt: null,
        closedAt: null,
        registeredBy: "Patient",
        notes: null,
      });
    visitCount += 1;
  }

  // ---------------------------------------------- the other hospitals' day
  // Dwarka and Noida each get a working morning of their own: people at the
  // desk, with the doctor, and at the medicine counter, so signing in as any
  // member of those teams shows a real queue, and so the hospitals on the map
  // are not empty rooms. Their records are theirs alone.
  type Person = {
    name: string;
    phone: string;
    age: number;
    sex: "male" | "female";
    village: string;
    stage: "registered" | "intake_complete" | "prescribed";
    complaint?: string;
    diagnosis?: string;
    temperatureC?: number;
    pulseBpm?: number;
    systolic?: number;
    diastolic?: number;
    items?: ItemSeed[];
  };
  const emptyVitals = {
    systolicMmhg: null, diastolicMmhg: null, pulseBpm: null, temperatureC: null,
    respiratoryRate: null, spo2Pct: null, weightKg: null, heightCm: null,
    bloodSugarMgdl: null, bloodSugarType: null,
  };
  const DAYS: { hospital: string; doctor: string; people: Person[] }[] = [
    {
      hospital: "h-dwarka", doctor: "dwarkadoc",
      people: [
        { name: "Anjali Verma", phone: "9811990011", age: 29, sex: "female", village: "Dwarka Sector 7", stage: "intake_complete", complaint: "Bukhar aur gale mein dard, do din se.", temperatureC: 38.4, pulseBpm: 96, systolic: 118, diastolic: 76 },
        { name: "Manoj Tiwari", phone: "9811990022", age: 44, sex: "male", village: "Uttam Nagar", stage: "registered" },
        { name: "Geeta Rawat", phone: "9811990033", age: 61, sex: "female", village: "Dwarka Sector 12", stage: "prescribed", complaint: "Gale mein kharash aur khaansi.", diagnosis: "Acute pharyngitis", items: [{ drug: "paracetamol", freq: "TDS", days: 3, timing: "after_food" }, { drug: "cetirizine", freq: "HS", days: 5, timing: "after_food" }] },
      ],
    },
    {
      hospital: "h-noida", doctor: "noidadoc",
      people: [
        { name: "Rahul Saxena", phone: "9958770011", age: 33, sex: "male", village: "Sector 63", stage: "intake_complete", complaint: "Pet mein dard aur dast, kal se.", temperatureC: 37.6, pulseBpm: 88, systolic: 124, diastolic: 80 },
        { name: "Neha Gupta", phone: "9958770022", age: 26, sex: "female", village: "Sector 62", stage: "registered" },
        { name: "Imtiaz Ali", phone: "9958770033", age: 52, sex: "male", village: "Sector 70", stage: "prescribed", complaint: "Dast aur kamzori.", diagnosis: "Acute gastroenteritis", items: [{ drug: "ors", freq: "TDS", days: 3 }, { drug: "pantoprazole", freq: "OD", days: 5, timing: "before_food" }] },
      ],
    },
  ];
  for (const day of DAYS) {
    const doctor = TEAM.find((m) => m.key === day.doctor)!;
    const doctorUid = uidByKey.get(day.doctor)!;
    for (const person of day.people) {
      const patientRef = db().collection("patients").doc();
      await patientRef.set({
        hospitalId: day.hospital, fullName: person.name, phone: person.phone,
        sex: person.sex, dateOfBirth: null, statedAgeYears: person.age,
        ageStatedOn: daysAgo(0), villageOrArea: person.village, district: null,
        state: null, bloodGroup: null, preferredLanguage: "hi", notes: null,
        createdAt: daysAgo(0), updatedAt: FieldValue.serverTimestamp(),
      });
      const past = person.stage !== "registered";
      const items = person.items ? itemsFrom(person.items) : [];
      const vitals = past
        ? { ...emptyVitals, temperatureC: person.temperatureC ?? null, pulseBpm: person.pulseBpm ?? null, systolicMmhg: person.systolic ?? null, diastolicMmhg: person.diastolic ?? null }
        : null;
      const times = visitTimes(0, null, visitCount);
      const at = times.reg;
      const visitRef = db().collection("visits").doc();
      await visitRef.set({
        hospitalId: day.hospital, patientId: patientRef.id, visitCode: generateVisitCode(),
        stage: person.stage, department: "general", tokenNumber: null,
        patientName: person.name, patientPhone: person.phone, patientAgeYears: person.age,
        patientSex: person.sex, patientVillage: person.village, hasAllergy: false,
        complaint: person.complaint ?? null, vitals, diagnosis: person.diagnosis ?? null,
        itemCount: items.length, linkedPhones: [],
        assignedDoctorUid: past ? doctorUid : null,
        assignedDoctorName: past ? doctor.displayName : null,
        source: "walk_in", registeredAt: at,
        intakeCompletedAt: past ? times.intake : null, consultationStartedAt: person.stage === "prescribed" ? times.consult : null,
        prescribedAt: person.stage === "prescribed" ? times.rx : null,
        closedAt: person.stage === "prescribed" ? times.rx : null, registeredBy: "Front desk", notes: null,
      });
      visitCount += 1;
      if (items.length > 0) {
        await visitRef.collection("prescriptions").doc().set({
          visitId: visitRef.id, patientId: patientRef.id, diagnosisText: person.diagnosis ?? null,
          items, advice: "Aaram karein aur paani zyada piyein.", followUpDays: 5,
          prescriberName: doctor.displayName, prescriberUid: doctorUid,
          createdAt: at, signedAt: at, supersedesId: null,
        });
      }
    }
  }

  // Requests still on the clock at the other hospitals, so the desk's inbox, the
  // countdown and the "pass it on" button all have something to act on. One is
  // down to its last few minutes.
  const CLOCKED: { hospital: string; name: string; phone: string; age: number; sex: "male" | "female"; village: string; stage: "requested" | "proposed"; minutes: number; complaint: string; bring?: string[]; note?: string; candidates: string[] }[] = [
    { hospital: "h-noida", name: "Sunil Joshi", phone: "9958770044", age: 47, sex: "male", village: "Sector 18", stage: "requested", minutes: 3, complaint: "Seene mein dard aur saans phoolti hai.", bring: ["id_proof", "reports"], note: "Come to Gate 2.", candidates: ["h-noida", "h-cp", "h-dwarka"] },
    { hospital: "h-dwarka", name: "Kavita Menon", phone: "9811990044", age: 35, sex: "female", village: "Sector 10", stage: "requested", minutes: 11, complaint: "Skin par daane aur khujli, ek hafte se.", candidates: ["h-dwarka", "h-cp", "h-noida"] },
    { hospital: "h-dwarka", name: "Aman Khanna", phone: "9811990055", age: 8, sex: "male", village: "Sector 12", stage: "proposed", minutes: 8, complaint: "Bachche ko bukhar aur khaansi hai.", bring: ["medicines"], candidates: ["h-dwarka", "h-cp", "h-noida"] },
  ];
  for (const r of CLOCKED) {
    const patientRef = db().collection("patients").doc();
    await patientRef.set({
      hospitalId: r.hospital, fullName: r.name, phone: r.phone, sex: r.sex,
      dateOfBirth: null, statedAgeYears: r.age, ageStatedOn: daysAgo(0),
      villageOrArea: r.village, district: null, state: null, bloodGroup: null,
      preferredLanguage: "hi", notes: null, createdAt: daysAgo(0), updatedAt: FieldValue.serverTimestamp(),
    });
    const hospitalName = HOSPITALS.find((h) => h.id === r.hospital)!.name;
    const doc = TEAM.find((m) => m.hospital === r.hospital && m.accountType === "doctor")!;
    await db().collection("visits").doc().set({
      hospitalId: r.hospital, patientId: patientRef.id, visitCode: generateVisitCode(),
      stage: r.stage, department: "general", tokenNumber: null,
      patientName: r.name, patientPhone: r.phone, patientAgeYears: r.age, patientSex: r.sex,
      patientVillage: r.village, hasAllergy: false, complaint: r.complaint, vitals: null,
      diagnosis: null, itemCount: 0, linkedPhones: [],
      assignedDoctorUid: r.stage === "proposed" ? uidByKey.get(doc.key)! : null,
      assignedDoctorName: r.stage === "proposed" ? doc.displayName : null,
      source: "pre_visit", requestMode: "new_problem",
      requestedDoctorUid: null, requestedDoctorName: null, preferredDate: addDays(todayInClinic(), 1),
      scheduledFor: null, declines: [],
      respondBy: Timestamp.fromDate(new Date(Date.now() + r.minutes * 60_000)),
      candidateHospitalIds: r.candidates,
      attempts: [{ hospitalId: r.hospital, hospitalName, at: new Date().toISOString(), outcome: "waiting" }],
      exhausted: false,
      ...(r.bring ? { bring: r.bring, bringNote: r.note ?? null, bringReady: [] } : {}),
      registeredAt: FieldValue.serverTimestamp(), requestedAt: FieldValue.serverTimestamp(),
      intakeCompletedAt: null, consultationStartedAt: null, prescribedAt: null,
      closedAt: null, registeredBy: "Patient", notes: null,
    });
    visitCount += 1;
  }

  // ------------------------------------------------------------ the history
  // Thirty days of an OPD behind each set-up, so Stats, the activity log and
  // today's counters look like a clinic that has been open a month.
  {
    const staff = (key: string) => {
      const m = TEAM.find((x) => x.key === key)!;
      const seat = layoutOf(m.hospital).seats.find((s) => s.id === seatFor(m));
      return { uid: uidByKey.get(key)!, name: m.displayName, seatName: seat?.name ?? null, qualification: m.qualification ?? null, registrationNo: m.registrationNo ?? null };
    };
    const history: HistoryHospital[] = [
      {
        id: "h-cp", name: "Rohini City Hospital", fee: 300, pool: 420, perDay: [26, 38], sessions: [[9, 17]], tokens: true,
        areas: ["Sector 7, Rohini", "Sector 8, Rohini", "Sector 11, Rohini", "Sector 13, Rohini", "Sector 15, Rohini", "Sector 16, Rohini", "Sector 17, Rohini", "Pitampura", "Prashant Vihar", "Budh Vihar", "Mangolpuri", "Sultanpuri"],
        takenToday: patients.flatMap((p) => p.visits.filter((v) => v.daysAgo === 0 && v.tokenNumber).map((v) => v.tokenNumber!)),
        doctors: { general: staff("khan"), cardiology: staff("mehta") },
        desk: staff("anil"), vitals: staff("mary"), pharmacy: staff("pooja"), billing: staff("vikram"),
      },
      {
        id: "h-dwarka", name: "Sector 9 Care Hospital", fee: 200, pool: 220, perDay: [12, 20], sessions: [[9, 14], [17, 20]], tokens: false,
        areas: ["Sector 9, Rohini", "Sector 20, Rohini", "Sector 22, Rohini", "Sector 24, Rohini", "Begumpur", "Pooth Kalan", "Vijay Vihar", "Rithala"],
        doctors: { general: staff("dwarkadoc") },
        desk: staff("dwarkadesk"), vitals: staff("dwarkadesk"), pharmacy: null, billing: staff("sneha"),
      },
      {
        id: "h-noida", name: "Dr. Verma's Clinic", fee: 200, pool: 160, perDay: [8, 14], sessions: [[9, 13], [17, 21]], tokens: false,
        areas: ["Sector 15, Rohini", "Sector 16, Rohini", "Sector 18, Rohini", "Pitampura", "Prashant Vihar", "Shalimar Bagh", "Haiderpur", "Sector 3, Rohini"],
        doctors: { general: staff("noidadoc") },
        desk: staff("noidadoc"), vitals: staff("noidadoc"), pharmacy: null, billing: staff("noidadoc"),
      },
    ];
    const taken = new Set<string>([...patients.map((p) => p.phone), ...DAYS.flatMap((x) => x.people.map((p) => p.phone)), ...CLOCKED.map((c) => c.phone)]);
    visitCount += await seedHistory(history, taken);
  }

  // ---------------------------------------------------------- a family phone
  // Kamla is "Dadi" on the shared phone, and needs help with it: signing in as
  // that phone and choosing her shows the simple screen. Set every run, so
  // the demo starts the same whatever was changed by hand.
  await db().collection("profiles").doc(profileId("9811044321", "Kamla Devi")).set({
    ownerPhone: "9811044321",
    name: "Kamla Devi",
    nickname: "Dadi",
    ageYears: 71,
    sex: "female",
    look: {},
    needsHelp: true,
    helperName: "Beta",
    helperNumber: "9811000000",
    callNumber: null,
    callNumberVerified: false,
    access: { lowVision: false, deaf: false, largeText: true, highContrast: false },
    updatedAt: FieldValue.serverTimestamp(),
  });

  // The family's medicines, matching what their doctors prescribed: Kamla's
  // heart medicines (one due as the demo is loaded, so her simple screen shows
  // the big "I took it" button straight away), Sunita's blood pressure tablet,
  // Ramesh's diabetes medicines. Doses earlier today are already ticked, so the
  // Medicines tab reads like a real day. India time.
  {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const get = (t: string) => parts.find((x) => x.type === t)!.value;
    const today = `${get("year")}-${get("month")}-${get("day")}`;
    const now = `${get("hour")}:${get("minute")}`;
    const started = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);
    const FAMILY = "9811044321";
    const meds: { id: string; person: string; title: string; detail: string; times: string[]; days?: number }[] = [
      { id: "seed-kamla-calcium", person: "Kamla Devi", title: "Calcium + D3 500", detail: "after food", times: [now] },
      { id: "seed-kamla-metoprolol", person: "Kamla Devi", title: "Metoprolol 25 mg", detail: "after food", times: ["08:00", "20:00"] },
      { id: "seed-kamla-warfarin", person: "Kamla Devi", title: "Warfarin 2 mg", detail: "after food, same time daily", times: ["21:00"] },
      { id: "seed-sunita-amlodipine", person: "Sunita Devi", title: "Amlodipine 5 mg", detail: "after food", times: ["09:00"] },
      { id: "seed-sunita-calcium", person: "Sunita Devi", title: "Calcium + D3 500", detail: "after food", times: ["14:00"] },
      { id: "seed-ramesh-glimepiride", person: "Ramesh Chand", title: "Glimepiride 1 mg", detail: "before food", times: ["07:30"] },
      { id: "seed-ramesh-metformin", person: "Ramesh Chand", title: "Metformin 500 mg", detail: "after food", times: ["08:30", "20:30"] },
      { id: "seed-ramesh-amitriptyline", person: "Ramesh Chand", title: "Amitriptyline 10 mg", detail: "at bedtime", times: ["22:00"], days: 30 },
    ];
    await wipe("doseLogs");
    for (const r of await db().collection("reminders").where("ownerPhone", "==", FAMILY).get().then((q) => q.docs)) await r.ref.delete();
    const taken: Record<string, string> = {};
    for (const m of meds) {
      await db().collection("reminders").doc(m.id).set({
        ownerPhone: FAMILY, personName: m.person, kind: "medicine", days: [], enabled: true, source: null,
        title: m.title, detail: m.detail, times: m.times,
        startDate: m.id === "seed-kamla-calcium" ? today : started,
        endDate: m.days ? new Date(Date.now() + m.days * 86400000).toISOString().slice(0, 10) : null,
      });
      // Taken already: anything due more than half an hour ago today.
      for (const time of m.times) if (time < now && m.id !== "seed-kamla-calcium" && minutesBetween(time, now) > 30) taken[`${m.id}@${time.replace(":", "")}`] = new Date().toISOString();
    }
    await db().collection("doseLogs").doc(`${FAMILY}__${today}`).set({ ownerPhone: FAMILY, date: today, taken });
  }

  // ------------------------------------------------------------- assertions
  const problems: string[] = [];

  const byPhone = new Map<string, number>();
  for (const p of patients) byPhone.set(p.phone, (byPhone.get(p.phone) ?? 0) + 1);
  const shared = [...byPhone.entries()].filter(([, n]) => n > 1);
  if (shared.length === 0) {
    problems.push("no shared handset in the fixture — the household model has nothing to show");
  }

  const sugarCase = patients.flatMap((p) =>
    p.visits
      .filter((v) => (v.vitals?.sugar ?? p.baseline.sugar ?? 0) >= 250)
      .map((v) => `${p.name} at ${v.vitals?.sugar ?? p.baseline.sugar}`),
  );
  if (sugarCase.length === 0) {
    problems.push("no high intake sugar — the drug/vitals rule has nothing to fire on");
  }

  if (!patients.some((p) => (p.allergies ?? []).length > 0)) {
    problems.push("no recorded allergy — the drug/allergy rule has nothing to fire on");
  }

  return {
    patients: patients.length,
    visits: visitCount,
    drugs: drugs.length,
    interactions: interactions.length,
    sharedHandsets: shared.map(([phone, n]) => `${phone} -> ${n}`),
    liveCode: grantCode,
    staff: TEAM.map((s) => s.email),
    problems,
  };
});
