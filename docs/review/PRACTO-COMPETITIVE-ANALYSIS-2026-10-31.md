# Parcha versus Practo

Research date: 31 October 2026. Focus: Indian outpatient clinics and the prescription-to-home workflow.

## Assessment

Parcha's strongest competitive hypothesis is a prescription that a family can understand and act on: pictures, spoken Hindi/English/Hinglish, individual profiles on a shared phone, and a schedule derived from the signed prescription. Practo has a much broader established offering across care discovery, clinic operations, digital records, and follow-up communication. Parcha should prove a specific improvement in comprehension and everyday use before claiming superiority.

The immediate comparison is Parcha versus **Practo Ray plus the relevant patient experience**. Practo's directory, Prime, Consult, and Insta are separate products or services; comparing all of them with Parcha's clinic app alone would mix different buying decisions. Practo describes these product boundaries in its [official FAQ](https://help.practo.com/practo/practo-faq/).

Evidence limits: Parcha was assessed from this working tree, including documentation and selected source files; no new application tests were run for this analysis. Practo was assessed from official public pages and indexed official-page content, without a paid account or hands-on trial. Some help articles describe older releases. “Not verified” means this research did not establish the capability, not that Practo lacks it. Pricing is an indexed public snapshot, not a sales quote. Several direct product-page fetches returned HTTP 403.

## Comparison

| Dimension | Practo evidence | Parcha evidence | Competitive implication |
| --- | --- | --- | --- |
| Patient acquisition | Directory/profile, Prime, and online consultation products are documented. [FAQ](https://help.practo.com/practo/practo-faq/) | Booking and routing exist, but the README says there are no real users and nearby real hospitals do not receive demo requests. | Practo has the stronger acquisition proposition. Parcha cannot promise new patients from its current network. |
| Clinic operations | Ray publishes scheduling, charting, billing, communication, and reports. [Plans](https://www.practo.com/providers/clinics/ray/plans) | Registration, intake, queues, prescribing, pharmacy, billing, roles, and team messaging are implemented. | Much of this is necessary competitive coverage. Feature presence alone does not establish a reason to switch. |
| Prescription creation | Templates, dosage instructions, printing, and SMS/email delivery are documented. [Prescriptions](https://help.practo.com/practo-ray/emr/using-automated-prescriptions/) | Reuse, medicine search, dictation, signed QR handoff, and printing are documented. | “Digital prescriptions” is shared capability. Measure completion time and corrections on equivalent tasks. |
| Medicine catalogue | Practo describes almost 100,000 drug, brand, and salt-name entries. [Catalogue](https://help.practo.com/practo-ray/emr/global-drug-catalogue/) | A curated demo formulary and manual medicine entry; the seed explicitly disclaims a clinical decision-support database. | Practo has the stronger published catalogue breadth. Parcha needs maintained terminology and a clear coverage boundary. |
| Prescription checks | An equivalent set of interaction, dose, age, pregnancy, and vital checks was not verified in the reviewed sources. | Deterministic checks and acknowledgement of high flags are documented; coverage depends on curated rules and supported inputs. | Demonstrate the actual checks. Do not claim Parcha is clinically safer than Practo without comparative validation. |
| Understanding at home | Practo documents patient education and treatment communications; equivalent pictorial, spoken, shared-phone instruction workflows were not verified. [Treatment communications](https://help.practo.com/practo-ray/calendar/ray-7-treatment-communications/) | Pictures, read-aloud instructions, easy mode, and family profiles are central to the patient app. | This is Parcha's clearest differentiation hypothesis; it needs usability evidence. |
| Language | Practo documents local-language SMS, including Hindi, with patient-specific selection. [Languages](https://help.practo.com/practo-ray/communication/sms-in-local-languages/) | Patient screens, speech, schedules, and notifications follow each person's Hindi, English, or Hinglish preference. | Compare the scope of the language experience. “Practo is English-only” is false. |
| Reminders | Practo documents medicine, test, and follow-up reminders and educational plans; current plan availability needs confirmation. [Treatment communications](https://help.practo.com/practo-ray/calendar/ray-7-treatment-communications/) | Dose logs, notifications, and a consent-based calling flow; real Twilio delivery remains unproven in the README. | Reminder existence is shared. Test whether Parcha's presentation, family use, and delivery improve use. |
| Offline | Ray's mobile help documents scheduling, contacts, records, and later sync; it specifies read-only iOS access and online-only bill creation/payment collection. [Offline help](https://help.practo.com/practo-ray/app/how-to-access-ray-offline/) | Clinic documentation covers local registration through prescribing and printing, with queued sync. Separate offline computers cannot exchange work. | A potential distinction is the specific clinic prescribing/printing workflow. “Only Parcha works offline” is false. Verify current Ray behaviour in a trial. |
| ABDM/ABHA | Practo advertises Ray's ABDM integration and record linking/sharing. [ABDM](https://www.practo.com/providers/abdm) | STANDARDS.md explicitly says Parcha is not connected yet. | Practo has an integration advantage. A planned FHIR mapping is not a working integration. |
| Security and trust | Practo publishes security and data-ownership assurances. [ABDM page](https://www.practo.com/providers/abdm) | Tenant boundaries, server-controlled clinical writes, local storage, audit trails, and encrypted staff messaging are documented. | Compare concrete controls and verified operations. This review establishes no overall security winner. |
| AI | Practo announced investment across care navigation and provider tools in March 2026. [AI announcement](https://blog.practo.com/welcoming-cijo-george-to-lead-practos-ai-charter/) | Local recognition/OCR and clinician-reviewed assistance are present; optional Meko work also exists in the working tree. | “We use AI” is weak positioning. Compare the task completed, error handling, privacy, and doctor review. |
| Deployment maturity | Public subscriptions, training/support, and migration assistance are offered. [Plans](https://www.practo.com/providers/clinics/ray/plans) | The README describes no real users, untested live calling, and an Android build not yet device-tested. | Parcha's implementation is substantial, but its operating evidence is early. Onboarding and reliability matter as much as features. |

Parcha sources: [README](../../README.md), [patient app](../PATIENT-APP.md), [clinic app](../CLINIC-APP.md), [offline](../OFFLINE.md), [safety engine](../SAFETY-ENGINE.md), [calling](../CALLING.md), [standards](../STANDARDS.md), and [demo formulary](../../packages/core/src/demo/formulary.ts).

## Pricing and buying decision

The indexed [official Ray plans page](https://www.practo.com/providers/clinics/ray/plans), retrieved on the research date, displays:

| Plan | Displayed monthly equivalent | Displayed term | Subscription arithmetic |
| --- | --- | --- | --- |
| CM Atom | INR 999 | 1 year | INR 11,988 for 12 months |
| Clinic Management | INR 1,499 promotional figure | 1 year | INR 17,988 for 12 months |
| Clinic Management | INR 999 promotional figure | 4 years | INR 47,952 for 48 months |

These totals are multiplication of the advertised monthly equivalents, not verified invoice amounts or payment schedules. The page also shows INR 1,999 reference figures. Confirm tax, offer eligibility, renewal, messaging allowances, payment charges, and current terms in a written quote. Do not treat marketplace products as included in the Ray subscription.

Parcha's pitch discusses INR 999/month, while its README does not establish a commercial plan. At that proposed price, Parcha matches Ray's displayed entry rate. A claim that it is cheaper is unsupported. Call delivery, onboarding, support, storage, and messaging costs must be included in a Parcha pricing model.

Recommended commercial hypothesis: charge the clinic for an understandable prescription handoff and follow-up workflow, with family access included; separately define any paid calling allowance. Test willingness to pay with clinics before presenting this as an established model. A clinic with adequate patient demand and a recurring instruction problem is a more plausible first buyer than one buying software primarily to acquire patients.

## Where to compete first

Recommended initial segment, as a hypothesis: independent general-medicine clinics with repeat outpatient visits, Hindi/Hinglish-speaking households, older patients, and limited staff. Validate that prescription explanation and caregiver coordination consume enough time or create enough confusion for the clinic to pay.

Parcha's proposed value to the doctor is less repeated explanation and an efficient prescription handoff. Its value to the patient and caregiver is knowing whose medicine to take, how much, and when. The buyer and beneficiary are different people; the pilot must demonstrate value to both.

Avoid making national doctor discovery, teleconsultation breadth, or a complete hospital system the first contest. Those would require network, operating, and product breadth that Parcha has not demonstrated. A companion handoff product for clinics using other systems is worth investigating, but no Practo integration or reliable import path was verified; it is a product experiment rather than a present capability.

The long-term defensibility would come from observed household usability, reliable prescription-to-schedule conversion, clinic adoption, and measured outcomes. Pictures, reminders, and offline storage can be copied. They are useful features, not an established moat.

## Claims to revise in existing pitch material

The following are recommendations; this analysis does not edit the existing pitches.

| Existing claim or implication | Finding | Defensible replacement |
| --- | --- | --- |
| “When the visit is over, Practo's job is finished” in MENTOR-STORY.md | Contradicted by published treatment communications. | “Parcha concentrates on helping the household understand and follow the prescription after the visit.” |
| “The only one treating the patient's grandmother as a user” | Exclusivity is not established by this comparison. | “Parcha explicitly designs for older patients and caregivers using a shared phone.” |
| “The only one that moves a prescription without needing the internet” in JUDGE-PITCH.md | Exclusivity unproven; Ray documents offline mobile operations, although this does not establish equivalent offline prescription transfer. | “Parcha documents an offline clinic prescription workflow and a self-contained QR handoff.” |
| “We are cheaper” at INR 999/month | Same as Ray's displayed entry monthly equivalent. | State a proposed price and included services, then show the customer's full cost for both products. |
| “A prescription in 30 seconds” | Product target; no real-clinic timing study identified. | “Designed to shorten prescription creation; timing will be measured in the pilot.” |
| “We are safer” or “fully compliant” | Comparative safety and compliance not established. | Describe specific checks, limits, and implemented controls. |

References: [mentor story](../pitch/MENTOR-STORY.md) and [judge pitch](../pitch/JUDGE-PITCH.md). The older [RESEARCH.md](../RESEARCH.md) also describes offline writes as unbuilt and pharmacy/billing as dropped; those statements conflict with newer app documentation and should not be reused as current product status.

## What to prove next

Suggested sequence for the next 90 days; these are research targets, not forecasts or achieved results.

1. **Days 1–15: establish a fair baseline.** Interview 5–10 clinics and 10–15 patient/caregiver pairs, including current Ray users. Observe prescription creation and explanation. Trial current Ray on matched tasks, particularly offline prescribing, patient language options, medication reminders, and exports. Confirm current pricing directly.
2. **Days 16–30: establish pilot readiness.** Resolve correctness, privacy, and offline durability issues with evidence. The 29 October project review reports findings; some files have since changed, so recheck each finding rather than assuming it is still open or already resolved. Test Android notifications and live calls on real devices, and establish maintained medicine/rule coverage. ABDM integration should be prioritized according to the chosen clinics' requirements.
3. **Days 31–60: run a narrow supervised pilot.** Start with 3–5 clinics and approximately 50 households if recruitment permits. Compare with each clinic's actual current process. For shared-phone and elder workflows, observe use directly rather than relying only on staff opinions.
4. **Days 61–90: decide from adoption and payment evidence.** Assess repeat clinic use, household comprehension, support burden, and willingness to pay. Expand only when the workflow is reliable and clinics choose to keep using it.

| Question | Measure | Interpretation |
| --- | --- | --- |
| Is prescribing faster? | Median and 90th-percentile time from opening the prescription to signing, with corrections and task complexity recorded | Test the 30-second target against an equivalent baseline; speed must not hide errors. |
| Do families understand it? | Unprompted teach-back of medicine identity, amount, timing, and duration immediately and after 48 hours | A proposed early gate is at least 90% correct answers on the predefined questions; this is a usability target, not a clinical benchmark. |
| Does the handoff work? | QR scan success, correct-person selection, schedule correctness, and successful use on low-end/shared phones | Count staff assistance and failed attempts, not just completed scans. |
| Does offline use hold up? | Full visit on one offline device, process restart, print, reconnect, and reconciliation; separately test two disconnected devices | Demonstrate persistence and accurate sync. A local optimistic success is insufficient. |
| Do reminders reach people? | Notification/call delivery, acknowledgement, opt-out, and family confusion | Self-reported “taken” events do not prove ingestion or improved clinical outcomes. |
| Is there a business? | Continuing weekly clinic use, paid conversion, onboarding time, support time, and total cost per clinic | Determine whether the value pays for reliable delivery and service. |

Pilot-readiness context: [project review, 29 October](PROJECT-ANALYSIS-2026-10-29.md). This competitive analysis does not re-audit or reproduce those findings.

## Suggested answer to “Why Parcha instead of Practo?”

> Practo covers doctor discovery and clinic management, and it also offers reminders and follow-up communication. Parcha focuses on a specific household workflow: turning the doctor's signed prescription into pictures, spoken instructions, and a personal medicine schedule for a family sharing a phone. Our next step is to prove that this helps people understand their medicines while fitting into the clinic's day.

This positioning describes the intended advantage without claiming exclusive features, lower cost, validated adherence gains, or production readiness.
