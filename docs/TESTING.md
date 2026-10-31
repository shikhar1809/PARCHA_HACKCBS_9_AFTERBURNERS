# Testing

| What | Command | Needs | Count |
| --- | --- | --- | --- |
| Unit tests | `npm test` | Nothing | 93 |
| Integration tests | `npm run test:integration` | The emulators running | 58 |
| Types | `npm run check` | Nothing | both apps and the functions |
| Load test | `node scripts/loadtest.mjs [requests] [concurrency]` | The emulators running | |
| Screenshots | `node scripts/screenshots.mjs [clinic\|patient]` | Emulators, both apps, Chrome | |

## Unit tests

`packages/core/test`, run with `tsx --test`. They cover the pure logic:

| File | Covers |
| --- | --- |
| `conflicts.test.ts` | The [safety check](SAFETY-ENGINE.md): allergy, interaction and vitals rules, severities, retractions |
| `stages.test.ts` | The stage machine: which moves are legal and who may make them |
| `schedule.test.ts` | Doses by time of day, dose keys, frequencies |
| `fuzzy.test.ts` | Typo-tolerant medicine search |
| `calls.test.ts` | The reminder-call scripts and key presses |
| `profile.test.ts` | Avatars, ages and names |
| `seats.test.ts` | Counters and account type from abilities, the templates, old tokens, seat ids, session rules |
| `session.test.ts` | Distances, what counts as moving, address changes (and the IPv4/IPv6 allowance), place text, device names |

## Integration tests

`scripts/integration.test.mjs` talks to the running emulators over HTTP and
checks what unit tests cannot: that **the security rules and the Cloud Functions,
together, hold.** It reseeds the demo data first, so it leaves the emulator in
the demo state.

```bash
npm run emulators         # one terminal
npm run test:integration  # another
```

| Group | Checks |
| --- | --- |
| The hospital wall | Staff cannot read another hospital's records; clients cannot write clinical data |
| A patient's own papers | Private to the phone; staff cannot read them |
| Signing a prescription | An unknown medicine is refused; the safety check finds a steroid with a painkiller; an unacknowledged high flag stops signing; acknowledged, it signs, closes the visit and mints a share code; it cannot be signed twice |
| Phone calls | Cannot be switched on without consent; only the signed-in number; the dispatcher refuses a missing key |
| People on a phone | An age outside 0 to 120 is refused; family members and their reminders; a number is called only after its code is typed back; a client-made reminder id is kept and cannot take over someone else's |
| Privacy | Consent is recorded and the export holds it |
| Staff sessions and the activity log | Without a session a staff account reads nothing; a new address ends the session and only a fresh sign-in opens another; a forged forwarded address is ignored; moving away or turning location off ends it; the doctor reads who did what in sentences, and a desk that is not an admin cannot |
| Seats, set-up and Manage | The Manage page needs the PIN and the ability; a new seat is exactly what a person can do; the last manager cannot lose it; five wrong PINs lock it; a clinic is set up once and its solo owner registers, takes vitals and sends to themselves; a clinic can allow address changes; a doctor's profile needs a registration number |
| Several roles | A person made with two roles can do what each allows; changing their roles changes their claims and account type; nobody is left with no role; a role someone holds cannot be removed |
| Messages inside the team | A direct message is read by its two people only; nobody else can read it, write in it, or open a thread for two other people; nobody writes as someone else; a message in the clear is refused; a channel is closed to another hospital and to patients |
| Device keys | A person publishes their own device key, never someone else's; another hospital cannot read them |
| Working offline | A client-made patient keeps its id and sending twice makes one; visit, intake and consultation arrive in order and repeat safely; a prescription signed offline keeps when it was signed and a repeat returns the first answer |

## Load test

A burst of authenticated writes (`registerPatient`) against the emulators. It
shows whether the code holds up (no errors, latency that does not climb), not how
many requests a real project absorbs: the emulator is one process on one machine.
[ARCHITECTURE.md](ARCHITECTURE.md) explains the real limits.

## Screenshots

`scripts/screenshots.mjs` drives Chrome through its DevTools protocol (no
packages needed, Node 22+) and signs in with the demo accounts, so the pictures
in the README are exactly what [DEMO.md](DEMO.md) describes. It changes data
(it signs a prescription), so run `npm run seed` afterwards.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. **Types, unit tests, builds:** `npm ci`, `npm test`, `npm run typecheck:apps`, build the functions, build both apps.
2. **Rules and functions:** the emulators are started with a long function timeout and the integration tests run against them.

## Not tested

- The Android app on a device or emulator, and Twilio against a live account (see [ANDROID.md](ANDROID.md), [CALLING.md](CALLING.md)).
- Browser system notifications (they need a normal browser; an embedded preview has no service workers).
- Real users: none yet.
