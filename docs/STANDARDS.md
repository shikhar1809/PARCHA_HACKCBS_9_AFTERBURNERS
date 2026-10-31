# Standards and law

What Parcha already does, what a judge or a hospital will ask about, and what is
not built yet. Nothing here is legal advice; it is where the product stands
against the rules and standards an Indian OPD product is measured by.

## ABDM: ABHA, the registries, and sharing records

The Ayushman Bharat Digital Mission (ABDM) connects patients, facilities and
doctors through:

- **ABHA**, the patient's health ID (a 14-digit number and an address like
  `name@abdm`), which links their records across hospitals.
- **HFR** (Health Facility Registry) for hospitals and clinics, and **HPR**
  (Healthcare Professionals Registry) for doctors.
- **Consent-based sharing**: a facility that creates records is a *Health
  Information Provider* (HIP); one that fetches them with the patient's consent
  is a *Health Information User* (HIU). Records travel as FHIR documents.

**Where Parcha stands: not connected yet.** The data model was built so that
connecting is mapping, not redesign:

| ABDM piece | In Parcha today | To connect |
| --- | --- | --- |
| ABHA | A patient record per hospital, matched by phone (a family can share one) | Add ABHA number and address to `patients`; create or verify ABHA at the desk (ABDM's first milestone, M1) |
| HFR | `hospitals/{id}` with name, address, location, departments | Store the facility's HFR ID; set at clinic set-up |
| HPR | Doctors' `registrationNo` and qualification, required before signing | Verify against HPR at the doctor's first sign-in |
| Care context | Each visit (`visits/{id}`) | Each visit becomes a care context linked to the ABHA (M2) |
| Sharing | The patient's own phone, share codes, export and delete | Act as an HIP: answer consent requests with FHIR bundles (M2); fetch past records with consent (M3) |

### The FHIR mapping

ABDM uses FHIR R4 with India's profiles (the NRCeS implementation guide).
Parcha's records map onto them directly:

| Parcha | FHIR resource | Notes |
| --- | --- | --- |
| `patients` | Patient | Name, sex, age or birth date, phone, village or area |
| `hospitals` | Organization | With the HFR ID once stored |
| `accounts` (doctors) | Practitioner | Registration number as an identifier |
| `visits` | Encounter | Stages map to Encounter status; ambulatory class |
| `vitals` | Observation | LOINC codes: blood pressure 85354-9 (systolic 8480-6, diastolic 8462-4), pulse 8867-4, temperature 8310-5, SpO2 59408-5, weight 29463-7, blood glucose 2339-0 |
| `complaints`, diagnosis | Condition | Chief complaint; encounter diagnosis |
| `allergies` | AllergyIntolerance | Class, reaction, severity, source |
| Prescription items | MedicationRequest | `1-0-1` becomes `timing.repeat.when` [MORN, NIGHT]; "every 2 days" becomes `period: 2, periodUnit: d`; days become `boundsDuration`; quantity becomes `dispenseRequest.quantity` |
| A signed prescription | ABDM *PrescriptionRecord* (a document Bundle with a Composition) | Signed by the Practitioner, dated by the server |
| `documents` | DocumentReference | The patient's own papers |
| `dispensing` | MedicationDispense | Including same-formula substitutions |
| `bills` | Invoice | Fee lines and payment mode |

The answer for a judge: *the records are already structured the way FHIR wants
them; exporting a PrescriptionRecord bundle and linking ABHA are the next step,
not a rebuild.*

## What a prescription must carry

The Telemedicine Practice Guidelines (2020) set out a sample e-prescription,
and the National Medical Commission's 2023 conduct regulations asked doctors to
prescribe by generic name, legibly, preferably in capitals. That generic-name
rule was put on hold in August 2023, but generic-first prescribing is still
what is expected. Against that, the printed and on-phone prescription carries:

| Item | Parcha |
| --- | --- |
| Doctor's name and qualification | Yes, from the doctor's profile |
| Doctor's registration number | Yes; a doctor cannot finish their first sign-in without it |
| Clinic name, address and phone | Yes |
| Patient's name, age, sex | Yes, with phone and village or area |
| Date | Yes, the server's time of signing |
| Chief complaint | Yes, as the desk recorded it |
| Diagnosis | Yes, when the doctor writes one |
| Medicines by generic name, in capitals | Yes; brands only as same-formula alternatives |
| Strength, dose, frequency, duration, timing | Yes, with the quantity to give |
| Advice and follow-up | Yes |
| Signature | **Partly.** Signed electronically by the authenticated doctor, with the server's timestamp and an append-only record; the slip has a line for a handwritten signature. It is not yet a Digital Signature Certificate or Aadhaar eSign signature, which is the next step for a legally strongest e-prescription under the IT Act |

## Data protection

The Digital Personal Data Protection Act (2023) asks for consent for a stated
purpose, and the right to see and erase one's data. Parcha:

- asks for consent on first sign-in, in Hindi or English, and records it;
- lets the patient download everything (**My data**) and delete their own
  papers, reminders and profile;
- keeps each hospital's records behind a wall: staff see only their own
  hospital's patients;
- logs every staff action in plain words, with where the device was.

Deleting removes everything the patient made (papers, reminders, profiles,
consent, the sign-in) and logs a request to each hospital they visited.
Clinical records stay with the hospital, as the rules on medical records
require; the hospital decides what else may be removed.
