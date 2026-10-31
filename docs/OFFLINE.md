# Working offline

A clinic's internet drops; a patient's phone has no signal on the bus. Both apps
keep working. Changes are kept on the device first, shown as done, and sent in
order when the connection is back.

## Two stores

| Store | What it is | Where |
| --- | --- | --- |
| **The device store** | An encrypted copy of what each screen has read: queues, dossiers, the formulary, the team, reminders, papers | `packages/client/src/vault.ts` |
| **The outbox** | Changes made with no connection, waiting to be sent | `packages/client/src/outbox.ts` |

### The device store

IndexedDB, **AES-GCM**, with a key made on the device by the browser's crypto
and **marked non-extractable**, so a copied database file is unreadable.
Everything is kept per signed-in person (a different person on the same
computer sees none of it). Live-data hooks (`useDoc`, `useQuery`) save what they
read and fall back to the saved copy when there is no connection.

Patients can see what is held, and clear it, at **Me, My data**.

### The outbox

Each action is a named call. Online it is just a call. With no connection (or
the developer switch on) it is saved, the screen shows it as done, and it is sent
in the order it was made when the connection returns, on start-up, and every 20
seconds.

| | Patient actions | Clinic actions |
| --- | --- | --- |
| What | Tick a dose, add or change a reminder | Register a patient, start a visit, take vitals and send to a doctor, start a consultation, sign a prescription |
| If the server refuses on arrival | Dropped (waiting would not change the answer) | **Kept**, marked as needing attention, with the server's own words, until someone reads it |
| Safe to repeat | Yes | Yes: every send carries an `opId` the server remembers |

## Idempotency

A clinic action carries an `opId`. The server's `once()` (in
`firebase/functions/src/guards.ts`) stores the result under `opLog/{uid}__{opId}`
and returns that stored result on a repeat, so a flaky connection that sends a
call twice never registers a patient twice or signs twice.

**Client-made ids.** A computer with no connection cannot ask the server for a
patient id, so it makes one (`c_...`) and sends it as `clientId` /
`clientVisitId`. The server honours it only if that id is free, so one person
cannot take over another's record.

**When it was really signed.** A prescription signed offline is sent with
`queuedAt`; the server keeps it as `signedOfflineAt` if it is believable (not in
the future, not older than a week).

## What the screens show

`packages/client/src/overlay.ts` lays the queued actions over the live data, so:

- a patient registered offline is on the desk's list at once, marked unsent;
- the visit moves from "waiting at the desk" to "with the doctor" as vitals are sent;
- a prescription signed offline can be printed immediately, with a note that the server has not confirmed it (`unconfirmed`).

A banner says "No connection" and counts the waiting changes. A red strip
(`apps/clinic/src/NeedsAttention.tsx`) lists anything the server refused.

## The safety check offline

It runs on the computer from the saved formulary (`localSafety.ts`) and says so.
It cannot see what the patient took on other visits this month. The server runs
the real check again when the signature is sent, and a new high flag that was not
acknowledged makes the send fail, which then shows up as "needs attention".

## Limits

- **Two computers that are both offline do not see each other's work.** The desk's intake reaches the doctor's screen only when the desk is back online.
- Open the app once while online so the team, the routes and the formulary are saved.
- A refused action is not retried; someone decides.
- Signing out leaves the encrypted copy on the device; **Clear this copy** removes it.

## Testing it on a laptop

Turn the connection switch on:

- **Clinic:** Me, **Developer: pretend there is no connection**.
- **Patient:** Me, My data, the same switch.

It disables Firestore's network as well as queueing changes, so the apps behave
as they would on a real outage. Switch it off and watch the banner count down as
the changes are sent. `npm run test:integration` covers the server half:
repeating an action, client ids and offline signing.
