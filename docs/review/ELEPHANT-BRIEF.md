# Parcha: the elephant's brief

Written by the long-running session that built most of Parcha, for reviewers
who were not there. It says what Parcha is meant to be and for whom, so a fresh
reader can check the code and the live apps against it. The reviewer's job is to
find what is **missing, wrong or unconvincing**, not to praise.

## What it is

An OPD (outpatient) app for Indian clinics and hospitals, built as a
**hackathon submission**. The promise in one line: *a prescription in 30
seconds that the patient's family can read, hear and follow, even offline.*

The chain it covers:

1. A patient asks a hospital for a visit from their phone.
2. The front desk has 15 minutes to find a doctor; the doctor accepts a time.
3. The patient arrives; the desk checks them in and takes vitals.
4. The doctor consults, prescribes with a live safety check (allergies,
   interactions, today's vitals), and signs. The server re-checks on signing.
5. The prescription is printed, and appears on the family's phone as pictures,
   in Hindi, English or Hinglish, read aloud, with reminders and a reminder call.
6. Optional seats after the doctor: pharmacy and billing.

## Who it is for

- **Patients and families:** often older, low literacy, cheap Android phones,
  patchy internet. Hindi first for many.
- **Front desk / nurse / doctor / pharmacist / billing / management** in a
  single-doctor practice up to a large hospital. Doctors have 2-3 minutes a patient.
- **Hackathon judges:** see it for minutes, mostly through the live links, the
  README and maybe a video.

## What exists (claims to verify)

- Monorepo: `apps/clinic` (React web app), `apps/patient` (web + Android via
  Capacitor), `apps/desktop` (Electron, Windows installer), `apps/downloads`,
  `packages/core` (types, safety engine, seats), `packages/client` (Firebase
  hooks, offline outbox, end-to-end encrypted Messages), `packages/ui`,
  `firebase/functions` (Cloud Functions), `firestore.rules`.
- Live: patient https://parcha.web.app, clinic https://parcha-clinic.web.app,
  Windows installer https://parcha-desktop.web.app, Android https://parcha-android.web.app.
- Demo mode: the clinic opens on four set-ups (Large hospital, Medium hospital,
  Personal practice, Custom) with one-tap sign-in as each role; the patient app
  lists phone numbers to open with one tap. Sample data.
- Roles ("seats") are custom claims set by the server; one person may hold
  several roles; Management behind a PIN.
- Staff sessions pinned to device location and IP; idle lock.
- Messages inside the team (Ctrl+M): E2E encrypted (ECDH P-256 + AES-GCM per
  device), patients shared as links only, voice transcribed on-device only.
- Offline: clinic keeps working with no internet (outbox); desktop keeps an
  encrypted local copy.
- Tests: 81 unit, 56 integration (against Firebase emulators).
- Docs in `docs/`.

## Gaps the elephant already knows about (do not just repeat these)

- No file/document attachments in the clinic (would need Firebase Storage).
- Live demo data is messy; screenshots may be stale.
- No licence file; the GitHub repo is named `check`.
- Holding Doctor + Pharmacist at once gets no warning on the Team page.
- The Windows installer is unsigned (SmartScreen warns).

## What the reviewer should answer

What is missing that matters, ranked. For each: what it is, the evidence
(file path, live URL, command output), who it hurts (patient / clinic /
judge), and roughly how big the fix is.
