# What clinics and patients actually complain about

**How this was gathered, and what it is not.** Reddit is blocked for the search
tool used here, so there are **no Reddit threads** in this document, and I could
not install or run a commercial hospital system to test Parcha against it. What
follows comes from independent studies, audits, and review sites that could be
reached. Review pages for Indian clinic software are thin (single digits of
reviews), so some points rest on one source and are marked as such. Treat it as a
starting hypothesis to confirm with real doctors, not as proof.

## The complaints, and how Parcha answers each

| # | Complaint | Evidence | Parcha today |
|---|---|---|---|
| 1 | **Too many clicks and slow screens.** Simple tasks take many steps; moving between screens is slow. | A US physician quoted in *The Hospitalist*: "33 clicks to order and record a flu shot" ([source](https://blogs.the-hospitalist.org/content/10-ways-ehrs-lead-burnout)). 58% of physicians dissatisfied with system speed ([source](https://centerforhealthjournalism.org/our-work/insights/why-electronic-medical-records-are-disaster-some-docs)). An Indian vendor describes "clunky" screens that need several clicks ([source](https://tatvacare.in/blogs/clinic-burnout-is-real-heres-how-emr-can-help-without-getting-in-the-way-2)). | One visit is a short path: look up by phone, start, intake, consult, sign, print. Medicines are found by typing three letters (typo-tolerant) or dictating. Still to measure with a stopwatch on real staff. |
| 2 | **Documentation eats the doctor's time.** | 80% of physicians say documentation impedes care; 1.8 hours a day outside office hours ([source](https://www.aafp.org/pubs/fpm/blogs/inpractice/entry/amia-survey.html), [source](https://medicaleconomics.com/view/physicians-say-documentation-burdens-are-impeding-patient-care)). | Dictation and fuzzy search fill the line; the doctor ticks five facts instead of typing them. Diagnosis and advice are still typed. |
| 3 | **Weak internet and downtime break the day.** | Indian rural-hospital doctors name unreliable internet a top barrier ([source](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12087044/)); a Malaysian hospital's EMR slowed clinics because of slow internet ([source](https://codeblue.galencentre.org/2023/02/13/once-flagship-selayang-hospitals-emr-system-now-busted/)). | Live listeners retry and say when the network is gone. **Not yet offline-first:** a dropped connection stops writes. This is the largest real gap. |
| 4 | **Small providers have no IT staff and little budget.** | Lack of IT staff, staff, and money rank as the main barriers; 75 primary health centres: none prescribed through an EMR ([source](https://doaj.org/article/ff817ec8b0a24550b96bb25343ee9c5d)). | The Team page lets a non-technical admin add people and wire them. No installation. No pricing yet. |
| 5 | **Doctors adopt when they see a clear benefit.** | Perceived benefit is the strongest predictor of using e-prescriptions ([source](https://www.amrita.edu/publication/physicians-attitudes-toward-e-prescription-in-kerala-facilitators-barriers-and-insights/)); 93% of doctors surveyed wanted an EMR. | This is why the wedge is the doctor's own day (queue, dictation, printed prescription), not a records system for its own sake. |
| 6 | **Patients crowd waiting rooms and cannot step out.** Token roll, register, a wall display that shows the current number, not the wait. | Indian queue-tool vendors name it the biggest clinic-review complaint ([source](https://richautomate.in/blog/whatsapp-queue-management-token-system-india-2026)) (vendor claim). | Patients see their stage on their phone. **No live "your turn is in about N minutes" yet.** |
| 7 | **Long waits, very short consultations, no staggered scheduling.** | 62% waited over 30 minutes; most consultations five minutes or less, in J&K tertiary hospitals ([source](https://www.dailyexcelsior.com/cag-flags-long-waits-short-consultations-in-jk-opds/)). Crowds arriving at 7 a.m. for lack of staggered appointments ([source](https://thebhutanese.bt/jdwnrh-needs-to-reduce-waiting-time-in-opd-and-diagnosis-services-raa-report/)). | Pre-visit requests are booked into slots, which spreads arrivals. |
| 8 | **No-shows.** Patients forget and do not cancel. | 22% no-show with appointments at one hospital; forgetfulness and no reminders the top reasons ([source](https://thebhutanese.bt/health-minister-says-people-still-not-following-the-appointment-system-of-jdwnrh/), [source](https://www.ijcmph.com/index.php/ijcmph/article/download/15981/9477/81235)). The effect of reminders alone was not significant in one study, so measure it. | Reminders in the app, and a **calling agent** (see `docs/CALLING.md`). |
| 9 | **Reminder channel matters: phone calls beat SMS for some patients.** | Patients in India preferred IVR calls to SMS; an automated call plus a picture SMS raised optimal adherence from 85% to 91% in a Bangalore cohort ([source](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3428344/)). Evidence is from young urban HIV patients, not older chronic-disease patients. | Calls are the chosen channel. Efficacy for older patients is unproven; a pilot should measure it. |
| 10 | **Feature gaps and cost in the incumbent.** No WhatsApp integration, basic features cost extra. | A 2022 review of Practo Ray, 3 of 5 ([source](https://www.capterra.com/p/167778/Ray/reviews/)) (one review). | Nothing paid is gated. WhatsApp is not integrated. |

## What this changes

1. **Offline tolerance is the first engineering priority**, not a polish item: the
   most repeated complaint in India is connectivity, and the app currently needs
   it to write. (Capturing a visit locally and syncing later is the real fix.)
2. **Wait time, not just stage.** Show patients an estimate, and stop them
   standing in the room.
3. **Cut taps, then prove it.** Time a front-desk person and a doctor on a real
   visit and record taps per task, before and after.
4. **Pharmacy and billing are dropped.** None of the evidence above asks for
   them in a small OPD; the printed prescription is the hand-off.

## What I could not do

- Reach Reddit; I have no thread-level quotes.
- Run any commercial HMS (Practo Ray, DocPulse, Healthplix, a hospital HIS).
  A like-for-like test needs access to those products, or real staff who use them.
- Verify vendor claims (queue tools, no-show rates quoted in vendor blogs).
