/**
 * Thirty days of a believable OPD behind each demo hospital.
 *
 * The fixtures in packages/core/src/demo hold the people the walkthrough is
 * about. This adds the crowd around them, so every screen that counts or lists
 * (Stats over 1, 7 and 30 days, the activity log, the pharmacy and billing
 * lists for today, a doctor's history with a patient) looks like a clinic that
 * has been open for a month rather than one that opened this morning.
 *
 * What makes it look real, and what it is built from:
 * - Volume by weekday: a Monday rush, a quiet Sunday; mornings busier than
 *   afternoons; the personal practice keeps morning and evening sessions.
 * - What people come with: the common presentations of a Delhi OPD in late
 *   October (viral fever and suspected dengue, coughs and colds, stomach upsets,
 *   and the steady stream of diabetes and blood-pressure follow-ups), each with
 *   the vitals, tests and medicines a doctor would actually write.
 * - People return: chronic patients come back about monthly, and had a visit
 *   before the window too, so "Same as last visit" has something to copy.
 * - Waits grow at the peak; a few people leave before they are seen; some
 *   arrive through the app, and a few requests timed out at one hospital and
 *   were answered by the next.
 * - The counters close the loop: the pharmacy gives out what was prescribed (a
 *   brand swap now and then), the bill is the consultation fee plus medicines,
 *   and most are paid, by cash or UPI more than card.
 *
 * Everything comes from one seeded random generator, so the demo is the same
 * on every run, and every name, phone number and record is made up.
 */
import { Timestamp, getFirestore } from "firebase-admin/firestore";

import { tokenDoc } from "./tokens.js";

import { drugs } from "../../../packages/core/src/demo/index.js";
import { normaliseFrequency, suggestedQuantity } from "../../../packages/core/src/items.js";
import { generateVisitCode } from "../../../packages/core/src/paths.js";
import { rupees } from "../../../packages/core/src/counter.js";
import type { PrescriptionItem, Timing, VitalsSummary } from "../../../packages/core/src/types.js";

const db = () => getFirestore();
const MIN = 60_000;
const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;

/* ---------------------------------------------------------------- random */

/** mulberry32: small, fast, and the same sequence for the same seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)];
  const chance = (p: number) => next() < p;
  const weighted = <T,>(list: readonly { w: number; v: T }[]) => {
    let r = next() * list.reduce((s, x) => s + x.w, 0);
    for (const x of list) if ((r -= x.w) < 0) return x.v;
    return list[list.length - 1].v;
  };
  return { next, int, pick, chance, weighted };
}
type Rng = ReturnType<typeof rng>;

/* ---------------------------------------------------------------- people */

const MEN = ["Prashant", "Suresh", "Mohammed", "Arjun", "Vikas", "Deepak", "Harpreet", "Sanjay", "Imran", "Rajesh", "Amit", "Pradeep", "Karan", "Naveen", "Joseph", "Abdul", "Gopal", "Bhupinder", "Mahesh", "Rakesh", "Salim", "Anil", "Ashok", "Dinesh", "Manoj", "Yusuf", "Sunil", "Hari", "Vinod", "Rohit"];
const WOMEN = ["Priya", "Priya", "Fatima", "Kavita", "Meena", "Neelam", "Shabnam", "Anita", "Seema", "Lakshmi", "Gurpreet", "Nirmala", "Ritu", "Sarita", "Rubina", "Asha", "Usha", "Poonam", "Savita", "Nazia", "Komal", "Rani", "Shanti", "Geeta", "Mamta", "Farzana", "Suman", "Jyoti", "Babita", "Radha"];
const BOYS = ["Aarav", "Vivaan", "Ayaan", "Kabir", "Rehan", "Ishaan", "Arnav", "Zaid", "Dev", "Yash"];
const GIRLS = ["Ananya", "Aadhya", "Saanvi", "Myra", "Zara", "Diya", "Kiara", "Inaya", "Pari", "Navya"];
const SURNAMES = ["Sharma", "Verma", "Gupta", "Singh", "Kumar", "Yadav", "Khan", "Ansari", "Qureshi", "Chauhan", "Rawat", "Bisht", "Negi", "Mishra", "Pandey", "Tiwari", "Jha", "Das", "Nair", "Thomas", "Gill", "Arora", "Malhotra", "Bansal", "Agarwal", "Meena", "Saini", "Prajapati", "Siddiqui", "Joshi"];

type Pid = { id: string; name: string; phone: string; age: number; sex: "male" | "female"; area: string; chronic: Condition | null; allergy: { classId: string; label: string; reaction: string } | null };

/* ------------------------------------------------------------ conditions */

type Line = { drug: string; freq: string; days: number; timing?: Timing; strength?: string; form?: string; every?: number };
type Condition = {
  key: string;
  weight: number;
  ages: [number, number];
  sex?: "male" | "female";
  chronic?: boolean;
  dept: "general" | "cardiology" | "paediatrics";
  complaints: string[];
  diagnosis: string;
  vitals: (r: Rng, age: number) => Partial<VitalsSummary>;
  lines: Line[];
  tests?: string[];
  testChance?: number;
  advice: string;
  followUp: number | null;
};

const fever = (r: Rng, lo = 37.8, hi = 39.2) => Math.round((lo + r.next() * (hi - lo)) * 10) / 10;
const normalBp = (r: Rng) => ({ systolicMmhg: r.int(108, 132), diastolicMmhg: r.int(70, 86) });

const CONDITIONS: Condition[] = [
  { key: "viral", weight: 16, ages: [5, 75], dept: "general", complaints: ["Bukhar aur badan dard, do din se.", "Tez bukhar, sar dard aur kamzori.", "Bukhar aa raha hai, raat ko zyada."], diagnosis: "Viral fever", vitals: (r) => ({ temperatureC: fever(r), pulseBpm: r.int(90, 112), ...normalBp(r) }), lines: [{ drug: "paracetamol", freq: "TDS", days: 3, timing: "after_food", strength: "650 mg" }, { drug: "cetirizine", freq: "HS", days: 5, timing: "after_food" }], tests: ["CBC"], testChance: 0.4, advice: "Aaram karein, paani zyada piyein.\nBukhar 3 din se zyada rahe to turant aayein.", followUp: 3 },
  { key: "dengue", weight: 7, ages: [10, 65], dept: "general", complaints: ["Tez bukhar, aankhon ke peeche dard aur badan toot raha hai.", "Bukhar ke saath jodon mein bahut dard."], diagnosis: "Acute febrile illness, suspected dengue", vitals: (r) => ({ temperatureC: fever(r, 38.5, 39.8), pulseBpm: r.int(96, 118), systolicMmhg: r.int(100, 120), diastolicMmhg: r.int(64, 78) }), lines: [{ drug: "paracetamol", freq: "TDS", days: 3, timing: "after_food", strength: "650 mg" }, { drug: "ors", freq: "TDS", days: 3 }], tests: ["Dengue NS1", "CBC"], testChance: 1, advice: "Dard ki aur koi goli (Brufen, Combiflam) na lein.\nPaani, nariyal paani, ORS zyada piyein.\nPlatelet report kal dikhayein.", followUp: 1 },
  { key: "pharyngitis", weight: 8, ages: [12, 60], dept: "general", complaints: ["Gale mein dard aur nigalne mein takleef.", "Gala kharab, halka bukhar."], diagnosis: "Acute pharyngitis", vitals: (r) => ({ temperatureC: fever(r, 37.4, 38.4), pulseBpm: r.int(82, 100), ...normalBp(r) }), lines: [{ drug: "amoxicillin", freq: "TDS", days: 5, timing: "after_food", strength: "500 mg" }, { drug: "paracetamol", freq: "SOS", days: 3, timing: "after_food", strength: "650 mg" }], advice: "Garam paani se garare karein.\nThanda na piyein.", followUp: 5 },
  { key: "cold", weight: 9, ages: [14, 70], dept: "general", complaints: ["Naak beh rahi hai, chheenk aur khaansi.", "Zukaam aur halki khaansi, teen din se."], diagnosis: "Upper respiratory tract infection", vitals: (r) => ({ temperatureC: fever(r, 36.9, 37.7), pulseBpm: r.int(76, 92), ...normalBp(r), spo2Pct: r.int(96, 99) }), lines: [{ drug: "levocetirizine", freq: "HS", days: 5, timing: "after_food" }, { drug: "paracetamol", freq: "SOS", days: 3, timing: "after_food", strength: "650 mg" }], advice: "Bhaap lein, garam paani piyein.", followUp: null },
  { key: "gastro", weight: 7, ages: [8, 70], dept: "general", complaints: ["Dast aur ulti, kal raat se.", "Pet mein marod aur patle dast."], diagnosis: "Acute gastroenteritis", vitals: (r) => ({ temperatureC: fever(r, 37.0, 38.0), pulseBpm: r.int(88, 108), systolicMmhg: r.int(100, 122), diastolicMmhg: r.int(64, 80) }), lines: [{ drug: "ors", freq: "TDS", days: 3 }, { drug: "ondansetron", freq: "SOS", days: 2, timing: "before_food", strength: "4 mg" }, { drug: "pantoprazole", freq: "OD", days: 5, timing: "before_food" }], advice: "Har dast ke baad ORS lein.\nKhichdi, dahi, kela khayein.", followUp: 3 },
  { key: "gastritis", weight: 6, ages: [20, 70], dept: "general", complaints: ["Pet mein jalan aur khatti dakar.", "Khana khane ke baad pet bhaari lagta hai."], diagnosis: "Acid peptic disease", vitals: (r) => ({ pulseBpm: r.int(72, 90), ...normalBp(r) }), lines: [{ drug: "pantoprazole", freq: "OD", days: 14, timing: "before_food" }, { drug: "domperidone", freq: "TDS", days: 5, timing: "before_food" }], advice: "Tel, masala aur bahar ka khana kam karein.\nRaat ka khana sone se 2 ghante pehle.", followUp: 14 },
  { key: "diabetes", weight: 11, ages: [38, 78], chronic: true, dept: "general", complaints: ["Sugar ki dawa khatam ho gayi, jaanch karani hai.", "Sugar check karwana hai, pyaas zyada lagti hai.", "Mahine ka check-up, sugar ki dawa."], diagnosis: "Type 2 diabetes mellitus, follow-up", vitals: (r) => ({ bloodSugarMgdl: r.int(132, 268), bloodSugarType: "random", systolicMmhg: r.int(122, 146), diastolicMmhg: r.int(78, 92), pulseBpm: r.int(72, 90), weightKg: r.int(58, 92) }), lines: [{ drug: "metformin", freq: "BD", days: 30, timing: "after_food", strength: "500 mg" }, { drug: "glimepiride", freq: "OD", days: 30, timing: "before_food", strength: "1 mg" }], tests: ["HbA1c", "Blood sugar (F/PP)"], testChance: 0.5, advice: "Meetha band karein, roz 30 minute chalein.\nSugar roz subah khaali pet check karein.", followUp: 30 },
  { key: "hypertension", weight: 10, ages: [40, 82], chronic: true, dept: "general", complaints: ["BP ki dawa ke liye aaye hain.", "Sar mein bhaaripan, BP check karna hai.", "Mahine ka BP check-up."], diagnosis: "Essential hypertension, follow-up", vitals: (r) => ({ systolicMmhg: r.int(136, 168), diastolicMmhg: r.int(86, 102), pulseBpm: r.int(70, 92), weightKg: r.int(56, 90) }), lines: [{ drug: "amlodipine", freq: "OD", days: 30, timing: "after_food", strength: "5 mg" }, { drug: "telmisartan", freq: "OD", days: 30, timing: "after_food", strength: "40 mg" }], tests: ["KFT", "Lipid profile"], testChance: 0.3, advice: "Namak kam karein.\nDawa roz ek hi samay lein, band na karein.", followUp: 30 },
  { key: "thyroid", weight: 3, ages: [28, 65], sex: "female", chronic: true, dept: "general", complaints: ["Thyroid ki dawa aur report dikhani hai.", "Thakaan aur wazan badh raha hai."], diagnosis: "Hypothyroidism, follow-up", vitals: (r) => ({ pulseBpm: r.int(62, 80), ...normalBp(r), weightKg: r.int(54, 82) }), lines: [{ drug: "levothyroxine", freq: "OD", days: 30, timing: "empty_stomach", strength: "50 mcg" }], tests: ["TSH"], testChance: 0.6, advice: "Dawa subah khaali pet, aadha ghanta pehle lein.", followUp: 30 },
  { key: "knees", weight: 6, ages: [50, 82], dept: "general", complaints: ["Ghutno mein dard, seedhi chadhne mein takleef.", "Ghutne sujte hain, chalna mushkil."], diagnosis: "Osteoarthritis of both knees", vitals: (r) => ({ pulseBpm: r.int(70, 88), systolicMmhg: r.int(124, 148), diastolicMmhg: r.int(78, 90), weightKg: r.int(58, 86) }), lines: [{ drug: "aceclofenac", freq: "BD", days: 5, timing: "after_food" }, { drug: "calcium_vitamin_d3", freq: "OD", days: 30, timing: "after_food" }], advice: "Garam paani ki sikai karein.\nSeedhiyan kam chadhein, wazan kam karein.", followUp: 14 },
  { key: "anaemia", weight: 4, ages: [16, 45], sex: "female", dept: "general", complaints: ["Kamzori aur chakkar aate hain.", "Jaldi thak jaati hoon, saans phoolti hai."], diagnosis: "Iron deficiency anaemia", vitals: (r) => ({ pulseBpm: r.int(88, 104), systolicMmhg: r.int(100, 116), diastolicMmhg: r.int(62, 74), weightKg: r.int(44, 60) }), lines: [{ drug: "iron_folic_acid", freq: "OD", days: 30, timing: "after_food" }], tests: ["CBC"], testChance: 1, advice: "Hari sabziyan, gud, chana khayein.\nGoli ke saath chai na piyein.", followUp: 30 },
  { key: "uti", weight: 4, ages: [18, 70], sex: "female", dept: "general", complaints: ["Peshab mein jalan aur baar baar jaana.", "Peshab mein jalan, halka bukhar."], diagnosis: "Urinary tract infection", vitals: (r) => ({ temperatureC: fever(r, 37.2, 38.2), pulseBpm: r.int(80, 98), ...normalBp(r) }), lines: [{ drug: "cefixime", freq: "BD", days: 5, timing: "after_food", strength: "200 mg" }, { drug: "paracetamol", freq: "SOS", days: 3, timing: "after_food", strength: "650 mg" }], tests: ["Urine routine"], testChance: 0.8, advice: "Din mein 3 litre paani piyein.", followUp: 5 },
  { key: "asthma", weight: 4, ages: [12, 70], dept: "general", complaints: ["Saans phoolti hai aur seeti ki awaaz.", "Raat ko khaansi aur saans lene mein takleef."], diagnosis: "Bronchial asthma, acute exacerbation", vitals: (r) => ({ spo2Pct: r.int(93, 97), pulseBpm: r.int(90, 110), respiratoryRate: r.int(20, 26), ...normalBp(r) }), lines: [{ drug: "salbutamol", freq: "SOS", days: 15, form: "inhaler", strength: "100 mcg/puff" }, { drug: "montelukast", freq: "HS", days: 14, timing: "after_food", strength: "10 mg" }], advice: "Dhool aur dhuen se bachein.\nSaans zyada phoole to turant aayein.", followUp: 7 },
  { key: "fungal", weight: 3, ages: [16, 60], dept: "general", complaints: ["Jaangh par daad aur khujli.", "Skin par gol daane, khujli bahut."], diagnosis: "Tinea cruris", vitals: (r) => ({ ...normalBp(r), pulseBpm: r.int(70, 86) }), lines: [{ drug: "fluconazole", freq: "OD", days: 28, timing: "after_food", strength: "150 mg", every: 7 }, { drug: "levocetirizine", freq: "HS", days: 7, timing: "after_food" }], advice: "Kapde dhoop mein sukhayein, kisi aur ke saath na baantein.", followUp: 14 },
  { key: "new-bp", weight: 7, ages: [35, 75], dept: "cardiology", complaints: ["Sar dard aur chakkar, BP zyada aaya.", "Pharmacy par BP check kiya, zyada nikla."], diagnosis: "Hypertension, newly detected", vitals: (r) => ({ systolicMmhg: r.int(148, 176), diastolicMmhg: r.int(92, 106), pulseBpm: r.int(74, 96), weightKg: r.int(58, 94) }), lines: [{ drug: "amlodipine", freq: "OD", days: 30, timing: "after_food", strength: "5 mg" }], tests: ["ECG", "KFT", "Lipid profile"], testChance: 0.9, advice: "Namak kam karein, roz 30 minute chalein.\nGhar par BP note karein, agli baar dikhayein.", followUp: 14 },
  { key: "palpitations", weight: 7, ages: [28, 75], dept: "cardiology", complaints: ["Dil zor se dhadakta hai, ghabrahat hoti hai.", "Achanak dhadkan tez ho jaati hai, chakkar aata hai."], diagnosis: "Palpitations, for evaluation", vitals: (r) => ({ pulseBpm: r.int(92, 118), systolicMmhg: r.int(124, 150), diastolicMmhg: r.int(80, 94), spo2Pct: r.int(96, 99) }), lines: [{ drug: "metoprolol", freq: "OD", days: 14, timing: "after_food", strength: "25 mg" }], tests: ["ECG", "TSH", "CBC"], testChance: 0.9, advice: "Chai, coffee aur cigarette kam karein.\nChakkar ya behoshi ho to turant aayein.", followUp: 14 },
  { key: "child-fever", weight: 8, ages: [2, 11], dept: "paediatrics", complaints: ["Bachche ko bukhar aur khaansi, do din se.", "Bachcha khana nahi kha raha, bukhar hai."], diagnosis: "Viral fever with cough", vitals: (r, age) => ({ temperatureC: fever(r, 37.8, 39.0), pulseBpm: r.int(100, 130), weightKg: Math.round(age * 2 + 8 + r.next() * 3) }), lines: [{ drug: "paracetamol", freq: "TDS", days: 3, form: "syrup", strength: "125 mg/5 ml", timing: "after_food" }, { drug: "cetirizine", freq: "HS", days: 5, form: "syrup", strength: "5 mg/5 ml" }], advice: "Paani aur doodh dete rahein.\nSaans tez chale to turant laayein.", followUp: 3 },
  { key: "worms", weight: 2, ages: [3, 12], dept: "paediatrics", complaints: ["Bachche ke pet mein dard rehta hai, bhookh nahi.", "Raat ko daant peesta hai, pet dard."], diagnosis: "Intestinal worms", vitals: (r, age) => ({ pulseBpm: r.int(90, 110), weightKg: Math.round(age * 2 + 7 + r.next() * 3) }), lines: [{ drug: "albendazole", freq: "1-0-0", days: 1, timing: "after_food", strength: "400 mg" }], advice: "Haath dho kar khana khayein, nakhun chhote rakhein.", followUp: null },
  { key: "cardiac", weight: 5, ages: [45, 80], chronic: true, dept: "cardiology", complaints: ["Seene mein bhaaripan, chalne par saans phoolti hai.", "Dil ki dawa aur ECG ke liye."], diagnosis: "Chronic stable angina, follow-up", vitals: (r) => ({ systolicMmhg: r.int(128, 156), diastolicMmhg: r.int(80, 96), pulseBpm: r.int(62, 84), spo2Pct: r.int(95, 99), weightKg: r.int(60, 88) }), lines: [{ drug: "aspirin", freq: "OD", days: 30, timing: "after_food", strength: "75 mg" }, { drug: "atorvastatin", freq: "HS", days: 30, timing: "after_food", strength: "20 mg" }, { drug: "metoprolol", freq: "BD", days: 30, timing: "after_food", strength: "25 mg" }], tests: ["ECG", "Lipid profile"], testChance: 0.7, advice: "Seene mein dard 5 minute se zyada rahe to turant aayein.\nGhee, tel kam; roz halki sair.", followUp: 30 },
];

/* ------------------------------------------------------------ hospitals */

type Staff = { uid: string; name: string; seatName: string | null; qualification?: string | null; registrationNo?: string | null };
export type HistoryHospital = {
  id: string;
  name: string;
  fee: number;
  areas: string[];
  /** Patients on the register, roughly. */
  pool: number;
  /** Visits on a weekday; Sunday is about a third. */
  perDay: [number, number];
  /** Opening sessions in IST hours, [from, to). */
  sessions: [number, number][];
  tokens: boolean;
  /** Today's tokens already held by the walkthrough's own patients. */
  takenToday?: number[];
  doctors: { general: Staff; cardiology?: Staff; paediatrics?: Staff };
  desk: Staff;
  vitals: Staff;
  pharmacy: Staff | null;
  billing: Staff | null;
};

/** Writes the history. Returns how many visits it wrote. */
export async function seedHistory(hospitals: HistoryHospital[], avoidPhones: Set<string>): Promise<number> {
  const writer = db().bulkWriter();
  writer.onWriteError((e) => e.failedAttempts < 5);
  const r = rng(20261027);
  const now = Date.now();
  const startToday = Math.floor((now + IST) / DAY) * DAY - IST;
  let written = 0;
  const phones = new Set(avoidPhones);
  const phone = () => {
    for (;;) {
      const p = `${r.pick(["9", "9", "8", "7"])}${String(r.int(100000000, 999999999))}`;
      if (!phones.has(p)) return phones.add(p), p;
    }
  };

  for (const h of hospitals) {
    // ---- the register: a pool of people, some with a long-term condition.
    const chronicConds = CONDITIONS.filter((c) => c.chronic && (c.dept !== "cardiology" || h.doctors.cardiology));
    const pool: Pid[] = [];
    for (let i = 0; i < h.pool; i++) {
      const kid = r.chance(0.13);
      const sex: "male" | "female" = r.chance(0.52) ? "female" : "male";
      const age = kid ? r.int(2, 11) : r.weighted([{ w: 3, v: r.int(16, 30) }, { w: 4, v: r.int(31, 50) }, { w: 4, v: r.int(51, 70) }, { w: 1, v: r.int(71, 85) }]);
      const first = kid ? r.pick(sex === "female" ? GIRLS : BOYS) : r.pick(sex === "female" ? WOMEN : MEN);
      const chronic = !kid && age >= 30 && r.chance(0.32) ? r.pick(chronicConds.filter((c) => age >= c.ages[0] && age <= c.ages[1] && (!c.sex || c.sex === sex))) ?? null : null;
      const ref = db().collection("patients").doc();
      const allergy = r.chance(0.06)
        ? r.pick([
            { classId: "penicillins", label: "Penicillins", reaction: "Rash and itching" },
            { classId: "sulfonamides", label: "Sulfonamides (sulfa drugs)", reaction: "Hives" },
            { classId: "nsaids", label: "NSAIDs", reaction: "Swelling of the face" },
          ])
        : null;
      pool.push({ id: ref.id, name: `${first} ${r.pick(SURNAMES)}`, phone: phone(), age, sex, area: r.pick(h.areas), chronic, allergy });
    }
    const createdAt = Timestamp.fromMillis(startToday - r.int(40, 400) * DAY);
    for (const p of pool) {
      writer.set(db().collection("patients").doc(p.id), {
        hospitalId: h.id, fullName: p.name, phone: p.phone, sex: p.sex, dateOfBirth: null,
        statedAgeYears: p.age, ageStatedOn: createdAt, villageOrArea: p.area, district: null, state: "Delhi",
        bloodGroup: r.chance(0.4) ? r.pick(["B+", "O+", "A+", "AB+", "O-", "B-"]) : null,
        preferredLanguage: r.chance(0.8) ? "hi" : "en", notes: null, createdAt, updatedAt: createdAt,
      });
      if (p.allergy) {
        writer.set(db().collection("patients").doc(p.id).collection("allergies").doc(), {
          patientId: p.id, allergyClassId: p.allergy.classId, label: p.allergy.label, freeText: null,
          reaction: p.allergy.reaction, severity: "high", recordedAt: createdAt, recordedBy: "Clinic record", source: "patient", retractsAllergyId: null,
        });
      }
    }

    // When each chronic patient is next due: about monthly, first visit somewhere in the window.
    const due = new Map<string, number>();
    for (const p of pool) if (p.chronic) due.set(p.id, r.int(0, 34));

    // ---- each day, oldest first, so tokens and follow-ups run forward.
    for (let d = 30; d >= 0; d--) {
      const dayStart = startToday - d * DAY;
      const weekday = new Date(dayStart + IST).getUTCDay(); // 0 = Sunday
      const factor = weekday === 0 ? 0.35 : weekday === 1 ? 1.2 : weekday === 6 ? 0.85 : 1;
      let count = Math.round(r.int(h.perDay[0], h.perDay[1]) * factor);
      // Visits for today stop about an hour before now: what is still open is the fixtures' queue.
      const cutoff = d === 0 ? now - 70 * MIN : Infinity;

      // Who comes: chronic patients due today (or a day either side), then new problems.
      const todays: { p: Pid; c: Condition }[] = [];
      for (const p of pool) {
        const at = due.get(p.id);
        // Due today or overdue (a full day pushes them to the next).
        if (p.chronic && at !== undefined && 30 - d >= at && todays.length < count) {
          todays.push({ p, c: p.chronic });
          due.set(p.id, at + r.int(26, 33));
        }
      }
      while (todays.length < count) {
        const p = r.pick(pool);
        if (todays.some((t) => t.p.id === p.id)) continue;
        const fits = CONDITIONS.filter((c) => !c.chronic && p.age >= c.ages[0] && p.age <= c.ages[1] && (!c.sex || c.sex === p.sex) && (c.dept !== "paediatrics" || p.age < 12) && (c.dept !== "cardiology" || !!h.doctors.cardiology));
        if (!fits.length) continue;
        todays.push({ p, c: r.weighted(fits.map((c) => ({ w: c.weight, v: c }))) });
      }

      // Arrival times: weighted to each session's first hours.
      const minutes = todays.map(() => {
        const [from, to] = r.weighted(h.sessions.map((s, i) => ({ w: i === 0 ? 3 : 2, v: s })));
        const span = (to - from) * 60;
        return from * 60 + Math.floor(Math.pow(r.next(), 1.6) * span);
      }).sort((a, b) => a - b);

      let token = 0;
      for (const [i, { p, c }] of todays.entries()) {
        const reg = dayStart + minutes[i] * MIN;
        if (reg > cutoff) continue;
        token += 1;
        while (d === 0 && h.takenToday?.includes(token)) token += 1;
        const busy = todays.length > h.perDay[1] * 0.8 && minutes[i] < (h.sessions[0][0] + 3) * 60;
        const intake = reg + r.int(3, busy ? 26 : 14) * MIN;
        // A hospital with a cardiologist sends the blood-pressure follow-ups to him too.
        const toCardio = c.dept === "cardiology" || c.key === "hypertension";
        const doctor = (toCardio && h.doctors.cardiology) || (c.dept === "paediatrics" && h.doctors.paediatrics) || h.doctors.general;
        const consult = intake + r.int(busy ? 15 : 5, busy ? 55 : 28) * MIN;
        const rxAt = consult + r.int(c.dept === "cardiology" ? 6 : 3, c.dept === "cardiology" ? 14 : 9) * MIN;
        const left = r.chance(0.03);
        const fromApp = r.chance(0.18);
        const ts = (ms: number) => Timestamp.fromMillis(Math.min(ms, now - 5 * MIN));
        const vitals: VitalsSummary = {
          systolicMmhg: null, diastolicMmhg: null, pulseBpm: null, temperatureC: null, respiratoryRate: null,
          spo2Pct: null, weightKg: null, heightCm: null, bloodSugarMgdl: null, bloodSugarType: null,
          ...c.vitals(r, p.age),
        };
        const items: PrescriptionItem[] = left ? [] : c.lines.map((l) => {
          const drug = drugs.find((x) => x.id === l.drug)!;
          const frequency = normaliseFrequency(l.freq);
          return {
            drugId: drug.id, drugName: drug.generic, form: l.form ?? drug.defaultForm, strength: l.strength ?? drug.defaultStrength,
            frequency, durationDays: l.days, timing: l.timing ?? "any",
            quantity: l.form === "inhaler" ? 1 : l.form === "syrup" ? 1 : (suggestedQuantity(frequency, l.days, l.every ?? 1) ?? l.days),
            ...(l.every ? { everyDays: l.every } : {}),
          };
        });
        const tests = c.tests && r.chance(c.testChance ?? 0) ? c.tests : [];
        const complaint = r.pick(c.complaints);

        // Requests from the app: most answered here; a few were answered here after another hospital let the clock run out.
        const others = hospitals.filter((o) => o.id !== h.id).map((o) => o.id);
        const missed = fromApp && r.chance(0.2) ? r.pick(others) : null;
        const requestedAt = reg - r.int(2, 18) * 60 * MIN;
        const request = fromApp
          ? {
              source: "pre_visit", requestMode: p.chronic ? "existing_doctor" : "new_problem",
              requestedAt: Timestamp.fromMillis(requestedAt),
              candidateHospitalIds: missed ? [missed, h.id, ...others.filter((o) => o !== missed)] : [h.id, ...others],
              attempts: [
                ...(missed ? [{ hospitalId: missed, hospitalName: hospitals.find((o) => o.id === missed)!.name, at: new Date(requestedAt).toISOString(), outcome: "timed_out" }] : []),
                { hospitalId: h.id, hospitalName: h.name, at: new Date(requestedAt + (missed ? 15 : 0) * MIN).toISOString(), outcome: "answered" },
              ],
            }
          : { source: "walk_in" };

        // The counters.
        // Today, only the last hour is still at the counters; earlier days, some buy their medicines outside.
        const recent = d === 0 && reg > now - 110 * MIN;
        const dispensed = !left && h.pharmacy && !recent && r.chance(d === 0 ? 1 : 0.9);
        const swap = dispensed && r.chance(0.12) ? items.findIndex((it) => drugs.find((x) => x.id === it.drugId)!.brands.length > 1) : -1;
        const medicines = dispensed ? items.reduce((s, it) => s + it.quantity * unitPrice(it), 0) : 0;
        const billLines = left ? [] : [{ label: "Consultation", amount: h.fee }, ...(medicines ? [{ label: "Medicines", amount: Math.round(medicines) }] : []), ...(tests.length && r.chance(0.5) ? [{ label: "Blood test", amount: 250 * tests.length }] : [])];
        const billed = !left && h.billing && !recent && r.chance(d === 0 ? 1 : 0.97);
        const paid = billed && r.chance(d === 0 ? 1 : d === 1 ? 0.95 : 0.99);
        const mode = r.weighted([{ w: 52, v: "cash" }, { w: 42, v: "upi" }, { w: 6, v: "card" }]);
        const total = billLines.reduce((s, l) => s + l.amount, 0);
        const dispenseAt = rxAt + r.int(4, 22) * MIN;
        const billAt = (dispensed ? dispenseAt : rxAt) + r.int(2, 12) * MIN;

        const ref = db().collection("visits").doc();
        writer.set(ref, {
          hospitalId: h.id, patientId: p.id, visitCode: generateVisitCode(),
          stage: left ? "cancelled" : "prescribed", department: c.dept, tokenNumber: h.tokens ? token : null,
          patientName: p.name, patientPhone: p.phone, patientAgeYears: p.age, patientSex: p.sex, patientVillage: p.area,
          hasAllergy: !!p.allergy, complaint, vitals, diagnosis: left ? null : c.diagnosis, itemCount: items.length, linkedPhones: [],
          assignedDoctorUid: doctor.uid, assignedDoctorName: doctor.name,
          ...request,
          registeredAt: ts(reg), intakeCompletedAt: ts(intake),
          consultationStartedAt: left ? null : ts(consult), prescribedAt: left ? null : ts(rxAt),
          closedAt: ts(left ? intake + r.int(35, 80) * MIN : rxAt),
          registeredBy: h.desk.name, notes: left ? "Left before being seen." : null,
          ...(dispensed ? { dispensedAt: ts(dispenseAt), dispensedBy: h.pharmacy!.name } : {}),
          ...(billed ? { billTotal: total, paid, paidMode: paid ? mode : null } : {}),
        });
        writer.set(ref.collection("vitals").doc(), { visitId: ref.id, patientId: p.id, ...vitals, notes: null, recordedAt: ts(intake), recordedBy: h.vitals.name, supersedesId: null });
        if (!left) {
          writer.set(ref.collection("prescriptions").doc(), {
            visitId: ref.id, patientId: p.id, diagnosisText: c.diagnosis, items, advice: c.advice, tests, pregnancy: null,
            followUpDays: c.followUp, prescriberName: doctor.name, prescriberUid: doctor.uid,
            prescriberQualification: doctor.qualification ?? null, prescriberRegNo: doctor.registrationNo ?? null,
            createdAt: ts(rxAt), signedAt: ts(rxAt), supersedesId: null,
          });
        }
        if (dispensed) {
          writer.set(ref.collection("dispensing").doc(), {
            lines: items.map((it, k) => ({ drugName: it.drugName, given: true, substitute: k === swap ? drugs.find((x) => x.id === it.drugId)!.brands[0] : null })),
            prescriptionId: null, by: h.pharmacy!.name, byUid: h.pharmacy!.uid, at: ts(dispenseAt),
          });
        }
        if (billed) {
          writer.set(ref.collection("bills").doc(), { lines: billLines, total, paid, mode: paid ? mode : null, by: h.billing!.name, byUid: h.billing!.uid, at: ts(billAt) });
        }

        // The activity log, for the last two days: what the log screen reads first.
        if (d <= 1) {
          const log = (who: Staff, kind: string, text: string, at: number) =>
            writer.set(db().collection("activity").doc(), {
              hospitalId: h.id, at: ts(at), actorUid: who.uid, actorName: who.name,
              actorRole: who.seatName ? who.seatName.toLowerCase() : "front desk", kind, text, patientId: p.id, visitId: ref.id, ip: null, place: null,
            });
          log(h.desk, "visit.started", `${label(h.desk)} started a visit for ${p.name}.`, reg);
          const reading = [vitals.systolicMmhg ? `BP ${vitals.systolicMmhg}/${vitals.diastolicMmhg}` : null, vitals.pulseBpm ? `pulse ${vitals.pulseBpm}` : null, vitals.temperatureC ? `temperature ${vitals.temperatureC}°C` : null, vitals.bloodSugarMgdl ? `sugar ${vitals.bloodSugarMgdl}` : null].filter(Boolean).join(", ");
          log(h.vitals, "visit.intake", `${label(h.vitals)} took ${p.name}'s vitals${reading ? ` (${reading})` : ""} and sent them to ${doctor.name}.`, intake);
          if (left) {
            log(h.desk, "visit.cancelled", `${label(h.desk)} closed ${p.name}'s visit: left before being seen.`, intake + 50 * MIN);
          } else {
            log(doctor, "visit.consultation", `${doctor.name} started seeing ${p.name}.`, consult);
            log(doctor, "prescription.signed", `${doctor.name} signed ${p.name}'s prescription: ${items.map((it) => it.drugName).join(", ")}.`, rxAt);
          }
          if (dispensed) {
            const swapped = swap >= 0 ? ` (${items[swap].drugName} given as ${drugs.find((x) => x.id === items[swap].drugId)!.brands[0]})` : "";
            log(h.pharmacy!, "visit.dispensed", `${label(h.pharmacy!)} gave ${p.name} ${items.length} of ${items.length} medicines${swapped}.`, dispenseAt);
          }
          if (billed) {
            log(h.billing!, "visit.billed", `${label(h.billing!)} billed ${p.name} ${rupees(total)} (${billLines.map((l) => `${l.label} ${rupees(l.amount)}`).join(", ")})${paid ? `, paid by ${mode === "upi" ? "UPI" : mode}` : ", not yet paid"}.`, billAt);
          }
        }
        written += 1;
      }
      // Today's token count carries on from the last one handed out, so the next walk-in gets the next number.
      if (d === 0) writer.set(tokenDoc(h.id), { last: Math.max(h.tokens ? token : 0, ...(h.takenToday ?? [])) });
    }

    // A visit before the window for every chronic patient, so their first visit inside it has a "last time".
    for (const p of pool.filter((x) => x.chronic)) {
      const c = p.chronic!;
      const doctor = (c.dept === "cardiology" && h.doctors.cardiology) || h.doctors.general;
      const at = startToday - r.int(38, 60) * DAY + (h.sessions[0][0] * 60 + r.int(0, 180)) * MIN;
      const items: PrescriptionItem[] = c.lines.map((l) => {
        const drug = drugs.find((x) => x.id === l.drug)!;
        const frequency = normaliseFrequency(l.freq);
        return { drugId: drug.id, drugName: drug.generic, form: l.form ?? drug.defaultForm, strength: l.strength ?? drug.defaultStrength, frequency, durationDays: l.days, timing: l.timing ?? "any", quantity: suggestedQuantity(frequency, l.days) ?? l.days };
      });
      const ref = db().collection("visits").doc();
      writer.set(ref, {
        hospitalId: h.id, patientId: p.id, visitCode: generateVisitCode(), stage: "prescribed", department: c.dept, tokenNumber: null,
        patientName: p.name, patientPhone: p.phone, patientAgeYears: p.age, patientSex: p.sex, patientVillage: p.area, hasAllergy: !!p.allergy,
        complaint: r.pick(c.complaints), vitals: { systolicMmhg: null, diastolicMmhg: null, pulseBpm: null, temperatureC: null, respiratoryRate: null, spo2Pct: null, weightKg: null, heightCm: null, bloodSugarMgdl: null, bloodSugarType: null, ...c.vitals(r, p.age) },
        diagnosis: c.diagnosis, itemCount: items.length, linkedPhones: [], assignedDoctorUid: doctor.uid, assignedDoctorName: doctor.name, source: "walk_in",
        registeredAt: Timestamp.fromMillis(at), intakeCompletedAt: Timestamp.fromMillis(at + 9 * MIN), consultationStartedAt: Timestamp.fromMillis(at + 30 * MIN),
        prescribedAt: Timestamp.fromMillis(at + 37 * MIN), closedAt: Timestamp.fromMillis(at + 37 * MIN), registeredBy: h.desk.name, notes: null,
      });
      writer.set(ref.collection("prescriptions").doc(), {
        visitId: ref.id, patientId: p.id, diagnosisText: c.diagnosis, items, advice: c.advice, tests: [], pregnancy: null, followUpDays: c.followUp,
        prescriberName: doctor.name, prescriberUid: doctor.uid, prescriberQualification: doctor.qualification ?? null, prescriberRegNo: doctor.registrationNo ?? null,
        createdAt: Timestamp.fromMillis(at + 37 * MIN), signedAt: Timestamp.fromMillis(at + 37 * MIN), supersedesId: null,
      });
      written += 1;
    }
  }
  await writer.close();
  return written;
}

/** "Dr. A. Khan" and "Rekha (management)" stay; anyone else gets their seat. */
const label = (s: Staff) => (/\(/.test(s.name) || /^dr\.?\s/i.test(s.name) || !s.seatName ? s.name : `${s.name} (${s.seatName.toLowerCase()})`);

/** A plausible Indian retail price per unit, enough for a believable medicines bill. */
function unitPrice(item: PrescriptionItem): number {
  if (item.form === "syrup") return 65;
  if (item.form === "inhaler") return 180;
  if (item.form === "sachet") return 22;
  const cheap = ["paracetamol", "cetirizine", "levocetirizine", "metformin", "amlodipine", "iron_folic_acid", "albendazole", "aspirin", "domperidone"];
  return cheap.includes(item.drugId) ? 2 : 7;
}

