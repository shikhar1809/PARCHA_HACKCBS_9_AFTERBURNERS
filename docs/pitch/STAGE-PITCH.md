# The stage pitch — Priyam, Shikhar, Bhanu

**One story, three voices, about 5 minutes.** Each speaker ends on a line the
next one picks up. The story is one family — the Shuklas — from the moment the
doctor's slip leaves the clinic to the day Parcha is in every home like theirs.

| Speaker | Part | Time | Scores |
| --- | --- | --- | --- |
| **Priyam** | The problem — Dadi, and the 36.8% | 1:15 | Problem & Value (10) |
| **Shikhar** | The app, live — then how it thinks, and what it refuses to do | 2:45 | Innovation (5), AI/Agent (5), Demo (5) |
| **Bhanu** | Who it reaches, how, what it changes, what comes next | 1:00 | Problem & Value (10), again |

Problem & Value is 10 of 25 marks — so it is said **twice**: Priyam opens with
the problem, Bhanu closes with the value. Shikhar's whole demo is the bridge.

---

## 1 · Priyam — the problem (1:15)

> *(Hold up a real doctor's slip, or show it on the slide.)*
>
> This is Prabha Devi. She's 71. Everyone in her house calls her Dadi.
>
> Last week her doctor wrote her three medicines on a slip like this one. By the
> time she got home, it was three names she couldn't read, and a "1-0-1" that
> meant nothing to her.
>
> Her son Prashant was at work. He had no idea whether she'd taken the 8 o'clock
> one. He still doesn't. He calls, she says "haan, le li". Neither of them really
> knows.
>
> Now here's the part that surprised us. Everyone assumes the problem is the
> doctor's handwriting. A hospital in Kolkata checked 380 prescriptions. **96%
> were perfectly legible.** And still — **36.8% of patients did not understand
> what they'd been given.** Only 40% got *how many times a day* right.
>
> *(pause)*
>
> The prescription was fine. **Everything after it failed.** And it fails worst
> for exactly the people who take the most medicines — the elderly, women,
> people who don't read English.
>
> When those patients were asked what would help, they asked for two things:
> *say it in our language, and show us pictures.*
>
> Every app out there is building a better desk for the doctor. Nobody is
> building for Dadi — at home, at 8 p.m., holding a strip of tablets she
> can't read.
>
> So we built Parcha. **Parcha is everything after the prescription.**
> Shikhar — show them what happens when Dadi's slip comes home.

*Source for the slide (small type): Indian Journal of Pharmacology, 2025 — 380
OPD prescriptions, Kolkata.*

---

## 2 · Shikhar — the app, live (2:45)

### 2a · The Parcha comes home (0:45)

> *(Tablet in hand, demo family 9811044321 — the Shuklas.)*
>
> Dadi's slip just came home. Prashant opens Parcha. First question: *is it
> printed?*
>
> It is — so he photographs it. The phone reads the medicine names **and the
> times printed beside them, on the phone itself.** Nothing is uploaded.
>
> Now look at this screen. **A person confirms every single medicine.** If no
> time was printed or said, the time stays *empty*. Parcha never invents a time —
> because a wrong time on a medicine is worse than no time at all.
>
> Then — and this is the bit nobody else does — **he photographs each strip,
> front and back.** Because Dadi doesn't know "Metoprolol". She knows *the white
> strip with the blue writing.* Then the schedule is **locked** — on our server,
> not just on the phone.

### 2b · The dose arrives (0:45)

> It's 8 o'clock. Dadi's card shows up — **the photo of her own strip on top.**
> Two buttons: *Taken*, or *Not taken* — and if not, she's asked again in 30
> minutes.
>
> This is Dadi's screen. *(Tap — it speaks in Hindi.)* It tells her, in Hindi,
> in a woman's voice, when her next medicine is. Huge buttons. And two that
> never scroll away: **Message family** and **Call.**
>
> *(Record.)* "Safed wali goli khatam ho gayi hai." — She hears it back before
> it's sent. Dadi can't type. Now she doesn't need to.
>
> On Android, the reminder can even ring **like a phone call**, with three
> answers in Hindi: *haan, le li · nahi li · sandesh record karein.*

### 2c · The family sees (0:20)

> Prashant's phone, at work: *"Dadi took Metoprolol at 8:33."* *"Dadi sent a
> message."* Green, amber, red, across the week.
>
> But notice — **he can look, he can't touch.** Only Dadi can tick Dadi's
> doses. Her dignity stays hers. The family gets the truth, not a checkbox
> someone ticked for her.

### 2d · Ask — the AI, and where we refused to let it decide (0:55)

> Now the question every family has: *"Is this the right tablet? Has it
> expired?"*
>
> *(Ask → photograph a strip.)*
>
> Here's how Ask thinks, because this is the part we're proudest of. It's four
> steps, and **the model only does two of them.**
>
> **One — Gemini reads** the photo into a fixed shape: name, strength, expiry,
> and how sure it is.
> **Two — code decides.** Is this medicine on *her* Parcha? Has it expired? Plain,
> tested functions — not a model's opinion.
> **Three — Meko remembers** what she asked before, keyed by a salted hash,
> never her name.
> **Four — Gemini words the reply**, in Hindi, English or Hinglish, with a
> Listen button — under rules it cannot talk its way around.
>
> *(Answer appears.)* Her times. Her doctor. In her language.
>
> And the edge cases — this is where health apps hurt people:
>
> - **A blurry photo is refused on the phone**, before anything is sent. *(Show
>   it.)* We never read a photo hopefully.
> - A strip that's **not on her Parcha?** Code says *"Not on your Parcha — don't
>   take it until a doctor confirms."* Every time. The model can't soften it.
> - **Expired?** Code says *"do not take it."* Every time.
> - Ask *"what is this medicine for?"* — it refuses. **No advice to start, stop
>   or change a dose. Ever.** That's the doctor's job, not ours.
>
> Under the hood: React and Capacitor on Android, native Java for the call
> screen, every write re-checked on the server, an encrypted vault and an
> offline outbox on the phone, and **191 unit tests.** Everything you just saw
> is a real Galaxy Tab, against the live backend.
>
> So that's one Dadi, one family. Bhanu — how do we get this into a million
> homes like the Shuklas'?

---

## 3 · Bhanu — reach, impact, what's next (1:00)

> India has around **15 crore people over 60.** A huge share of them live with
> BP, sugar, or a heart condition — that means medicines every day, for years.
> And most of them have a Prashant: a son or daughter who worries from work, or
> from another city.
>
> That gives us our go-to-market. **Dadi is the user. Prashant is the buyer.**
> He's the one who installs it, sets it up from a photo, and checks the feed.
>
> We reach him at the three places a Parcha already passes through:
>
> 1. **The chemist counter** — every strip in this app came from one. A chemist
>    who hands over the strips can hand over Parcha with them.
> 2. **The clinic** — a doctor whose patients actually take their medicines
>    gets better follow-ups. We've already built the clinic side in our repo:
>    the doctor signs, and the printed slip carries the whole prescription in a
>    signed QR the phone verifies offline.
> 3. **The family WhatsApp** — one son installs it for Dadi, and shows his
>    cousins.
>
> **What changes:** the instruction reaches her in her language, with a picture
> of her own tablet — exactly what patients asked for. And the family stops
> guessing.
>
> And we'll be honest with you: **we haven't measured adherence yet.** There
> are no real users yet. Our first pilot measures exactly three things —
> doses ticked on time, missed doses caught by the family, and how many Parchas
> get set up start to finish.
>
> **What's next:** reminders on locked phones across Indian phone brands' battery
> savers; the calling agent that rings in her language; and ABHA, so Dadi's
> records can follow her to any hospital.
>
> *(Back to the slip.)* The doctor already wrote the prescription correctly.
> **Parcha makes sure it's followed** — and that the people who love her can see
> it was.
>
> We're Priyam, Shikhar and Bhanu. Thank you.

*Verify before the round: the "15 crore over 60" figure (India Ageing Report,
UNFPA 2023 puts it at ~14.9 crore in 2022). If you can't cite it, say "crores of
people over 60" instead.*

---

## The unique bits — say these, every one is ours

These are what nobody else in the market is doing. If you run short of time,
cut anything *except* these.

1. **The patient's own strip photo is the reminder** — not a drug name she can't read.
2. **No time is ever invented.** A blank stays blank until a person fills it.
3. **Only the patient ticks her own dose.** The family sees, never fakes it.
4. **Dadi speaks back** — a voice message to the family, no typing.
5. **AI reads, code decides.** "Not on your Parcha" and "expired" are said by code, not a model.
6. **An unclear photo is refused on the phone** — never read hopefully.
7. **It refuses to give medical advice** — never what a medicine is for, never start/stop/change.
8. **Printed slips are read on the phone** — nothing uploaded.

## Do not say

- **"It improves adherence."** Unmeasured. Say "a pilot will measure it."
- **"Nobody does reminders / OCR."** Many do. What's ours is the list above.
- **Demo the phone-call reminder live.** It's built, but not yet rung end to end
  — mention it, don't press it.
- **Doctor-voice / handwriting reading** (`hearInstructions`, `readHandwriting`)
  — only if it is committed and deployed before the round.
- **A price.** "We haven't priced it; the pilot tells us what Prashant will pay."

---

## Likely judge questions — who answers

| Question | Who | The answer, in one breath |
| --- | --- | --- |
| "Why not just use phone alarms?" | Priyam | An alarm says *ring*. It doesn't say *which tablet*, in Hindi, with its picture — and it doesn't tell her son she took it. |
| "What if Gemini misreads the strip?" | Shikhar | It returns how sure it is; a low-confidence read is said as unsure. And the decision — on her Parcha or not, expired or not — is code, not the model. |
| "What if the photo is blurry / dark?" | Shikhar | Refused on the phone before upload. Show `ask-refuses-unclear`. |
| "What does Meko store? Privacy?" | Shikhar | What she asked, keyed by a salted hash — never a name or phone number. The key lives only on our server. |
| "Can the family fake a 'Taken'?" | Shikhar | No — the server only accepts a tick from the person who takes the dose. |
| "What if there's no printed slip?" | Shikhar | Photograph the pharmacy bill and say what the doctor said; each medicine is still confirmed by a person. |
| "No internet?" | Shikhar | Doses tick offline and send later — an offline outbox on the phone. |
| "Who pays?" | Bhanu | The worried child — Prashant. Pricing comes out of the pilot, not a guess. |
| "How is this different from Practo / Eka Care?" | Bhanu | They build the doctor's desk and store records. We make the instruction usable inside the house — for the person taking the tablet. |
| "ABHA / Ayushman?" | Bhanu | Ayushman (PM-JAY) is insurance — no overlap. ABHA is the records rail: it moves records between hospitals. It doesn't move understanding into a home. We plan to connect to it. |
| "What's not working yet?" | Bhanu | Say it plainly: call-screen not rung end to end, locked-phone reminders on Android 14+ unproven, OEM battery savers untested, no real users yet. |

## Before you walk in

- Tablet charged, signed in to **9811044321**, Dadi's screen one tap away.
- A **real strip** in hand for Ask, and a deliberately **blurry photo** ready.
- Sound **on** — the Hindi voice is the moment the room remembers.
- Rehearse the three handoffs. The last line of each part is the first beat of the next.
