# The Android app

The Android app is the patient web app inside a native shell
([Capacitor](https://capacitorjs.com)). The screens are the same code that runs
in a browser. The native layer adds three things a browser cannot:

1. **Real alerts that ring while the app is closed**, and with no network, built
   to be noticed the way a delivery app's alert is: a high-importance channel (it
   drops down over whatever is on screen and shows on the lock screen), our own
   chime and a long vibration, the medicine, person and time on it, a larger icon,
   and two buttons, **Taken** and **Later**. If a dose is not ticked, a second
   reminder follows ten minutes later and a third after twenty-five; they vanish
   once the dose is ticked off. The next three days of doses are handed to the
   phone's alarm system and rebuilt whenever the reminders change.
   (`apps/patient/src/components/native.tsx`; the chime and icons are made by
   `scripts/make-android-alerts.mjs`.) In a browser the same alert appears as a
   system notification with the same two buttons, but only while the app is open.
2. A launcher icon and splash (generated from the logo: `scripts/make-icons.mjs`).
3. A proper app: no browser bar, installs from an APK.

It is also an **installable PWA** with an offline-capable app shell, for phones
where an APK is not wanted (Chrome: Add to Home screen).

> **Status.** `parcha-debug.apk` builds, and its package, icon and permissions
> were inspected with the SDK's `aapt2`. It has **not been run on a device or
> an emulator** (none was available to the person who built it). Treat the
> first run on a real phone as the first test.

## Build it

Needs JDK 21 and the Android SDK (platform 35). Gradle downloads the rest on the
first run.

```bash
node apps/patient/scripts/android.mjs 10.0.2.2
```

This builds the web app, copies it into `apps/patient/android`, runs Gradle, and
writes `apps/patient/parcha-debug.apk`. It is a **debug build**, signed with the
debug key: fine to show and to sideload, not for the Play Store.

The argument is where the Firebase emulators are, **from the phone's point of view**:

| Running on | Use |
| --- | --- |
| An Android emulator on the same computer | `10.0.2.2` (default) |
| A real phone on the same wifi | the computer's address, e.g. `192.168.1.20` |

For a real phone the emulators must listen on the network: set `"host": "0.0.0.0"`
for auth, firestore and functions in `firebase.json`. The Android project is set to
allow plain `http` to reach them (`capacitor.config.ts`); remove that when the app
points at a real hosted project.

## Install and try it

```bash
adb install -r apps/patient/parcha-debug.apk
```

Then: open it, sign in with a demo phone (`docs/DEMO.md`), agree to the privacy
notice, open **Schedule**, turn the bell on (the phone asks for permission to show
notifications), and add a reminder a minute from now.

## Before this is a product

- **A hosted backend.** The app talks to emulators on a development machine. A real
  app needs a Firebase project (Mumbai), real phone sign-in (SMS or Play Integrity),
  and App Check.
- **A release build** signed with your own key, and a Play listing.
- **Exact alarms.** The app asks for `SCHEDULE_EXACT_ALARM` so doses ring on the
  minute. On Android 14 and later the person can withdraw it in system settings,
  and then reminders may be a few minutes late. Some phone makers also kill
  background apps aggressively; test on the phones your patients actually have.
- **Push.** Local reminders cover doses. A server-sent message (a request was
  answered, a follow-up) needs Firebase Cloud Messaging, which is not wired up.
