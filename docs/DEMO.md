# Demo guide

Everything here runs on the local emulators. Load (or reset) the demo data with:

```bash
npm run seed
```

Besides the walkthrough's own patients, the seed writes **thirty days of an OPD
behind each set-up** (`firebase/functions/src/seedHistory.ts`): about 900 visits
at Rohini City Hospital and a few hundred at the other two. It covers weekday rushes
and quiet Sundays, the common presentations of a Delhi OPD in October (fever and
suspected dengue, coughs, stomach upsets, and diabetes and blood-pressure follow-ups),
patients who come back monthly, requests from the app (a few answered only after
another hospital let the clock run out), and people who left before being seen.
It also includes the pharmacy and the bills. So Stats over a day, a week or a month,
the activity log and today's counters all look like a clinic that has been open a
month. Every name and number is made up, and the same on every run.

Seed with **no clinic app open**: open screens stream every change while the seed
runs, which turns a 30-second seed into several minutes.

**The clinic app opens on a choice of set-up**: **Rohini City Hospital** (large,
as hospital management: every service), **Sector 9 Care Hospital** (medium, as
hospital management), **Dr. Verma's Clinic** (as its one doctor), or **Custom** (a new,
empty clinic just for you, which opens on the clinic set-up). Once inside,
**Switch** on the sidebar's card opens any other seat in the same set-up (the
pharmacist, the triage nurse...), **Management** (people and their roles, as the
manager; PIN `1234`), or signs out (which goes back to the choice of set-up).
**Ctrl+M** opens Messages (end-to-end encrypted): open it once as the doctor
so their computer has a key, then as management send them a message with a
patient's prescription linked. Just above
it, **I am on duty** switches you on or off duty.
The screens never say "demo". The patient app lists the
demo phone numbers; one tap opens a household with no SMS. This works on the
emulator and on the live demo project (`VITE_DEMO_SIGN_IN=on` for the apps,
`DEMO_SIGN_IN=on` for the functions). Every staff account also takes the
password `parcha123`.

The example set-ups have no real names; their staff, patients, phone numbers
and figures are all made up.

## The five-minute path

If you only have five minutes, do this and nothing else. It is the whole product.

1. **The patient asks** (patient app, `9873312098` Mohammed Irfan): see the visit that is waiting. Say: *he asked from his phone before leaving the village.*
2. **The desk** (clinic app, `staff@parcha.test`): look up `9811044321`, start a visit, take vitals, choose Dr. Khan, send.
3. **The doctor** (`doctor@parcha.test`): open the patient, start the consultation, dictate or type *prednisolone* then *ibuprofen*. A high flag appears. Tick that it was read, sign, print.
4. **The patient's copy** (patient app, `9811044321`): the prescription and the reminders it made are already there. Tick a dose.
5. **The line that sells it:** Me, My data, *pretend there is no connection*, and do step 2 again. Nothing stops; it sends when the connection returns.

Everything else in this guide is detail for when someone asks.

## Hospitals

One of each size, around Shaheed Sukhdev College in Rohini. The two hospitals have a **Management** seat that works every counter, reads the stats and opens Manage, but does not prescribe; the one-doctor clinic is just its doctor, who does everything.

| Hospital | Size | Seats | Notes |
| --- | --- | --- | --- |
| Rohini City Hospital | Large: every service | Management, reception, triage nurse, doctors, pharmacy, billing, ward clerk | Where the demo opens: 15 patients with two years of history, a full team. Fee ₹300, rating 4.5 (an example). |
| Sector 9 Care Hospital | Medium: a few services | Management, front desk, doctor | A working morning, a request waiting on a doctor. Fee ₹200, rating 4.3. |
| Dr. Verma's Clinic | One doctor | One doctor who does everything | A working morning, a request about to run out of time. Fee ₹200, rating 4.6. |
| Parcha Health Gurugram | | | Not taking requests, to show that state on the map. |

## Staff (clinic app, localhost:3000)

| Hospital | Seat | Email |
| --- | --- | --- |
| Large | **Hospital management** (Rekha): every counter, stats, Manage. The demo opens here | `staff@parcha.test` |
| Large | Reception (Anil) | `staff2@parcha.test` |
| Large | Triage nurse (Sister Mary) | `triage@parcha.test` |
| Large | Doctor (General medicine, available) | `doctor@parcha.test` |
| Large | Doctor (Cardiology, busy) | `doctor2@parcha.test` |
| Large | Doctor (Paediatrics): **has not filled in a profile**, so signing in shows the doctor's first-sign-in | `doctor3@parcha.test` |
| Large | Pharmacist (Pooja): today's prescriptions to give out | `pharmacy@parcha.test` |
| Large | Billing desk (Vikram): fees from the price list; cash, UPI, card or the Razorpay QR; receipts | `billing@parcha.test` |
| Medium | Hospital management (Sneha) | `dwarka.desk@parcha.test` |
| Medium | Front desk (Farhan) | `medium.desk@parcha.test` |
| Medium | Doctor (Dr. P. Nair) | `dwarka.doctor@parcha.test` |
| Dr. Verma's Clinic | Doctor who does everything (Dr. S. Verma): desk, vitals, prescribing, pharmacy, Manage | `noida.doctor@parcha.test` |
| New clinic | The owner of a clinic that is **not set up**: signing in shows the clinic set-up | `solo@parcha.test` |

Each hospital is a wall: signing in at Sector 9 Care Hospital shows only its patients, team
and queues, however the app is poked.

The **Manage PIN** for every set-up demo hospital is `1234` (Manage tab, as management). The clinic app asks for this computer's **location**. The example set-ups (and every Custom clinic) open even if it is blocked, and the activity log says the session opened without one; a real clinic does not open without it.

The patients' map also shows eleven **real hospitals around the college** (Jackson, Ambedkar, Saroj, Jaipur Golden, Brahm Shakti, Bhagwan Mahavir, Max and Fortis Shalimar Bagh, Sanjay Gandhi, Deep Chand Bandhu, Maharaja Agrasen) at their OpenStreetMap places. For the demo they can be asked for a visit like the set-ups, but nobody at them sees the request: it waits its 15 minutes and moves on. Their fee and rating are left blank, not made up.

## Patients (patient app, localhost:3001)

| Phone | Who | What to try |
| --- | --- | --- |
| `9811044321` | Priya, Prashant and Prabha (one family phone) | **The one the app offers, filled in.** Three people on one phone; a prescription ready; a day of medicines for each; Prabha ("Dadi") gets the simple screen. |
| `9700881122` | Ganesh and Suresh | A request waiting at Rohini City Hospital. |
| `9988112233` | Pooja Sharma | A confirmed booking with a "please bring" checklist half ticked. |
| `9873312098` | Mohammed Irfan | A request waiting on a doctor. |
| `9845512077` | Lalita Nayak | Nothing open: book a visit from scratch and watch the map. |
| `9958770044` | Sunil Joshi | A request at Dr. Verma's Clinic with about three minutes left. Open it and watch it move on. |
| `9811990044` | Kavita Menon | A request at Sector 9 Care Hospital with a clock running. |
| `9811990055` | Aman Khanna | A request a doctor at Sector 9 Care Hospital is looking at. |
| `9811990011` | Anjali Verma | A walk-in with the doctor at Sector 9 Care Hospital. |
| `9958770011` | Rahul Saxena | A walk-in with the doctor at Dr. Verma's Clinic. |

## Things worth trying

- **A clinic of one:** sign in as `solo@parcha.test`, choose "A doctor on their own", name the clinic, set a PIN, then fill in the doctor's profile. The same person now has the Desk and the Queue: register a patient, take vitals and send them to yourself.
- **Pharmacy:** sign in as `pharmacy@parcha.test`. Today's signed prescriptions are waiting. Swap one medicine for a same-formula brand, untick another, press Given. As `doctor@parcha.test`, the Activity tab says what was given and what was not.
- **Billing:** sign in as `billing@parcha.test`. The ₹300 consultation fee is filled in; tap Dressing (₹150) from the price list, choose **Razorpay**, and the clinic's Razorpay page shows as a QR with ₹450 to pay. Type the `pay_...` id from the confirmation and press Paid: the receipt prints with it, and today's takings go up. Change the price list or the Razorpay page under Manage → Clinic.
- **Running the clinic:** as `staff@parcha.test`, open Manage (PIN `1234`). Stats opens first (switch between Today and 30 days). Under Clinic, switch off New problems and save: a patient asking Rohini City Hospital for a new problem is told to choose another hospital.
- **Seats:** as `staff@parcha.test`, open Manage (PIN `1234`), add a seat "Triage nurse" that can only take vitals, add a person in it, and sign in as them: they can take vitals but not register anyone. Try switching Manage off for the admin seat: it is refused, so a clinic can never lock itself out.
- **Who is using the phone:** in the patient app, sign in with `9811044321`; Parcha asks who is using it, shows only that person, and the Switch button at the top changes person or signs out.

- **Book a visit:** in the patient app (the family phone is filled in), choose Prashant, tap **New visit**, describe the problem, and the map suggests one hospital and says why. Tap another pin to see its size, rating, fee and distance; ask a real hospital near the college too, and watch the 15-minute ring.
- **Feedback:** open a visit whose prescription is ready: "How was your visit?" takes stars and a few tapped words.
- **@ in Messages:** in the clinic, open Messages (Ctrl+M), type `@rx` or `@` and a token number, and pick "Active prescription #6 · Prashant". Hover the chip for a quick view; click it to open the visit.
- **The promise broken:** sign in as Sunil Joshi and leave the visit open. When the ring reaches zero the request moves on to the next hospital by itself.
- **The hospital's side:** sign in as `noida.doctor@parcha.test` (Dr. Verma's Clinic), open Sunil's request, set what to bring, or pass it on.
- **Bring list:** sign in as Pooja, tick the pictures, then watch the desk's count change.
- **Safety check:** as a doctor, open a waiting patient, start the consultation, add Prednisolone and Ibuprofen. A high-severity flag appears; the Sign button stays off until you tick "I have read this".
- **Reminders and calls:** sign in as `9811044321`, open Schedule, tap the phone icon, switch calls on (agree), add a medicine reminder for this minute, then run `node scripts/dispatch-calls.mjs`. The call shows as ringing with demo buttons for pressing 1 or 2.
- **A shared phone:** sign in as `9811044321`, then Me, and tap Prabha (or Prashant) to design their face, set an age and nickname, switch on Needs help with the phone, and add a helper and a PIN. Then Home, tap the faces at the top, and choose Prabha: the app becomes the simple screen. Leave it with the PIN.
- **Their own phone for calls:** in that editor, enter a number under Reminder calls on their own phone; the demo line shows the code.
- **Offline:** Me, My data, then Developer: pretend there is no connection. Tick a dose and add a reminder (a banner counts the waiting changes), reload the page, then switch back online and watch them send.
- **Alerts:** Schedule, bell on. In Chrome, allow notifications: a reminder appears as a system notification with Taken and Later buttons. (This needs a normal browser; the in-app preview pane has no service workers.)
- **Your data:** Me, then My data: download a copy, or delete what you added.
- **The whole chain:** desk, doctor, a printed prescription, and the patient's own copy.
- **The wiring:** sign in as `staff@parcha.test` and open Team.
