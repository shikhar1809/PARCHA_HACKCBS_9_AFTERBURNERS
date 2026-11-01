# Security

What is enforced, and where. The rules and the functions are the enforcement;
the screens only agree with them. The limits are listed at the end.

## Who is asking

| Caller | How they are identified |
| --- | --- |
| Staff (front desk) | Email and password. Custom claims set only by the Admin SDK: `accountType` = `staff`, `hospitalId`, and `admin` for admins |
| Doctor | The same, with `accountType` = `doctor` |
| Patient | A phone number (one-time code). The token's `phone_number` is the identity; no claims |

A client cannot grant itself a role: claims are set when the account is made by
`createTeamMember`.

## The four rules that carry the weight

1. **Clients never write clinical data.** `firestore.rules` denies every client write to patients, visits and everything under them. Every change is a callable function using the Admin SDK. The stage machine is therefore real: a screen that forgot a check, or a client that is not one of these screens, still cannot move a patient along.
2. **Append-only is enforced by the rules**, not by convention. Vitals, complaints, prescriptions, stage events and conflicts deny update and delete to everyone.
3. **Each hospital is a wall.** A staff token carries `hospitalId`; a staff account can read a record only if the record carries the same one. Another hospital's patients, visits, team and wiring are refused below the application.
4. **A catch-all deny** ends the rules: anything not named is closed.

The one thing a staff app writes directly is a **message to the team**: it is not part of any record and has to feel instant. The rules hold it instead: a channel is readable only by its own hospital's staff with an open session; a direct thread only by its two members (both checked to work at that hospital when it is made); a message must be from the person signed in, stamped with the server's time, and can never be changed or deleted; only the "last message" fields of a thread can move, and only as the sender. A message is accepted only as ciphertext: the rules refuse any field that could hold words in the clear.

**Messages are end-to-end encrypted** (`packages/client/src/e2e.ts`). Each device makes an ECDH P-256 key pair; the private key is non-extractable and kept in the browser's IndexedDB; the public key is published at `hospitals/{id}/commsKeys/{uid}__{device}`, which only its owner can write. A message is encrypted with a fresh AES-256-GCM key, bound to the thread and the sender as associated data; that key is wrapped for every reader device with a one-time ECDH key and HKDF-SHA-256. The server sees who wrote to whom and when, who was @mentioned, and ciphertext. A patient is shared only as an id inside the encryption, opened with the reader's own rights. Speech is recognised on the device only. Limits, stated plainly: public keys come from the server, so the **safety code** is how two people rule out a swapped key; messages are not signed, so a server operator could inject a message (not read one); a lost device's key is gone with it, and a new device cannot read older messages.

## Staff

- **Counters:** the functions check the caller's role for each action. Only the front desk registers, starts visits and takes intake; only a doctor starts a consultation or signs; only an admin changes the team.
- **Idle lock:** a staff device locks after ten idle minutes and asks for the password.
- **Re-authentication at signing:** `signPrescription` requires a recent sign-in; the app asks for the password at that moment if needed.
- **Duty:** a device that is open and unlocked reports duty every minute; a lock or sign-out, or the duty switch, reports off.
- **Rate limits and audit:** sensitive functions are rate limited per caller and write an audit record.

## Staff sessions: pinned to a place and a network

Before the clinic app (web or desktop) shows anything, it opens a **session**:

- The server records the **internet address it sees** (the device cannot choose this) and the **location the device reports**, and the device it is on.
- Without a location, the app does not open, except in an example set-up (a hospital marked `example`, and each "Custom" clinic), which opens and logs that no location was shared; the address is still pinned. The desktop program asks Windows for the location (Electron's own needs a Google key); a browser uses its location permission.
- The device checks in **every minute**, and as soon as it moves more than 100 m. The session **ends at once** if:
  - the internet address changes;
  - the device moves more than 300 m from where it opened (or more than twice the reading's stated accuracy, so GPS wander does not count);
  - location is turned off (three failed readings in a row on the desktop program);
  - the same account opens Parcha somewhere else.
- **Ending is enforced below the app.** The security rules refuse every staff read without an open session, every staff function checks the session and the address on each call, and the account's refresh tokens are revoked. Coming back needs the password again, not just a still-valid token.
- **The address is the one Google's front end appended**, the last entry of `X-Forwarded-For`; earlier entries can be sent by the client and are ignored (tested).
- **What it cannot do:** a location is what the device says, and a determined person can fake one. The address is the part the server sees for itself. Two allowances avoid false endings: a device with both IPv4 and IPv6 may show both in its first two minutes, and small GPS movements are ignored.
- **The cost of strictness:** a router that renews its address, or a laptop that moves from clinic Wi-Fi to a phone hotspot, ends the session, and the person signs in again. Every ending is in the activity log with the reason.

## Seats and the Manage PIN

- **Abilities are claims**, set by the server when a person is given their seats (roles); several seats add up. The functions check abilities (register, vitals, consult, activity, manage), not job titles; the rules let a seat with "activity" read the log.
- **The Manage page needs three things**: a sign-in, a seat with the Manage ability, and the clinic's PIN. The PIN is stored as an scrypt hash; five wrong tries lock it for 15 minutes; a right PIN gives a 15-minute pass, stored hashed, that each change extends.
- **A clinic cannot lock itself out**: the last person able to manage cannot lose the ability, be moved out of the seat, or be deactivated. Nobody can deactivate themselves.
- **Deactivating a person** disables their sign-in, revokes their tokens and ends their session at once.
- The PIN hash, the passes and the session rules live in `hospitalPrivate`, which no client can read.

## The activity log

Every action a doctor may need to account for is written by the server as a sentence, with the time, the address it came from and where the device was. For example:

> Rekha (management) took Priya's vitals (BP 158/94, pulse 92, sugar 312) and sent them to Dr. A. Khan. · At the clinic · 49.36.x.x

Logged: sessions opened, signed out and ended (with why); patients registered; visits started; vitals sent; consultations started; prescriptions signed (with the medicines, any safety warnings that were read and accepted, and whether it was signed offline); requests asked for, accepted, declined, cancelled and passed on; check-ins, bring lists, reschedules, hand-overs and no-shows; doctors' availability; and team changes. Clients can never write it; **doctors and the admin** of the same hospital can read it (the Activity screen). The older `audit` collection stays as a machine record nobody can read from a client.

## Patients

- **Phone-owned data:** a patient reads their own visits, prescriptions, papers, reminders and profiles because the record's phone number matches the token's. Staff cannot read the patient-owned collections (this is tested).
- **Shared phones:** everyone on a handset is reachable from it. That is deliberate for households, and it is also the limit: anyone holding the unlocked phone sees everyone on it. Easy mode's helper PIN keeps an older person's screen simple; it does not lock the others' data.
- **Consent, export and deletion:** the patient records consent (with the notice version), can download everything held about them, and can delete what they added (`recordConsent`, `exportMyData`, `deleteMyData`).
- **Share codes:** a signed prescription mints an access code that expires and can be revoked; the rules check expiry on every read.

## Data on the device

Both apps keep an encrypted copy of what they have read (see [OFFLINE.md](OFFLINE.md)):
AES-GCM, with a key that is made on the device and cannot be exported, kept per
signed-in person. It protects against a copied database file; it does not protect
against someone using the app while it is open and signed in (that is what the lock and sign-out are for).
Signing out does not erase the copy by default; **Me, My data, Clear this copy** does.

## The QR on the printed Parcha

When the doctor signs, the server builds the prescription into a small payload, compresses it, and signs it with an ECDSA P-256 key (`RX_SIGNING_KEY` in the functions' env files, never committed; `firebase/functions/src/rxToken.ts`). The public key is in `packages/core/src/rxToken.ts`. The patient app verifies the signature on the phone before showing anything, so a forged or edited code is refused. The prescription is after the "#" in the link, which a browser never sends to a server. Anyone holding the paper can read it, exactly as they could read the paper.

## Calls

Reminder calls go only to a verified number: a code is read out to the number and
typed back before any call is placed to it. Calls respect consent and quiet hours.
The provider webhook validates the provider's signature over the exact URL.

## Not covered

- The Twilio integration has not been run against a live account.
- The privacy notice is an engineering draft, not reviewed by a lawyer.
- There is no per-person consent between adults on one phone (see above).
- Hospital data on a desk computer is also a compliance matter (disk encryption, who can log in to the machine, retention) that the program does not solve.
- Real phone sign-in outside the emulator is not built.

Report a vulnerability by opening a private security advisory on the repository.
