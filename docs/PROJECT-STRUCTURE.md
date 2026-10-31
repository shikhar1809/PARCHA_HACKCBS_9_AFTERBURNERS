# Project structure

An npm workspaces monorepo. The two apps and the Cloud Functions share one
pure-logic package, so the rule that guards a write on the server is the same
file that keeps the screen honest.

```
parcha/
├── apps/
│   ├── clinic/            Staff web app (Vite + React), port 3000
│   ├── patient/           Patient PWA and Android app (Vite + React + Capacitor), port 3001
│   └── desktop/           Electron wrapper for either app (Windows installer)
├── packages/
│   ├── core/              Pure TypeScript: types, stage machine, safety check, schedule, call scripts
│   ├── client/            Firebase wiring: auth, hooks, mutations, offline store and outbox
│   └── ui/                Shared components and the theme
├── firebase/
│   └── functions/         Cloud Functions (region asia-south1): every write is one of these
├── docs/                  This documentation (screenshots in docs/screenshots)
├── scripts/               Dev, seed, tests, load test, screenshots
├── firestore.rules        Security rules
├── firestore.indexes.json Indexes
└── firebase.json          Emulator and deploy configuration
```

## `packages/core`

Pure functions and types. No Firebase, no React, no network. Everything here is
unit tested (`packages/core/test`).

| File | What it holds |
| --- | --- |
| `types.ts` | Every document type: patient, visit, prescription, reminder, account, route and more |
| `stages.ts` | The visit stage machine and who may move a visit on |
| `conflicts.ts` | The safety check: allergy, interaction and vitals rules |
| `dictation.ts`, `fuzzy.ts` | Turning "paracetamol 650 sos" into a line to tick; typo-tolerant medicine search |
| `items.ts` | Prescription line helpers (frequency, quantity) |
| `schedule.ts` | Doses by time of day, dose keys, today's list |
| `calls.ts` | The reminder-call scripts in Hindi and English, key presses |
| `profile.ts` | Avatars, nicknames, ages: one phone, many people |
| `privacy.ts` | Consent text and versions |
| `duty.ts` | Who counts as on duty |
| `hospitals.ts`, `slots.ts`, `bring.ts` | Hospital choice, visit slots, the "please bring" list |
| `paths.ts` | Collection names, in one place |

## `packages/client`

| File | What it holds |
| --- | --- |
| `firebase.ts` | App, auth, Firestore and Functions clients; emulator wiring; retries and re-authentication |
| `hooks.ts`, `queries.ts` | Live data hooks (`useQueue`, `useVisit`, `useFormulary`, ...) that also read from the device store |
| `mutations.ts` | Every write, as a typed call to a function. Clinic actions work offline |
| `outbox.ts` | The queue of changes made with no connection; sends them in order |
| `overlay.ts` | Shows queued changes as already done on screen |
| `vault.ts` | The encrypted on-device store (IndexedDB, AES-GCM, a key that cannot be exported) |
| `localSafety.ts` | Runs the safety check on the computer when the server cannot be reached |
| `session.tsx` | Idle lock, sign-out, the offline banner, duty heartbeat and the duty switch |
| `records.ts`, `schedule.ts` | The patient's papers and reminders |

## `firebase/functions/src`

| File | What it holds |
| --- | --- |
| `index.ts` | Registration, visits, intake, consultation, signing; exports everything |
| `previsit.ts` | Requests before a visit: ask, propose, accept, escalate, check in |
| `flow.ts`, `routing.ts` | The stage transition guard; choosing hospitals and doctors |
| `safety.ts` | Loads the formulary and the patient's context for the safety check |
| `team.ts` | Creating people, wiring desks to doctors, the duty flag |
| `reminders.ts`, `calls.ts` | Reminders and doses; the calling agent and its dispatcher |
| `profiles.ts`, `records.ts`, `privacy.ts` | People on a phone; papers and history; consent, export, delete |
| `guards.ts` | Authorisation, rate limits, audit, idempotency (`once`) |
| `seed.ts` | The demo data (emulator only) |

## `apps/clinic/src`

| Path | What it holds |
| --- | --- |
| `App.tsx`, `Shell.tsx`, `Tabs.tsx` | Routing by account type, the sidebar and the list-beside-detail layout |
| `screens/Desk.tsx`, `NewPatient.tsx`, `intake/` | The front desk: look up, register, vitals, choose a doctor |
| `screens/DoctorQueue.tsx`, `Consultation.tsx`, `consultation/` | The doctor: queue, dossier, prescribing pad, safety panel |
| `screens/Team.tsx`, `team/` | The wiring diagram and the duty switch |
| `screens/RequestDetail.tsx`, `RespondRequest.tsx` | Requests from patients, both sides |
| `NeedsAttention.tsx` | Offline actions the server refused, with its reason |

## `apps/patient/src`

| Path | What it holds |
| --- | --- |
| `screens/` | Home, Schedule, Visits, Records, Me, Book, EasyHome, VisitScreen, SignIn |
| `components/` | Reminders, alerts and notifications, the avatar designer, shared-phone switcher, PIN, privacy and data, the hospital map |
| `kit.tsx` | The big buttons and layout pieces |

## `scripts`

| Script | Purpose |
| --- | --- |
| `dev.mjs` | Emulators and both apps in one command |
| `emulators.mjs` | Starts the emulators with a long function timeout |
| `seed.mjs` | Loads the demo data |
| `integration.test.mjs` | Rules and functions against the emulators |
| `loadtest.mjs` | A load test for the visit flow |
| `dispatch-calls.mjs` | Runs the call dispatcher by hand |
| `twilio-check.mjs` | Checks a Twilio account before real calls |
| `screenshots.mjs` | Takes the README screenshots |
