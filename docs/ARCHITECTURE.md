# How Parcha is built to stay up

This is the reasoning behind the design, what has been measured, and where the
limits are. Where something is a plan rather than a fact, it says so.

The interactive diagram, with each part linked to the lines of code it stands
for: [architecture/parcha-architecture.html](architecture/parcha-architecture.html)
(download it and open it in a browser; GitHub shows HTML as text). Its source is
[architecture/parcha-architecture.json](architecture/parcha-architecture.json).

## The shape

```
  patient phone (PWA)        clinic web app (desk, doctor, admin)
        │                              │
        │   reads: Firestore listeners (rules-scoped)
        │   writes: callable Cloud Functions only
        ▼                              ▼
  ┌──────────────────────────────────────────────┐
  │ Cloud Functions (asia-south1, Mumbai)         │  all writes, all checks
  │  80 concurrent per instance, none kept warm   │
  │  max 20 instances per function (raise later)  │
  └───────────────────────┬──────────────────────┘
                          ▼
                 Firestore (asia-south1)
```

Nothing a screen does can change data directly. The rules deny every client
write; the stage machine, hospital wall and wiring are enforced in the
functions, where a modified client cannot skip them.

## Why this design absorbs a surge

**No shared hot spot.** Firestore's real ceiling is on a single document (about
one sustained write a second). Every write here lands on a document nobody else
is writing: a visit, a patient, a per-phone rate-limit counter. There is no
global counter, no "all requests" document, no single queue document. A
hospital's queue is a *query* over its visits, not a list stored in one place.

**Reads fan out, not in.** The queue on a desk is a listener over that
hospital's visits, capped (`QUEUE_LIMIT` 200, history 60, team 500). Hospitals
are a small, read-mostly collection every client caches.

**One request, one attempt chain.** A patient's request carries an
idempotency key, so the retry a flaky mobile network causes is the same
request, not a second booking. The request names its hospitals in order once,
at the start, so "who is tried next" is a fixed list and never a computation
done under load.

**The 15-minute promise is a deadline, not a timer.** `respondBy` is a stored
timestamp. Nothing has to *run* for a request to be overdue: the patient's
phone notices and moves it on, the desk can pass it on, and a sweeper
(`sweepOverdueRequests`) catches any the other two missed. A crash of any one of
them delays the hand-off; it never loses the request.

**The server brakes abuse.** Per-key rate limits (a phone can ask 12 times an
hour; an admin can change the team 30 times an hour; a doctor can sign 300
prescriptions an hour), length limits on every free-text field, a ceiling of
20 instances per function so a runaway client cannot run up an unbounded bill.

**Clients degrade, they do not break.** Calls that fail with "unavailable" are
retried with exponential, jittered waits (so a thousand screens do not retry in
the same instant). Listeners that are denied during a token refresh retry with
backoff. Raw errors never reach a person. A screen that crashes is caught with a
way back; losing the network is announced; the map is a separate download that
the page works without.

## QR codes and share codes, at lakhs

**What a printed slip carries.** Each signed prescription mints one **share code**:
10 letters from a 32-letter alphabet that avoids 0/O and 1/I, so it can be read off
paper in bad light. The QR on the slip is that code as a link,
`https://parcha.web.app/link?code=XXXXXXXXXX`: any phone camera opens Parcha's
"Add a visit" with the code filled in. The QR itself is never stored. It is drawn
from the code when the slip is printed, so a lakh of slips cost nothing to keep.

**What is stored.** One small document per code, `accessGrants/{code}`, about 400 bytes:
which visit, which patient, who issued it, when, and when it expires (180 days).
The document's id *is* the code, so redeeming a code is one point read by id, the
same speed at ten codes or ten crore. A lakh of codes is about 40 MB.

**Collisions.** 32^10 is about 10^15 codes. Even at a crore of live codes, the chance a
new one is already taken is about one in a hundred million, and the server creates
each code only if that id is free, so a clash can never overwrite another patient's
code. The letters come from the platform's cryptographic random generator, so codes
cannot be guessed from earlier ones.

**Guessing.** A code is a credential, so redeeming one is rate limited per phone, and
an expired or revoked code is refused by the security rules as well as the function.

**Clean-up.** A nightly job (`sweepExpired`, 3 am India time) deletes codes past
expiry, offline-action records older than 30 days, old rate-limit counters and expired
Manage passes, in batches of 400 (up to 20,000 of each per night), so the store holds
what is live and does not grow without end. The prescription itself is never deleted
by this; only the way to reach it from an old slip.

**If a slip is lost or shared by mistake,** revoking the code is one field on that
document (`revokedAt`), and the rules refuse it at once.

## What has been measured

`node scripts/loadtest.mjs <requests> <concurrency>` fires authenticated
`registerPatient` writes at the emulators and reports latency.

| Run (emulator, one laptop) | Result |
| --- | --- |
| 500 requests, 20 at a time, workers warm | 500 succeeded, 0 failed, 247 requests/s, p50 71 ms, p95 148 ms |
| same, first burst after a restart | the same successes, but some requests wait ~8 s |

The second row is the emulator starting a new worker process for each
concurrent request, loading the code each time. It is an emulator behaviour
(a real deployment runs 80 requests inside one instance), and it is why the
functions are configured with `concurrency` in `firebase/functions/src/options.ts`. It is
named here rather than hidden because it is the first thing anyone running the
test will see.

## What is *not* proven, and the real limits

Be careful with the number "1 lakh". What this design can honestly claim:

- **Functions:** 20 instances × 80 concurrent requests is 1,600 requests in
  flight per function. At the roughly 100 ms these calls take, that is on the
  order of 16,000 requests a second for each function, and the ceiling is one
  line to raise. Capacity here is not the constraint. No instance is kept
  warm (that would bill every function all day), so the first call after a
  quiet spell waits a second or two for a cold start.
- **Firestore:** a new database is *ramped*: Google's guidance is to start near
  500 writes a second and grow about 50% every five minutes. A sudden jump from
  nothing to 100,000 writes a second on a cold database will be throttled,
  and some calls will fail with "resource exhausted", which the client treats
  as "very busy, try again" rather than as a crash. A predictable morning
  ramp is absorbed; an instantaneous cliff is not, by any Firestore design.
- **Listeners:** a database supports on the order of a million concurrent
  listeners; the app opens a few per signed-in person, so this is not the
  constraint at this scale, but it is the number to watch.
- **This has not been run against a real project.** Everything above the table
  is reasoning from the structure and from Google's published limits, not a
  measurement. Before relying on it, run the load test against a staging
  project in Mumbai, from several machines, with the ramp above.

## Still to do for production (honest list)

- Schedule the sweeper (`sweepOverdueRequests` is an HTTP function; Cloud
  Scheduler must call it every minute with the `x-sweep-key` secret). The reminder-call
  dispatcher (`dispatchReminderCalls`) is already a scheduled function.
- Turn on **App Check** (not available in the emulator) so only the real apps
  can call the functions.
- Replace the demo password sign-in with enrolled devices and, for doctors, a
  second factor. The password re-entry at signing is the placeholder for that.
- Move to a paid map tile provider; the free OpenStreetMap tiles are not for
  production traffic.
- Allergies are not copied when a patient is handed to another hospital.
- A lawyer must review the privacy notice and the retention position (docs: `packages/core/src/privacy.ts`, `firebase/functions/src/privacy.ts`).
- Deploy the indexes in `firestore.indexes.json` (the emulator does not need
  them; a real project refuses the queries without them).
- Run `npm audit` and triage the findings (several are in dev tooling).
