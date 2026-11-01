# Parcha

**A prescription in 30 seconds that the patient's family can read, hear and
follow, even offline.**

A doctor in an Indian OPD has two or three minutes a patient. Parcha gets the
prescription written in seconds (same as last visit, the doctor's own sets and
usual medicines, a search that understands "PCM 650"), checks it for allergies,
interactions and today's vitals before it is signed, and puts it on the
family's phone as pictures, in Hindi, English or Hinglish, read aloud, with
reminders and a call.
It keeps working with no internet.

A correct prescription stops working the moment the patient leaves the room. A
government hospital in Kolkata looked at 380 of its own: 96% legible, 86%
complete — and 36.8% of those patients did not understand what they had been
given. That gap, not the consultation, is what this is built for.

<p align="center">
  <img src="docs/screenshots/clinic-desk.png" alt="The front desk" width="62%">
  <img src="docs/screenshots/patient-home.png" alt="The patient app" width="19%">
  <img src="docs/screenshots/patient-prescription.png" alt="A prescription as pictures" width="17%">
</p>

```
at the clinic                              in the family's hands
─────────────                              ─────────────────────
desk registers, takes vitals
         ↓
doctor consults, safety check, signs
         ↓
printed Parcha with a signed QR    ──────→  the family scans it at home
                                                      ↓
                                            medicines by time of day, ticked
                                            off, reminders in the app, on the
                                            phone, and by a phone call
                                                      ↓
                                            Ask: which Parcha is this medicine
                                            on, who wrote it, when does the
                                            course end
                                                      ↓
                                            hand a doctor the history: a QR to
                                            scan, or a link for 15 minutes
```

Pharmacy and billing are optional seats after the doctor; the visit itself ends at the signed prescription.

**The phone and the clinic stay apart.** A patient's handset reads **nothing**
under the clinic's records — not the visit, not the queue, not the prescription
([firestore.rules](firestore.rules)). What a family holds is its own: the
Parchas they scanned, their reminders, their papers, kept encrypted on the
phone. The prescription crosses the gap the way the paper does — the family is
handed the printed Parcha and scans the signed QR on it, which carries the
whole document and is checked on the device with no network at all. So what the
chemist reads and what the phone reminds about are the same slip, and a
clinic's records are not sitting on a handset nobody at the clinic controls.

## Try it

| | |
| --- | --- |
| **Patient app (web)** | https://parcha.web.app |
| **Android app** | https://parcha-android.web.app (scan the QR) |
| **Clinic program for Windows** | https://parcha-desktop.web.app |
| **Clinic app (web)** | https://parcha-clinic.web.app |

The clinic app opens on a choice of three demo set-ups around Shaheed Sukhdev
College, Rohini: **Rohini City Hospital** (a large hospital: reception, triage,
doctors, pharmacy, billing, management), **Sector 9 Care Hospital** (medium: front desk,
doctors, management), **Dr. Verma's Clinic** (one doctor who does everything),
or **Custom** (a new, empty clinic you set up yourself). The patient app opens
with the demo family phone (**9811044321**: Priya, Prashant and Prabha, "Dadi")
already filled in, each with the Parcha their doctor wrote. The people, visits
and Parchas are sample data. Deploying is in [docs/DEPLOY.md](docs/DEPLOY.md).

## The apps

| | Who | What |
| --- | --- | --- |
| **Clinic app** [`apps/clinic`](apps/clinic) | Front desk, doctors, an admin | Register a patient; intake (vitals, complaint, choose a doctor); a doctor's queue; prescribing with typo-tolerant medicine search (or any medicine written by hand), dictation you tick through, tests to order, and a live safety check that includes children's doses and pregnancy; a printable prescription; a team page where wiring a desk to doctors is a drawing and who is on duty shows green; **Billing** from the clinic's price list, paid by cash, UPI, card or a **Razorpay** payment-page QR, with a printed receipt; **Management** for people and their roles (several per person), fees, the price list and the Razorpay page; **Messages** inside the team (Ctrl+M): end-to-end encrypted channels and direct messages, spoken messages recognised on the device, `@` a person, a token number or a patient to put a visit or an active prescription in the line (hover for a quick view, click to open it), and patients shared as links only. |
| **Patient app** [`apps/patient`](apps/patient) | Patients and their families | In **Hindi, English or Hinglish**, chosen per person. Five tabs: **Home** (today's medicines), **Medicines** (a day-by-day schedule, ticked off, with reminders and reminder calls), **Parchas** (every one this phone holds), **Ask** (what the record says about a medicine — which Parcha, which doctor, when the course ends), and **Me**. A new Parcha arrives by scanning the signed QR, or by checking the medicines off a pharmacy bill, which the phone **reads for you** (each name boxed on the photo, for you to add or not; nothing leaves the phone). Me holds the family, their papers, a PIN, a sealed **backup** of the phone, and **Show the doctor**: a QR with the whole history in it, or a link that lives 15 minutes and can be revoked. An Android app and a PWA. |
| **Desktop program** [`apps/desktop`](apps/desktop) | The front desk | The clinic app as a Windows program: prints through the computer's printers and keeps its own encrypted copy of the data. |

## A look around

| Front desk | Doctor |
| --- | --- |
| ![Intake](docs/screenshots/clinic-intake.png) | ![Dossier](docs/screenshots/clinic-consultation.png) |
| Vitals and the complaint, sent to a chosen doctor. | Today's reading, allergies and history in one view. |

**The safety check** runs while the doctor prescribes, and again on the server when
they sign. A high-severity flag must be read before the prescription can be signed.

![The safety check](docs/screenshots/clinic-prescribe-safety.png)

| Signed and ready to print | Who is on duty |
| --- | --- |
| ![Signed](docs/screenshots/clinic-prescription-signed.png) | ![Team](docs/screenshots/clinic-team.png) |

**Each clinic decides who does what.** A doctor alone, a small clinic or a hospital: set up in four steps, then people and their roles are managed behind a PIN. One person can hold several roles (a doctor who also runs the pharmacy), and what they can do adds up.

**Messages, with patients in the line.** Type `@rx` or `@` and a token number: the active prescription sits in the message as a chip, with a quick view on hover and the visit a click away. Encrypted end to end.

![Messages](docs/screenshots/clinic-messages.png)

| Clinic set-up | Manage: seats and abilities |
| --- | --- |
| ![Set-up](docs/screenshots/clinic-setup.png) | ![Manage](docs/screenshots/clinic-manage.png) |

**On the patient's phone**

| Who is using Parcha? | Home | Medicines | Easy mode |
| --- | --- | --- | --- |
| <img src="docs/screenshots/patient-who-is-using.png" width="160"> | <img src="docs/screenshots/patient-home.png" width="160"> | <img src="docs/screenshots/patient-schedule.png" width="160"> | <img src="docs/screenshots/patient-easy-mode.png" width="160"> |
| A shared phone asks whose turn it is, then shows only them. | Today's medicines, and the two things people come for: a new Parcha, or a question about an old one. | The day's medicines, ticked off, with reminders. | One big screen, read aloud, for someone who needs help. |

*(The screenshots are from before the patient app was narrowed; Home and the
tab bar have changed. `node scripts/screenshots.mjs` remakes them.)*

## Features

- **The visit, at the clinic.** Register, vitals, consult, sign. Each hospital is a wall: staff see only their own patients, team and queues.
- **Ask your own Parchas.** Name a medicine (or photograph the strip) and the phone says which Parcha it is on, which doctor wrote it, where and when, drawn as pictograms rather than `1-0-1`, with courses about to finish listed as what they are. It answers only from the Parchas on that phone, and never says what a medicine is for or whether to take it — none of that is on the paper. Plain code, no model: [`packages/core/src/askMemory.ts`](packages/core/src/askMemory.ts).
- **Hand a doctor the history, two ways.** A **QR** carrying the whole summary, read off the screen by the doctor's camera with no network and no server in the path — and so nothing to expire or revoke. Or a **link** (`parcha.web.app/<name>`) that lives 15 minutes, opens with a PIN the family reads out, and dies the moment they tap Revoke. The link's summary is sealed on the phone with a key made from that PIN, so what the server keeps is a box it cannot open; five wrong PINs close it.
- **The phone keeps a copy of itself.** Sealed with the family's PIN, kept in a store of its own, and checked once on the way up: a backup newer than the phone's own data is offered back, never restored without asking. Savable as a file, which is what moves a family's Parchas to a new handset.
- **Prescribing that keeps up.** Fuzzy search of the medicine register ("para" finds paracetamol); dictation turned into a checklist of medicine, dose and timing for the doctor to tick (a human always in the loop); a printable prescription.
- **A deterministic safety check** for allergy, drug interaction, vitals, age, the most a day (by weight for a child) and pregnancy; a medicine not in the list can still be written by hand, marked as unchecked. No model, no guesswork: [docs/SAFETY-ENGINE.md](docs/SAFETY-ENGINE.md).
- **Reminders that reach people.** In-app, as phone notifications with Taken and Later buttons and a chime, and as **phone calls** in Hindi or English (press 1 when taken).
- **One phone, a whole family.** People with their own faces, ages and helpers; an easy mode for elders with a helper PIN; reminder calls to a person's own verified phone.
- **Hindi, English or Hinglish.** The patient app speaks one language at a time, chosen at sign-in or in Me, and each person on a shared phone keeps their own: screens, spoken medicines, reminders and notifications all follow it.
- **Messages inside the team, end-to-end encrypted.** Ctrl+M (or the button at the bottom right) opens channels for the whole hospital and direct messages only the two people can read. Every message is encrypted on the sender's computer for each reader's device; the database and the server see only ciphertext. A patient is shared as a link (record, visit or prescription), never as data: type `@` and a token number or a name, and the visit or the active prescription sits in the message as a chip, with a quick view on hover and the visit a click away. It opens only for someone allowed to see that patient. Speak a message and it is recognised on the computer itself; the sound never leaves it.
- **AI that only fills in.** The patient app reads the printed medicine names on a pharmacy bill, and checks a strip's photo shows the right medicine, on the phone itself: every name is boxed on the photo with why it counts, nothing is added until the person taps Add, nothing is suggested, and nothing is uploaded or kept: [docs/PATIENT-APP.md](docs/PATIENT-APP.md#reading-on-the-phone-ai-that-only-fills-in).
- **Works offline.** Both apps keep an encrypted copy on the device and queue changes made with no signal. The clinic can register, take vitals, consult, sign and print with the internet down; the patient app's Home, Medicines, Parchas and Ask all read from the phone alone, and a backup can be made with no connection at all: [docs/OFFLINE.md](docs/OFFLINE.md).
- **Their data is theirs.** Consent, a full export and deletion, built in.

## The revision: what was cut, and why

Parcha began as the whole outpatient chain — the family asked for a visit from
their phone, a desk had fifteen minutes to find a doctor, a request nobody
answered moved itself to the next hospital, the phone watched the queue and the
token, and the visit ended in a signed Parcha. All of that was built and
working.

**It has been narrowed on purpose.** The patient app is now the product, and it
is not a window onto a clinic's queue: it is the family's own record of what
they were told to take. Three things came out of it, and the backend behind
them:

| Cut | What it was | Why |
| --- | --- | --- |
| Patient-initiated visits | Request, propose, accept, cancel; the hospital map; the fee-and-rating suggestion | A booking product is a different product, and a crowded one. The gap the evidence points at is after the consultation, not before it. |
| The fifteen-minute promise | A request routed itself to the next hospital on a timer, with a countdown on the phone and in the desk's inbox | It only exists to serve patient-initiated requests. With those gone it had nothing to route. |
| The patient's view of the visit | The queue, the token, the stage, feedback after the consultation | It required the handset to read the clinic's records. Closing that read entirely is a stronger promise than fencing it. |

What replaced them is the same effort pointed at the house instead of the
waiting room: **Ask**, which answers from the Parchas the phone already holds;
**Show the doctor**, so a family can hand their history over without a hospital
in the middle; and a **backup**, because a product whose records live only on a
phone owes that phone a way back.

The clinic app keeps its full consultation — register, vitals, prescribe,
safety check, sign, print, pharmacy, billing — and loses only the request
inbox it no longer has anything to put in.

**What this costs, said plainly.** A clinic gets no bookings out of Parcha, so
the reason for a clinic to run it is the consultation and the printed Parcha
alone. The patient app no longer tells a family anything about a visit in
progress. And the fifteen-minute share is the one place a sealed copy of
clinical data leaves the phone at all — the QR remains for families who would
rather it did not.

## What is real, and what is not

Built and tested here (against the Firebase emulators):

- The visit at the clinic, and tenant isolation between hospitals.
- The safety check, live and again at signing.
- **The reminder calling agent, end to end**: a dose falls due, the dispatcher places the call to the number that signed in, pressing 1 ticks the dose, and the next run does not call about it again. Consent, quiet hours, one retry, verified numbers, and every enabled account reached (it used to stop at 500 and tell nobody).
- **The fifteen-minute share**: the server keeps ciphertext and no PIN, five wrong PINs close a link, Revoke closes it at once, and a name that was never used answers exactly as one that is finished.
- **The phone's backup**: wiped the vault, restarted, and all three Parchas came back from the sealed copy.
- Offline for both apps, with the server half under test.
- **Staff sessions pinned to a place and a network**, ended the moment either changes, and an **activity log** doctors can read: who did what, from where, in plain sentences.
- **For people who cannot see or hear**: read aloud in Hindi and English, spoken reminders, larger text and high contrast; flashing, vibrating reminders and no calls for someone deaf; access needs on the patient record with a big-text "Show to patient" pad and large-print prescriptions.
- **Prescribing without voice**: search by name, brand, formula ingredient or class with same-formula alternatives; the schedule by hand (subah, dopahar, shaam, raat; every day, every few days, weekly).
- **Roles instead of fixed job titles**: each clinic decides who does what (a doctor alone, a small clinic, a hospital), with a set-up wizard, a doctor's first-sign-in profile and a PIN-protected Management page. A person can hold several roles.
- **End-to-end encrypted messages between staff** (ECDH P-256 per device, AES-256-GCM per message, HKDF-wrapped for each reader's device; private keys non-extractable in the browser), with the security rules accepting only ciphertext, keeping a direct message to its two people, and every message from the person signed in, never changed or deleted. A safety code lets two people check no key was swapped.
- **The patient app in three languages** (Hindi, English, Hinglish), per person on a shared phone.
- **180 unit tests and 69 integration tests** (rules and functions together), run on every push.

Written but **not proven**:

- The **Twilio** adapter for real calls has not been run against a live account; everything above it is proven against the demo line. Indian telecom rules apply: [docs/CALLING.md](docs/CALLING.md).
- Reading a **medicine name off a photograph** in Ask is built as a seam and says it is not configured; no model is wired to it yet.
- The **Android app** builds but has not been run on a device or emulator: [docs/ANDROID.md](docs/ANDROID.md).
- Capacity for "1 lakh requests" is reasoning, not a measurement: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- The privacy notice is an engineering draft, not reviewed by a lawyer.
- There are no real users yet.

Not built: push for a closed phone in the browser, real phone sign-in outside the emulator.

## Run it

You need Node 22+ and Java 11+ (for the emulator). No cloud account.

```bash
npm install
npm run emulators        # auth, firestore, functions
npm run seed             # the demo hospitals, doctors and patients
npm run dev:clinic       # http://localhost:3000
npm run dev:patient      # http://localhost:3001
```

Staff sign in with the demo accounts in [docs/DEMO.md](docs/DEMO.md) (password
`parcha123`); patients pick a demo phone number. **Short on time? Follow the
five-minute path at the top of the demo guide.**

```bash
npm test                  # unit tests
npm run test:integration  # rules + functions, with the emulators running
npm run check             # typecheck both apps and build the functions
```

## How it is built

An npm workspaces monorepo:

```
apps/clinic        staff web app (Vite + React)
apps/patient       patient PWA and Android app (Vite + React + Capacitor)
apps/desktop       Electron wrapper
packages/core      pure logic: stages, safety check, schedule, call scripts
packages/client    Firebase wiring, hooks, the offline store and outbox
packages/ui        shared components and the theme
firebase/functions every write, checked on the server (Cloud Functions, asia-south1)
```

**Clients never write clinical data.** The security rules deny it, and every change is
a callable function, so the rule that "only a doctor can sign" is enforced where it
cannot be skipped. Anything clinical is append-only. Staff messages are the one
thing written straight from the app (they are not part of a record and must feel
instant); the rules hold them instead. Details in
[docs/SECURITY.md](docs/SECURITY.md) and [docs/DATA-MODEL.md](docs/DATA-MODEL.md).

## Documentation

Everything is indexed in [docs/README.md](docs/README.md).

| | |
| --- | --- |
| [Getting started](docs/GETTING-STARTED.md) | Install, run, fix the usual problems |
| [Demo guide](docs/DEMO.md) | The five-minute path, every demo account |
| [Project structure](docs/PROJECT-STRUCTURE.md) | Every folder and what lives in it |
| [Architecture](docs/ARCHITECTURE.md) | Why it should stay up, what was measured, the limits |
| [Architecture diagram](docs/architecture/parcha-architecture.html) | Every part and how a visit moves through them, each linked to its code (download and open in a browser) |
| [Data model](docs/DATA-MODEL.md) | Collections and the visit stage machine |
| [Security](docs/SECURITY.md) | Walls, roles, sessions, privacy |
| [Functions API](docs/FUNCTIONS-API.md) | Every Cloud Function and who may call it |
| [Safety check](docs/SAFETY-ENGINE.md) | The allergy, interaction, vitals, age, dose and pregnancy rules |
| [Offline](docs/OFFLINE.md) | The device store, the outbox, idempotency |
| [Clinic app](docs/CLINIC-APP.md) · [Patient app](docs/PATIENT-APP.md) | Every screen |
| [Reminder calls](docs/CALLING.md) | The calling agent and Twilio |
| [Android](docs/ANDROID.md) · [Desktop](docs/DESKTOP.md) | Building the native apps |
| [Deploying](docs/DEPLOY.md) | The live sites and how to ship |
| [Standards and law](docs/STANDARDS.md) | ABDM, ABHA and FHIR; what a valid prescription needs |
| [Testing](docs/TESTING.md) | What is tested, and how |
| [Research](docs/RESEARCH.md) | What clinics and patients complain about, mapped to the product |

## Contributing

Changes go through a pull request that passes CI (types, unit tests, builds, and
the integration tests against the emulators). Keep logic that both the apps and the
functions need in `packages/core`, with a test. A new write is a new function in
`firebase/functions`, never a client write. Screenshots in this repository are made
by `node scripts/screenshots.mjs`.

## Licence

No licence file has been added yet.
