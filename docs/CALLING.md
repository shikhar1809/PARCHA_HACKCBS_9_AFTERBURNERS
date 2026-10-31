# The reminder calling agent

An older patient may not read a screen or feel a buzz in a pocket, but answers
a phone. When a patient switches calls on, Parcha phones their number at the
time of each medicine, says what to take, and asks for one key press.

> **Status.** The whole loop runs end to end in the emulator on a **demo phone
> line** (no real call is placed; the app shows buttons for the key presses).
> The **Twilio adapter is written but has not been tried against a live
> account** in this repository. Treat it as ready to test, not as proven.

## What a call is

- It goes **only to the number the patient signed in with**. No request can
  name another number, so the system cannot be made to phone strangers.
- It needs a **recorded consent** (the wording and its version are stored). It
  respects **quiet hours** (default 22:00 to 06:00) and is capped at **12 calls
  a day** per phone.
- One call per time of day, however many medicines are due then.
- Said in **Hindi or English**, from fixed scripts (`packages/core/src/calls.ts`).
  No model writes the words: a medicine reminder is the wrong place for text
  that varies.

> "Hello, this is Parcha with your medicine reminder. It is 2 pm. It is time to
> take for Ramesh: Paracetamol and Metformin. If you have taken it, press 1. To
> be reminded again in ten minutes, press 2. Thank you."

| Press | What happens |
| --- | --- |
| **1** | The doses are ticked off in the app. |
| **2** or no key | Asked again once, ten minutes later. |
| No answer, busy | Asked again once, ten minutes later. |
| Second attempt unanswered | Left alone; shown as "No answer" in the app. |

Doses ticked in the app between the two attempts are not asked about again.

## How it runs

```
every minute:  dispatchReminderCalls   (Cloud Scheduler, production)
               runCallDispatcher       (same code, by hand, for the emulator)
                  for each patient with calls on:
                    work out doses due now (same rules as the in-app schedule)
                    skip ticked doses and quiet hours
                    create one call job (the id says which call it is, so a
                      second run can never place the same call twice)
                    place it through the provider
provider:      mock    - the default, and the only one in the emulator
               twilio  - real calls
webhook:       callWebhook  - the provider reports a key press or a hang-up
```

Locally, run the dispatcher every 30 seconds with
`node scripts/dispatch-calls.mjs`.

## Calls to a family member's own phone

A person who needs help but has a phone of their own can get the reminder calls
on it. In the profile editor, enter their number; we call it and read a
four-digit code; typing it back proves the number is theirs (a code lasts ten
minutes, and five wrong guesses lock it). Until then their calls keep going to
the account's own number. When they press 1, the dose is ticked off for the
whole household. The demo phone line shows the code on screen instead of ringing.

## Turning on real calls

```
CALL_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+1...            # a number on your account (or a verified caller ID on a trial)
TWILIO_WEBHOOK_URL=https://<where callWebhook is served>   # the exact address, no query string
TWILIO_VOICE=Polly.Aditi     # optional; speaks Hindi and Indian English
SWEEP_KEY=...                # protects the by-hand dispatcher
```

Check the account first:

```bash
TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+1... node scripts/twilio-check.mjs
# to hear the voice (this places a real call):
... node scripts/twilio-check.mjs --call +91XXXXXXXXXX
```

It confirms the account, that the number is yours, and that voice calls to India
are enabled.

To try the whole loop from a laptop, expose the functions emulator with a tunnel
(for example ngrok), set `TWILIO_WEBHOOK_URL` to the tunnel address of
`callWebhook`, set the Twilio variables before starting the emulators, and run the
dispatcher. **Twilio's signature covers the exact URL it called, so
`TWILIO_WEBHOOK_URL` must match what Twilio was given, character for character.**

The webhook verifies that signature on every request and refuses anything that
does not match. On a trial account Twilio can only call numbers you have verified
in its console.

## Before real patients get real calls

1. **Indian telecom rules.** Automated calls to Indian numbers go through TRAI
   regulations (registered sender, DLT templates, the do-not-call register).
   A calls provider with Indian numbers and DLT support (Exotel, Plivo,
   Twilio with Indian routing) is likely needed; the adapter is the only part
   that changes. Get this checked by someone who knows it.
2. **Cost.** Voice minutes cost money per call. The daily cap bounds one
   patient; decide who pays before opening it up.
3. **Evidence.** Studies of automated voice reminders in India are mostly
   among young urban HIV patients ([source](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3428344/));
   there is little for older people on chronic medicines. Measure doses taken
   with and without calls in a pilot before claiming an effect.
4. **Dispatcher scale.** It reads up to 500 opted-in phones a run. Past that it
   needs to be sharded by phone number.
