# Handoff

Written at the end of a long session, for whoever picks this up next. It says
where the work stands, what is proven and what only compiles, and the handful
of environment facts that cost real time to discover.

Branch: **`patient-app-first`**, pushed to `origin`. Head: `9cff200`.
Not merged to `main`. No PR opened.

---

## 1. What Parcha is now

It used to be the whole outpatient chain: a family asked for a visit from
their phone, a desk had fifteen minutes to find a doctor, an unanswered
request routed itself to the next hospital, and the phone watched the queue.

**That was deliberately removed this session.** The patient app is now the
product, and it is the family's own record rather than a window onto a
clinic's queue. `README.md` has a section, *The revision: what was cut, and
why*, with the reasoning and the costs. Read it before re-adding anything.

- **Clinic app**: register → vitals → consult → safety check → sign → print.
  Pharmacy, billing and management are unchanged. Its request inbox and SLA
  screens are gone.
- **Patient app**: five tabs — Home, Medicines, Parchas, Ask, Me. A handset
  now reads **nothing** under the clinic's `visits` (enforced in
  `firestore.rules`). The prescription crosses on paper, via the signed QR.

---

## 2. What was built this session

| Thing | Where | State |
| --- | --- | --- |
| Visits stripped from patient app, backend and rules | `apps/patient`, `firebase/functions/src/previsit.ts`, `firestore.rules` | Done, tests pass |
| **Ask** tab — answers only from Parchas on the phone | `packages/core/src/askMemory.ts`, `apps/patient/src/screens/Ask.tsx` | Done, verified in browser |
| **Doctor QR** — whole history inside the code, offline | `packages/core/src/historyToken.ts` | Done, 5 unit tests |
| **15-minute share** — `parcha.web.app/<name>`, PIN, revoke | `packages/core/src/share.ts`, `shareCrypto.ts`, `firebase/functions/src/share.ts` | Done, 10 unit + 8 integration tests, verified end to end in browser |
| **Device backup** — sealed with the PIN, restored at start-up | `packages/core/src/deviceBackup.ts`, `packages/client/src/backup.ts`, `apps/patient/src/components/backup.tsx` | Done; proven by wiping the vault and restoring |
| **Call screen** — full-screen medicine reminder on Android | `apps/patient/android/.../CallActivity.java`, `CallScreenPlugin.java`, `apps/patient/src/components/callScreen.ts` | **Proven on a real tablet** (screenshot, `mCurrentFocus=CallActivity`) |
| Calling agent dispatcher paging fix (was capped at 500 and told nobody) | `firebase/functions/src/calls.ts` | Done, integration test drives the whole loop |
| New demo family: **Prabha Devi (Dadi, 71), Prashant (48), Priya (42)** | `packages/core/src/demo/patients.ts`, `firebase/functions/src/seed.ts` | Done, seeded on live |

Tests: **180 unit**, **69 integration**. `npm test`, `npm run test:integration`
(needs emulators), `npm run check`.

---

## 3. Environment facts that cost time

**These are the ones to read twice.**

1. **The live project belongs to a different Google account.**
   `parcha-101` is owned by **`onlyafterburners@gmail.com`**, not the default
   `royalshikher@gmail.com`. Every deploy needs
   `--account onlyafterburners@gmail.com`, or it fails with a misleading
   "project not found". The functions script takes `FIREBASE_ACCOUNT=`.

2. **Meko blocks every function deploy.** `firebase/functions/src/meko.ts`
   declares `defineSecret("MEKO_API_KEY")`, and the CLI resolves secrets while
   *analysing the codebase* — before building anything. `parcha-101` has no
   Secret Manager API enabled, so the analysis fails **for all 73 functions**,
   not just Meko's. The export is currently **parked** in
   `firebase/functions/src/index.ts` with a comment explaining how to restore
   it (enable Secret Manager, set both secrets, uncomment).

3. **The Firebase emulator serves stale function code.** It does not always
   reload after `npm run functions:build`. If a seed or callable behaves like
   an older version, restart the emulators. This wasted a lot of time.

4. **Seeding the emulator is not seeding live.** `npm run seed` hits
   `parcha-dev`. The Android app and `parcha.web.app` use `parcha-101`. For
   live: `node scripts/seed-live.mjs parcha-101` — **and the deployed
   `seedDemoData` must be current first**, or it writes the old demo data.
   The live seed **deletes existing profiles** for `9811044321` (it removed a
   real "Shikhar Shahi" profile).

5. **A tablet is attached over USB debugging.** Galaxy Tab A9 (`SM-X115`),
   **Android 16**. `adb` is not on PATH:
   `"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"`. Under Git Bash,
   prefix device paths with `MSYS_NO_PATHCONV=1` and use `//sdcard/...`, or
   paths get mangled.
   - `CallActivity` is **not exported**, so `adb shell am start` cannot launch
     it. Drive the app's own UI instead.
   - `uiautomator dump` + `grep` for `content-desc` is far cheaper than
     screenshots for finding tap targets.

6. **Android 14+ withholds `USE_FULL_SCREEN_INTENT`** from apps it does not
   read as alarms or dialers. On this tablet `canRing()` returns
   `overLockScreen: false`. The screen still appears because the plugin starts
   the activity directly while the app is in the foreground. **The locked-phone
   path is still unproven.**

7. **Full-screen intents are demoted to heads-up popups while the device is
   unlocked and in use.** This is Android behaviour, not a bug — it is why the
   reminder looked like "a popup, not full screen".

---

## 4. Live deployment state

Deployed from this session, all to `parcha-101`:

- `firestore.rules` — patient reads of `visits` closed
- Hosting: `parcha.web.app`, `parcha-clinic.web.app`,
  `parcha-101-patient.web.app`, `parcha-android.web.app` (12 MB APK)
- Functions: 74 live. The batched deploy completed **after** the Meko fix.
  **Verify `shareHistory` / `openShare` / `shareIsOpen` are present** — the
  last check before the session ended was interrupted:

```bash
npx firebase functions:list --project live --account onlyafterburners@gmail.com --json
```

**Uncommitted right now:** `CallActivity.java` has an edit changing the spoken
line to exactly `आपकी दवाई का समय हो गया` + the medicine name. It is built into
the local APK but **not committed, not installed on the tablet, not deployed**.
Finish or revert it first.

---

## 5. The outstanding request

The user specified a full end-to-end lock-down of the patient flow. **Almost
none of this is built.** In their order:

1. **New Parcha flow.** Ask "is it printed?".
   - **Yes** → scan the QR (exists), *or* photograph the Parcha and OCR it
     (not built; on-device OCR already exists in
     `apps/patient/src/components/readText.ts`).
   - **No** → read the bill → take voice instructions from the doctor or
     pharmacist → import the purchase with context → **human-in-the-loop
     verification** of every medicine.
2. **Strip photos.** After the schedule's medicines are verified, walk the
   person through each medicine **once**, capturing front and back of the
   strip. Then the schedule is created and **locked**.
3. **Reminders show the strip photos.** In-app reminder is a notification;
   tapping it opens the app and shows, **one medicine at a time**, the strip
   image and name with **Taken / Not taken**. Three medicines at one time =
   three cards. Not taken → follow up after 30 minutes.
4. **The call** is deliberately dumb: a scheduled call that says
   *"आपकी दवाई का समय हो गया"*. No duplex, no conversation.
5. **Agent flow.** Full context of that patient's prescriptions and schedules;
   answer clarifying questions; photograph a medicine and ask *"ye dawai kab
   leni thi"* and get the right answer. **Meko provides persistent memory** and
   records memories as the conversation goes on.
6. **Purchase UI/UX** needs polish. Medicines, lab reports and Me are fine.

### Sequencing suggestion

Steps 1–3 are one connected build and the heart of the demo — do them
together. Step 4 needs credentials (below). Step 5 needs Meko unblocked
(below) and is the largest single piece; the deterministic half already exists in
`packages/core/src/askMemory.ts` and should stay deterministic.

---

## 6. Blockers that need the user

1. **Twilio credentials** for real calls: `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. A trial account needs no card. Webhook
   is `https://asia-south1-parcha-101.cloudfunctions.net/callWebhook` — it
   answers 404 by design until `CALL_PROVIDER=twilio`. Run
   `scripts/twilio-check.mjs` first; it verifies **voice calls to India are
   enabled**, which Twilio blocks by default. Everything above the telephone is
   proven; the telephone itself is not. See `docs/CALLING.md`.
2. **Meko**: an API key, and **Secret Manager enabled** on `parcha-101`. Until
   both, the exports stay parked (§3.2) or no function deploys at all.
3. **"MISO from Yugpaya AI"** was asked for earlier and **does not appear to
   exist** — no company, no docs, nothing in the repo. The only Miso with an
   API is a San Francisco personalization company that cannot read a drug
   photo. Ask the user for a URL before building against it. Note the app
   already does **on-device OCR** (Tesseract WASM, models served locally), and
   `packages/core/src/soundsLike.ts` corrects OCR-mangled names against a real
   drug list — this needs no key and no upload.

---

## 7. Known rough edges

- The Home dose grid pushes **New Parcha / Ask** below the fold. Home scrolls,
  but it is no longer the one-screen design it was.
- `docs/screenshots/` predate the narrowing; the README says so.
  `node scripts/screenshots.mjs` remakes them (it mutates demo state).
- The APK is a **debug build signed with the debug key**. Phone sign-in inside
  the Android app uses reCAPTCHA in a webview and is untested.
- `presentation/` has uncommitted deletions and untracked assets, deliberately
  left alone all session.
- Indian OEM battery killers (Xiaomi, Oppo, Vivo, Realme) throttle alarms and
  kill background apps. This is the biggest practical risk to the reminder
  story and is untested.

---

## 8. House style

Commit messages here are full prose explaining **why**, not bullet lists —
match the existing log. Code comments explain the reasoning and the trade-off,
not the mechanism. **Never add Claude attribution to commits or PRs.**
