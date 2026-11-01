# Handoff to the next session

Written mid-task on 2026-11-01. Read this first, then `HANDOFF.md` (older, still true for environment facts).

Branch `patient-app-first`; `main` on GitHub (`shikhar1809/check`) = `a7d6e0a`, same commit. Both pushed.

---

## The task in flight (NOT committed, NOT tested)

The add-Parcha flow after Yes/No follows the wizard workflow below, written from scratch:

> prescription + bill → doctor recording + verification (skippable) → pharmacist recording + verification (required if doctor skipped) → strip photos front/back → plan: merge everything, prompt to add to the schedule, check clashes → **then test on the tablet**.

**Written so far (uncommitted, typecheck was clean on the last run):**

| File | What |
| --- | --- |
| `apps/patient/src/screens/AddParcha.tsx` | New. The whole flow: `papers` → `doctor` → `pharmacist` → `strips` → `plan` → `done`. Printed Rx and bill read on the phone (`BillReader`); handwriting via `readHandwriting` on a tap. `Words` component records audio (MediaRecorder, ≤120 s) → `hearInstructions` → per-medicine cards, each point (name/when/food/days) ✓ or ✗ "not said/wrong". Doctor skippable; chemist skip only allowed if the doctor gave a confirmed medicine. Plan merges by `sameMedicine`: identity bill > rx > typed > doctor > chemist; timing doctor > rx > chemist; conflicts must be picked; missing points set by hand; then `NewSchedule lock` (clash check) → vault `check:<id>` → Simple Parcha. |
| `apps/patient/src/App.tsx` | `/add` and `/check` → `AddParcha` (import of `CheckMedicines` replaced). |
| `apps/patient/src/screens/Start.tsx` | Yes → `/add?printed=1`, No → `/add`. |
| `firebase/functions/src/assistant.ts` + `index.ts` | `hearInstructions` (audio → transcript + medicines, "only if said") and `readHandwriting`. **Already deployed to live** and working. `gemini()` takes a model list; audio uses `gemini-3.5-flash-lite` first. |

`docs/pitch/DEMO-VIDEO.md` and `STAGE-PITCH.md` are untracked and were **not written by me** — leave them for the user.

**To finish:**
1. `npx tsc -p apps/patient --noEmit`; fix anything.
2. `CheckMedicines.tsx` is now unrouted but `ScanParcha.tsx` still imports `startFromPrintedPhoto` from it — fine to leave, or delete both old paths once AddParcha is proven.
3. Build + install: `node apps/patient/scripts/android.mjs live`, `adb install -r apps/patient/parcha.apk`, then **force-stop and launch twice** (first launch after install shows the old bundle — see below).
4. Walk the flow on the tablet. The doctor step needs a real voice: the user can speak, or play `doctor.webm` (Gemini-TTS Hinglish doctor clip, in the scratchpad) near the mic. Expect Metformin (morning+night, after food, 30 days), Glimepiride (morning, before food), Amitriptyline (night).
5. Commit (prose message, why not what; **no Claude attribution**), push branch, `git push origin patient-app-first:main`, then `node apps/downloads/build.mjs` and `firebase deploy --only hosting:android`.
6. Update README chapter 1 + screenshots (`docs/screenshots/android/`) for the new flow.

---

## Environment facts that cost time this session

- **Deploys:** `--project live --account onlyafterburners@gmail.com`. The user has allowed deploys. A transient "service identity for pubsub" error goes away on retry.
- **Functions import core by relative path** (`../../../packages/core/src/x.js`), never `@parcha/core` — the deploy analyser can't load TS.
- **Secrets on parcha-101 (Secret Manager is enabled):** `GEMINI_API_KEY` (version 3 = the working key), `MEKO_API_KEY`, `MEKO_SCOPE_SALT`. The user's *second* Gemini key returns 429 "monthly spending cap" — **not usable until they raise the cap in AI Studio**; v3 is the first key. Never print a secret (reading it back is blocked anyway).
- **Gemini models:** `gemini-3.5-flash` often 503s; `gemini-3.5-flash-lite` is fast and reliable (audio 3–4 s, vision ~5 s). `gemini-flash-latest` took 160 s once; `gemini-2.5-*` are gone for new users.
- **Meko:** memory tools **require `conversation_id`**; `memory_add.metadata` must be a string; bad args come back as HTTP 200 with validation text (now thrown by `tool()`). Recall = `context_search` (~5–12 s, run in parallel, 5 s cap); writes = `conversation_add_message`. Ask datapack `b1df71e1-9819-4e9b-9c01-e05efb1dd8fc`, opted out of cross-search. One conversation per person in Firestore `askScopes/{hash}`.
- **Tablet:** Galaxy Tab A9 `R9ZX801JY7L`, adb at `$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe`, screen 800×1340 (screenshot px = tap px). Swipe up unlocks. **First launch after `install -r` shows the stale bundle; force-stop + relaunch.** uiautomator can't see WebView text — use screenshots. Samsung camera: shutter (714,893), then the "Ok" button (find via uiautomator `text="Ok"`).
- **Capacitor plugin proxies must never be awaited/returned from async** (`.then` probe throws) — that bug had silently stopped all native alarms; fixed in `native.tsx`.
- **Effects must not return values** — Android WebView's `scrollIntoView` returns a Promise and crashed Ask.
- **Heredocs with long Python in the Bash tool break**; write the script to the scratchpad and run it.
- End-to-end Ask test script: `scratchpad/ask-e2e.mjs` (signs in as the demo phone via `demoPhoneSignIn`, calls the live callable with real images).

## What shipped this session (all on main)

Dose cards with strip photos and 30-min follow-up; locked schedules (server-enforced); person-scoped doses; demo strip drawings (marked samples); Overview + family feed; voice messages (native call screen recorder + in-app, deployed); green selection everywhere; Simple Parcha; photo-quality refusal (`packages/core/src/photoQuality.ts`); Ask = Gemini read + code decides (match/expiry) + Meko memory, tested live and on the tablet; printed Parcha by photo/OCR (QR removed); portrait lock; female Hindi TTS; README rewritten for judges, no clinic app. 191 unit tests pass.

**Still unproven:** the native call screen's three answers rung end to end; reminders over a locked phone (Android 14+); OEM battery killers.
