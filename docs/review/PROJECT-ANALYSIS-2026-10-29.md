# Parcha project analysis

Reviewed 29 October 2026. This is a source and configuration review with local builds, automated backend tests, and targeted emulator probes. It is not a clinical validation or a certification of a live deployment. No application source was changed.

## Assessment

Parcha has a coherent product and a substantial implementation: the clinic-to-family handoff is represented by a shared state machine, the backend owns clinical writes, and the patient experience includes language, accessibility, family, and connectivity needs. The main work before a real patient pilot is correctness and operational hardening, especially prescription validation, safety arithmetic, offline durability, and privacy completeness.

The repository uses Vite and React, not Next.js. The Next.js block in AGENTS.md and the Supabase/Next variables in .env.example are migration leftovers.

## Architecture and data flow

| Layer | Responsibilities | Main locations |
| --- | --- | --- |
| Clinic web | Registration, intake, queues, consultation, prescribing, pharmacy, billing, team, management, messaging | apps/clinic |
| Patient web/PWA | Family identity, booking, prescriptions, schedules, records, consent, local OCR, notifications | apps/patient |
| Android | Capacitor wrapper, native notifications, speech and haptics | apps/patient/android |
| Desktop | Sandboxed Electron wrapper, local packaged app, printing, Windows location bridge | apps/desktop |
| Shared domain | Stages, roles/abilities, safety, formulary, schedules, dictation, hospital selection | packages/core |
| Shared client | Firebase setup, scoped subscriptions, mutations, encrypted vault, offline queue, messaging encryption | packages/client |
| Shared interface | Theme, common visual components, dose pictograms, printed prescription | packages/ui |
| Backend | Callable writes, sessions, routing, safety context, reminders, privacy and administrative functions | firebase/functions/src |
| Persistence/access | Firestore collections and subcollections, custom claims, security rules, indexes | firestore.rules, firestore.indexes.json |

The patient requests a visit; the desk proposes or books a doctor; the doctor accepts; the desk checks the patient in and records intake; the assigned doctor consults and signs. The shared sequence is requested → proposed → scheduled → registered → intake_complete → in_consultation → prescribed, with cancellation and specific desk booking shortcuts. Pharmacy and billing happen after signing without extending the clinical stage sequence.

Clients subscribe directly to Firestore. Clinical mutations go through Functions, whose Admin SDK bypasses Firestore rules; server guards and transactions therefore carry the write authorization. Staff messaging is an intentional direct-write exception governed by rules. Each staff identity has a hospital claim, abilities, and an active session. Patient access is primarily tied to the authenticated phone number, including all family members recorded under that number.

Clinical history is stored beneath visits/patients, with denormalized summaries for queues. The patient also has private documents, profiles, reminders, dose logs, histories, call settings and consent records. The encrypted vault mirrors reads and retains queued actions; Firestore independently maintains its persistent local cache.

## What is implemented well

- Shared pure domain logic gives the client and server the same stage and safety rules.
- Stage transitions re-read state in transactions, enforce hospital boundaries and assigned doctors, and leave stage events.
- The server reruns safety checks and requires acknowledgement of high severity flags before signing.
- Clinical client writes are denied by default; personal papers are separate from clinic-readable clinical records.
- Seat abilities support small clinics and several roles per staff member. Management adds a PIN-issued pass and protects the last manager.
- Offline clinical failures remain visible for human attention instead of being silently discarded.
- Patient wording, Hindi/English/Hinglish, dose pictograms, easy mode, accessibility preferences and local OCR form a consistent product direction.
- Messaging implements per-device ECDH, HKDF and AES-GCM, with non-extractable private keys and safety-code comparison. This is a meaningful implementation, although it has not received an independent cryptographic audit.
- Both apps compile, and CI includes unit, build, type and emulator integration checks.

## Priority findings

### 1. High: duplicate medicine lines bypass aggregate dose checking

Evidence: packages/core/src/conflicts.ts:123 and :257.

The engine deduplicates prescription items by drugId before its dose rules. The backend accepts multiple lines for the same drug. A local probe supplied two paracetamol lines, each calculating to 3,000 mg/day. The combined 6,000 mg/day exceeds the engine's configured 4,000 mg/day threshold, but the engine returned no flags. The signing Function accepted the same payload without an acknowledgement.

Reject duplicate drug lines or combine all relevant amounts before calculating dose exposure. Add server-level regression coverage, including differing strengths and schedules. Ingredient overlap in combination products needs a separate explicit policy.

### 2. High: signing accepts malformed schedules and inconsistent drug identity

Evidence: packages/core/src/items.ts:129; packages/core/src/items.ts:49; packages/core/src/special.ts:196; firebase/functions/src/index.ts:375.

validateItem only requires a nonempty frequency; it accepts "nonsense" and a five-slot pattern. It does not enforce a complete runtime shape for form, strength, quantity, or drug identity. dosesPerDay does not normalize BD/OD shorthand, so BD passes validation but yields no numeric daily dose. The server checks that drugId exists, but retains the client-provided name and other presentation fields.

A targeted emulator call successfully signed a known drugId with an unrelated displayed medicine name and frequency "nonsense". This makes the printed medicine and the medicine checked by the safety engine disagree.

Introduce strict runtime request schemas. Normalize supported schedules on the server, reject unsupported patterns, resolve known medicine identity from the formulary, and explicitly flag any dose that cannot be checked. Preserve intentional manual medicines through a distinct validated path.

### 3. High: export and account deletion omit patient profiles

Evidence: firebase/functions/src/privacy.ts:45 and :99; firebase/functions/src/profiles.ts:24.

Profiles hold names, ages, helper details, accessibility preferences and verified call numbers. exportMyData never includes profiles, and deleteMyData never deletes them. A local probe created a profile, exported and deleted the account: the export had no profiles field and the profile document remained afterward.

Use a single ownership inventory to drive export and erasure. Include profiles, verification records and granted access where applicable. Keep the intended clinical-retention exception explicit and separate. Add a regression that checks every patient-owned collection.

### 4. High: hosted patient camera scanning is blocked by configuration

Evidence: firebase.json:161 and :247; apps/patient/src/components/QrScanner.tsx:40.

The patient hosting targets send Permissions-Policy with camera=(). QrScanner depends on getUserMedia, so the configured hosted web application cannot open its camera even if the user wants to allow it. Choosing a photo remains a fallback.

Allow same-origin camera access on patient targets and verify the actual response headers and scan flow in a deployed browser. This finding follows the checked-in configuration; live headers were not inspected.

### 5. High: the encrypted-copy claim excludes Firestore's persistent cache

Evidence: packages/client/src/firebase.ts:75; packages/client/src/vault.ts:133; apps/patient/src/components/privacy.tsx:149.

AES-GCM protects the custom vault, but Firebase also persists clinical document data through persistentLocalCache. That separate store is outside the custom vault's encryption and clearing path. "Clear this copy" calls vaultClear only; no Firestore persistence-clearing path was found. User-facing statements that the phone's copy is locked and cleared therefore describe only part of the storage.

Choose one documented storage and retention model. Either use the encrypted vault with a memory-only Firestore cache or implement explicit clearing and protection for both stores. Check sign-out, account deletion, shared-device use and multiple tabs. A non-extractable browser CryptoKey alone should also not be presented as a guarantee against an attacker copying a browser profile.

### 6. High: an offline action can appear saved without durable storage

Evidence: packages/client/src/outbox.ts:139; packages/client/src/vault.ts:85.

callQueued updates the in-memory queue and returns an optimistic success after vaultPut. The vault intentionally swallows IndexedDB, encryption and quota errors. If persistence fails, the UI can say an offline registration or signature is saved, while reloading loses it.

Make durable clinical queue writes return a confirmed transaction outcome. If persistence is unavailable, explain the failure before reporting success. Test quota failure, blocked storage and process termination. Also preserve user/account scope during asynchronous flushes.

### 7. Medium: idempotency is not atomic with the clinical action

Evidence: firebase/functions/src/guards.ts:171; firebase/functions/src/index.ts:102 and :147.

once reads opLog, performs work, then stores the result in a separate write. A crash after the clinical write but before the log write can cause a retry to execute again. Simultaneous workers can both miss the log. startVisit also checks for an existing open visit outside the creation transaction. Client ID availability is checked before an unconditional set.

The existing tests establish sequential replay. A six-request local concurrency probe did not reproduce duplicates; this does not remove the separate-write failure window.

Commit the operation result and domain changes together where feasible, or use deterministic operation-owned documents with transactional preconditions. Include function/action identity and a request hash in the idempotency contract. Test failure immediately after the domain commit and concurrent requests across workers.

### 8. Medium: hospital handoff drops known allergy context

Evidence: firebase/functions/src/routing.ts:88; firebase/functions/src/previsit.ts:650.

ensurePatientAt creates a fresh file at the next hospital without the source allergies and returns hasAllergy=false. The safety check then reads only that hospital's file. This limitation is acknowledged in the architecture document, but it weakens the product's safety story during automatic routing.

Define an explicitly consented, provenance-preserving handoff for patient-reported allergies, or require reconciliation before prescribing. Also review age propagation: statedAgeYears is copied into visits and new hospital files without applying the elapsed time recorded by ageStatedOn.

### 9. Medium: reminder dispatch silently excludes users after the first 500

Evidence: firebase/functions/src/calls.ts:256.

Each scheduled run queries enabled callSettings with limit(500), without pagination or a rotating cursor. With more than 500 enabled accounts, subsequent accounts can remain outside every run. Per-account reads and call placement are also sequential under a 120-second scheduled timeout.

Page through a bounded checkpointed workload or create per-due-time jobs processed by workers. Record queue lag and skipped/deadline-missed calls. Scale tests should cover more than 500 eligible accounts.

### 10. Medium: capacity documentation materially overstates current settings

Evidence: firebase/functions/src/options.ts:34; firebase/functions/src/tokens.ts:14; docs/ARCHITECTURE.md:121.

The architecture describes 20 instances × 80 concurrent requests = 1,600 requests in flight per Function. The checked-in global configuration is maxInstances=5 and concurrency=1: five requests in flight per default Function. Overrides exist for selected jobs. Registration also increments one token document per hospital/day, which is a contention point absent from the "no shared hot spot" discussion.

The architecture still lists scheduling the overdue sweeper as future work, but moveOverdueRequests is already an onSchedule Function. Rewrite capacity claims around the deployed settings and use staging measurements before making throughput promises.

### 11. Medium: dependency advisories need targeted triage

The npm audit snapshot reported 39 affected dependency entries: 1 critical, 21 high, 12 moderate and 5 low. These are dependency-tree findings, not 39 demonstrated application exploits. The critical entry was transitive tar; high findings include Electron/build tooling and Firebase dependencies.

Determine which paths ship in browser/native/server artifacts, prioritize the old Electron runtime and reachable server dependencies, and verify compatible upgrades. Some suggested fixes are major changes or apparent downgrades; do not apply npm audit fix --force indiscriminately.

## Other limits and maintenance work

- Family identity remains phone-based. The person picker is a usability boundary; the rules let that phone access all associated family records. Per-adult consent and revocation need a product decision before real use.
- Code expiry/revocation controls new redemption. Once redeemed, linkedPhones grants persistent access and the rules do not consult the original grant. Clarify this distinction in security documentation and provide explicit unlinking if revocation should remove existing access.
- Safety context uses up to six recent visits and a 30-day signing window. It does not model actual course completion, long-running medicines beyond that window or all medication sources. No-flags results cannot imply comprehensive clearance.
- Offline safety omits other visits' current medicines. An offline signature is locally unconfirmed and may be rejected later; the treatment/printing and reconciliation policy needs explicit validation.
- Pharmacy substitutions are stored as free text; the backend does not verify a same-formula substitution. Razorpay payment references are manually recorded, not independently verified through provider settlement.
- The main screen modules are eagerly imported. Clinic build output includes a roughly 490 KB Firebase chunk, a 579 KB speech chunk and a 26.9 MB WASM artifact. Patient Firebase is roughly 496 KB. Speech is intended to load on demand, but measure actual network and low-end device behavior.
- Clinic builds fetch speech model files from mutable Hugging Face main revisions. Pin revisions and integrity metadata for reproducible releases. Audit offline reload behavior on clinic web, which lacks the patient's service-worker setup.
- Existing CI does not provide repeatable browser UI coverage, native-device coverage, visual regression coverage, or production latency/load evidence. The screenshot script mutates demo state and is a demonstration aid rather than a regression assertion suite.
- Update README/TESTING test counts and the obsolete .env.example. Add a license before distribution decisions depend on it.

## Recommended sequence

1. Fix prescription schemas, canonical drug identity, frequency normalization and aggregate dose checking. Add negative backend tests for each reproduced failure.
2. Complete export/erasure and reconcile custom-vault/Firestore storage guarantees. Make offline durability failures visible.
3. Fix hosted camera permissions and validate the patient prescription acquisition flow on a physical Android phone and browser.
4. Make idempotency atomic and add failure-window, concurrent-worker and offline-replay tests.
5. Define allergy handoff, medication reconciliation, family access revocation and offline-signature policies.
6. Page reminder dispatch, triage dependencies, pin build assets, and update architecture documentation to actual settings.
7. Run a staging rehearsal covering booking → check-in → intake → signing → patient retrieval → reminders, with real response headers, indexes, scheduled jobs, monitoring and restore procedures.

## Validation

- Unit suite: 118 passed, 0 failed.
- npm run check: passed (both application type checks and Functions build).
- Clinic and patient production builds: passed; bundle warnings noted above.
- Backend integration suite: 64 tests across 22 suites passed, 0 failed, using isolated emulator ports; runtime approximately 190 seconds.
- Targeted local backend probes: duplicate-dose signing accepted; arbitrary frequency/mismatched medicine name accepted; profile absent from export and still present after deletion.
- Concurrency probe: six simultaneous identical registrations produced one patient; six simultaneous starts produced one visit in this emulator run. Atomicity remains an inspection finding, not a reproduced duplicate here.
- Not exercised: live Firebase deployment, live Twilio account, payment settlement, physical Android behavior, packaged desktop install, full interactive browser flow, production load or clinical dataset validation.
- Host runtime was Node 24.14.1; Functions requests Node 22. CI uses Node 22. Local results therefore do not replace verification on the deployment runtime.

The pre-existing untracked presentation/Iteration.png and presentation/diagram_1.png were left untouched. The isolated emulators were stopped and temporary test configuration removed after validation; the original development emulators were preserved.
