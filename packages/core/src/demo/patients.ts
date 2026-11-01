/**
 * The patient fixture: 15 people with two years of OPD history behind them.
 *
 * This is written as a demo script, not as random noise. Specific things are
 * true on purpose, and the schema test in scripts/verify-sql.ts asserts them:
 *
 *   - 9811044321 is one handset shared by three people in the same household
 *     (Priya, her husband Prashant, his mother Prabha). That is the case the
 *     /intake disambiguation step exists for, and it is the single most
 *     common reason paper systems lose track of a patient.
 *   - 9700881122 is a second shared number, two brothers, so the behaviour is
 *     not a one-off.
 *   - Priya has a recorded penicillin allergy. Prabha Devi takes
 *     warfarin. Babulal Meena takes theophylline. Each sets up one of the
 *     drug<->drug or drug<->allergy rules.
 *   - Savitri Bai is the drug<->vitals case. She is mid-consultation right
 *     now with an intake random sugar of 312 mg/dL and a knee flare that a
 *     doctor would reasonably reach for prednisolone to settle. Nothing on a
 *     paper slip would connect those two facts.
 *
 * Today's visits are spread across the stages so every queue has something
 * in it the moment the seed finishes.
 */

import type { Stage, Timing } from "../types.js";

export type { Stage };

export type Baseline = {
  heightCm?: number;
  weightKg?: number;
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  temperatureC?: number;
  respiratoryRate?: number;
  spo2?: number;
  sugar?: number;
  sugarType?: "fasting" | "random" | "post_prandial";
};

export type ItemSeed = {
  drug: string;
  freq: string;
  days: number;
  timing?: Timing;
  instructions?: string;
  strength?: string;
  form?: string;
};

export type VisitSeed = {
  daysAgo: number;
  /** The stage this visit has reached. Today's visits sit mid-chain. */
  stage: Stage;
  department?: string;
  tokenNumber?: number;
  complaint?: {
    body: string;
    language?: string;
    durationDays?: number;
    severity?: "mild" | "moderate" | "severe";
    source?: "patient" | "caretaker" | "compounder" | "doctor";
  };
  vitals?: Baseline;
  diagnosis?: string;
  items?: ItemSeed[];
  advice?: string;
  followUpDays?: number;
  prescriber?: string;
  documents?: { kind: string; title: string; documentDaysAgo?: number }[];
  /** Issues an access grant for this visit's /p/[code] page. */
  grant?: "live" | "expired" | "revoked";
};

export type AllergySeed = {
  classId?: string;
  freeText?: string;
  reaction: string;
  severity: "info" | "caution" | "high";
  daysAgo: number;
  source?: "patient" | "caretaker" | "compounder" | "doctor" | "record";
};

export type CaretakerSeed = {
  name: string;
  phone?: string;
  relationship: string;
  /** Set when the caretaker is also a patient here. */
  patientKey?: string;
};

export type PatientSeed = {
  key: string;
  name: string;
  sex: "female" | "male" | "other";
  age: number;
  phone: string;
  village?: string;
  district?: string;
  state?: string;
  bloodGroup?: string;
  language?: string;
  notes?: string;
  baseline: Baseline;
  allergies?: AllergySeed[];
  caretakers?: CaretakerSeed[];
  visits: VisitSeed[];
};

const DR_MEHRA = "Dr. A. Mehra";
const DR_IYER = "Dr. S. Iyer";
const DR_KHAN = "Dr. R. Khan";

export const patients: PatientSeed[] = [
  // =========================================================================
  // The shared-handset household. One phone number, three patients.
  // =========================================================================
  {
    key: "priya",
    name: "Priya",
    sex: "female",
    age: 42,
    phone: "9811044321",
    village: "Nangli Sakrawati",
    district: "South West Delhi",
    state: "Delhi",
    bloodGroup: "B+",
    language: "hi",
    notes: "Shares a handset with her husband and mother-in-law.",
    baseline: {
      heightCm: 152,
      weightKg: 64,
      systolic: 148,
      diastolic: 92,
      pulse: 82,
      temperatureC: 36.9,
    },
    allergies: [
      {
        classId: "penicillins",
        reaction:
          "Widespread itchy rash and facial swelling after amoxicillin, 2019. Treated at a private clinic.",
        severity: "high",
        daysAgo: 690,
        source: "patient",
      },
    ],
    visits: [
      {
        daysAgo: 700,
        stage: "prescribed",
        complaint: {
          body: "Sir do mahine se sar ghoomta hai aur gardan mein dard rehta hai.",
          durationDays: 60,
          severity: "moderate",
        },
        vitals: { systolic: 162, diastolic: 98, pulse: 88 },
        diagnosis: "Newly detected hypertension",
        items: [
          { drug: "amlodipine", freq: "OD", days: 30, timing: "after_food" },
          { drug: "paracetamol", freq: "SOS", days: 5, timing: "after_food" },
        ],
        advice: "Namak kam karein. Roz subah tees minute paidal chalein.",
        followUpDays: 30,
        prescriber: DR_MEHRA,
      },
      {
        daysAgo: 668,
        stage: "prescribed",
        complaint: { body: "Dawa chal rahi hai, chakkar kam hai.", durationDays: 30 },
        vitals: { systolic: 150, diastolic: 94, pulse: 84 },
        diagnosis: "Hypertension, partially controlled",
        items: [{ drug: "amlodipine", freq: "OD", days: 60, timing: "after_food" }],
        followUpDays: 60,
        prescriber: DR_MEHRA,
      },
      {
        daysAgo: 420,
        stage: "prescribed",
        complaint: {
          body: "Pichle hafte se khaansi aur halka bukhar.",
          durationDays: 7,
          severity: "mild",
        },
        vitals: { temperatureC: 38.1, pulse: 96, systolic: 144, diastolic: 90 },
        diagnosis: "Upper respiratory tract infection",
        // Deliberately NOT a penicillin: this is what the chain is supposed
        // to look like when the allergy is actually carried forward.
        items: [
          { drug: "azithromycin", freq: "OD", days: 3, timing: "before_food" },
          { drug: "paracetamol", freq: "TDS", days: 3, timing: "after_food" },
          { drug: "cetirizine", freq: "HS", days: 5, timing: "after_food" },
        ],
        advice: "Garam paani se gargle karein.",
        prescriber: DR_IYER,
        grant: "expired",
      },
      {
        daysAgo: 95,
        stage: "prescribed",
        complaint: { body: "BP ki dawa khatam ho gayi hai.", durationDays: 3 },
        vitals: { systolic: 138, diastolic: 86, pulse: 78, weightKg: 65.5 },
        diagnosis: "Hypertension, controlled",
        items: [
          { drug: "amlodipine", freq: "OD", days: 90, timing: "after_food" },
          { drug: "calcium_vitamin_d3", freq: "OD", days: 90, timing: "after_food" },
        ],
        followUpDays: 90,
        prescriber: DR_MEHRA,
        documents: [
          { kind: "lab_report", title: "Lipid profile, district lab", documentDaysAgo: 100 },
        ],
      },
      // --- today: just arrived at the desk. Feeds the /intake queue. ---
      {
        daysAgo: 0,
        stage: "registered",
        tokenNumber: 14,
      },
    ],
  },
  {
    key: "prashant",
    name: "Prashant",
    sex: "male",
    age: 48,
    phone: "9811044321",
    village: "Nangli Sakrawati",
    district: "South West Delhi",
    state: "Delhi",
    bloodGroup: "O+",
    language: "hi",
    notes: "Same handset as Priya (wife) and Prabha Devi (mother).",
    baseline: {
      heightCm: 168,
      weightKg: 78,
      systolic: 136,
      diastolic: 86,
      pulse: 80,
      sugar: 164,
      sugarType: "fasting",
    },
    visits: [
      {
        daysAgo: 640,
        stage: "prescribed",
        complaint: {
          body: "Bahut pyaas lagti hai aur raat mein baar baar peshaab aata hai.",
          durationDays: 90,
          severity: "moderate",
        },
        vitals: { sugar: 248, sugarType: "random", weightKg: 81 },
        diagnosis: "Type 2 diabetes mellitus, newly detected",
        items: [
          { drug: "metformin", freq: "BD", days: 30, timing: "after_food" },
          { drug: "vitamin_b_complex", freq: "OD", days: 30, timing: "after_food" },
        ],
        advice: "Cheeni aur mithai band. Roti kam, sabzi zyada.",
        followUpDays: 30,
        prescriber: DR_KHAN,
        documents: [
          { kind: "lab_report", title: "Fasting and PP glucose", documentDaysAgo: 645 },
        ],
      },
      {
        daysAgo: 430,
        stage: "prescribed",
        complaint: { body: "Sugar ki dawa chal rahi hai, thakaan rehti hai.", durationDays: 20 },
        vitals: { sugar: 186, sugarType: "fasting", weightKg: 79.5 },
        diagnosis: "Type 2 diabetes mellitus, suboptimal control",
        items: [
          { drug: "metformin", freq: "BD", days: 90, timing: "after_food" },
          { drug: "glimepiride", freq: "OD", days: 90, timing: "before_food" },
        ],
        followUpDays: 90,
        prescriber: DR_KHAN,
        documents: [{ kind: "lab_report", title: "HbA1c 8.4%", documentDaysAgo: 433 }],
      },
      {
        daysAgo: 180,
        stage: "prescribed",
        complaint: { body: "Pair ke talwe mein jalan hoti hai raat ko.", durationDays: 45 },
        vitals: { sugar: 172, sugarType: "fasting", pulse: 78 },
        diagnosis: "Type 2 diabetes with early peripheral neuropathy",
        items: [
          { drug: "metformin", freq: "BD", days: 90, timing: "after_food" },
          { drug: "glimepiride", freq: "OD", days: 90, timing: "before_food" },
          { drug: "amitriptyline", freq: "HS", days: 30, timing: "after_food" },
        ],
        advice: "Roz pair dekhein. Chappal pehen kar hi chalein.",
        followUpDays: 90,
        prescriber: DR_KHAN,
      },
      // --- today: prescription signed, waiting at the pharmacy counter. ---
      {
        daysAgo: 0,
        stage: "prescribed",
        tokenNumber: 6,
        complaint: {
          body: "Teen din se khaansi, balgam peela aa raha hai. Sugar ki dawa bhi khatam.",
          durationDays: 3,
          severity: "moderate",
        },
        vitals: {
          sugar: 158,
          sugarType: "fasting",
          temperatureC: 37.8,
          pulse: 92,
          systolic: 134,
          diastolic: 84,
          spo2: 97,
        },
        diagnosis: "Acute bronchitis on type 2 diabetes mellitus",
        items: [
          { drug: "amoxicillin_clavulanate", freq: "BD", days: 5, timing: "after_food" },
          { drug: "paracetamol", freq: "TDS", days: 3, timing: "after_food" },
          { drug: "metformin", freq: "BD", days: 30, timing: "after_food" },
          { drug: "glimepiride", freq: "OD", days: 30, timing: "before_food" },
        ],
        advice: "Khaansi ki dawa paanch din poori lein, beech mein na chhodein.",
        followUpDays: 30,
        prescriber: DR_KHAN,
        grant: "live",
      },
    ],
  },
  {
    key: "prabha-devi",
    name: "Prabha Devi",
    sex: "female",
    age: 71,
    phone: "9811044321",
    village: "Nangli Sakrawati",
    district: "South West Delhi",
    state: "Delhi",
    bloodGroup: "B+",
    language: "hi",
    notes:
      "On long-term warfarin for atrial fibrillation. Cannot read; her son Prashant handles her medicines.",
    baseline: {
      heightCm: 148,
      weightKg: 51,
      systolic: 142,
      diastolic: 84,
      pulse: 72,
      spo2: 96,
    },
    caretakers: [
      {
        name: "Prashant",
        phone: "9811044321",
        relationship: "Son",
        patientKey: "prashant",
      },
    ],
    visits: [
      {
        daysAgo: 710,
        stage: "prescribed",
        complaint: {
          body: "Dil tez tez dhadakta hai aur saans phoolti hai.",
          durationDays: 30,
          severity: "severe",
        },
        vitals: { pulse: 118, systolic: 150, diastolic: 88, spo2: 94 },
        diagnosis: "Atrial fibrillation",
        items: [
          { drug: "warfarin", freq: "OD", days: 30, timing: "after_food" },
          { drug: "metoprolol", freq: "BD", days: 30, timing: "after_food" },
        ],
        advice:
          "Warfarin roz ek hi samay par. Khoon ki jaanch (INR) har mahine zaroori hai.",
        followUpDays: 30,
        prescriber: DR_MEHRA,
        documents: [{ kind: "lab_report", title: "ECG and INR baseline", documentDaysAgo: 712 }],
      },
      {
        daysAgo: 520,
        stage: "prescribed",
        complaint: { body: "INR ki jaanch karwa li hai, report laayi hoon.", durationDays: 2 },
        vitals: { pulse: 76, systolic: 144, diastolic: 86 },
        diagnosis: "Atrial fibrillation on warfarin, INR in range",
        items: [
          { drug: "warfarin", freq: "OD", days: 90, timing: "after_food" },
          { drug: "metoprolol", freq: "BD", days: 90, timing: "after_food" },
        ],
        followUpDays: 90,
        prescriber: DR_MEHRA,
        documents: [{ kind: "lab_report", title: "INR 2.4", documentDaysAgo: 523 }],
      },
      {
        daysAgo: 240,
        stage: "prescribed",
        complaint: { body: "Ghutno mein bahut dard hai, seedhi chadhna mushkil.", durationDays: 120 },
        vitals: { pulse: 74, systolic: 146, diastolic: 88, weightKg: 52 },
        diagnosis: "Osteoarthritis of both knees, on warfarin",
        // Paracetamol, not an NSAID. The correct call, recorded so the
        // dossier shows the reasoning was already made once.
        items: [
          { drug: "paracetamol", freq: "TDS", days: 15, timing: "after_food" },
          { drug: "calcium_vitamin_d3", freq: "OD", days: 90, timing: "after_food" },
          { drug: "warfarin", freq: "OD", days: 90, timing: "after_food" },
        ],
        advice:
          "Dard ki koi aur dawa bazaar se na lein - warfarin ke saath khoon beh sakta hai.",
        followUpDays: 90,
        prescriber: DR_IYER,
        grant: "revoked",
      },
      // --- today: intake done, sitting in the doctor's queue. ---
      {
        daysAgo: 0,
        stage: "intake_complete",
        tokenNumber: 9,
        complaint: {
          body: "Ghutne ka dard bahut badh gaya hai, raat ko neend nahi aati.",
          durationDays: 14,
          severity: "severe",
          source: "caretaker",
        },
        vitals: {
          pulse: 74,
          systolic: 148,
          diastolic: 88,
          weightKg: 51.5,
          spo2: 96,
          temperatureC: 36.8,
        },
      },
    ],
  },

  // =========================================================================
  // The drug <-> vitals case.
  // =========================================================================
  {
    key: "savitri-bai",
    name: "Savitri Bai",
    sex: "female",
    age: 58,
    phone: "9823451170",
    village: "Bhiwandi",
    district: "Thane",
    state: "Maharashtra",
    bloodGroup: "A+",
    language: "mr",
    notes:
      "Poorly controlled diabetes; defaults on follow-up when the harvest is on.",
    baseline: {
      heightCm: 150,
      weightKg: 68,
      systolic: 152,
      diastolic: 90,
      pulse: 86,
      sugar: 254,
      sugarType: "random",
    },
    visits: [
      {
        daysAgo: 660,
        stage: "prescribed",
        complaint: {
          body: "Khup tahaan lagte ani jakhma bharat nahi.",
          durationDays: 120,
          severity: "moderate",
        },
        vitals: { sugar: 286, sugarType: "random", weightKg: 71 },
        diagnosis: "Type 2 diabetes mellitus, poorly controlled",
        items: [
          { drug: "metformin", freq: "BD", days: 30, timing: "after_food" },
          { drug: "glimepiride", freq: "OD", days: 30, timing: "before_food" },
        ],
        followUpDays: 30,
        prescriber: DR_KHAN,
        documents: [{ kind: "lab_report", title: "HbA1c 10.2%", documentDaysAgo: 663 }],
      },
      {
        daysAgo: 395,
        stage: "prescribed",
        complaint: { body: "Dawa madhe khand padli, pudhe gheta ali nahi.", durationDays: 180 },
        vitals: { sugar: 268, sugarType: "random", weightKg: 69 },
        diagnosis: "Type 2 diabetes mellitus, treatment interrupted",
        items: [
          { drug: "metformin", freq: "BD", days: 60, timing: "after_food" },
          { drug: "glimepiride", freq: "BD", days: 60, timing: "before_food" },
          { drug: "atorvastatin", freq: "HS", days: 60, timing: "after_food" },
        ],
        advice: "Dawa roj ghene. Pandhra divsani sugar tapasne.",
        followUpDays: 60,
        prescriber: DR_KHAN,
      },
      {
        daysAgo: 150,
        stage: "prescribed",
        complaint: { body: "Guddhyat dukhte, chalayla tras hoto.", durationDays: 60 },
        vitals: { sugar: 242, sugarType: "random", systolic: 156, diastolic: 92 },
        diagnosis: "Osteoarthritis of knees with uncontrolled type 2 diabetes",
        items: [
          { drug: "paracetamol", freq: "TDS", days: 10, timing: "after_food" },
          { drug: "metformin", freq: "BD", days: 90, timing: "after_food" },
          { drug: "glimepiride", freq: "BD", days: 90, timing: "before_food" },
        ],
        followUpDays: 90,
        prescriber: DR_IYER,
      },
      // --- today: the doctor has her dossier open.
      //
      // Intake random sugar 312 mg/dL, and she has come in with a knee flare
      // plus wheeze. Reaching for prednisolone here is an entirely ordinary
      // clinical move, and on paper nothing would connect the steroid at the
      // bottom of the slip to the sugar at the top. This is the case the
      // drug<->vitals rule exists for.
      {
        daysAgo: 0,
        stage: "in_consultation",
        tokenNumber: 3,
        complaint: {
          body:
            "Guddhyachi sujan khup vadhli ahe ani dam lagto. Chalayla pan jamat nahi.",
          durationDays: 10,
          severity: "severe",
        },
        vitals: {
          sugar: 312,
          sugarType: "random",
          systolic: 158,
          diastolic: 94,
          pulse: 92,
          weightKg: 68.5,
          temperatureC: 37.1,
          spo2: 95,
          respiratoryRate: 22,
        },
      },
    ],
  },

  // =========================================================================
  // The theophylline case.
  // =========================================================================
  {
    key: "babulal-meena",
    name: "Babulal Meena",
    sex: "male",
    age: 74,
    phone: "9890011223",
    village: "Bassi",
    district: "Jaipur",
    state: "Rajasthan",
    bloodGroup: "O+",
    language: "hi",
    notes: "Forty years of beedi smoking. On theophylline, which has a narrow margin.",
    baseline: {
      heightCm: 164,
      weightKg: 54,
      systolic: 134,
      diastolic: 80,
      pulse: 96,
      spo2: 92,
      respiratoryRate: 24,
    },
    visits: [
      {
        daysAgo: 690,
        stage: "prescribed",
        complaint: {
          body: "Saans phoolti hai, subah bahut balgam nikalta hai.",
          durationDays: 365,
          severity: "severe",
        },
        vitals: { spo2: 90, pulse: 104, respiratoryRate: 26 },
        diagnosis: "Chronic obstructive pulmonary disease",
        items: [
          { drug: "salbutamol", freq: "1-1-1", days: 30, timing: "any" },
          { drug: "theophylline", freq: "OD", days: 30, timing: "after_food" },
          { drug: "budesonide", freq: "BD", days: 30, timing: "any" },
        ],
        advice: "Beedi poori tarah band karein. Inhaler ke baad kulla karein.",
        followUpDays: 30,
        prescriber: DR_IYER,
      },
      {
        daysAgo: 455,
        stage: "prescribed",
        complaint: { body: "Inhaler se aaram hai par chalne mein saans phoolti hai.", durationDays: 60 },
        vitals: { spo2: 92, pulse: 94, respiratoryRate: 22 },
        diagnosis: "COPD, stable on treatment",
        items: [
          { drug: "salbutamol", freq: "1-1-1", days: 90, timing: "any" },
          { drug: "theophylline", freq: "OD", days: 90, timing: "after_food" },
          { drug: "budesonide", freq: "BD", days: 90, timing: "any" },
        ],
        followUpDays: 90,
        prescriber: DR_IYER,
      },
      {
        daysAgo: 60,
        stage: "prescribed",
        complaint: { body: "Do din se bukhar aur balgam gaadha ho gaya hai.", durationDays: 2, severity: "moderate" },
        vitals: { temperatureC: 38.4, spo2: 89, pulse: 108, respiratoryRate: 28 },
        diagnosis: "Acute exacerbation of COPD",
        // Doxycycline, specifically avoiding ciprofloxacin on theophylline.
        items: [
          { drug: "doxycycline", freq: "BD", days: 7, timing: "after_food" },
          { drug: "prednisolone", freq: "OD", days: 5, timing: "after_food" },
          { drug: "salbutamol", freq: "1-1-1-1", days: 10, timing: "any" },
          { drug: "theophylline", freq: "OD", days: 30, timing: "after_food" },
        ],
        advice: "Steroid paanch din se zyada na lein.",
        followUpDays: 10,
        prescriber: DR_IYER,
        grant: "expired",
      },
      // --- today: intake done, in the doctor's queue. ---
      {
        daysAgo: 0,
        stage: "intake_complete",
        tokenNumber: 11,
        complaint: {
          body: "Peshaab mein jalan ho rahi hai teen din se, bukhar bhi hai.",
          durationDays: 3,
          severity: "moderate",
        },
        vitals: {
          temperatureC: 38.2,
          pulse: 102,
          spo2: 92,
          systolic: 132,
          diastolic: 78,
          respiratoryRate: 23,
        },
      },
    ],
  },

  // =========================================================================
  // The second shared handset: two brothers.
  // =========================================================================
  {
    key: "suresh-patil",
    name: "Suresh Patil",
    sex: "male",
    age: 39,
    phone: "9700881122",
    village: "Shirur",
    district: "Pune",
    state: "Maharashtra",
    bloodGroup: "AB+",
    language: "mr",
    notes: "Shares a handset with his brother Ganesh.",
    baseline: { heightCm: 171, weightKg: 74, systolic: 126, diastolic: 80, pulse: 76 },
    visits: [
      {
        daysAgo: 610,
        stage: "prescribed",
        complaint: {
          body: "Kambaret dukhte, vajan uchalayla jamat nahi.",
          durationDays: 30,
          severity: "moderate",
        },
        vitals: { weightKg: 76 },
        diagnosis: "Mechanical low back pain",
        items: [
          { drug: "aceclofenac", freq: "BD", days: 7, timing: "after_food" },
          { drug: "pantoprazole", freq: "OD", days: 7, timing: "before_food" },
        ],
        advice: "Garam shek. Jad vajan uchalu naka.",
        prescriber: DR_MEHRA,
      },
      {
        daysAgo: 300,
        stage: "prescribed",
        complaint: { body: "Punha kambar dukhayla lagli.", durationDays: 10, severity: "moderate" },
        vitals: { weightKg: 75 },
        diagnosis: "Recurrent mechanical low back pain",
        items: [
          { drug: "aceclofenac", freq: "BD", days: 5, timing: "after_food" },
          { drug: "pantoprazole", freq: "OD", days: 5, timing: "before_food" },
          { drug: "vitamin_b_complex", freq: "OD", days: 30, timing: "after_food" },
        ],
        prescriber: DR_MEHRA,
      },
      {
        daysAgo: 40,
        stage: "prescribed",
        complaint: { body: "Dat dukhto ani hirdya sujlya ahet.", durationDays: 4, severity: "moderate" },
        vitals: { temperatureC: 37.6 },
        diagnosis: "Dental abscess",
        items: [
          { drug: "amoxicillin_clavulanate", freq: "TDS", days: 5, timing: "after_food" },
          { drug: "metronidazole", freq: "TDS", days: 5, timing: "after_food" },
          { drug: "paracetamol", freq: "TDS", days: 3, timing: "after_food" },
        ],
        advice: "Dantachya doctor kade jaun dakhva.",
        prescriber: DR_KHAN,
      },
    ],
  },
  {
    key: "ganesh-patil",
    name: "Ganesh Patil",
    sex: "male",
    age: 36,
    phone: "9700881122",
    village: "Shirur",
    district: "Pune",
    state: "Maharashtra",
    bloodGroup: "B+",
    language: "mr",
    notes: "Shares a handset with his brother Suresh.",
    baseline: { heightCm: 169, weightKg: 68, systolic: 122, diastolic: 78, pulse: 80 },
    visits: [
      {
        daysAgo: 575,
        stage: "prescribed",
        complaint: { body: "Taap ani angdukhi, don divas.", durationDays: 2, severity: "moderate" },
        vitals: { temperatureC: 38.6, pulse: 98 },
        diagnosis: "Acute viral fever",
        items: [
          { drug: "paracetamol", freq: "TDS", days: 3, timing: "after_food" },
          { drug: "ors", freq: "SOS", days: 3, timing: "any" },
        ],
        advice: "Khup paani pyave. Taap utarat nasel tar punha yave.",
        prescriber: DR_IYER,
      },
      {
        daysAgo: 210,
        stage: "prescribed",
        complaint: { body: "Jodap honya sarkhe vatate, potat dukhte.", durationDays: 5 },
        vitals: { temperatureC: 37.2 },
        diagnosis: "Acute gastroenteritis",
        items: [
          { drug: "ors", freq: "SOS", days: 5, timing: "any" },
          { drug: "metronidazole", freq: "TDS", days: 5, timing: "after_food" },
          { drug: "ondansetron", freq: "BD", days: 2, timing: "before_food" },
        ],
        prescriber: DR_IYER,
      },
      // --- today: still at the desk. ---
      { daysAgo: 0, stage: "registered", tokenNumber: 21 },
    ],
  },

  // =========================================================================
  // The rest of the register.
  // =========================================================================
  {
    key: "mohammed-irfan",
    name: "Mohammed Irfan",
    sex: "male",
    age: 34,
    phone: "9873312098",
    village: "Seelampur",
    district: "North East Delhi",
    state: "Delhi",
    bloodGroup: "A+",
    language: "hi",
    baseline: { heightCm: 174, weightKg: 70, systolic: 124, diastolic: 78, pulse: 84, spo2: 96 },
    allergies: [
      {
        freeText: "Dust and paint fumes",
        reaction: "Wheeze and chest tightness within minutes of exposure at work.",
        severity: "caution",
        daysAgo: 600,
        source: "patient",
      },
    ],
    visits: [
      {
        daysAgo: 605,
        stage: "prescribed",
        complaint: {
          body: "Kaam par paint ke dhuen se saans phoolne lagti hai.",
          durationDays: 180,
          severity: "moderate",
        },
        vitals: { spo2: 95, pulse: 92, respiratoryRate: 22 },
        diagnosis: "Occupational asthma",
        items: [
          { drug: "salbutamol", freq: "SOS", days: 30, timing: "any" },
          { drug: "budesonide", freq: "BD", days: 30, timing: "any" },
          { drug: "montelukast", freq: "HS", days: 30, timing: "after_food" },
        ],
        advice: "Kaam par mask pehnein. Inhaler saath rakhein.",
        followUpDays: 30,
        prescriber: DR_IYER,
      },
      {
        daysAgo: 330,
        stage: "prescribed",
        complaint: { body: "Inhaler se kaafi aaram hai.", durationDays: 90 },
        vitals: { spo2: 97, pulse: 80 },
        diagnosis: "Asthma, well controlled",
        items: [
          { drug: "budesonide", freq: "BD", days: 90, timing: "any" },
          { drug: "salbutamol", freq: "SOS", days: 90, timing: "any" },
        ],
        followUpDays: 90,
        prescriber: DR_IYER,
      },
      {
        daysAgo: 75,
        stage: "prescribed",
        complaint: { body: "Mausam badalne se khaansi badh gayi.", durationDays: 7 },
        vitals: { spo2: 94, pulse: 90, respiratoryRate: 23 },
        diagnosis: "Asthma exacerbation",
        items: [
          { drug: "salbutamol", freq: "1-1-1", days: 7, timing: "any" },
          { drug: "budesonide", freq: "BD", days: 60, timing: "any" },
          { drug: "levocetirizine", freq: "HS", days: 10, timing: "after_food" },
        ],
        prescriber: DR_IYER,
      },
    ],
  },
  {
    key: "pooja-sharma",
    name: "Pooja Sharma",
    sex: "female",
    age: 27,
    phone: "9988112233",
    village: "Rohtak Road",
    district: "West Delhi",
    state: "Delhi",
    bloodGroup: "O-",
    language: "hi",
    baseline: { heightCm: 158, weightKg: 52, systolic: 110, diastolic: 70, pulse: 88 },
    visits: [
      {
        daysAgo: 520,
        stage: "prescribed",
        complaint: { body: "Bahut kamzori lagti hai, chakkar aate hain.", durationDays: 90, severity: "moderate" },
        vitals: { pulse: 96, systolic: 104, diastolic: 66, weightKg: 48 },
        diagnosis: "Iron deficiency anaemia",
        items: [
          { drug: "iron_folic_acid", freq: "OD", days: 90, timing: "after_food" },
          { drug: "albendazole", freq: "STAT", days: 1, timing: "after_food" },
        ],
        advice: "Goli ke saath chai na pijiye, nimbu paani lein.",
        followUpDays: 90,
        prescriber: DR_MEHRA,
        documents: [{ kind: "lab_report", title: "Hb 8.1 g/dL", documentDaysAgo: 522 }],
      },
      {
        daysAgo: 250,
        stage: "prescribed",
        complaint: { body: "Kamzori kam hui hai. Hb ki jaanch karwa li.", durationDays: 30 },
        vitals: { pulse: 84, weightKg: 51 },
        diagnosis: "Iron deficiency anaemia, improving",
        items: [{ drug: "iron_folic_acid", freq: "OD", days: 90, timing: "after_food" }],
        followUpDays: 90,
        prescriber: DR_MEHRA,
        documents: [{ kind: "lab_report", title: "Hb 10.4 g/dL", documentDaysAgo: 252 }],
      },
      // --- today: finished. Pharmacy has already handed over. Carries the
      // live access grant, so /p/[code] has a complete visit to show.
      {
        daysAgo: 0,
        stage: "prescribed",
        tokenNumber: 2,
        complaint: {
          body: "Pet ke nichle hisse mein dard aur peshaab mein jalan, do din se.",
          durationDays: 2,
          severity: "moderate",
        },
        vitals: {
          temperatureC: 37.9,
          pulse: 92,
          systolic: 112,
          diastolic: 72,
          weightKg: 52.5,
        },
        diagnosis: "Uncomplicated urinary tract infection",
        items: [
          { drug: "ofloxacin", freq: "BD", days: 5, timing: "after_food" },
          { drug: "paracetamol", freq: "TDS", days: 3, timing: "after_food" },
          { drug: "iron_folic_acid", freq: "OD", days: 60, timing: "after_food" },
        ],
        advice: "Din mein teen litre paani piyein. Dawa poori lein.",
        followUpDays: 7,
        prescriber: DR_KHAN,
        grant: "live",
      },
    ],
  },
  {
    key: "arjun-yadav",
    name: "Arjun Yadav",
    sex: "male",
    age: 19,
    phone: "9765443321",
    village: "Ballabgarh",
    district: "Faridabad",
    state: "Haryana",
    bloodGroup: "B-",
    language: "hi",
    baseline: { heightCm: 176, weightKg: 62, systolic: 118, diastolic: 74, pulse: 74 },
    visits: [
      {
        daysAgo: 540,
        stage: "prescribed",
        complaint: { body: "Chehre par daane nikal rahe hain.", durationDays: 180, severity: "mild" },
        diagnosis: "Acne vulgaris",
        items: [{ drug: "doxycycline", freq: "OD", days: 30, timing: "after_food" }],
        advice: "Dhoop mein sunscreen lagayein, dawa se skin sensitive hoti hai.",
        prescriber: DR_IYER,
      },
      {
        daysAgo: 310,
        stage: "cancelled",
        complaint: { body: "Daane phir nikal aaye.", durationDays: 20 },
        vitals: { pulse: 72 },
      },
      {
        daysAgo: 115,
        stage: "prescribed",
        complaint: { body: "Khel ke dauran takhne mein moch aa gayi.", durationDays: 1, severity: "moderate" },
        vitals: { pulse: 80, temperatureC: 36.8 },
        diagnosis: "Ankle sprain, grade 1",
        items: [
          { drug: "ibuprofen", freq: "TDS", days: 5, timing: "after_food" },
          { drug: "pantoprazole", freq: "OD", days: 5, timing: "before_food" },
        ],
        advice: "Barf lagayein, pair ooncha rakhein.",
        prescriber: DR_MEHRA,
      },
    ],
  },
  {
    key: "dinesh-kumar",
    name: "Dinesh Kumar",
    sex: "male",
    age: 52,
    phone: "9801556677",
    village: "Loni",
    district: "Ghaziabad",
    state: "Uttar Pradesh",
    bloodGroup: "A-",
    language: "hi",
    notes: "Hypertension with raised creatinine. Avoid NSAIDs.",
    baseline: { heightCm: 170, weightKg: 82, systolic: 156, diastolic: 96, pulse: 78 },
    visits: [
      {
        daysAgo: 680,
        stage: "prescribed",
        complaint: { body: "Sar bhari rehta hai, raat mein neend nahi aati.", durationDays: 60, severity: "moderate" },
        vitals: { systolic: 172, diastolic: 104, pulse: 82, weightKg: 85 },
        diagnosis: "Stage 2 hypertension",
        items: [
          { drug: "telmisartan", freq: "OD", days: 30, timing: "after_food" },
          { drug: "hydrochlorothiazide", freq: "OD", days: 30, timing: "after_food" },
        ],
        followUpDays: 30,
        prescriber: DR_MEHRA,
        documents: [{ kind: "lab_report", title: "Creatinine 1.6 mg/dL", documentDaysAgo: 684 }],
      },
      {
        daysAgo: 400,
        stage: "prescribed",
        complaint: { body: "BP kam hua hai par pair mein sujan aa jati hai.", durationDays: 30 },
        vitals: { systolic: 148, diastolic: 92, weightKg: 83 },
        diagnosis: "Hypertension with raised creatinine",
        items: [
          { drug: "telmisartan", freq: "OD", days: 90, timing: "after_food" },
          { drug: "atorvastatin", freq: "HS", days: 90, timing: "after_food" },
        ],
        advice: "Dard ki dawa (brufen jaisi) bilkul na lein, gurde par asar padta hai.",
        followUpDays: 90,
        prescriber: DR_MEHRA,
      },
      {
        daysAgo: 130,
        stage: "prescribed",
        complaint: { body: "Dawa ke liye aaya hoon.", durationDays: 1 },
        vitals: { systolic: 142, diastolic: 88, weightKg: 82 },
        diagnosis: "Hypertension, controlled",
        items: [
          { drug: "telmisartan", freq: "OD", days: 90, timing: "after_food" },
          { drug: "atorvastatin", freq: "HS", days: 90, timing: "after_food" },
        ],
        followUpDays: 90,
        prescriber: DR_MEHRA,
      },
    ],
  },
  {
    key: "farida-begum",
    name: "Farida Begum",
    sex: "female",
    age: 63,
    phone: "9810223344",
    village: "Zakir Nagar",
    district: "South East Delhi",
    state: "Delhi",
    bloodGroup: "AB-",
    language: "ur",
    baseline: { heightCm: 155, weightKg: 70, systolic: 138, diastolic: 84, pulse: 64 },
    visits: [
      {
        daysAgo: 655,
        stage: "prescribed",
        complaint: { body: "Bahut sardi lagti hai, wazan badh raha hai, thakaan rehti hai.", durationDays: 180 },
        vitals: { pulse: 58, weightKg: 72, temperatureC: 36.4 },
        diagnosis: "Primary hypothyroidism",
        items: [{ drug: "levothyroxine", freq: "OD", days: 60, timing: "empty_stomach" }],
        advice: "Goli subah khaali pet, aadha ghanta pehle. Calcium ke saath na lein.",
        followUpDays: 60,
        prescriber: DR_KHAN,
        documents: [{ kind: "lab_report", title: "TSH 14.2 mIU/L", documentDaysAgo: 658 }],
      },
      {
        daysAgo: 440,
        stage: "prescribed",
        complaint: { body: "Aaram hai. TSH ki jaanch karwa li.", durationDays: 15 },
        vitals: { pulse: 66, weightKg: 70 },
        diagnosis: "Hypothyroidism on replacement",
        items: [
          { drug: "levothyroxine", freq: "OD", days: 90, timing: "empty_stomach" },
          { drug: "calcium_vitamin_d3", freq: "OD", days: 90, timing: "after_food" },
        ],
        advice: "Calcium raat ko, thyroid ki goli subah - chaar ghante ka farak rakhein.",
        followUpDays: 90,
        prescriber: DR_KHAN,
      },
      {
        daysAgo: 85,
        stage: "prescribed",
        complaint: { body: "Ghutno mein dard aur kamzori.", durationDays: 60 },
        vitals: { pulse: 68, systolic: 140, diastolic: 86 },
        diagnosis: "Hypothyroidism with osteoarthritis",
        items: [
          { drug: "levothyroxine", freq: "OD", days: 90, timing: "empty_stomach" },
          { drug: "paracetamol", freq: "BD", days: 10, timing: "after_food" },
          { drug: "calcium_vitamin_d3", freq: "OD", days: 90, timing: "after_food" },
        ],
        followUpDays: 90,
        prescriber: DR_IYER,
      },
    ],
  },
  {
    key: "rekha-kumari",
    name: "Rekha Kumari",
    sex: "female",
    age: 31,
    phone: "9812003456",
    village: "Danapur",
    district: "Patna",
    state: "Bihar",
    bloodGroup: "O+",
    language: "hi",
    baseline: { heightCm: 154, weightKg: 56, systolic: 116, diastolic: 74, pulse: 82 },
    allergies: [
      {
        classId: "sulfonamides",
        reaction:
          "Blistering rash and mouth ulcers after Septran as a teenager. Hospitalised for a week.",
        severity: "high",
        daysAgo: 500,
        source: "patient",
      },
    ],
    visits: [
      {
        daysAgo: 505,
        stage: "prescribed",
        complaint: { body: "Peshaab mein jalan aur pet ke neeche dard.", durationDays: 3, severity: "moderate" },
        vitals: { temperatureC: 38.0, pulse: 94 },
        diagnosis: "Urinary tract infection",
        // Not cotrimoxazole - the allergy was recorded at this visit and the
        // choice reflects it.
        items: [
          { drug: "ofloxacin", freq: "BD", days: 5, timing: "after_food" },
          { drug: "paracetamol", freq: "TDS", days: 3, timing: "after_food" },
        ],
        advice: "Sulfa wali dawa (Septran) kabhi na lein.",
        prescriber: DR_KHAN,
      },
      {
        daysAgo: 280,
        stage: "prescribed",
        complaint: { body: "Sir dard aur ulti jaisa lagta hai.", durationDays: 2 },
        vitals: { systolic: 118, diastolic: 76, pulse: 86 },
        diagnosis: "Migraine without aura",
        items: [
          { drug: "paracetamol", freq: "SOS", days: 5, timing: "after_food" },
          { drug: "domperidone", freq: "SOS", days: 5, timing: "before_food" },
        ],
        prescriber: DR_IYER,
      },
      {
        daysAgo: 20,
        stage: "prescribed",
        complaint: { body: "Khaansi aur gale mein dard, chaar din se.", durationDays: 4 },
        vitals: { temperatureC: 37.7, pulse: 88 },
        diagnosis: "Acute pharyngitis",
        items: [
          { drug: "azithromycin", freq: "OD", days: 3, timing: "before_food" },
          { drug: "paracetamol", freq: "TDS", days: 3, timing: "after_food" },
        ],
        prescriber: DR_IYER,
      },
    ],
  },
  {
    key: "imran-sheikh",
    name: "Imran Sheikh",
    sex: "male",
    age: 45,
    phone: "9833445566",
    village: "Govandi",
    district: "Mumbai Suburban",
    state: "Maharashtra",
    bloodGroup: "B+",
    language: "hi",
    notes: "Epilepsy on phenytoin for eleven years. Levels matter.",
    baseline: { heightCm: 172, weightKg: 66, systolic: 128, diastolic: 80, pulse: 76 },
    visits: [
      {
        daysAgo: 670,
        stage: "prescribed",
        complaint: { body: "Do mahine mein do daure pade.", durationDays: 60, severity: "severe" },
        vitals: { pulse: 78, systolic: 130, diastolic: 82 },
        diagnosis: "Generalised tonic-clonic epilepsy",
        items: [
          { drug: "phenytoin", freq: "BD", days: 60, timing: "after_food" },
          { drug: "calcium_vitamin_d3", freq: "OD", days: 60, timing: "after_food" },
        ],
        advice: "Dawa ek din bhi na chhodein. Gaadi na chalayein.",
        followUpDays: 60,
        prescriber: DR_KHAN,
      },
      {
        daysAgo: 380,
        stage: "prescribed",
        complaint: { body: "Koi daura nahi pada. Mashude sooj gaye hain.", durationDays: 90 },
        vitals: { pulse: 74 },
        diagnosis: "Epilepsy, seizure free; phenytoin gingival hyperplasia",
        items: [
          { drug: "phenytoin", freq: "BD", days: 90, timing: "after_food" },
          { drug: "vitamin_b_complex", freq: "OD", days: 90, timing: "after_food" },
        ],
        advice: "Din mein do baar brush karein, dant ke doctor ko dikhayein.",
        followUpDays: 90,
        prescriber: DR_KHAN,
      },
      {
        daysAgo: 110,
        stage: "prescribed",
        complaint: { body: "Dawa ke liye aaya hoon, sab theek hai.", durationDays: 1 },
        vitals: { pulse: 76, weightKg: 66 },
        diagnosis: "Epilepsy, stable on phenytoin",
        items: [{ drug: "phenytoin", freq: "BD", days: 90, timing: "after_food" }],
        followUpDays: 90,
        prescriber: DR_KHAN,
      },
    ],
  },
  {
    key: "lalita-nayak",
    name: "Lalita Nayak",
    sex: "female",
    age: 68,
    phone: "9845512077",
    village: "Khordha",
    district: "Khordha",
    state: "Odisha",
    bloodGroup: "O+",
    language: "or",
    notes: "Heart failure on furosemide and digoxin. Potassium matters.",
    baseline: { heightCm: 149, weightKg: 58, systolic: 124, diastolic: 76, pulse: 68, spo2: 94 },
    visits: [
      {
        daysAgo: 630,
        stage: "prescribed",
        complaint: { body: "Pada phulichhi aur sowapare nishwasa bandha hue.", durationDays: 45, severity: "severe" },
        vitals: { pulse: 96, spo2: 91, systolic: 132, diastolic: 82, weightKg: 63, respiratoryRate: 26 },
        diagnosis: "Congestive cardiac failure",
        items: [
          { drug: "furosemide", freq: "OD", days: 30, timing: "after_food" },
          { drug: "digoxin", freq: "OD", days: 30, timing: "after_food" },
          { drug: "enalapril", freq: "BD", days: 30, timing: "after_food" },
        ],
        advice: "Namak bahut kam. Roz wazan tolein, badhe to turant aayein.",
        followUpDays: 15,
        prescriber: DR_MEHRA,
        documents: [{ kind: "imaging", title: "Chest X-ray, cardiomegaly", documentDaysAgo: 632 }],
      },
      {
        daysAgo: 350,
        stage: "prescribed",
        complaint: { body: "Sujan kamichhi, kintu durbala lage.", durationDays: 30 },
        vitals: { pulse: 64, spo2: 94, weightKg: 58, systolic: 118, diastolic: 72 },
        diagnosis: "Cardiac failure, compensated",
        items: [
          { drug: "furosemide", freq: "OD", days: 90, timing: "after_food" },
          { drug: "digoxin", freq: "OD", days: 90, timing: "after_food" },
          { drug: "enalapril", freq: "BD", days: 90, timing: "after_food" },
        ],
        followUpDays: 90,
        prescriber: DR_MEHRA,
        documents: [{ kind: "lab_report", title: "Serum potassium 3.2 mEq/L", documentDaysAgo: 352 }],
      },
      {
        daysAgo: 55,
        stage: "prescribed",
        complaint: { body: "Nadi dhire chalichhi bhali lage, matha ghurae.", durationDays: 10 },
        vitals: { pulse: 58, spo2: 94, systolic: 112, diastolic: 70 },
        diagnosis: "Cardiac failure; bradycardia on digoxin",
        items: [
          { drug: "furosemide", freq: "OD", days: 60, timing: "after_food" },
          { drug: "enalapril", freq: "BD", days: 60, timing: "after_food" },
          { drug: "potassium_chloride", freq: "OD", days: 15, timing: "after_food" },
        ],
        advice: "Digoxin filhal band. Pandhra din pare punah dekhaibe.",
        followUpDays: 15,
        prescriber: DR_MEHRA,
      },
    ],
  },
];
