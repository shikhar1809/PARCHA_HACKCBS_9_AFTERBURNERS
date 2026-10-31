# Parcha

**A prescription in 30 seconds that the patient's family can read, hear and
follow, even offline.**

A doctor in an Indian OPD has two or three minutes a patient. Parcha gets the
prescription written in seconds, checks it for allergies, interactions and
today's vitals before it is signed, and puts it on the family's phone as
pictures, read aloud, with reminders.
It keeps working with no internet.

Outpatient care does not usually fail at the consultation. It fails at the
handoffs: the patient waits without knowing, the desk copies the same facts, the
doctor types, and the patient forgets the medicine. Parcha cuts that chain to
what a small clinic in India actually needs.

```
patient asks  →  desk finds a doctor  →  doctor accepts a time  →  patient arrives
   (phone)          (15-minute promise)                                 (checked in)
                                                  ↓
            desk takes vitals  →  doctor consults, safety check, signs  →  printed prescription
                                                  ↓
                  the family scans the QR on the slip  →  the patient's phone:
                  medicines by time of day, ticked off, reminders in the app,
                  on the phone, and by a phone call
```

The visit itself ends at the signed prescription.

**The phone and the clinic stay apart.** Nothing clinical is pushed to the patient's
app. The phone follows the visit — the queue, the token, that the doctor has
signed — and that is all it is allowed to read; the clinic's record of what was
measured, found, prescribed and dispensed is read at the clinic. The prescription
crosses the gap the way the paper does: the family is handed the printed Parcha
and scans the signed QR on it, which carries the whole document.

## How it is built

An npm workspaces monorepo:

```
packages/core      pure logic: stages, safety check, schedule, call scripts
packages/client    Firebase wiring, hooks, the offline store and outbox
packages/ui        shared components and the theme
firebase/functions every write, checked on the server (Cloud Functions, asia-south1)
```

**Clients never write clinical data.** The security rules deny it, and every change is
a callable function, so the rule that "only a doctor can sign" is enforced where it
cannot be skipped. Anything clinical is append-only.
