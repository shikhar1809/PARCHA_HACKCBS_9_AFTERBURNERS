# Data model

Firestore, in `asia-south1`. Every collection name is defined once, in
`packages/core/src/paths.ts`; every document type in `packages/core/src/types.ts`.

## The visit and its stages

A **visit** is the spine: one document per trip to the clinic. Everything else
hangs off it or points at it. `visit.stage` is the only field any queue filters
on, so "whose counter is this patient at" is defined in one place
(`packages/core/src/stages.ts`) and enforced by the functions.

```
          ┌─ cancelled ◄──────────────┐
requested ⇄ proposed → scheduled → registered → intake_complete → in_consultation → prescribed
 (patient    (desk       (doctor      (arrived;     (vitals and       (doctor        (signed;
  asked)      chose a     accepted     desk takes    complaint taken,  started)       visit is
              doctor)     a time)      vitals)       sent to doctor)                  closed)
```

| Stage | Who acts next | Meaning |
| --- | --- | --- |
| `requested` | Front desk | A patient asked a hospital for a visit; the desk must find a doctor within the 15-minute promise or the request moves to the next hospital |
| `proposed` | Doctor | The desk asked a doctor; they accept with a time or decline with a reason |
| `scheduled` | Front desk | Booked. The desk checks the patient in on arrival |
| `registered` | Front desk | Arrived (or walked in). Waiting for vitals |
| `intake_complete` | Doctor | Vitals and complaint taken, doctor chosen |
| `in_consultation` | Doctor | The doctor has started |
| `prescribed` | nobody | Signed. `closedAt` is set; the printed prescription is the hand-off |
| `cancelled` | nobody | Cancelled by the patient or desk |

A walk-in starts at `registered`. There is no pharmacy or billing stage.
Each move writes a `stageEvents` document.

## Collections

### Clinical (hospital-walled)

| Path | Holds | Written by |
| --- | --- | --- |
| `patients/{id}` | Name, ten-digit phone, age, sex, village, blood group, notes, `hospitalId` | `registerPatient` |
| `patients/{id}/allergies/{id}` | Append-only; a later document with `retractsAllergyId` cancels an earlier one | functions |
| `visits/{id}` | The visit, with the patient's name and the latest vitals and complaint copied on so a queue is one query | functions |
| `visits/{id}/vitals`, `complaints` | Append-only readings and complaints | `saveIntake` |
| `visits/{id}/prescriptions/{id}` | Append-only; carries the items, the acknowledged flags and `signedOfflineAt` if signed with no connection | `signPrescription` |
| `visits/{id}/conflicts/{id}` | Append-only record of each safety flag raised at signing, with the engine version | `signPrescription` |
| `visits/{id}/stageEvents/{id}` | Append-only history of stage moves | functions |
| `visits/{id}/dispensing/{id}` | Append-only: what the pharmacy gave for a prescription, line by line, and any same-formula brand given instead. The visit carries `dispensedAt` and `dispensedBy` | `dispensePrescription` |
| `visits/{id}/bills/{id}` | Append-only: fee lines, total, paid and how (cash, UPI, card or Razorpay, with Razorpay's payment id when the desk wrote it down). The visit carries `billTotal`, `paid`, `paidMode` and `paidRef` | `recordBill` |
| `accounts/{uid}` | A staff account: name, type (`staff` or `doctor`), hospital, availability, duty | `createTeamMember`, `setDuty`, `setAvailability` |
| `routes/{id}` | A wire from one person to another ("this desk sends patients to that doctor") | `connectTeamMembers` |
| `hospitals/{id}` | Name, area, location, set-up template, and its status: taking requests, `acceptsNew`, `acceptsFollowUp`, load, answer time, departments, `consultationFee` | `setupClinic`, `saveSettings` (Manage) |
| `accessGrants/{code}` | The share code minted when a prescription is signed; expires and can be revoked | `signPrescription` |

### Reference

`drugs`, `allergyClasses`, `drugInteractions`, `drugVitalCautions`: the formulary
and the tables the safety check reads. Readable by anyone signed in; written
only by seeding.

### The patient's own (readable by the phone number)

| Path | Holds |
| --- | --- |
| `documents/{id}` (and `files/`) | Papers kept in the Records tab |
| `histories/{id}` | The health summary |
| `reminders/{id}`, `doseLogs/{id}` | Reminders and which doses were ticked |
| `profiles/{id}` | The people on the phone: face, age, nickname, helper, call number |
| `consents/{id}` | Consent given, with the notice version |
| `callSettings`, `callVerifications`, `callJobs` | Reminder-call settings, number checks, and the jobs the dispatcher runs |

### Seats and the clinic's private settings

| Path | Holds | Read by |
| --- | --- | --- |
| `hospitals/{id}/seats/{seatId}` | A seat: its name, its abilities, its order | The hospital's staff |
| `hospitalPrivate/{id}` | The Manage PIN (scrypt hash and salt), wrong-PIN count and lock, the session rules | Nobody (functions only) |
| `hospitalPrivate/{id}/passes/{uid}` | A Manage pass (hashed) and when it ends | Nobody |

A person's seats are on their account (`seatIds`, the first also as `seatId`, `seatName` such as "Doctor + Pharmacist", and `abilities`, all their seats' together) and in their claims. Older accounts with only `seatId` are read as holding that one seat. `hospitals/{id}.setupDone` says whether the clinic set-up has run.

### Messages inside the team (written by the app, held by the rules)

| Path | Holds | Read by |
| --- | --- | --- |
| `hospitals/{id}/threads/{threadId}` | A channel (`kind: "channel"`, its name and topic) or a direct thread (`kind: "dm"`, id `dm_{uidA}_{uidB}`, its two `members`), and who wrote last and when (never what) | A channel: the hospital's staff. A direct thread: its two members |
| `hospitals/{id}/threads/{threadId}/messages/{id}` | One message: who, their role, the device, the people mentioned, when; then sealed: `v`, `eph` (one-time public key), `iv`, `ct` (the text, whether spoken, and a reference `{kind: patient \| visit \| prescription, id}`), `keys` (the message key wrapped for each reader device) | As its thread. Never changed or deleted |
| `hospitals/{id}/commsKeys/{uid}__{device}` | A device's public key (P-256), a label such as "Chrome on Windows", when it was last seen | The hospital's staff; written only by its owner |
| `hospitals/{id}/commsRead/{uid}` | When this person last read each thread | That person |

### Sessions and the activity log (server-written)

| Path | Holds | Read by |
| --- | --- | --- |
| `staffSessions/{uid}` | The account's one session: id, active, the addresses seen, where it opened, the device, when and why it ended | Nobody (the rules check it; only functions read it) |
| `activity/{id}` | One sentence per action: who, their role, what, the patient and visit it was about, the address and where the device was | Doctors and admins of the same hospital |

### Housekeeping

`opLog/{uid}__{opId}` records the result of each offline-capable action so a
repeat is answered, never redone (see [OFFLINE.md](OFFLINE.md)). Rate limits and
the audit log are also written by the functions only.

## Conventions

- **Append-only** for anything clinical. A correction is a new document that names the one it supersedes; nothing is updated in place.
- **Dates** from the server are timestamps; the apps show them in the clinic's time zone.
- **Phone numbers** are stored as ten digits; Firebase Auth holds E.164 (`+91...`) and the rules compare the tail.
- **Client-made ids** start with `c_` (`c_` plus 8 to 40 lowercase letters or digits). They let a computer with no connection name a patient or visit before the server has seen it; the server honours one only if it is free.
