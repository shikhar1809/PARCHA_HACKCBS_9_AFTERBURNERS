# Functions API

Every write is a callable Cloud Function in `asia-south1`
(`firebase/functions/src`). The apps call them through `packages/client/src/mutations.ts`.
Errors carry a sentence meant for a person; machine prefixes such as `SAFETY_ACK:`
are stripped for display.

Callers: **Desk** = staff with the front-desk counter, **Doctor**, **Admin** =
staff with the `admin` claim, **Patient** = a signed-in phone number.

## The visit

| Function | Caller | What it does |
| --- | --- | --- |
| `registerPatient` | Desk | Creates a patient (honours a free `clientId`). Offline-safe (`opId`) |
| `startVisit` | Desk | Opens a visit at `registered` for a patient (honours `clientVisitId`). Returns the existing open visit if there is one |
| `saveIntake` | Desk | Saves vitals and the complaint, chooses a doctor (must be wired to this desk), moves to `intake_complete` |
| `startConsultation` | Doctor | `intake_complete` to `in_consultation` |
| `checkPrescription` | Doctor | Runs the [safety check](SAFETY-ENGINE.md) on the medicines so far; advisory |
| `signPrescription` | Doctor | Needs a recent sign-in. Re-runs the safety check; an unacknowledged high flag fails with `SAFETY_ACK`. Writes the prescription, the conflicts and the share code; closes the visit |
| `linkVisitByCode` | Patient | Adds a visit to the phone using its share code |
| `sendFollowUpReminder` | Desk | Sends a follow-up message |
| `registerPushToken` | Patient | Saves a device's push token |

## Before the visit

| Function | Caller | What it does |
| --- | --- | --- |
| `requestVisit` | Patient | Asks a hospital for a visit; starts the 15-minute promise |
| `cancelMyRequest` | Patient | Withdraws a request |
| `escalateRequest` | Patient | Moves a request on if the hospital's time has run out (a no-op otherwise) |
| `proposeVisit`, `withdrawProposal` | Desk | Asks, or stops asking, a doctor |
| `passOnRequest` | Desk | Passes a request to the next hospital with a reason |
| `cancelVisitRequest` | Desk | Cancels with a reason |
| `respondToRequest` | Doctor | Accepts with a day and time, or declines with a reason |
| `checkInVisit` | Desk | Checks a booked patient in on arrival |
| `controlVisit` | Desk | Sets what to bring, reschedules, reassigns, or marks no-show |
| `setBringReady` | Patient | Ticks what they have ready to bring |
| `setAvailability` | Doctor | Available, busy or off |
| `sweepOverdueRequests` | Scheduler (HTTP in the emulator) | Moves requests whose time ran out to the next hospital |

## Sessions

| Function | Caller | What it does |
| --- | --- | --- |
| `startStaffSession` | Staff | Opens a session with the device's location and the address the server sees; resumes the open one after a reload from the same place. Refuses without a location, and after a session ended needs a fresh sign-in |
| `sessionBeat` | Staff | The minute check-in. Ends the session if the address changed, the device moved away, or location stopped |
| `endStaffSession` | Staff | Signing out closes the session |

Every desk, doctor and admin function above also checks for an open session from the same address (`liveCounter` and `liveAdmin` in `session.ts`); without one it answers `SESSION_ENDED` and the app signs out.

## Setting up and running a clinic

| Function | Caller | What it does |
| --- | --- | --- |
| `setupClinic` | Manage ability, clinic not set up | Template, name, place and PIN; creates the seats and puts the caller in the owner seat |
| `saveMyProfile` | Any staff | Name, qualification, registration number (required for a doctor), department, phone, hours |
| `openManage` | Manage ability | Checks the PIN; locks after 5 wrong tries for 15 minutes; returns a 15-minute pass |
| `closeManage` | Staff | Ends the pass |
| `manageState` | Manage pass | Seats, team (with sign-in emails), clinic details, session rules, and the clinic's status (taking requests, new problems, follow-ups, how busy, answer time, departments, consultation fee) |
| `manageStats` | Manage pass | Today, 7 or 30 days (India time): patients, walk-ins and app requests, signed prescriptions, average waits (arrival to vitals, vitals to doctor, with the doctor), requests answered, each doctor's patients and consultation time, arrivals by hour, pharmacy and billing totals |
| `saveSeat`, `deleteSeat` | Manage pass | Add or change a seat (everyone in it changes at once); remove an empty one |
| `assignSeat`, `setMemberActive` | Manage pass | Give a person their roles (`seatIds`: one or several, which add up; the older single `seatId` still works); deactivate or bring back |
| `saveSettings` | Manage pass | Clinic details, session rules and status. Only what changed is written and said in the activity log |
| `changeManagePin` | Manage pass and a recent sign-in | A new PIN |
| `createTeamMember` | Manage pass and a recent sign-in | Adds a person with one or more roles (`seatIds`); the first password is returned once |

None of them lets the last person who can manage lose that ability.

A clinic that switches off **new problems** or **follow-ups** has `requestVisit` refuse that kind of request from the app, with a message telling the patient to choose another hospital.

## The pharmacy and the billing desk

Optional counters after the doctor, for clinics with a seat that has the ability. The visit's own stages end at "prescribed" either way, so neither can hold a patient up.

| Function | Caller | What it does |
| --- | --- | --- |
| `dispensePrescription` | Dispense ability, open session | For a signed prescription: which medicines were given and any same-formula brand given instead. Writes `visits/{id}/dispensing`, sets `dispensedAt` and `dispensedBy` on the visit, and logs it in a sentence ("gave Prashant 3 of 4 medicines (Paracetamol given as Dolo 650). Not given: Glimepiride.") |
| `recordBill` | Billing ability, open session | Fee lines, and whether paid (cash, UPI, card or Razorpay, required when paid; for Razorpay, an optional `pay_...` payment id). Writes `visits/{id}/bills`, sets `billTotal`, `paid`, `paidMode` and `paidRef` on the visit, and logs it. |

## The team

| Function | Caller | What it does |
| --- | --- | --- |
| `createTeamMember` | Admin | Makes an account with its claims and a first password. Needs a recent sign-in |
| `connectTeamMembers`, `disconnectTeamMembers` | Admin | Wires a desk to a doctor, or removes the wire |
| `setDuty` | Staff, own account | "I am here" or "I have left". Rate limited |

## The patient's own

| Function | What it does |
| --- | --- |
| `saveReminders`, `deleteReminder`, `markDose` | Reminders and ticking doses. Client-made reminder ids are honoured when free |
| `saveProfile`, `deleteProfile` | The people on the phone: face, age, nickname, helper |
| `addDocument`, `deleteDocument`, `saveHistory` | Papers and the health summary |
| `recordConsent`, `exportMyData`, `deleteMyData` | Consent, download, delete |

## Reminder calls

| Function | What it does |
| --- | --- |
| `saveCallSettings` | Turns calls on (needs consent), sets quiet hours |
| `startCallNumberVerification`, `confirmCallNumber`, `clearCallNumber` | Gives a person their own phone for calls, proved by a code read to it |
| `requestTestCall`, `simulateCallOutcome` | Demo line only: a test call and the "press 1 / press 2" buttons |
| `dispatchReminderCalls` | Scheduled every minute: places the calls that are due |
| `runCallDispatcher` | The same, by HTTP, for the emulator (needs `x-sweep-key`) |
| `callWebhook` | The provider's callback (signature checked) |

See [CALLING.md](CALLING.md).

## Setting up a live project

`bootstrapLive` (HTTP; its key lives in `firebase/functions/.env.<project>`, never committed) loads the medicine list, a hospital and a first team (an admin at the desk and a doctor wired to them) into an empty live project. It refuses if a team already exists. Delete it once it has run.

## Development only

`seedDemoData` loads the demo clinic. It refuses to run anywhere but the emulator.

## Common behaviour

- **Authorisation:** `requireStaff`, `requireCounter`, `requireAdmin`, `requirePatientPhone` in `guards.ts`.
- **Idempotency:** the five clinic actions accept `opId` and use `once()` ([OFFLINE.md](OFFLINE.md)).
- **Rate limits:** per caller, kept in Firestore so they hold across instances.
- **Audit:** sensitive actions write an audit record.
