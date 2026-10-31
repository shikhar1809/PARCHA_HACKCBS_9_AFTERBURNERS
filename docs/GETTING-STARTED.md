# Getting started

Everything runs on your machine against the Firebase emulators. No account, no
cloud project and no money are needed.

## You need

- **Node.js 22 or newer** and npm.
- **Java 11 or newer** (the Firestore emulator is a Java program).
- **Chrome or Edge** for the apps and for taking screenshots.
- Optional: JDK 21 and the Android SDK for the Android app; nothing extra for the desktop program's dev run.

## Install

```bash
npm install
```

This installs every workspace (`packages/*`, `apps/*`, `firebase/functions`) at once.

## Run it

Use four terminals, or `npm run dev` to start the emulators and both apps together.

```bash
npm run emulators        # auth, firestore, functions on 127.0.0.1
npm run seed             # loads the demo hospitals, doctors and patients
npm run dev:clinic       # http://localhost:3000  (front desk and doctors)
npm run dev:patient      # http://localhost:3001  (patients)
```

| What | Where |
| --- | --- |
| Clinic app | http://localhost:3000 |
| Patient app | http://localhost:3001 |
| Emulator console | http://127.0.0.1:4000 |
| Functions | `http://127.0.0.1:5001/parcha-dev/asia-south1/<name>` |

Sign in with the demo accounts in [DEMO.md](DEMO.md): staff use the password
`parcha123`; patients pick a demo phone number and the app reads the one-time
code from the Auth emulator for you.

`npm run seed` can be run again at any time. It deletes what it owns and
loads the demo clinic afresh, which is the way to get back to a known state
after trying things.

### Reminder calls

The dispatcher runs every minute in a real deployment. Locally, run it by hand
or in a loop:

```bash
node scripts/dispatch-calls.mjs
```

See [CALLING.md](CALLING.md).

## Everyday commands

```bash
npm test                    # unit tests (no emulators needed)
npm run test:integration    # rules and functions (emulators must be running)
npm run check               # typecheck both apps and build the functions
npm run functions:build     # compile firebase/functions to lib/
```

After you change anything in `firebase/functions/src`, run
`npm run functions:build`: the emulator runs the compiled `lib/` and reloads
when it changes.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| A function call fails after about 30 seconds in the emulator | The emulator's default timeout is short. Start with `npm run emulators` (it sets a 300 second one), not `firebase emulators:start`. |
| The patient app asks for a code and nothing arrives | The code is not an SMS: it is in the Auth emulator at `http://127.0.0.1:9099/emulator/v1/projects/parcha-dev/verificationCodes`. The demo handsets fill it in. |
| `Port 8080/9099/5001 is not open` | The emulators are not running or a stale one holds the port. Stop it and run `npm run emulators` again. |
| A screen shows old data after a rule change | Firestore rules reload when the file is saved; the functions reload when `lib/` changes. Reload the page. |
| The splash plays on every load | That is the opening animation; tap it to skip. |
| Sign-in is stuck on the lock screen | Staff devices lock after ten idle minutes and ask for the password. |
| Offline testing | Clinic: Me, "Developer: pretend there is no connection". Patient: Me, My data, the same switch. |
