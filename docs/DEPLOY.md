# Deploying

The live project is **`parcha-101`** (alias `live` in `.firebaserc`). Local
development uses the emulators under `parcha-dev` and never touches it.

## What is where

| URL | What | Hosting target |
| --- | --- | --- |
| https://parcha.web.app | The patient app in the browser | `web` |
| https://parcha-android.web.app | A QR code and a button to download the Android app (`parcha.apk`) | `android` |
| https://parcha-desktop.web.app | A QR code and a button to download the clinic program for Windows | `desktop` |
| https://parcha-clinic.web.app | The clinic app (desk and doctor) in the browser | `clinic` |
| https://parcha-101.web.app | Redirects to parcha-clinic.web.app | `old-clinic` |
| https://parcha-101-patient.web.app | The patient app (second address) | `patient` |

- **Functions:** `asia-south1` (Mumbai), Node 22.
- **Firestore:** `asia-south1`, so patient data stays in India.
- **Auth:** email and password for staff, phone for patients.

## Deploying a change

```bash
npm run build:live            # both web apps, built against parcha-101
npm run functions:build
npx firebase deploy --project live --only firestore,functions,hosting:clinic,hosting:web,hosting:patient
```

To refresh the downloads, build the binaries against the live project, generate
the pages, and deploy them:

```bash
node apps/patient/scripts/android.mjs live                                  # apps/patient/parcha.apk
cd apps/desktop && node scripts/build-web.mjs clinic live && npx electron-builder --win nsis && cd ../..
node apps/downloads/build.mjs                                               # both download pages
npx firebase deploy --project live --only hosting:android,hosting:desktop
```

`vite build --mode parcha-101` reads `apps/*/.env.parcha-101`: the project's web
config (public by design; the rules and functions protect the data) and
`VITE_FIREBASE_USE_EMULATORS=false`.

## Functions

Deploy them with the batching script, never all at once (see the quota note below):

```bash
npm run functions:build
FIREBASE_ACCOUNT=you@example.com node scripts/deploy-functions.mjs live --batch 4
```

`moveOverdueRequests` is a scheduled function: Cloud Scheduler runs it every minute, so a request nobody answers in its time moves on to the next hospital without anyone pressing anything. `sweepOverdueRequests` does the same over HTTP for a caller holding `SWEEP_KEY` (from `firebase/functions/.env.<project>`, header `x-sweep-key`).

### Demo data on the live project

`seedDemoData` refuses outside the emulator unless it is given `BOOTSTRAP_KEY` (from `firebase/functions/.env.<project>`, never committed). The script reads it and calls the function:

```bash
node scripts/seed-live.mjs parcha-101
```

It replaces the demo data: the demo hospitals, their patients and visits, and the demo team and passwords (docs/DEMO.md).

It retries the ones that fail, up to four rounds. Each function runs small (`cpu: "gcf_gen1"`, 256 MiB, one request at a time, at most 5 instances), so many fit in a new project's CPU quota; `firebase/functions/src/options.ts` says how to scale it up.

## Things that bit us, and their fixes

- **Create Firestore before the first rules deploy.** Deploying rules to a project without a database creates one in the US (`nam5`), and a database's location can never change. Create it with `firebase firestore:databases:create "(default)" --location asia-south1` first.
- **Regional CPU quota on a new project.** Cloud Run counts CPU for every function instance that starts, and a new project's quota in `asia-south1` is small. Deploying all ~50 functions at once fails with *Quota exceeded for total allowable CPU*. Deploy in batches of about four, or ask for more quota (Google Cloud console, IAM and Admin, Quotas, "Total CPU allocation per project per region", `asia-south1`). The same quota limits how many functions can be warm at once under real traffic.
- **A function that answers 403 to everyone** was created but missed its public invoker permission (its first create failed on the CPU quota). Redeploying does not fix it, even with `invoker: "public"` set: the CLI grants the permission when it creates a function. Delete and deploy it again (`firebase functions:delete <name> --region asia-south1`, then deploy it). Check every function after a deploy: a callable should answer 401 to a call with no sign-in, never 403. Scheduled functions (`dispatchReminderCalls`, `sweepExpired`) answer 403, which is right.
- **"User code failed to load ... Timeout after 10000"**: loading the functions to see what to deploy took longer than 10 s. The batching script sets `FUNCTIONS_DISCOVERY_TIMEOUT=60`.
- **No warm instances.** `minInstances` is 0. It is set per function, so a value of 1 means ~50 instances billed all day. Each function is capped at 3 instances of 80 concurrent requests (`firebase/functions/src/options.ts`).
- **electron-builder and npm workspaces.** Its "rebuild production dependencies" step prunes the shared `node_modules` (TypeScript and its own helper vanish). `apps/desktop/package.json` sets `"npmRebuild": false`; the program has no runtime dependencies.

## One-time setup in the console (not scriptable here)

- **Billing:** the project must be on the Blaze plan for Functions.
- **Authentication:** turn on Email/Password and Phone. Under *Settings, Authorized domains*, add `parcha.web.app` and `parcha-101-patient.web.app`, or phone sign-in fails there. Test phone numbers with fixed codes avoid real SMS during a demo.
- **People and medicines:** production starts empty. Staff accounts are made by an admin (`createTeamMember`), so the first admin and the formulary must be loaded once.

## Not verified

- Phone sign-in inside the Android app: it uses reCAPTCHA in the app's built-in browser view, which is often refused. It is untested on a device.
- The Windows installer is not code-signed, so SmartScreen warns on first run.
