# The judge pitch

**The scored round. Slides, then a live end-to-end demo of the working build.**

Scored out of 25:

| Criterion | Points | The question being asked |
| --- | --- | --- |
| Problem and value | **10** | Is the problem clear, and does the solution deliver meaningful value? |
| Solution and innovation | **5** | Is the solution creative and unique? |
| AI / agent engineering | **5** | Is AI meaningfully integrated, with effective tool usage and edge-case handling? |
| Demo and communication | **5** | Is the demo functional, clear and well explained? |

Problem and value is **forty per cent of the marks on its own**. It is also the
criterion our current deck spends the least time on — it opens with a global WHO
statistic and moves to features by slide two. That is the single biggest change
this document makes.

---

## 1. How to spend the time

Whatever your slot is, divide it like the marks.

| Block | Share of time | What it is for | Criterion |
| --- | --- | --- | --- |
| **The problem** | 35% | One patient, one failure, three Indian studies | Problem and value (10) |
| **The demo** | 40% | The working build, end to end, live | Demo (5) + value (10) |
| **How it is built** | 15% | The three decisions that make it different, and the AI | Innovation (5) + AI (5) |
| **Where we are** | 10% | Honest limits, what a pilot would measure, the ask | Credibility across all four |

Two things that are **not** in that table, and must not be: the architecture
diagram as a slide you walk through, and the go-to-market slide. Both exist, both
are good, and both are what you put up *while answering a question about them*.
Neither earns a mark in this rubric.

---

## 2. Problem and value — the 10-point block

### The reframe

Our deck currently opens with *1 in 20 patients experience preventable
medication-related harm globally*. It is a real figure and it is the wrong
opening, for three reasons: it is global, it is about hospitals in general, and
it does not point at anything we built.

Open with this instead, because it is Indian, it is specific, and every single
thing we built falls out of it:

> A government hospital in Kolkata looked at 380 prescriptions coming out of its
> outpatient departments. **96% were perfectly legible. 86% were complete by the
> national guidelines.** And **36.8% of those patients did not understand what
> they had been given.** On frequency — how many times a day — only **40%** got
> it right.
>
> *Indian Journal of Pharmacology, 2025.*

Then say the line that makes it a product:

> So this is not a handwriting problem. The prescription is correct. The care
> fails ten feet outside the consulting-room door, and it fails worst for exactly
> the people who need it most — women did worse than men, over-fifties worse than
> under-fifties, lower income worse than higher.
>
> When the researchers asked those patients what would help, they asked for two
> things: **write it in our language, and show us pictures.** That is not our
> idea. We just built it.

This does more work than any statistic we have:

- It is **unarguable** — it is a measured Indian number from a peer-reviewed
  journal, not a vendor blog or a global average.
- It **kills the obvious objection** ("doctors should just write more clearly")
  before a judge raises it.
- It **specifies the product.** Hindi, Hinglish, dose pictograms, read-aloud —
  every one of those is now a response to a request from patients, not a feature
  we thought was nice.

### The three places the visit breaks

Build the problem slide as three failures in one visit, with the evidence on the
slide in small type. Not a list of complaints — one patient moving through time.

| When | What breaks | Evidence |
| --- | --- | --- |
| **Before** | She cannot know when her turn is, so she leaves home at 7 a.m. for a 10:30 consultation | CAG audit of J&K outpatient departments: most consultations 5 minutes or less, most patients wait over 30. One hospital study: 110 minutes of waiting for a 5-minute consultation |
| **During** | Prescribing is where medicine harm is actually created, and the doctor has 2–3 minutes and will not type | WHO-published review (Panagioti et al. 2024, 100 studies): **53% of preventable medication harm arises at ordering and prescribing.** Indian clinic-software vendors report the common pattern is the doctor writing by hand and staff retyping it later |
| **After** | The prescription is correct and she cannot use it | The Kolkata study above |

### The value, said in a way that scores

Do not say "improves patient outcomes". Say what changes, for whom, and admit
what is unmeasured:

> For the family: the instruction arrives in a language and a shape they can
> use, and keeps arriving — at eight in the evening, as a phone call, in Hindi.
>
> For the doctor: the prescription is written by talking, so the record exists
> without costing him the two minutes he does not have. No evening retyping.
>
> For the clinic: the same app runs a single doctor's room and a seven-counter
> hospital, because who does what is data, not a hard-coded job title.
>
> **What we have not measured:** whether any of this changes whether Prabha takes
> her tablets. That needs a pilot, and it is the first thing we would measure.

That last paragraph gains more marks than it loses. Every team claims impact. A
team that names what it has not proven reads as the one you could actually fund.

---

## 3. Solution and innovation — the 5-point block

Three decisions. Not a feature list — three choices with a reason, which is what
"creative and unique" is actually asking for.

### 3.1 The prescription travels on the paper, not over the internet

**The claim:** the whole prescription — every medicine, strength, form,
frequency, duration, timing, the doctor's registration number, the hospital — is
compressed and written into the QR printed on the slip, and signed by the
hospital's server at the moment the doctor signs. The patient's phone reads it
and **verifies the signature on the device with no network at all**, and refuses
a code that was not made by Parcha or was altered.

Two details worth saying out loud, because they are the kind of thing a
technical judge remembers:

- It is **ECDSA P-256 over the deflate-compressed payload**, checked against a
  public key shipped inside the app. Nothing is looked up. There is no server in
  the path.
- The token sits **after the `#`** in the link, which a browser never transmits
  to a server. So the clinical detail goes from the paper to the phone and
  nowhere else — not even to our own hosting logs.

**Why this is the interesting choice:** every competitor delivers the
prescription as an SMS or WhatsApp link. That needs a network, a live server, a
link that has not expired, and it puts clinical data in a third party's chat
history. Paper is the one thing an Indian OPD has already universally adopted.
We made it the data carrier.

It also means a chemist reads the same slip the phone is reminding from. One
document, not two.

*(Also true, and worth having ready: because the QR renders on the screen before
it prints, a clinic with no printer can have the family scan it off the monitor.
And a family with no printed slip at all has a second path — the app can read the
printed medicine names off a pharmacy bill, on the phone, and cross-check them
against what they were told.)*

### 3.2 The clinic's records and the patient's phone are deliberately kept apart

Nothing clinical is pushed to the patient's app. The phone is allowed to read
that a visit exists, its queue position, its token, and that the doctor has
signed — and nothing else. What was measured, found, prescribed and dispensed is
read at the clinic. The security rules enforce it, not a convention.

Say why, because the why is the point: a clinic's medical records should not sit
on a handset nobody at the clinic controls, and under the DPDP Act the less of it
that leaves the clinic the better. The prescription crosses the gap exactly the
way the paper does — handed over, in the family's hand.

This is unusual enough that a judge may read it as a limitation. Get ahead of it:
it is a choice, it is written down in `firestore.rules`, and the QR is what makes
it possible to make that choice without the family losing anything.

### 3.3 Who does what is data, not a job title

The same build serves Dr Verma on his own — who is the front desk, the nurse, the
doctor and the pharmacy — and a hospital with reception, triage, several doctors,
pharmacy, billing and management. Roles are seats with abilities, set up by a
non-technical person behind a PIN, and one person can hold several at once;
what they can do adds up.

This is the least glamorous of the three and it is the one that decides whether
the product can ever be sold, because the Indian market is overwhelmingly
one-doctor and two-doctor clinics. Say that.

---

## 4. AI / agent engineering — the 5-point block

The rubric asks three things: is AI **meaningfully** integrated, is **tool usage**
effective, and are **edge cases** handled. Answer all three explicitly.

### 4.1 Where AI is, and where we refused to put it

Lead with the refusal. It is the strongest thing we have to say here, and it is
true.

> There are three places in this product where a model would have been the easy
> choice, and we did not use one.
>
> **Where the medicines go on the page** is decided by rules we wrote, which we
> can read out line by line. The same dictation gives the same lines every time,
> which is what makes it reviewable by a doctor in two seconds.
>
> **The safety check has no model in it at all.** Allergy, drug-drug interaction,
> today's vitals, too young, more than the most-a-day — by a child's weight —
> pregnancy and breastfeeding. Deterministic, same answer every time, and every
> flag names which record it read.
>
> **The reminder call script is fixed text.** A reminder about medicine is the
> wrong place for wording that varies.

Then where it is:

| What | Where it runs | Why it earns its place |
| --- | --- | --- |
| **Speech to text** | Whisper, compiled to WASM, on the clinic's own computer | The doctor talks instead of typing. **No audio ever leaves the machine** — not the browser's speech service either, which would send it to Google or Microsoft |
| **Sound-alike medicine names** | On device, against *this clinic's* formulary | Speech writes "Parasetamal 650", "Syprophloxysin". Names are matched by how they sound against the clinic's own drug list, and only names on that list are ever written |
| **Reading a pharmacy bill or a strip** | Optical reading on the patient's phone | Every name found is boxed on the photo with why it counts. Nothing is added until the person taps Add. Nothing is uploaded, nothing is kept |

### 4.2 Tool usage — the loop, end to end

Describe it as a chain with a named step at each link, because "effective tool
usage" is scored on whether you can show the parts talking to each other:

```
microphone → audio worklet → Whisper (WASM, on device) → transcript
   → sound-alike matching against this clinic's drug list
   → placement rules: diagnosis / medicine / test / advice / follow-up / remove / change
   → the gaps become ONE question at a time ("how many days for the paracetamol?")
   → the next thing said is taken as that answer
   → the safety engine runs live against allergies, current medicines and today's vitals
   → the doctor reads and ticks
   → sign → the server re-runs the whole safety check, and signs the QR
```

Two things in that chain are worth stopping on:

- **It asks, rather than guessing.** If a duration was not said, it does not
  invent one silently — it asks for it, one question at a time, and understands
  the answer in context. "A medicine named while another is being asked about is
  that medicine, not the answer" is a test in the suite.
- **The check runs twice.** Live in the browser so the doctor sees a clash while
  composing, and again inside the signing function, where a modified client
  cannot skip it. The second run is the one on record.

### 4.3 Edge cases — have these ready by name

This is where marks are actually won or lost, because a judge will ask "what
happens if…". Each of these is handled in the build:

| The edge case | What happens |
| --- | --- |
| Speech mangles a medicine name | Matched by sound against the clinic's list; only a name on the list is written, and the pad shows which medicine it took the words to be |
| A medicine that is not in the list at all | Can still be written by hand, and is flagged on the prescription as **unchecked** — its name is still read against free-text allergies |
| The doctor says the same medicine twice | Treated as a change to the existing line, not a second line. Only what was said the second time changes |
| A high-severity safety flag | The Sign button stays off until the doctor ticks that they read it, and that acknowledgement is stored with the prescription |
| A flag that is wrong | Flags **advise, never block.** A tool that blocks gets switched off and the clinic goes back to paper |
| The child's weight was not recorded | It says the dose **could not be checked**, rather than passing it silently |
| The internet goes down mid-visit | Register, vitals, consult, sign and print all continue; changes queue and send when the signal returns |
| The computer is too slow for the speech model | Falls back to a smaller model; with none available, typing still works and the dictation box is still there |
| No printer at the clinic | The QR is on screen before it prints and can be scanned off the monitor |
| No smartphone in the family | The slip alone still works — it is a complete, valid prescription on paper |
| Three people share one phone | Each person is separate, each in their own language; the grandmother's screen is one instruction at a time behind a helper PIN |
| The patient cannot hear | Flashing and vibrating reminders, and no calls |
| Someone tries to forge a QR | Signature check fails on the phone, offline, and the code is refused |

### 4.4 What to say about the learning agent — and what not to

There is a designed next step, specified in full in
[`docs/plans/MEKO-VOICE-AGENT.md`](../plans/MEKO-VOICE-AGENT.md): a voice agent
that remembers how *this* doctor writes each medicine, with a closed-world rule
that nothing may ever be offered that is not already in the clinic's own data,
and a human review step before one doctor's habit becomes the clinic's rule.

**What is actually in the build today is the first phase only** — the switch (off
by default, per clinic, with `?meko=off` as an override), the single call site in
the prescribing pad, the privacy gate that *refuses* rather than scrubs any text
containing a phone number, Aadhaar-shaped digits, an email or the patient's own
name, and the closed-world gate that drops any proposed medicine, test,
frequency or timing that does not resolve against the clinic's formulary.
**Recall and the local model are not wired.**

So say exactly this, and no more:

> The doctor's pad today learns nothing — doctor A in her thousandth
> consultation gets the behaviour she got on day one. We have built the frame to
> change that: the switch, the privacy gate that refuses rather than scrubs, and
> a rule enforced in code that the agent may only ever re-apply something that
> already exists in the clinic's own data. It never invents. The recall itself
> is next, and it is not running yet.

Do not say "it learns". Do not say the word "agent" about a thing that is not
calling anything yet. A judge who asks one follow-up question will find the
middle is empty, and you will lose more on credibility across all four criteria
than you could ever gain on this one.

---

## 5. The demo — the 5-point block

### 5.1 Set-up, before you walk in

- **Two windows, arranged before the round starts.** Clinic app on the left, the
  patient app in a phone-shaped window on the right. Never alt-tab looking for a
  tab.
- **Seed fresh and open nothing.** `npm run seed` with no clinic app open — an
  open screen streams every write and turns a 30-second seed into several
  minutes.
- **Sign in to Messages once as the doctor beforehand** so that computer has a
  key, or the Messages part will be blank.
- **Decide who drives.** One person on the clinic app, one on the phone, one
  talking. The person talking touches nothing.
- **Have the printed slip already printed.** Print one before the round and keep
  it in your hand. If the printer, the print dialog or the PDF viewer misbehaves
  live, you have lost a minute of a five-minute demo to a dialog box.
- **The camera header is fixed, but redeploy before you trust it.** The patient
  hosting targets used to send `Permissions-Policy: camera=()`, which blocked the
  in-app QR scanner on `parcha.web.app`; they now send `camera=(self)`. That only
  takes effect **after a hosting deploy**, so deploy and then check the live
  response header before the round. The clinic target still blocks the camera
  deliberately — it has no use for one.
- **Either way, prefer the phone's own camera app.** The QR is a plain link, so
  the native camera opens the patient app on it with no permission prompt at all.
  It is one less thing to go wrong in front of a judge. **Rehearse whichever you
  choose, on the actual device, on the actual network.**
- **If the venue network is bad, run it all on localhost.** The product's whole
  argument is that it works without the internet. Running on localhost is on
  message, not an excuse.

### 5.2 The run, with the words to say

Five minutes, five moves. The timings are the *maximum* for each.

**Move 1 — the patient, blind (0:30).**
Patient app, Mohammed Irfan (`9873312098`). A request is waiting.

> He asked for this visit from his phone, before leaving home. He can see where
> it stands. In the hospital he actually goes to, he cannot.

**Move 2 — the doctor (1:45). This is the move that matters.**
Clinic app as the desk (`staff@parcha.test`): look up `9811044321`, start a
visit, vitals, choose Dr Khan, send. Switch to `doctor@parcha.test`, open the
patient, start the consultation.

Then hold Space and talk. Say it the way a doctor says it, in Hinglish.

> *Watch the boxes, not me.*

Dictate `prednisolone`, then `ibuprofen`. The high-severity flag fires.

> That is not a model guessing. It is a rule that can tell you which record it
> read — this patient's own allergy list and today's blood pressure. And it does
> not block me. It makes me say I read it.

Tick it. Sign. The prescription appears, signed, with the QR.

> The whole thing happened by talking. Nothing he said left this computer.

**Move 3 — the family (1:30). This is the move that wins.**
Hold up the printed slip. Scan it with the phone's camera.

> Everything on that paper is now on this phone, and the phone checked the
> hospital's signature itself — I can turn the data off and it still works. There
> was no server in the middle.

Switch the phone's person to Prabha.

> Hindi. A sun and a moon. The actual number of tablets drawn out. No 1-0-1, no
> HS. It reads itself out if she taps it.

Tap Listen. Then show the reminder, and the call demo.

> And at eight in the evening her phone rings and a voice in Hindi says which
> tablet, and asks her to press one when she has taken it.

**Move 4 — unplug it (0:45).**
Me → My data → pretend there is no connection. Then do a registration and tick a
dose. Reload the page. Come back online and watch it send.

> This is the part the clinics we would actually sell to care about most.

**Move 5 — the wall (0:30).**
One sentence over the architecture slide, or the rules file.

> One thing worth noticing: the patient's phone cannot read the clinic's clinical
> records. It is allowed the queue and the fact that the doctor signed, and
> nothing else. The prescription crossed on the paper. That is a choice, and it
> is enforced in the security rules, not by a convention.

### 5.3 If you have longer than five minutes

In priority order, and only if asked or if time clearly allows:

1. **Dr Verma's Clinic** — the same app as a single doctor doing every job. This
   is the commercial argument, visually, in fifteen seconds.
2. **Messages** — `@` a token number and watch the live prescription arrive as a
   chip in an end-to-end encrypted chat.
3. **Manage → Stats** — a month of a real-looking OPD behind the demo, which
   makes the whole thing feel like a product rather than a prototype.
4. **Pharmacy and billing** — the Razorpay QR. Nice, not load-bearing.

### 5.4 Things that will go wrong, and the recovery line

| If | Do this | Say this |
| --- | --- | --- |
| The camera will not scan | Use the pre-printed slip and the native camera; failing that, open the `rx#` link by hand | "The code is just a link — any camera opens it" |
| Speech picks up nothing | Switch to the dictation box and type the same words | "Same path — the typing and the talking go to the same place" |
| The venue network dies | Keep going | "Convenient, actually — this is move four" |
| The seed looks wrong / a queue is empty | Switch to `dwarka.doctor@parcha.test`, which has its own waiting patient | — |
| Something genuinely crashes | Close it, say so in one sentence, move to the next move | "That is a bug and I will show you the next piece" — never narrate a stack trace |

Rehearse the whole thing **three times end to end**, once on the venue's network
if you can get in early. Marks for "demo and communication" are almost entirely
decided before you walk into the room.

---

## 6. Competitive analysis — the USP, defended

### The landscape

| Who | What they are | Where they stop |
| --- | --- | --- |
| **Practo Ray** | The incumbent clinic system: appointments, EMR, prescriptions, billing, WhatsApp patient messaging. Published plans around ₹999/mo (CM Atom, annual) and ₹1,499–1,999/mo | Optimises the doctor's desk. The patient gets a text with a link. Reviewers flag cost, and basic things costing extra. Payment processing and SMS are metered |
| **HealthPlix** | India's largest doctor-facing EMR by its own account, ~$43M raised, 370+ cities. Famous for making a long prescription eight clicks instead of typing | Speed for the *doctor*. We found no patient-side comprehension product, and no voice prescribing |
| **Eka Care** | The closest thing to a direct competitor: ABDM-compliant doctor EMR *and* a patient records app, an AI scribe, ABHA creation at the desk, follow-ups by SMS and WhatsApp | Patient side is **records storage and retrieval** — a place to keep reports. Not instruction comprehension. Reviews note handwritten notes are poorly handled. Everything needs a network |
| **Augnito** | Indian medical speech recognition, from Scribetech, NHS background. Claims accuracy across accents of spoken English | **Cloud** dictation, Indian English. By a competitor's comparison: no structured note generation, no coding. It returns *text*; it does not draft a prescription with a real drug identifier a safety rule can read |
| **ABDM / ABHA** | Government rails. 93.95 crore ABHA numbers, 105 crore linked records, 5.33 lakh facilities (July 2026) | Moves records between institutions, with consent. Contains nothing that makes an instruction usable inside a home |
| **Queue / token apps** | WhatsApp token systems, OPD queue tools | The wait only. No prescription, no record, no safety |

### The one-sentence USP

> Everyone in this market is building a better desk for the doctor. **Parcha is
> the only one treating the patient's grandmother as a user** — her language, a
> picture of her tablet, a phone call at eight — and the only one that moves a
> prescription without needing the internet to be up.

### What we must *not* claim

Three claims that are wrong or unprovable, and that a judge could puncture:

1. **"Nobody does voice."** Augnito, Eka's scribe and others do speech. What is
   genuinely ours is that it runs **on the clinic's own computer** so no patient
   audio leaves, that it resolves to a real drug identifier the safety rules can
   read rather than to free text, and that it understands Hinglish the way a
   Delhi doctor actually dictates. **Claim that, not "nobody does voice".**
2. **"Nobody is ABDM-ready."** Eka Care is ABDM-compliant today and we are not
   connected at all. Never imply otherwise.
3. **"We are cheaper."** Our slide says ₹999/mo for a solo clinic. That is the
   *same price* as Practo's entry plan, from a product with no users. Either drop
   the number from the deck and say "we have not priced this yet, and a pilot is
   how we would", or justify it on a different axis — the patient app is included
   rather than metered, there is no per-booking fee, and it keeps working offline.
   The second is defensible; price parity with the incumbent is not.

### The ABHA and Ayushman answer

This is the question the mentor round got wrong. Have it word-perfect.

**First, separate the two cards**, because conflating them is extremely common:

- The **Ayushman card (PM-JAY)** is **insurance** — up to ₹5 lakh a year of
  cashless hospital treatment for eligible families. It pays bills. It has
  nothing to do with prescriptions, records or instructions. **Zero overlap with
  Parcha.**
- The **ABHA number** is the **health-records ID** under ABDM — 14 digits, 93.95
  crore created, 105 crore records linked. Holding one confers no PM-JAY
  eligibility; they are different programmes that can be linked.

**Then, on ABHA specifically — the honest answer, which is also the strong one:**

> ABHA is the rail. We want to be on it, and we are not on it yet.
>
> But look at what ABHA is *for*. It answers "where are this patient's records?"
> — it moves documents between institutions, with consent. It is retrieval, for
> clinicians.
>
> What it does not do, and is not trying to do, is make an instruction usable
> inside a house. A hundred crore records are linked, and Prabha still did not
> know what HS meant. **ABDM moves records between institutions. It does not move
> understanding into a home.**
>
> So we are not an alternative to ABHA. We are the thing that makes a record
> worth linking.

**And the technical half, which is what a judge is actually testing:**

> The records are already shaped the way ABDM wants them. Vitals carry LOINC
> codes. A prescription line is already a MedicationRequest — `1-0-1` is already
> two timing codes, "every two days" is already a period. A visit is already an
> Encounter. So connecting is mapping, not a rebuild:
>
> **M1** is ABHA creation and verification at the front desk. **M2** is acting as
> a provider — each visit becomes a care context and a signed prescription
> becomes a PrescriptionRecord bundle when a consent request arrives. Then NHA
> sandbox, and Safe-to-Host before production.
>
> That is weeks of work and a certification queue, not a redesign. It is the
> first thing after a pilot. It is written up in
> [`docs/STANDARDS.md`](../STANDARDS.md) with the resource mapping row by row.

Having the FHIR mapping written down already is worth real marks here. Offer to
show that table.

---

## 7. Claims to correct in the deck before you present

Our current eight-slide deck is strong visually. These are the content changes,
in order of how badly they could hurt.

| # | Where | Problem | Fix |
| --- | --- | --- | --- |
| 1 | Slide 1 | **"WHO, 2024: 100 studies / 487,162 patients"** — the 100 studies is right; **the 487,162 figure does not check out.** WHO's own record of that review reports 41,040 patients with medication-related harm. A judge who Googles the citation finds a mismatch | Say "100 studies" and drop the patient count |
| 2 | Slide 1 | Opens on a **global** harm statistic that points at nothing we built | Open on the Kolkata study (§2). Keep the WHO figure for slide 4, where the 53%-at-prescribing number earns its place |
| 3 | Slide 7 | **₹999/mo is Practo's entry price.** Parity pricing from a product with no users invites a question we cannot win | Drop the number, or reframe on included-not-metered, no per-booking fee, offline |
| 4 | Slide 7 | "PROJECTED OPERATING PROFIT ₹1,715/mo · 34.3%" on five imagined clinics | Keep only if asked. A margin projection on zero customers reads as naive, and the footnote admitting it is illustrative is doing a lot of quiet work |
| 5 | Anywhere | Any **capacity** number. Our own architecture doc says 20 instances × 80 concurrent; the deployed configuration is 5 instances at concurrency 1 | Say nothing about scale. If asked: "we have reasoned about it and not measured it, and the deployed settings are deliberately small" |
| 6 | Anywhere | Any **"bad handwriting"** framing | Remove entirely. 96% were legible. The reframe is better anyway |
| 7 | Slide 8 | QR to the **Android** build. It compiles and has never been run on a device | Leave the QR, do not demo from it, and say "built, not yet tested on a handset" if asked |
| 8 | Slide 4 | "0 cloud audio uploads" is true and reads like marketing | Say it as a sentence instead: "the listening happens on the clinic's computer; no audio leaves it" |
| 9 | Everywhere | Nothing should imply the voice mode **learns** | See §4.4. The learning agent is designed, not running |

Two figures the deck gets **right** and should keep, because they are worth
defending: *1 in 4 preventable medication harm is severe or life-threatening* and
*53% of preventable medication harm occurs at ordering/prescribing* are both
genuinely from the WHO-published 2024 review. Do not mix them with the 58%/47%
numbers from Hodkinson 2020 — different study.

---

## 8. Where we are, honestly — the closing slide

This slide gains marks. Put it up and read it.

**Built and working:** the whole visit from request to signed prescription;
tenant isolation between hospitals; the request moving on by itself when a
hospital does not answer in 15 minutes; the safety check, live and again on
signing; prescribing by voice on the clinic's own machine; the signed QR, verified
offline on the phone; three languages per person on a shared phone; dose
pictograms and read-aloud; reminders in app, as notifications and as calls
against a test line; both apps working with the internet unplugged; end-to-end
encrypted staff messages; roles as data; an activity log; export and deletion.
**157 unit tests pass**; 64 integration tests against the Firebase emulators as
of the 29 October review — re-run both before you present.

**Written, not proven:** real phone calls against a live Twilio account. The
Android build on an actual handset. Any capacity number. The privacy notice is an
engineering draft, not reviewed by a lawyer.

**Not started:** the ABDM connection. The learning agent's recall.

**And the one that matters:** *no real patient has used this.* No clinic, no
doctor, no Tuesday. Everything above works and has never met a real OPD.

Then the ask:

> What we want is one doctor and one family for two weeks, and three numbers out
> of it: how many seconds a prescription actually takes, whether the front desk
> stops retyping in the evening, and whether the grandmother can tell us what her
> tablets are for on day seven.

### If a judge asks "what is broken?"

Do not say "nothing". Name one real thing — it buys more credibility than any
claim in the deck. We ran a full review on 29 October
([`docs/review/PROJECT-ANALYSIS-2026-10-29.md`](../review/PROJECT-ANALYSIS-2026-10-29.md))
and these are still open:

- **A patient's own profile is left out of export and deletion** — names, ages,
  helper details, verified call numbers. That one matters under the DPDP Act and
  is a small fix.
- **An offline action can report itself saved when the device store quietly
  failed**, so a reload could lose it.
- **Idempotency is not atomic with the clinical write.** A crash in the window
  between the two could let a retry run the action twice. Not reproduced in a
  concurrency probe; it is an inspection finding.
- **Allergies do not follow a patient to the next hospital** when a request is
  routed on, so the safety check there reads an empty allergy list.

Pick **one** of those to volunteer, not all of them. "We know about this, here is
the file, here is roughly how big the fix is" is exactly what the credibility of
the whole pitch rests on.

Two from that review are **now fixed**, and both are worth mentioning only if the
conversation goes there:

- **Two lines of the same medicine used to bypass the daily-maximum check** — the
  engine removed duplicates by drug before the dose rules ran, so two paracetamol
  lines of 3,000 mg each never added to the 6,000 mg that should flag. Every line
  carrying a medicine is now added up first, the flag says how many lines it
  counted, and a line whose dose cannot be read adds nothing rather than being
  guessed at. Four tests cover it; the engine version is now `1.2.0`.
- **The patient site's hosting headers blocked camera access**, so the in-app QR
  scanner could not open. The patient targets now allow same-origin camera; the
  clinic target still does not, deliberately.

---

## 9. The one-page cheat sheet

Print this. It is the only page you need in your hand.

**The problem, in one line.** A correct prescription stops working the moment the
patient leaves the room — 96% legible, 86% complete, and 36.8% still did not
understand it.

**The product, in one line.** The doctor talks and signs in seconds; the family
gets the same prescription on a phone in their own language, as pictures, read
aloud, with a call at eight — and none of it needs the internet to be up.

**The USP, in one line.** The only one treating the grandmother as the user, and
the only one that moves a prescription on paper instead of over a network.

**On Ayushman.** Different thing — that is insurance. ABHA is the records ID, and
ABDM moves records between institutions; it does not move understanding into a
home. We are not on it yet, and the data is already FHIR-shaped so connecting is
mapping, not a rebuild.

**On AI.** On the clinic's computer, never the cloud. Rules where a prescription
is concerned, because the same words must give the same lines every time. No
model anywhere near the safety check.

**On what is missing.** No real user has touched it. That is the whole ask.

**Never say.** Bad handwriting. Any capacity number. "It learns." "We are
cheaper than Practo." "Nobody does voice."
