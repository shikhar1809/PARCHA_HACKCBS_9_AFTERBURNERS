# The desktop program

The clinic app (or the patient app) as a program that opens from the taskbar,
for the front-desk computer. It is the same web app in a window of its own
(Electron), so every screen behaves the same. What the desktop adds:

- **Opens like a program**, remembers its window, one copy at a time.
- **Prints prescriptions** through the computer's own printers (Ctrl+P, or the
  Print button).
- **Keeps its own copy of the data on the computer.** The app's encrypted local
  store (see `packages/client/src/vault.ts`) lives in this program's own profile,
  separate from any browser, so a day's queue and the dossiers already opened are
  still there when the internet drops.
- **A closed shell.** The window loads the app from files packed inside it (a
  private `app://` address, with a content policy that allows only the emulators
  and Google's services), cannot open arbitrary pages, and sends links to the
  person's browser.

> **Status.** Run and smoke-tested on Windows: it loads the clinic sign-in screen
> in a secure context with local storage. The Windows installer was built with
> electron-builder; it has **not been installed on a second machine**, and the
> macOS and Linux targets were not built. **Dictation does not work in the
> desktop program**: Chromium's speech recogniser needs a Google API key that an
> Electron app does not carry. Use the browser for dictation, or the medicine
> search and the tick-through, which work the same.

## Run it

```bash
npm run emulators                      # one terminal
npm run seed
npm run dev:clinic                     # http://localhost:3000
npm --workspace @parcha/desktop run start    # the program, pointed at the dev server
```

To run the packed version (no dev server needed):

```bash
node apps/desktop/scripts/build-web.mjs clinic 127.0.0.1   # build the app into the program
npm --workspace @parcha/desktop run start:built
```

`PARCHA_APP=patient` (with `build-web.mjs patient`) makes the same program carry
the patient app instead.

## Make the installer

```bash
node apps/desktop/scripts/build-web.mjs clinic <backend-host>
cd apps/desktop && npx electron-builder --win nsis      # apps/desktop/release/
```

`<backend-host>` is where the Firebase emulators are, from the computer's point of
view (`127.0.0.1` on the same machine). Pointing it at a hosted project needs the
real Firebase settings (`VITE_FIREBASE_*`) set at build time as well.

## What "stored on the device" means here

The same as on the phone: every screen mirrors what it reads into an encrypted
local store, and reads from it when there is no connection. The key is made on
the computer and cannot be exported, so a copied database file is unreadable.
**What it protects against** is the data being lifted from the disk. **What it
does not** is someone using the program while it is open and signed in: that is
what the idle lock is for.

The clinic works offline too. Registering a patient, starting a visit, taking
vitals and sending to the doctor, starting a consultation and signing and
printing a prescription are all kept on the computer and sent in order when the
connection returns (see `packages/client/src/outbox.ts`). Each send carries a
name the server remembers, so sending twice never does it twice. The safety
check runs on the computer from the saved formulary; it cannot see what the
patient was given on other visits this month, and says so. When the server
refuses something on arrival (the patient has moved on, a new warning appears),
the action is kept, with the server's words, in a red strip at the bottom of
the screen until someone reads it. **Two computers that are both offline do not
see each other's work**: the desk's intake reaches the doctor only when the desk
is back online. Open the Team page's neighbours once while online so the team
and the formulary are saved on the computer.

Hospital data on a desk computer is also a compliance matter (disk encryption,
who can log in to the machine, retention). The program does not solve that; it
only makes sure its own copy is encrypted.
