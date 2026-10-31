/**
 * The formulary: ~46 drugs, their allergy classes, their interaction pairs,
 * and the vital thresholds that the drug<->vitals rule reads.
 *
 * This is the dataset the conflict engine runs over. It is deliberately
 * hand-written rather than generated, because the three rules are only as
 * good as this file is, and because the team has to be able to point at any
 * single row in front of judges and say where it came from.
 *
 * Scope note: this is a hackathon demo formulary built around what a North
 * Indian general OPD actually hands out. The interactions are the
 * well-established, textbook ones - it is not a clinical decision support
 * database and nothing here should be used to treat anybody.
 */

export type AllergyClassSeed = {
  id: string;
  label: string;
  description: string;
};

export type DrugSeed = {
  id: string;
  generic: string;
  brands: string[];
  drugClass: string;
  forms: string[];
  strengths: string[];
  defaultForm: string;
  defaultStrength: string;
  otc?: boolean;
  steroid?: boolean;
  allergyClasses?: string[];
  notes?: string;
};

export type InteractionSeed = {
  a: string;
  b: string;
  severity: "info" | "caution" | "high";
  mechanism: string;
  advice: string;
};

export type VitalCautionSeed = {
  id: string;
  drugId?: string;
  drugClass?: string;
  vital:
    | "blood_sugar_mgdl"
    | "systolic_mmhg"
    | "diastolic_mmhg"
    | "pulse_bpm"
    | "spo2_pct"
    | "temperature_c"
    | "weight_kg";
  comparator: "gt" | "gte" | "lt" | "lte";
  threshold: number;
  severity: "info" | "caution" | "high";
  message: string;
};

// ---------------------------------------------------------------------------
// Allergy classes.
//
// A patient says "penicillin se allergy hai" - they do not say
// "amoxicillin-clavulanate". The class is the unit of recall, so it is the
// unit of storage, and the drug<->allergy rule resolves brand -> class.
// ---------------------------------------------------------------------------
export const allergyClasses: AllergyClassSeed[] = [
  {
    id: "penicillins",
    label: "Penicillins",
    description:
      "Amoxicillin, ampicillin, cloxacillin and combinations. The most commonly reported drug allergy in Indian OPD.",
  },
  {
    id: "cephalosporins",
    label: "Cephalosporins",
    description:
      "Cefixime, cephalexin, ceftriaxone. Cross-reactivity with penicillins is possible, so a penicillin allergy is worth surfacing here too.",
  },
  {
    id: "sulfonamides",
    label: "Sulfa drugs",
    description:
      "Cotrimoxazole and related sulfonamides. Reactions range from rash to Stevens-Johnson syndrome.",
  },
  {
    id: "nsaids",
    label: "NSAIDs",
    description:
      "Ibuprofen, diclofenac, aceclofenac, naproxen, aspirin. Often presents as wheeze or urticaria rather than rash.",
  },
  {
    id: "macrolides",
    label: "Macrolides",
    description: "Azithromycin, erythromycin, clarithromycin.",
  },
  {
    id: "quinolones",
    label: "Fluoroquinolones",
    description: "Ciprofloxacin, levofloxacin, ofloxacin.",
  },
  {
    id: "tetracyclines",
    label: "Tetracyclines",
    description: "Doxycycline and related. Also photosensitising.",
  },
  {
    id: "opioids",
    label: "Opioids",
    description:
      "Tramadol, codeine. Often a reported intolerance (vomiting) rather than true allergy, which is worth recording as distinct.",
  },
  {
    id: "antiepileptics_aromatic",
    label: "Aromatic antiepileptics",
    description:
      "Phenytoin, carbamazepine. Cross-reactive hypersensitivity is well described.",
  },
  {
    id: "metronidazole_group",
    label: "Nitroimidazoles",
    description: "Metronidazole and related.",
  },
];

// ---------------------------------------------------------------------------
// Drugs.
// ---------------------------------------------------------------------------
export const drugs: DrugSeed[] = [
  // --- analgesics / antipyretics ---
  {
    id: "paracetamol",
    generic: "Paracetamol",
    brands: ["Crocin", "Dolo 650", "Calpol"],
    drugClass: "Analgesic / antipyretic",
    forms: ["tablet", "syrup", "injection"],
    strengths: ["500 mg", "650 mg", "125 mg/5 ml"],
    defaultForm: "tablet",
    defaultStrength: "650 mg",
    otc: true,
  },
  {
    id: "ibuprofen",
    generic: "Ibuprofen",
    brands: ["Brufen", "Combiflam (with paracetamol)"],
    drugClass: "NSAID",
    forms: ["tablet", "syrup"],
    strengths: ["200 mg", "400 mg", "100 mg/5 ml"],
    defaultForm: "tablet",
    defaultStrength: "400 mg",
    otc: true,
    allergyClasses: ["nsaids"],
  },
  {
    id: "diclofenac",
    generic: "Diclofenac sodium",
    brands: ["Voveran", "Dynapar"],
    drugClass: "NSAID",
    forms: ["tablet", "injection", "gel"],
    strengths: ["50 mg", "75 mg/3 ml"],
    defaultForm: "tablet",
    defaultStrength: "50 mg",
    allergyClasses: ["nsaids"],
  },
  {
    id: "aceclofenac",
    generic: "Aceclofenac",
    brands: ["Hifenac", "Zerodol"],
    drugClass: "NSAID",
    forms: ["tablet"],
    strengths: ["100 mg"],
    defaultForm: "tablet",
    defaultStrength: "100 mg",
    allergyClasses: ["nsaids"],
  },
  {
    id: "naproxen",
    generic: "Naproxen",
    brands: ["Naprosyn"],
    drugClass: "NSAID",
    forms: ["tablet"],
    strengths: ["250 mg", "500 mg"],
    defaultForm: "tablet",
    defaultStrength: "250 mg",
    allergyClasses: ["nsaids"],
  },
  {
    id: "aspirin",
    generic: "Aspirin",
    brands: ["Ecosprin", "Disprin"],
    drugClass: "NSAID / antiplatelet",
    forms: ["tablet"],
    strengths: ["75 mg", "150 mg", "325 mg"],
    defaultForm: "tablet",
    defaultStrength: "75 mg",
    allergyClasses: ["nsaids"],
    notes:
      "At 75 mg it is an antiplatelet, not an analgesic. Bleeding interactions still apply.",
  },
  {
    id: "tramadol",
    generic: "Tramadol",
    brands: ["Ultracet (with paracetamol)", "Tramazac"],
    drugClass: "Opioid analgesic",
    forms: ["tablet", "capsule", "injection"],
    strengths: ["50 mg", "100 mg"],
    defaultForm: "capsule",
    defaultStrength: "50 mg",
    allergyClasses: ["opioids"],
  },
  {
    id: "codeine",
    generic: "Codeine phosphate",
    brands: ["Codistar (with chlorpheniramine)"],
    drugClass: "Opioid antitussive",
    forms: ["syrup", "tablet"],
    strengths: ["10 mg/5 ml", "15 mg"],
    defaultForm: "syrup",
    defaultStrength: "10 mg/5 ml",
    allergyClasses: ["opioids"],
  },

  // --- antibiotics ---
  {
    id: "amoxicillin",
    generic: "Amoxicillin",
    brands: ["Mox", "Novamox"],
    drugClass: "Aminopenicillin",
    forms: ["capsule", "syrup"],
    strengths: ["250 mg", "500 mg", "125 mg/5 ml"],
    defaultForm: "capsule",
    defaultStrength: "500 mg",
    allergyClasses: ["penicillins"],
  },
  {
    id: "amoxicillin_clavulanate",
    generic: "Amoxicillin + Clavulanic acid",
    brands: ["Augmentin", "Clavam"],
    drugClass: "Aminopenicillin + beta-lactamase inhibitor",
    forms: ["tablet", "syrup", "injection"],
    strengths: ["625 mg", "1 g", "228 mg/5 ml"],
    defaultForm: "tablet",
    defaultStrength: "625 mg",
    allergyClasses: ["penicillins"],
  },
  {
    id: "ampicillin",
    generic: "Ampicillin",
    brands: ["Roscillin"],
    drugClass: "Aminopenicillin",
    forms: ["capsule", "injection"],
    strengths: ["250 mg", "500 mg"],
    defaultForm: "capsule",
    defaultStrength: "500 mg",
    allergyClasses: ["penicillins"],
  },
  {
    id: "cloxacillin",
    generic: "Cloxacillin",
    brands: ["Bioclox"],
    drugClass: "Antistaphylococcal penicillin",
    forms: ["capsule", "injection"],
    strengths: ["250 mg", "500 mg"],
    defaultForm: "capsule",
    defaultStrength: "500 mg",
    allergyClasses: ["penicillins"],
  },
  {
    id: "cefixime",
    generic: "Cefixime",
    brands: ["Taxim-O", "Zifi"],
    drugClass: "Third-generation cephalosporin",
    forms: ["tablet", "syrup"],
    strengths: ["200 mg", "50 mg/5 ml"],
    defaultForm: "tablet",
    defaultStrength: "200 mg",
    allergyClasses: ["cephalosporins"],
  },
  {
    id: "cephalexin",
    generic: "Cephalexin",
    brands: ["Sporidex"],
    drugClass: "First-generation cephalosporin",
    forms: ["capsule", "syrup"],
    strengths: ["250 mg", "500 mg"],
    defaultForm: "capsule",
    defaultStrength: "500 mg",
    allergyClasses: ["cephalosporins"],
  },
  {
    id: "ceftriaxone",
    generic: "Ceftriaxone",
    brands: ["Monocef", "Oframax"],
    drugClass: "Third-generation cephalosporin",
    forms: ["injection"],
    strengths: ["250 mg", "1 g"],
    defaultForm: "injection",
    defaultStrength: "1 g",
    allergyClasses: ["cephalosporins"],
  },
  {
    id: "azithromycin",
    generic: "Azithromycin",
    brands: ["Azithral", "Azee"],
    drugClass: "Macrolide",
    forms: ["tablet", "syrup"],
    strengths: ["250 mg", "500 mg", "200 mg/5 ml"],
    defaultForm: "tablet",
    defaultStrength: "500 mg",
    allergyClasses: ["macrolides"],
  },
  {
    id: "erythromycin",
    generic: "Erythromycin",
    brands: ["Erythrocin"],
    drugClass: "Macrolide",
    forms: ["tablet", "syrup"],
    strengths: ["250 mg", "500 mg"],
    defaultForm: "tablet",
    defaultStrength: "250 mg",
    allergyClasses: ["macrolides"],
  },
  {
    id: "clarithromycin",
    generic: "Clarithromycin",
    brands: ["Claribid"],
    drugClass: "Macrolide",
    forms: ["tablet"],
    strengths: ["250 mg", "500 mg"],
    defaultForm: "tablet",
    defaultStrength: "500 mg",
    allergyClasses: ["macrolides"],
    notes: "Strong CYP3A4 inhibitor - the source of several high-severity pairs.",
  },
  {
    id: "ciprofloxacin",
    generic: "Ciprofloxacin",
    brands: ["Ciplox", "Cifran"],
    drugClass: "Fluoroquinolone",
    forms: ["tablet", "eye drops", "injection"],
    strengths: ["250 mg", "500 mg"],
    defaultForm: "tablet",
    defaultStrength: "500 mg",
    allergyClasses: ["quinolones"],
  },
  {
    id: "levofloxacin",
    generic: "Levofloxacin",
    brands: ["Levoflox", "Levotas"],
    drugClass: "Fluoroquinolone",
    forms: ["tablet"],
    strengths: ["250 mg", "500 mg"],
    defaultForm: "tablet",
    defaultStrength: "500 mg",
    allergyClasses: ["quinolones"],
  },
  {
    id: "ofloxacin",
    generic: "Ofloxacin",
    brands: ["Oflox", "Zanocin"],
    drugClass: "Fluoroquinolone",
    forms: ["tablet", "syrup"],
    strengths: ["200 mg", "50 mg/5 ml"],
    defaultForm: "tablet",
    defaultStrength: "200 mg",
    allergyClasses: ["quinolones"],
  },
  {
    id: "cotrimoxazole",
    generic: "Trimethoprim + Sulfamethoxazole",
    brands: ["Septran", "Bactrim"],
    drugClass: "Sulfonamide combination",
    forms: ["tablet", "syrup"],
    strengths: ["480 mg", "960 mg"],
    defaultForm: "tablet",
    defaultStrength: "480 mg",
    allergyClasses: ["sulfonamides"],
  },
  {
    id: "metronidazole",
    generic: "Metronidazole",
    brands: ["Flagyl", "Metrogyl"],
    drugClass: "Nitroimidazole",
    forms: ["tablet", "syrup", "injection"],
    strengths: ["200 mg", "400 mg"],
    defaultForm: "tablet",
    defaultStrength: "400 mg",
    allergyClasses: ["metronidazole_group"],
  },
  {
    id: "doxycycline",
    generic: "Doxycycline",
    brands: ["Doxy-1", "Microdox"],
    drugClass: "Tetracycline",
    forms: ["capsule"],
    strengths: ["100 mg"],
    defaultForm: "capsule",
    defaultStrength: "100 mg",
    allergyClasses: ["tetracyclines"],
  },
  {
    id: "fluconazole",
    generic: "Fluconazole",
    brands: ["Forcan", "Zocon"],
    drugClass: "Azole antifungal",
    forms: ["tablet"],
    strengths: ["150 mg", "200 mg"],
    defaultForm: "tablet",
    defaultStrength: "150 mg",
  },
  {
    id: "albendazole",
    generic: "Albendazole",
    brands: ["Zentel", "Bandy"],
    drugClass: "Anthelmintic",
    forms: ["tablet", "syrup"],
    strengths: ["400 mg"],
    defaultForm: "tablet",
    defaultStrength: "400 mg",
    otc: true,
  },
  {
    id: "ivermectin",
    generic: "Ivermectin",
    brands: ["Ivermectol"],
    drugClass: "Anthelmintic",
    forms: ["tablet"],
    strengths: ["6 mg", "12 mg"],
    defaultForm: "tablet",
    defaultStrength: "12 mg",
  },

  // --- gastro ---
  {
    id: "omeprazole",
    generic: "Omeprazole",
    brands: ["Omez", "Ocid"],
    drugClass: "Proton pump inhibitor",
    forms: ["capsule"],
    strengths: ["20 mg", "40 mg"],
    defaultForm: "capsule",
    defaultStrength: "20 mg",
    otc: true,
  },
  {
    id: "pantoprazole",
    generic: "Pantoprazole",
    brands: ["Pan 40", "Pantocid"],
    drugClass: "Proton pump inhibitor",
    forms: ["tablet", "injection"],
    strengths: ["40 mg"],
    defaultForm: "tablet",
    defaultStrength: "40 mg",
  },
  {
    id: "ondansetron",
    generic: "Ondansetron",
    brands: ["Emeset", "Vomikind"],
    drugClass: "Antiemetic (5-HT3 antagonist)",
    forms: ["tablet", "syrup", "injection"],
    strengths: ["4 mg", "8 mg"],
    defaultForm: "tablet",
    defaultStrength: "4 mg",
  },
  {
    id: "domperidone",
    generic: "Domperidone",
    brands: ["Domstal"],
    drugClass: "Prokinetic antiemetic",
    forms: ["tablet", "syrup"],
    strengths: ["10 mg"],
    defaultForm: "tablet",
    defaultStrength: "10 mg",
  },
  {
    id: "ors",
    generic: "Oral rehydration salts",
    brands: ["ORS-L", "Electral"],
    drugClass: "Rehydration",
    forms: ["sachet"],
    strengths: ["21.8 g sachet"],
    defaultForm: "sachet",
    defaultStrength: "21.8 g sachet",
    otc: true,
  },

  // --- diabetes ---
  {
    id: "metformin",
    generic: "Metformin",
    brands: ["Glycomet", "Glucophage"],
    drugClass: "Biguanide",
    forms: ["tablet"],
    strengths: ["500 mg", "850 mg", "1 g"],
    defaultForm: "tablet",
    defaultStrength: "500 mg",
  },
  {
    id: "glimepiride",
    generic: "Glimepiride",
    brands: ["Amaryl", "Glimestar"],
    drugClass: "Sulfonylurea",
    forms: ["tablet"],
    strengths: ["1 mg", "2 mg"],
    defaultForm: "tablet",
    defaultStrength: "1 mg",
  },
  {
    id: "gliclazide",
    generic: "Gliclazide",
    brands: ["Diamicron"],
    drugClass: "Sulfonylurea",
    forms: ["tablet"],
    strengths: ["40 mg", "80 mg"],
    defaultForm: "tablet",
    defaultStrength: "80 mg",
  },
  {
    id: "insulin_human",
    generic: "Human insulin (30/70)",
    brands: ["Mixtard", "Huminsulin"],
    drugClass: "Insulin",
    forms: ["injection"],
    strengths: ["100 IU/ml"],
    defaultForm: "injection",
    defaultStrength: "100 IU/ml",
  },

  // --- cardiovascular ---
  {
    id: "amlodipine",
    generic: "Amlodipine",
    brands: ["Amlopres", "Stamlo"],
    drugClass: "Calcium channel blocker",
    forms: ["tablet"],
    strengths: ["2.5 mg", "5 mg", "10 mg"],
    defaultForm: "tablet",
    defaultStrength: "5 mg",
  },
  {
    id: "telmisartan",
    generic: "Telmisartan",
    brands: ["Telma", "Telsartan"],
    drugClass: "Angiotensin receptor blocker",
    forms: ["tablet"],
    strengths: ["20 mg", "40 mg"],
    defaultForm: "tablet",
    defaultStrength: "40 mg",
  },
  {
    id: "enalapril",
    generic: "Enalapril",
    brands: ["Envas"],
    drugClass: "ACE inhibitor",
    forms: ["tablet"],
    strengths: ["2.5 mg", "5 mg"],
    defaultForm: "tablet",
    defaultStrength: "5 mg",
  },
  {
    id: "atenolol",
    generic: "Atenolol",
    brands: ["Aten", "Tenormin"],
    drugClass: "Beta blocker",
    forms: ["tablet"],
    strengths: ["25 mg", "50 mg"],
    defaultForm: "tablet",
    defaultStrength: "50 mg",
  },
  {
    id: "metoprolol",
    generic: "Metoprolol",
    brands: ["Metolar", "Betaloc"],
    drugClass: "Beta blocker",
    forms: ["tablet"],
    strengths: ["25 mg", "50 mg"],
    defaultForm: "tablet",
    defaultStrength: "25 mg",
  },
  {
    id: "hydrochlorothiazide",
    generic: "Hydrochlorothiazide",
    brands: ["Aquazide"],
    drugClass: "Thiazide diuretic",
    forms: ["tablet"],
    strengths: ["12.5 mg", "25 mg"],
    defaultForm: "tablet",
    defaultStrength: "12.5 mg",
  },
  {
    id: "furosemide",
    generic: "Furosemide",
    brands: ["Lasix"],
    drugClass: "Loop diuretic",
    forms: ["tablet", "injection"],
    strengths: ["40 mg"],
    defaultForm: "tablet",
    defaultStrength: "40 mg",
  },
  {
    id: "spironolactone",
    generic: "Spironolactone",
    brands: ["Aldactone"],
    drugClass: "Potassium-sparing diuretic",
    forms: ["tablet"],
    strengths: ["25 mg", "50 mg"],
    defaultForm: "tablet",
    defaultStrength: "25 mg",
  },
  {
    id: "potassium_chloride",
    generic: "Potassium chloride",
    brands: ["K-Cl syrup"],
    drugClass: "Electrolyte supplement",
    forms: ["syrup", "tablet"],
    strengths: ["600 mg", "20 mEq/15 ml"],
    defaultForm: "syrup",
    defaultStrength: "20 mEq/15 ml",
  },
  {
    id: "atorvastatin",
    generic: "Atorvastatin",
    brands: ["Atorva", "Lipvas"],
    drugClass: "Statin",
    forms: ["tablet"],
    strengths: ["10 mg", "20 mg", "40 mg"],
    defaultForm: "tablet",
    defaultStrength: "10 mg",
  },
  {
    id: "clopidogrel",
    generic: "Clopidogrel",
    brands: ["Plavix", "Clopilet"],
    drugClass: "Antiplatelet",
    forms: ["tablet"],
    strengths: ["75 mg"],
    defaultForm: "tablet",
    defaultStrength: "75 mg",
  },
  {
    id: "warfarin",
    generic: "Warfarin",
    brands: ["Warf", "Uniwarfin"],
    drugClass: "Vitamin K antagonist",
    forms: ["tablet"],
    strengths: ["1 mg", "2 mg", "5 mg"],
    defaultForm: "tablet",
    defaultStrength: "2 mg",
    notes:
      "Narrow therapeutic index. Most of the high-severity interaction pairs in this formulary involve warfarin.",
  },
  {
    id: "digoxin",
    generic: "Digoxin",
    brands: ["Lanoxin"],
    drugClass: "Cardiac glycoside",
    forms: ["tablet"],
    strengths: ["0.25 mg"],
    defaultForm: "tablet",
    defaultStrength: "0.25 mg",
  },

  // --- steroids ---
  {
    id: "prednisolone",
    generic: "Prednisolone",
    brands: ["Omnacortil", "Wysolone"],
    drugClass: "Corticosteroid",
    forms: ["tablet", "syrup"],
    strengths: ["5 mg", "10 mg", "20 mg"],
    defaultForm: "tablet",
    defaultStrength: "10 mg",
    steroid: true,
  },
  {
    id: "dexamethasone",
    generic: "Dexamethasone",
    brands: ["Decdan", "Dexona"],
    drugClass: "Corticosteroid",
    forms: ["tablet", "injection"],
    strengths: ["0.5 mg", "4 mg/ml"],
    defaultForm: "tablet",
    defaultStrength: "0.5 mg",
    steroid: true,
  },
  {
    id: "deflazacort",
    generic: "Deflazacort",
    brands: ["Defcort"],
    drugClass: "Corticosteroid",
    forms: ["tablet"],
    strengths: ["6 mg", "30 mg"],
    defaultForm: "tablet",
    defaultStrength: "6 mg",
    steroid: true,
  },
  {
    id: "hydrocortisone",
    generic: "Hydrocortisone",
    brands: ["Efcorlin"],
    drugClass: "Corticosteroid",
    forms: ["injection", "cream"],
    strengths: ["100 mg", "1%"],
    defaultForm: "injection",
    defaultStrength: "100 mg",
    steroid: true,
  },

  // --- respiratory / allergy ---
  {
    id: "salbutamol",
    generic: "Salbutamol",
    brands: ["Asthalin", "Ventorlin"],
    drugClass: "Short-acting beta agonist",
    forms: ["inhaler", "tablet", "respule"],
    strengths: ["100 mcg/puff", "2 mg", "2.5 mg/2.5 ml"],
    defaultForm: "inhaler",
    defaultStrength: "100 mcg/puff",
  },
  {
    id: "budesonide",
    generic: "Budesonide",
    brands: ["Budecort"],
    drugClass: "Inhaled corticosteroid",
    forms: ["inhaler", "respule"],
    strengths: ["200 mcg/puff", "0.5 mg/2 ml"],
    defaultForm: "inhaler",
    defaultStrength: "200 mcg/puff",
    steroid: true,
    notes:
      "Inhaled, so systemic effects are far smaller than with oral steroids. Flagged as a steroid, but the vitals rule treats it at lower severity.",
  },
  {
    id: "montelukast",
    generic: "Montelukast",
    brands: ["Montair", "Montek"],
    drugClass: "Leukotriene receptor antagonist",
    forms: ["tablet"],
    strengths: ["4 mg", "5 mg", "10 mg"],
    defaultForm: "tablet",
    defaultStrength: "10 mg",
  },
  {
    id: "theophylline",
    generic: "Theophylline",
    brands: ["Deriphyllin"],
    drugClass: "Methylxanthine bronchodilator",
    forms: ["tablet"],
    strengths: ["100 mg", "300 mg"],
    defaultForm: "tablet",
    defaultStrength: "300 mg",
    notes: "Narrow therapeutic index; levels rise sharply with CYP inhibitors.",
  },
  {
    id: "cetirizine",
    generic: "Cetirizine",
    brands: ["Cetzine", "Alerid"],
    drugClass: "Second-generation antihistamine",
    forms: ["tablet", "syrup"],
    strengths: ["10 mg", "5 mg/5 ml"],
    defaultForm: "tablet",
    defaultStrength: "10 mg",
    otc: true,
  },
  {
    id: "levocetirizine",
    generic: "Levocetirizine",
    brands: ["Xyzal", "Levocet"],
    drugClass: "Second-generation antihistamine",
    forms: ["tablet", "syrup"],
    strengths: ["5 mg"],
    defaultForm: "tablet",
    defaultStrength: "5 mg",
    otc: true,
  },
  {
    id: "chlorpheniramine",
    generic: "Chlorpheniramine maleate",
    brands: ["CPM", "Piriton"],
    drugClass: "First-generation antihistamine",
    forms: ["tablet", "syrup"],
    strengths: ["4 mg"],
    defaultForm: "tablet",
    defaultStrength: "4 mg",
    otc: true,
  },

  // --- neuro / psych ---
  {
    id: "amitriptyline",
    generic: "Amitriptyline",
    brands: ["Tryptomer"],
    drugClass: "Tricyclic antidepressant",
    forms: ["tablet"],
    strengths: ["10 mg", "25 mg"],
    defaultForm: "tablet",
    defaultStrength: "10 mg",
  },
  {
    id: "carbamazepine",
    generic: "Carbamazepine",
    brands: ["Tegretol", "Mazetol"],
    drugClass: "Antiepileptic",
    forms: ["tablet"],
    strengths: ["100 mg", "200 mg"],
    defaultForm: "tablet",
    defaultStrength: "200 mg",
    allergyClasses: ["antiepileptics_aromatic"],
  },
  {
    id: "phenytoin",
    generic: "Phenytoin sodium",
    brands: ["Eptoin", "Dilantin"],
    drugClass: "Antiepileptic",
    forms: ["tablet", "capsule", "syrup"],
    strengths: ["50 mg", "100 mg"],
    defaultForm: "tablet",
    defaultStrength: "100 mg",
    allergyClasses: ["antiepileptics_aromatic"],
  },

  // --- endocrine / supplements ---
  {
    id: "levothyroxine",
    generic: "Levothyroxine",
    brands: ["Thyronorm", "Eltroxin"],
    drugClass: "Thyroid hormone",
    forms: ["tablet"],
    strengths: ["25 mcg", "50 mcg", "100 mcg"],
    defaultForm: "tablet",
    defaultStrength: "50 mcg",
  },
  {
    id: "iron_folic_acid",
    generic: "Ferrous sulphate + Folic acid",
    brands: ["IFA tablets", "Fefol"],
    drugClass: "Haematinic",
    forms: ["tablet", "syrup"],
    strengths: ["100 mg + 500 mcg"],
    defaultForm: "tablet",
    defaultStrength: "100 mg + 500 mcg",
    otc: true,
  },
  {
    id: "calcium_vitamin_d3",
    generic: "Calcium carbonate + Vitamin D3",
    brands: ["Shelcal", "Calcimax"],
    drugClass: "Mineral supplement",
    forms: ["tablet"],
    strengths: ["500 mg + 250 IU"],
    defaultForm: "tablet",
    defaultStrength: "500 mg + 250 IU",
    otc: true,
  },
  {
    id: "vitamin_b_complex",
    generic: "Vitamin B complex",
    brands: ["Becosules", "Neurobion"],
    drugClass: "Vitamin supplement",
    forms: ["capsule", "injection"],
    strengths: ["standard"],
    defaultForm: "capsule",
    defaultStrength: "standard",
    otc: true,
  },
  {
    id: "allopurinol",
    generic: "Allopurinol",
    brands: ["Zyloric"],
    drugClass: "Xanthine oxidase inhibitor",
    forms: ["tablet"],
    strengths: ["100 mg", "300 mg"],
    defaultForm: "tablet",
    defaultStrength: "100 mg",
  },
];

// ---------------------------------------------------------------------------
// drug <-> drug.
//
// Order within a pair does not matter here; the builder sorts each pair to
// satisfy the drug_a_id < drug_b_id constraint.
// ---------------------------------------------------------------------------
export const interactions: InteractionSeed[] = [
  // --- warfarin, the big one ---
  {
    a: "warfarin",
    b: "aspirin",
    severity: "high",
    mechanism: "Additive antiplatelet effect on top of anticoagulation.",
    advice: "Avoid unless specifically intended. If unavoidable, add gastroprotection and recheck INR within a week.",
  },
  {
    a: "warfarin",
    b: "ibuprofen",
    severity: "high",
    mechanism: "NSAIDs displace warfarin from protein binding and injure gastric mucosa.",
    advice: "Use paracetamol for analgesia instead.",
  },
  {
    a: "warfarin",
    b: "diclofenac",
    severity: "high",
    mechanism: "NSAID-induced GI bleeding risk on an anticoagulated patient.",
    advice: "Use paracetamol for analgesia instead.",
  },
  {
    a: "warfarin",
    b: "aceclofenac",
    severity: "high",
    mechanism: "NSAID-induced GI bleeding risk on an anticoagulated patient.",
    advice: "Use paracetamol for analgesia instead.",
  },
  {
    a: "warfarin",
    b: "naproxen",
    severity: "high",
    mechanism: "NSAID-induced GI bleeding risk on an anticoagulated patient.",
    advice: "Use paracetamol for analgesia instead.",
  },
  {
    a: "warfarin",
    b: "ciprofloxacin",
    severity: "high",
    mechanism: "CYP1A2/3A4 inhibition raises warfarin levels; INR can climb within days.",
    advice: "Prefer a non-quinolone. If required, recheck INR after 3 to 5 days.",
  },
  {
    a: "warfarin",
    b: "metronidazole",
    severity: "high",
    mechanism: "Inhibits warfarin metabolism; one of the most reliably reported INR spikes.",
    advice: "Reduce warfarin dose and recheck INR within 3 days.",
  },
  {
    a: "warfarin",
    b: "fluconazole",
    severity: "high",
    mechanism: "Potent CYP2C9 inhibition raises warfarin exposure sharply.",
    advice: "Avoid, or reduce warfarin dose and monitor INR closely.",
  },
  {
    a: "warfarin",
    b: "cotrimoxazole",
    severity: "high",
    mechanism: "CYP2C9 inhibition plus protein-binding displacement.",
    advice: "Choose a different antibiotic where possible.",
  },
  {
    a: "warfarin",
    b: "clarithromycin",
    severity: "high",
    mechanism: "CYP3A4 inhibition raises warfarin levels.",
    advice: "Prefer azithromycin and still recheck INR.",
  },
  {
    a: "warfarin",
    b: "azithromycin",
    severity: "caution",
    mechanism: "Weaker CYP interaction than clarithromycin, but INR rises are reported.",
    advice: "Acceptable with an INR check after the course.",
  },
  {
    a: "warfarin",
    b: "carbamazepine",
    severity: "high",
    mechanism: "Enzyme induction lowers warfarin levels; anticoagulation can be lost.",
    advice: "Expect to need a higher warfarin dose; monitor INR.",
  },

  // --- bleeding / antiplatelet ---
  {
    a: "clopidogrel",
    b: "aspirin",
    severity: "caution",
    mechanism: "Dual antiplatelet therapy - intended in some indications, additive bleeding risk in all.",
    advice: "Confirm this combination is deliberate and time-limited.",
  },
  {
    a: "clopidogrel",
    b: "omeprazole",
    severity: "caution",
    mechanism: "CYP2C19 inhibition reduces conversion of clopidogrel to its active form.",
    advice: "Prefer pantoprazole for gastroprotection.",
  },

  // --- NSAID duplication and stacking ---
  {
    a: "ibuprofen",
    b: "diclofenac",
    severity: "caution",
    mechanism: "Two NSAIDs together multiply GI and renal risk without adding analgesia.",
    advice: "Prescribe one NSAID only.",
  },
  {
    a: "diclofenac",
    b: "aceclofenac",
    severity: "caution",
    mechanism: "Duplicate NSAID therapy.",
    advice: "Prescribe one NSAID only.",
  },
  {
    a: "ibuprofen",
    b: "aspirin",
    severity: "caution",
    mechanism: "Ibuprofen blocks aspirin's irreversible platelet binding, blunting cardioprotection.",
    advice: "Separate doses, or use paracetamol for analgesia.",
  },
  {
    a: "prednisolone",
    b: "ibuprofen",
    severity: "high",
    mechanism: "Steroid plus NSAID markedly raises the risk of peptic ulceration and GI bleed.",
    advice: "Add a proton pump inhibitor, or drop one of the two.",
  },
  {
    a: "prednisolone",
    b: "diclofenac",
    severity: "high",
    mechanism: "Steroid plus NSAID markedly raises the risk of peptic ulceration and GI bleed.",
    advice: "Add a proton pump inhibitor, or drop one of the two.",
  },
  {
    a: "prednisolone",
    b: "aceclofenac",
    severity: "high",
    mechanism: "Steroid plus NSAID markedly raises the risk of peptic ulceration and GI bleed.",
    advice: "Add a proton pump inhibitor, or drop one of the two.",
  },

  // --- electrolytes ---
  {
    a: "spironolactone",
    b: "potassium_chloride",
    severity: "high",
    mechanism: "Both raise serum potassium; hyperkalaemia can be fatal and is often silent.",
    advice: "Do not combine without a potassium result in hand.",
  },
  {
    a: "spironolactone",
    b: "enalapril",
    severity: "high",
    mechanism: "ACE inhibition plus potassium sparing - additive hyperkalaemia.",
    advice: "Check potassium and renal function before and after starting.",
  },
  {
    a: "spironolactone",
    b: "telmisartan",
    severity: "high",
    mechanism: "ARB plus potassium sparing - additive hyperkalaemia.",
    advice: "Check potassium and renal function before and after starting.",
  },
  {
    a: "enalapril",
    b: "potassium_chloride",
    severity: "high",
    mechanism: "ACE inhibitors retain potassium; added supplementation compounds it.",
    advice: "Avoid routine potassium supplementation on an ACE inhibitor.",
  },
  {
    a: "digoxin",
    b: "furosemide",
    severity: "high",
    mechanism: "Diuretic-induced hypokalaemia sharply increases digoxin toxicity.",
    advice: "Monitor potassium; consider a potassium-sparing agent.",
  },
  {
    a: "digoxin",
    b: "clarithromycin",
    severity: "high",
    mechanism: "Raises digoxin levels via P-glycoprotein inhibition.",
    advice: "Avoid, or halve the digoxin dose and watch for nausea and bradycardia.",
  },
  {
    a: "digoxin",
    b: "spironolactone",
    severity: "caution",
    mechanism: "Spironolactone raises digoxin levels and interferes with some assays.",
    advice: "Interpret digoxin levels with care.",
  },
  {
    a: "enalapril",
    b: "ibuprofen",
    severity: "caution",
    mechanism: "NSAIDs blunt the antihypertensive effect and can precipitate renal impairment.",
    advice: "Short courses only; check creatinine if ongoing.",
  },
  {
    a: "furosemide",
    b: "ibuprofen",
    severity: "caution",
    mechanism: "NSAIDs antagonise the diuretic effect and add renal risk.",
    advice: "Avoid in heart failure.",
  },

  // --- CYP and QT ---
  {
    a: "atorvastatin",
    b: "clarithromycin",
    severity: "high",
    mechanism: "CYP3A4 inhibition raises statin levels; rhabdomyolysis risk.",
    advice: "Hold the statin for the duration of the macrolide course.",
  },
  {
    a: "atorvastatin",
    b: "fluconazole",
    severity: "caution",
    mechanism: "Raised statin exposure; myopathy risk.",
    advice: "Warn the patient about muscle pain and dark urine.",
  },
  {
    a: "ciprofloxacin",
    b: "theophylline",
    severity: "high",
    mechanism: "CYP1A2 inhibition can double theophylline levels, causing seizures.",
    advice: "Use a non-quinolone antibiotic.",
  },
  {
    a: "erythromycin",
    b: "theophylline",
    severity: "high",
    mechanism: "Reduced theophylline clearance.",
    advice: "Prefer azithromycin and reduce the theophylline dose.",
  },
  {
    a: "phenytoin",
    b: "fluconazole",
    severity: "high",
    mechanism: "CYP2C9 inhibition raises phenytoin to toxic levels.",
    advice: "Avoid, or monitor phenytoin levels.",
  },
  {
    a: "phenytoin",
    b: "carbamazepine",
    severity: "caution",
    mechanism: "Mutual enzyme induction; both levels become unpredictable.",
    advice: "Only under specialist supervision with level monitoring.",
  },
  {
    a: "tramadol",
    b: "amitriptyline",
    severity: "high",
    mechanism: "Additive serotonergic effect and a lowered seizure threshold.",
    advice: "Avoid the combination, particularly in the elderly.",
  },
  {
    a: "tramadol",
    b: "codeine",
    severity: "caution",
    mechanism: "Duplicate opioid therapy; additive sedation and respiratory depression.",
    advice: "Prescribe one opioid only.",
  },
  {
    a: "amitriptyline",
    b: "ondansetron",
    severity: "caution",
    mechanism: "Both prolong the QT interval.",
    advice: "Avoid in known long QT or electrolyte disturbance.",
  },
  {
    a: "azithromycin",
    b: "ondansetron",
    severity: "caution",
    mechanism: "Additive QT prolongation.",
    advice: "Short courses; avoid with hypokalaemia.",
  },
  {
    a: "levofloxacin",
    b: "ondansetron",
    severity: "caution",
    mechanism: "Additive QT prolongation.",
    advice: "Short courses; avoid with hypokalaemia.",
  },

  // --- absorption / chelation ---
  {
    a: "ciprofloxacin",
    b: "calcium_vitamin_d3",
    severity: "caution",
    mechanism: "Calcium chelates the quinolone and can abolish absorption.",
    advice: "Separate the doses by at least two hours.",
  },
  {
    a: "ciprofloxacin",
    b: "iron_folic_acid",
    severity: "caution",
    mechanism: "Iron chelates the quinolone and can abolish absorption.",
    advice: "Separate the doses by at least two hours.",
  },
  {
    a: "levofloxacin",
    b: "iron_folic_acid",
    severity: "caution",
    mechanism: "Iron chelates the quinolone and can abolish absorption.",
    advice: "Separate the doses by at least two hours.",
  },
  {
    a: "doxycycline",
    b: "calcium_vitamin_d3",
    severity: "caution",
    mechanism: "Calcium chelates tetracyclines.",
    advice: "Separate the doses by at least two hours.",
  },
  {
    a: "doxycycline",
    b: "iron_folic_acid",
    severity: "caution",
    mechanism: "Iron chelates tetracyclines.",
    advice: "Separate the doses by at least two hours.",
  },
  {
    a: "levothyroxine",
    b: "calcium_vitamin_d3",
    severity: "caution",
    mechanism: "Calcium blocks levothyroxine absorption; a common cause of apparent treatment failure.",
    advice: "Take levothyroxine on an empty stomach, four hours apart from calcium.",
  },
  {
    a: "levothyroxine",
    b: "iron_folic_acid",
    severity: "caution",
    mechanism: "Iron blocks levothyroxine absorption.",
    advice: "Separate the doses by at least four hours.",
  },

  // --- glycaemic ---
  {
    a: "glimepiride",
    b: "ciprofloxacin",
    severity: "caution",
    mechanism: "Quinolones can cause both hypo- and hyperglycaemia on a sulfonylurea.",
    advice: "Warn the patient and check sugars during the course.",
  },
  {
    a: "glimepiride",
    b: "cotrimoxazole",
    severity: "caution",
    mechanism: "Potentiates the sulfonylurea; hypoglycaemia reported.",
    advice: "Check sugars during the course.",
  },
  {
    a: "metformin",
    b: "prednisolone",
    severity: "caution",
    mechanism: "Steroids raise blood glucose and work against the oral hypoglycaemic.",
    advice: "Expect sugars to rise; review the diabetes plan for the steroid course.",
  },

  // --- respiratory ---
  {
    a: "atenolol",
    b: "salbutamol",
    severity: "caution",
    mechanism: "Non-selective beta blockade antagonises the bronchodilator and can provoke bronchospasm.",
    advice: "Prefer a cardioselective agent in asthma, or avoid beta blockade.",
  },
  {
    a: "metoprolol",
    b: "salbutamol",
    severity: "caution",
    mechanism: "Beta blockade blunts the bronchodilator response.",
    advice: "Use the lowest effective beta blocker dose and monitor symptoms.",
  },

  // --- misc ---
  {
    a: "allopurinol",
    b: "amoxicillin",
    severity: "caution",
    mechanism: "Markedly increased incidence of rash with the combination.",
    advice: "Warn the patient; a rash here is not necessarily penicillin allergy.",
  },
];

// ---------------------------------------------------------------------------
// drug <-> vitals.
//
// This is the rule with no paper equivalent: nothing on a paper slip connects
// the sugar the compounder wrote at the top with the steroid the doctor
// wrote at the bottom. Thresholds are blunt on purpose - the flag advises,
// it does not decide.
// ---------------------------------------------------------------------------
export const vitalCautions: VitalCautionSeed[] = [
  // --- the headline case ---
  {
    id: "steroid_high_sugar_class",
    drugClass: "Corticosteroid",
    vital: "blood_sugar_mgdl",
    comparator: "gt",
    threshold: 180,
    severity: "caution",
    message:
      "Corticosteroids raise blood glucose. This patient's intake sugar is already above target.",
  },
  {
    id: "prednisolone_high_sugar",
    drugId: "prednisolone",
    vital: "blood_sugar_mgdl",
    comparator: "gt",
    threshold: 250,
    severity: "high",
    message:
      "Oral prednisolone on a markedly raised intake sugar. Expect a further rise; review the diabetes plan before starting, or choose a non-steroid option.",
  },
  {
    id: "dexamethasone_high_sugar",
    drugId: "dexamethasone",
    vital: "blood_sugar_mgdl",
    comparator: "gt",
    threshold: 250,
    severity: "high",
    message:
      "Dexamethasone has a strong and prolonged hyperglycaemic effect on an already raised intake sugar.",
  },
  {
    id: "deflazacort_high_sugar",
    drugId: "deflazacort",
    vital: "blood_sugar_mgdl",
    comparator: "gt",
    threshold: 250,
    severity: "high",
    message: "Deflazacort will push an already raised sugar higher.",
  },
  {
    id: "budesonide_high_sugar",
    drugId: "budesonide",
    vital: "blood_sugar_mgdl",
    comparator: "gt",
    threshold: 300,
    severity: "info",
    message:
      "Inhaled steroid - systemic glycaemic effect is small, but worth noting at this sugar level.",
  },

  // --- hypoglycaemia ---
  {
    id: "glimepiride_low_sugar",
    drugId: "glimepiride",
    vital: "blood_sugar_mgdl",
    comparator: "lt",
    threshold: 90,
    severity: "high",
    message: "Sulfonylurea with an intake sugar already at or below normal - hypoglycaemia risk.",
  },
  {
    id: "gliclazide_low_sugar",
    drugId: "gliclazide",
    vital: "blood_sugar_mgdl",
    comparator: "lt",
    threshold: 90,
    severity: "high",
    message: "Sulfonylurea with an intake sugar already at or below normal - hypoglycaemia risk.",
  },
  {
    id: "insulin_low_sugar",
    drugId: "insulin_human",
    vital: "blood_sugar_mgdl",
    comparator: "lt",
    threshold: 100,
    severity: "high",
    message: "Insulin with a low intake sugar reading.",
  },

  // --- heart rate ---
  {
    id: "atenolol_bradycardia",
    drugId: "atenolol",
    vital: "pulse_bpm",
    comparator: "lt",
    threshold: 55,
    severity: "high",
    message: "Beta blocker with an intake pulse already below 55.",
  },
  {
    id: "metoprolol_bradycardia",
    drugId: "metoprolol",
    vital: "pulse_bpm",
    comparator: "lt",
    threshold: 55,
    severity: "high",
    message: "Beta blocker with an intake pulse already below 55.",
  },
  {
    id: "digoxin_bradycardia",
    drugId: "digoxin",
    vital: "pulse_bpm",
    comparator: "lt",
    threshold: 60,
    severity: "high",
    message: "Digoxin slows the heart further; intake pulse is already below 60.",
  },
  {
    id: "salbutamol_tachycardia",
    drugId: "salbutamol",
    vital: "pulse_bpm",
    comparator: "gt",
    threshold: 120,
    severity: "caution",
    message: "Beta agonist with an intake pulse above 120.",
  },
  {
    id: "theophylline_tachycardia",
    drugId: "theophylline",
    vital: "pulse_bpm",
    comparator: "gt",
    threshold: 110,
    severity: "caution",
    message: "Theophylline is arrhythmogenic; intake pulse is already raised.",
  },
  {
    id: "levothyroxine_tachycardia",
    drugId: "levothyroxine",
    vital: "pulse_bpm",
    comparator: "gt",
    threshold: 110,
    severity: "caution",
    message: "Raised pulse may indicate over-replacement. Review the dose before increasing it.",
  },

  // --- blood pressure ---
  {
    id: "nsaid_hypertension",
    drugClass: "NSAID",
    vital: "systolic_mmhg",
    comparator: "gt",
    threshold: 160,
    severity: "caution",
    message: "NSAIDs raise blood pressure and blunt antihypertensives; intake systolic is already above 160.",
  },
  {
    id: "amlodipine_hypotension",
    drugId: "amlodipine",
    vital: "systolic_mmhg",
    comparator: "lt",
    threshold: 100,
    severity: "caution",
    message: "Intake systolic below 100 before starting or increasing an antihypertensive.",
  },
  {
    id: "telmisartan_hypotension",
    drugId: "telmisartan",
    vital: "systolic_mmhg",
    comparator: "lt",
    threshold: 100,
    severity: "caution",
    message: "Intake systolic below 100 before starting or increasing an antihypertensive.",
  },
  {
    id: "enalapril_hypotension",
    drugId: "enalapril",
    vital: "systolic_mmhg",
    comparator: "lt",
    threshold: 100,
    severity: "caution",
    message: "Intake systolic below 100 before starting or increasing an antihypertensive.",
  },
  {
    id: "furosemide_hypotension",
    drugId: "furosemide",
    vital: "systolic_mmhg",
    comparator: "lt",
    threshold: 100,
    severity: "caution",
    message: "Diuresis on an already low systolic pressure.",
  },

  // --- oxygenation ---
  {
    id: "tramadol_low_spo2",
    drugId: "tramadol",
    vital: "spo2_pct",
    comparator: "lt",
    threshold: 94,
    severity: "high",
    message: "Opioid with an intake SpO2 below 94%; respiratory depression risk.",
  },
  {
    id: "codeine_low_spo2",
    drugId: "codeine",
    vital: "spo2_pct",
    comparator: "lt",
    threshold: 94,
    severity: "high",
    message: "Opioid antitussive with an intake SpO2 below 94%.",
  },
];
