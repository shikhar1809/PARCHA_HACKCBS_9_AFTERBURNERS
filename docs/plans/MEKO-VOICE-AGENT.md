# Parcha voice mode on Meko — implementation plan

**Status:** plan only. No application code has been changed.
**Scope:** the doctor's voice-first prescribing mode in `apps/clinic` and nothing else. The manual pad (typing, the dictation box, the drug search, the safety panel, the sign flow) stays byte-for-byte as it is. Every other screen is untouched.
**Target:** hackCBS 9.0 Meko Challenge, **Track A (open project)**, scored out of 100.

> **The overriding rule of this whole design: the agent never suggests anything new.**
> Every medicine, strength, test, frequency, duration and timing it offers must already exist
> in the clinic's own data — the `drugs` collection, `usual.ts`, `special.ts`, or something
> this doctor has signed before. The agent **recalls and re-applies; it never invents.**
> This outranks every other goal in this document, including the hackathon score.
> It is specified in §3.3 and enforced in code at four separate layers.

---

## 0. What this document is for

Today the voice mode is a very good *parser*. `packages/core/src/voice.ts` (410 lines of hand-written regex and placement rules) decides where every spoken clause goes. It never learns. Doctor A and doctor B, in their thousandth consultation, get exactly the behaviour they got on day one.

This plan turns it into a voice **agent that gets better the more a doctor uses it**, with Meko as the memory and knowledge layer underneath, and without giving up the property the product was built on: **patient audio and patient-identifying text never leave the clinic's computer.**

The deterministic parser is not thrown away. It becomes the agent's floor — the thing that runs when Meko is unreachable, when the model is not installed, and as the first pass on every utterance. That is both an engineering decision (never regress) and a demo asset (the "Meko off" half of the required on/off comparison is literally today's build).

---

## 1. What Meko actually is, and which primitives we use

### 1.1 The correction most plans get wrong

Meko is **not an agent framework, not an LLM, and not a runtime**. It is Yugabyte's *agent-native data layer* — a hosted, multi-tenant store built on YugabyteDB that holds, per **datapack**:

- **Conversations** — raw turns (`input`/`output`/`reasoning`/`plan`).
- **Memory** — durable facts extracted from those turns (server-side LLM extraction, async and best-effort) or written explicitly. Private to the writing account by default.
- **Learnings** — memories Meko has *nominated* for human review, by ranking memories against a summary of the datapack's knowledge base. Top 5 surface in the portal's Review zone.
- **Collective Memory / Shared Knowledge** — what a reviewer **promotes** a learning into. Collective Memory is concise facts retrieved directly; Shared Knowledge is document-style content retrieved by RAG. Both are visible to every member of the datapack. **Promotion never crosses datapacks, and it is irreversible.**
- **Knowledge base** — uploaded documents (`.pdf .txt .text .md .json .csv .xml .html .htm`), chunked and indexed.
- **Artifacts** — content-addressed blobs.
- **Traces** — per-turn record of the tool calls, latencies, token costs and retrieved results that produced an output.

So: **we bring the agents and the model; Meko brings the memory, the sharing and the audit trail.** Anyone who writes "we'll run the agent on Meko" has not read the docs.

### 1.2 Two ways in, and we use both

| Surface | Base | Auth | What it gives us |
|---|---|---|---|
| **MCP server** | `https://mcp.mekodata.ai/mcp` | `Authorization: Bearer mko_tkn_…` + `User-Agent` | The 28 tools: `context_search`, `memory_add`, `memory_search`, `memory_promote`, `conversation_create`, `conversation_add_message`, `knowledgebase_search`, `track_token_usage`, … |
| **Datapack REST API** | `https://api.mekodata.ai/api/v1` | same two headers | `POST /datapacks`, `GET /memories?scope=learnings`, `POST /promote-memories`, `POST /keep-as-memory`, KB upload/status/list/delete, artifacts, `GET /health` |

**Verified live** (2026-10-31): an unauthenticated `POST https://mcp.mekodata.ai/mcp` returns `401` with `www-authenticate: Bearer …, resource_metadata="https://mcp.mekodata.ai/.well-known/oauth-protected-resource/mcp"`, `server: uvicorn`. Single-endpoint POST with JSON responses and OAuth-2.1 protected-resource metadata — i.e. **streamable-HTTP MCP**, not stdio and not legacy SSE.

Note the split: **`memory_add`, `memory_search` and `context_search` exist only over MCP.** The REST API can list, promote and keep memories but cannot write or semantically search them. Our server therefore speaks MCP, and uses REST only for promotion, learnings review, KB upload and health.

### 1.3 Keys, roles, quotas — the constraints that shape the design

- Keys are `mko_tkn_…`, **account-scoped** (one key reaches *all* that account's datapacks), shown once, max 10 active, **expire after 365 days**. There is no per-datapack key. **Consequence: the key is a server secret. It never reaches a browser.**
- Roles on a datapack: **owner** (delete, rename), **maintainer** (promote, toggle conversation-search opt-out, upload KB), **member**, **viewer** (sees memories *without* authorship).
- Free tier: **10 datapacks**, **1,000 conversation calls/month**, **10,000 retrievals/month**, 5 MB KB files, 5 MB artifacts.
- REST rate limit: **60 req/min per key** (burst 10) and 10 req/s per IP.

1,000 conversation calls a month is the binding constraint for a demo and a pilot. §6.4 budgets against it.

### 1.4 The primitives we actually use, and why

| Meko primitive | Our use | Why not something else |
|---|---|---|
| **Datapacks as scopes** | One per agent role, per clinic (§3.2). Isolation is the only hard boundary Meko offers. | Firestore can't give a doctor's agent semantic recall over its own past. |
| **Extracted memories** | Every signed prescription writes a de-identified `memory_add` from the Habit, Formulary and Scribe agents. | This *is* the learning loop. |
| **Recall before reasoning** | `context_search` on every utterance before the LLM pass, and `memory_search` before the habit fill-in. | Replaces `localStorage` in `memory.ts`, which is per-browser and dies with a cache clear. |
| **Promotion to shared knowledge** | The `mekoCurate` function nominates; a doctor with the `manage` ability approves; `memory_promote` makes it clinic canon. | The brief's "which decisions stay human" — and clinically, a lone doctor's habit must not silently become the clinic's rule. |
| **Sharing across users/agents** | A new locum on day one inherits the clinic's promoted canon. A memory written by the Formulary agent is read by the Scribe agent. | Today a new doctor starts from zero. |
| **Documents (KB)** | The clinic's formulary export, the state's standard treatment guidelines, the hospital's own protocol notes. | RAG over real protocol text, which no regex can do. |
| **Traces + `track_token_usage`** | The swarm view (§4) and the A4 "visible context" panel. | Honest provenance: we show only what Meko returned. |

That is **six** of the A2 list; the requirement is three with a reason each.

---

## 2. The brief, criterion by criterion

Source: *Meko Challenge · hackCBS 9.0 · 31 Oct – 1 Nov 2026*, the one PDF in the shared Drive folder (`meko hackathon.pdf`, 5 pages, read in full). Track A is scored out of 100.

### 2.1 Requirements A1–A5

| # | Requirement | Done when | How this plan satisfies it |
|---|---|---|---|
| **A1** | Context matters | The same flow with Meko on and off gives clearly different results | **Phase 0 ships the switch.** `mekoEnabled` on the hospital doc, plus `?meko=off` for the demo. Off = today's `routeSpeech` exactly. On = recall → agents → learn. **The comparison is made against a *warm* `localStorage`, not a fresh browser profile** — see §13.1 F1 — so the delta is only what Meko genuinely adds: the same habits on a second device, a locum's first-ever utterance from clinic canon, and one agent using what another learned. §7.6 demos all three. |
| **A2** | Real Meko use | ≥3 Meko uses, each with a reason | Six, tabulated in §1.4. |
| **A3** | A user and a story | One persona, one problem, one demo story | **Dr Meena Rao, the only MBBS at Rohini City Hospital, 60–80 OPD patients a day.** Problem: she dictates the same prescription shape hundreds of times and the pad learns nothing; a locum covering her Sunday starts from zero. Story in §7.6. |
| **A4** | Visible context | UI shows what was recalled and stored, and lets the user correct or forget | **The Recall strip** (§5.3) above the VoiceBar: every recalled memory as a chip, with the Meko score, `Use`/`Wrong`/`Forget`. `Forget` calls `memory_delete_by_id`. Nothing is shown that Meko did not return — chips are rendered *from the tool result*, never from a local guess. |
| **A5** | Honest and private | No unneeded personal data; nothing shown as context Meko didn't return | §6 in full. Audio never leaves. No name, phone, patient id, visit id, age or free-text complaint is ever sent. A hard redaction gate (`deidentify()`) with unit tests, plus a server-side second pass that *rejects* rather than scrubs. |

### 2.2 Scoring, mapped

| Criterion | Pts | What we do for it |
|---|---|---|
| **The idea** | 20 | A voice agent for rural Indian OPD prescribing that learns one doctor's hand and promotes it, with review, into clinic canon. Lived problem (§7.6), and the Hinglish/phonetic ground truth already in the repo is hard to fake. |
| **Meko's role** | 30 | §1.4 (six uses), §3 (three agents, three datapacks, real hand-offs), §5.3 (visible context), §7.6 (on/off). |
| **Build and execution** | 25 | Phases ship working demos (§7). README set-up in **5 commands** (§7.7). `firebase emulators` + `npm run seed` already give a realistic clinic. Honest and private: §6. |
| **Built with Meko** | 10 | §8 — `parcha-build` datapack, team protocol in `AGENTS.md`, ≥10 promoted decisions from ≥2 teammates, **Check T**. |
| **Meko feature proposal** | 10 | §9 — a real piece of friction this design hits, written as an MCP tool. |
| **Build in public** | 5 + bonus | §10. |

### 2.3 Deliverables

1. **Repo** with a README that sets up in ≤5 commands — §7.7.
2. **Demo, ≤5 min**, same flow Meko on and off — §7.6.
3. **Meko feature proposal** — §9.
4. **Build datapack** with judges invited as Viewers, passing Check T — §8.

### 2.4 Agent swarms — explicitly

The brief makes a **swarm view mandatory for Track B only**. We are Track A, so it is not required of us. **We build one anyway**, because the biggest single block of Track A points is "Meko's role, 30 — Meko is load-bearing … context the user can see", and a live board of real Meko calls is the most direct possible evidence of that. It doubles as the A4 surface and as the demo's spine.

Our swarm is **three** agents, one datapack each (§3.2), each with a narrow job and an explicit right to write memory or not, plus the `mekoCurate` function and the doctor themself as nodes. Three is a deliberate cut from five (§13.2 F5): a Safety agent and a Curator agent were specified and dropped, because one belonged in a scheduled function and the other touches a part of the product this work keeps out of scope. **A swarm that is honestly three working agents beats five where two are scenery** — and the hand-offs, which are what the brief actually asks about, are unaffected. The board (§4) draws **only from logged Meko calls we really made** — `mekoCalls` in Firestore, written by the proxy, one row per MCP tool call with latency, token counts and a pass/fail. Anything seeded for the demo is labelled as seeded on the board itself.

---

## 3. Architecture

### 3.1 Where everything runs

```
┌─ The clinic's computer (nothing below this line leaves it) ───────────┐
│                                                                       │
│  Microphone ──► capture-worklet.js ──► Float32Array @16 kHz           │
│                                             │                         │
│                                   whisper.ts (WASM, local /asr)       │
│                                             │  transcript (text)      │
│                                             ▼                         │
│  Pad.tsx ──► routeSpeech()  ◄── the existing deterministic floor      │
│                 │                                                     │
│                 │ unplaced clauses + a recall request                 │
│                 ▼                                                     │
│          agent/runtime.ts ──► Ollama http://127.0.0.1:11434           │
│                 │              (Qwen3 8B, OpenAI-compatible,          │
│                 │               tool calling)                         │
│                 │                                                     │
│                 │ de-identified text only (deidentify(), §6.2)        │
└─────────────────┼─────────────────────────────────────────────────────┘
                  │  httpsCallable, Firebase Auth + seat check
                  ▼
      ┌─ Cloud Functions, asia-south1 (parcha-101) ─────────┐
      │  mekoRecall / mekoRemember / mekoReview / mekoPromote│
      │     ├─ redaction gate (reject, don't scrub)          │
      │     ├─ MEKO_API_KEY (defineSecret)                   │
      │     ├─ logs every call → Firestore `mekoCalls`       │
      │     └─ MCP client (streamable HTTP)                  │
      └────────────────────┬────────────────────────────────┘
                           ▼
              https://mcp.mekodata.ai/mcp   (+ api.mekodata.ai for promote/learnings/KB)
```

Three decisions worth defending:

1. **The browser never talks to Meko.** The key is account-scoped — one leaked key reaches every datapack we own. It lives in a Secret Manager secret, read only by Cloud Functions.
2. **The LLM is local, over `127.0.0.1`.** Ollama serving **Qwen3 8B** (Apache 2.0, strong tool calling, fits a 16 GB laptop — the brief's own table). The transcript, which contains the patient's complaint in the doctor's words, is given to the model but never to anything off-machine. No hosted model is wired in at all; adding one would be an explicit, separate decision with a different privacy analysis.
3. **The deterministic parser runs first, every time.** The LLM and Meko only see what `routeSpeech` left as `{ kind: "unplaced" }`, plus the recall request. This caps blast radius: a hallucinating model cannot invent a medicine line, because medicine lines still come out of `parseDictation`.

### 3.2 The swarm: three agents, three datapacks

Meko's `agent_id` is for trace attribution and does not filter `memory_search`; **the datapack is the real scope**. So one datapack per agent, per the brief's own Track-B example, named `parcha-<role>`. All three sit in a Meko **project** called `parcha-run`, kept strictly apart from `parcha-build` (§8).

| Agent | Datapack | `agent_id` | Owns | Writes memory? | Reads |
|---|---|---|---|---|---|
| **Habit** | `parcha-habit` | `habit` | How *this doctor* writes each drug: strength, frequency, duration, timing. Replaces `memory.ts`'s `localStorage`. **Needs no LLM at all.** | Yes — one memory per signed line | own memory + promoted canon |
| **Formulary** | `parcha-formulary` | `formulary` | Resolving a heard name to a `drugId`. Wraps and then outgrows `soundsLike.ts`. Learns that *this clinic* says "Dolo" for paracetamol and "Augmentin" for co-amoxiclav. | Yes — accepted and rejected name resolutions | own memory + promoted canon |
| **Scribe** | `parcha-scribe` | `scribe` | Placing clauses the rules could not place. Turns "she's been coughing two weeks, give her the usual cough syrup at night" into a target box. **The only one that needs the local model.** | Yes — placement corrections the doctor made | own memory + promoted canon |

Ordered by value, not by cleverness: Habit delivers nearly all of the user-visible win and
runs on any machine; Scribe is the most interesting and the most likely to be cut (§13.2 F3).

**Two things that are deliberately not agents.**

- **The Curator is a Cloud Function, not an agent** (`mekoCurate`, §5.2). Its job — rank
  memories by how often a pattern recurs, and queue the top ones for review — is a ranking
  query over `GET /memories?scope=learnings`. It has no conversation, no memory of its own and
  nothing to learn. Calling it an agent would have bought a fourth datapack and a node on the
  board in exchange for nothing. **It runs on a schedule, and the human review step it feeds is
  unchanged and still the most original part of this design.**
- **Safety is deferred, not cancelled.** RAG over uploaded protocol documents as a second
  opinion is a good idea that is not this feature: it touches the safety panel, which §16 puts
  out of scope, and it is the one place where a hosted model reading clinical documents could
  mislead a doctor. The existing deterministic `runConflictEngine` in
  `packages/core/src/conflicts.ts` remains the only safety authority, exactly as today.
  Written up as a follow-up in §13.2 F5, not built here.

**Agent-to-agent hand-off survives the cut**, which is what matters for the brief: the
Formulary agent's naming memory is read by the Scribe agent (§7.6 step 8), and both feed the
Habit agent's recall. Three agents still make a swarm; two would not.

**The hand-off in detail (the brief's B2 shape, which we adopt).** The Formulary agent writes `clinic says "Dolo" for paracetamol-650` into `parcha-formulary`. The Scribe agent reads it via `context_search` on the next consultation and places "Dolo 650 at night" without the doctor correcting it a second time. Both calls appear as edges on the swarm board.

### 3.3 The closed-world rule — nothing new is ever suggested

An AI model asked about medicines will happily produce a plausible, correct-sounding drug that
this clinic does not stock, at a strength that does not exist, for a condition nobody mentioned.
In an OPD where the doctor is signing 60 prescriptions before lunch, that is the single most
dangerous thing this feature could do. So the design forbids it structurally, not by prompting.

**The closed world — the only things that may ever appear on the pad:**

| Source | Where it lives | What it may contribute |
|---|---|---|
| The clinic's formulary | `drugs` collection in Firestore (seeded by `firebase/functions/src/seed.ts`); loaded by `useFormulary()` | Every `drugId`, `drugName`, `form`, `strength`. **The complete set of medicines.** |
| Usual schedules | `packages/core/src/usual.ts` — `CLASS_SCHEDULES`, `startingLine()` | A starting frequency / duration / timing when nothing else is known |
| The test list | `packages/core/src/special.ts` — `COMMON_TESTS` | Every test name. `testsIn()` already filters to this list |
| This doctor's own signed history | Meko `parcha-habit` + the `memory.ts` local cache | How they personally write a drug *already in the formulary* |
| Clinic canon | Meko promoted Collective Memory | A nickname or a habit a human explicitly approved |
| The doctor's own mouth | the transcript | Anything they actually said |

**Nothing else may reach the pad. In particular the local model may not contribute a single
clinical fact.** Its entire job is *routing* — deciding that the words "start her on the usual
cough syrup at bedtime" refer to a drug the doctor has prescribed before, and which box the
clause belongs in. It never names a drug the formulary does not have, never proposes a
strength, never suggests a medicine for a diagnosis, never writes advice of its own.

**Four enforcement layers, each sufficient on its own:**

1. **The tools are closed, not free-text.** `AGENT_TOOLS` in `voiceAgent.ts` exposes no field
   the model can fill with prose. Drug selection is `{ drugId: enum }` — the enum is built at
   call time from the drugs actually loaded by `useFormulary()`, so an unknown id is not
   expressible. Strength is `{ strength: enum }` from that drug's own `strengths[]`. Tests are
   `{ test: enum }` from `COMMON_TESTS`. Frequency is `{ frequency: enum }` from the existing
   `normaliseFrequency` vocabulary. **A hallucinated medicine has nowhere to go.**

2. **`mergeAgentActions()` validates before merging.** Every model-produced action is checked
   against the formulary and the lists above and **dropped silently** if it does not resolve:
   ```ts
   /** A model action survives only if every identifier in it already exists. */
   function grounded(a: VoiceAction, drugs: Drug[]): boolean;
   // drugId must be in drugs[]; strength in that drug's strengths[];
   // test in COMMON_TESTS; frequency in the normaliseFrequency vocabulary.
   // Anything else -> dropped, and the utterance falls back to { kind: "unplaced" }.
   ```
   The rules also still win every conflict, so the model can only ever fill a box the
   deterministic parser left empty.

3. **Recall is re-grounded too.** A Meko memory is a *sentence*, and Meko is a hosted service we
   do not control. So a recalled habit is never applied as text — it is parsed back into a
   `drugId` + schedule and **re-checked against today's formulary** before it touches the pad.
   A memory about a drug the clinic has since removed is dropped, not resurrected. The Recall
   strip renders only hits that survived this check.

4. **The server re-checks, as it already does.** `signPrescription` in
   `firebase/functions/src/index.ts` already rejects any line not in the `drugs` collection —
   *"Every line is checked against the formulary again here, because the list arrives from a
   browser."* That guard is untouched and remains the last word. Nothing this plan adds can
   get an unknown medicine onto a signed prescription, even if layers 1–3 all failed.

**What stays strictly human.** Medicines written by hand (`unlisted:`) remain a thing only the
doctor can do, by typing, in the manual pad. The agent may never create one, and may never
convert an unresolved spoken word into one — an unrecognised name still comes back as
`{ kind: "unplaced" }` and is said back to the doctor, exactly as today.

**Nothing advises on clinical content at all.** An earlier draft had a Safety agent doing RAG
over protocol documents as a second opinion; it is deferred (§13.2 F5), and with it goes the
only path by which a model could put clinical *prose* in front of a doctor. The existing
deterministic `runConflictEngine` in `packages/core/src/conflicts.ts` remains the sole safety
authority, exactly as it is today. **If that agent is ever built, these constraints are part of
it, not optional:** advisory prose only, in its own clearly-labelled panel; it may not add,
change, remove or substitute a medicine line; and it may never clear a flag the deterministic
engine raised. A second opinion printed beside the pad, never a hand on the pad.

**The honest trade-off.** This deliberately makes the agent less impressive. It will not
suggest a drug the doctor forgot, and it will not catch a missing antibiotic. That is the
correct trade for a prescribing tool: the doctor decides *what* to prescribe, and Parcha only
saves them the typing. Any future change to this rule is a clinical decision, not an
engineering one.

### 3.4 Per-doctor and per-clinic scoping, concretely

Meko has no notion of our doctors. We carry the scope in the memory text itself and in `metadata`, and rely on datapack isolation for the clinic boundary.

```ts
// packages/core/src/mekoScope.ts
/** A doctor, as Meko sees them: never a uid, never a name. */
export type MekoScope = {
  /** sha256(hospitalId + uid + MEKO_SCOPE_SALT), first 12 hex chars. Stable, not reversible. */
  doctorKey: string;
  /** sha256(hospitalId + MEKO_SCOPE_SALT), first 12 hex. */
  clinicKey: string;
};
```

Every `memory_add` carries `metadata: { doctorKey, clinicKey, kind, parchaVersion }` and every `memory_search` prefixes the query with the `doctorKey`, so the hybrid scorer's keyword and entity signals pull that doctor's rows up. Filtering is then applied again *server-side on `metadata`* before anything is returned to the browser — Meko's own search is a ranker, not an access control, so we never trust it as one.

**One clinic per datapack set.** A second hospital gets its own three datapacks. **The cut from
five to three is what makes the free tier workable:** `parcha-build` + `parcha-smoke` + three
per clinic means **two clinics fit in the 10-datapack cap with two to spare**, where the
five-agent design hit the ceiling at one. That is not a rounding detail — it is the difference
between a demo and a two-site pilot.

---

## 4. The swarm view

A new tab in the clinic app under the existing `activity` ability, at `apps/clinic/src/screens/Swarm.tsx`.

- **Nodes:** the three agents, plus "Doctor", "Parcha (local)" and "Curator (nightly)". The Curator is drawn as a **square**, not a circle, and the legend says *"a scheduled function, not an agent"* — the board should not flatter the design (§3.2).  Each agent node shows its datapack name and live counts: memories held, recalls served, nominations pending.
- **Edges:** one per logged Meko call, animated as it lands. Colour by kind: `write` / `recall` / `share` (agent→agent) / `promote`.
- **Counters:** notes, reads, promotions, approvals, errors — straight off `mekoCalls`.
- **Message stream:** `formulary → scribe: clinic says "Dolo" = paracetamol 650`, `curator (fn): nominated 3 learnings`, `dr-meena approved 1 → canon`.
- **Window:** live 5 m / 30 m / replay, driven by `at` on each row.
- **Honesty:** rows written by `npm run seed:meko` carry `seeded: true` and render with a dashed edge and a "seeded" badge. Nothing else is simulated.

Data source: `visits`-sibling collection `mekoCalls`, written by the proxy (§5.2), read by a new `useMekoCalls()` in `packages/client/src/queries.ts`.

---

## 5. Exact files to add and change

### 5.1 `packages/core` — new, pure, testable

**`packages/core/src/mekoScope.ts`** (new)
```ts
export type MekoScope = { doctorKey: string; clinicKey: string };
export type MemoryKind = "habit" | "naming" | "placement" | "nomination";
/** The one shape we ever send to Meko. Free of patient data by construction. */
export type MekoFact = {
  kind: MemoryKind;
  /** The sentence Meko stores and searches. English, no identifiers. */
  text: string;
  metadata: { doctorKey: string; clinicKey: string; kind: MemoryKind; parchaVersion: string };
};
export function scopeKeys(hospitalId: string, uid: string, salt: string): MekoScope;
```

**`packages/core/src/deidentify.ts`** (new) — the privacy gate, pure and unit-tested.
```ts
export type Redaction = { ok: true; text: string } | { ok: false; reason: string; found: string[] };
/**
 * Anything that could identify a patient makes this FAIL, it does not scrub.
 * A scrubber that silently half-works is worse than a gate that refuses.
 */
export function deidentify(text: string, known: { patientName?: string; phone?: string }): Redaction;
/** Ten-digit phones, Aadhaar-shaped 12-digit runs, the patient's own name and its parts,
 *  visit ids, patient ids, dates of birth, "years old" with a name beside it, email, UPI ids. */
export const PHI_PATTERNS: { name: string; re: RegExp }[];
```

**`packages/core/src/mekoFacts.ts`** (new) — turns a signed prescription into facts. Pure; no Firebase, no DOM, no Node (the `index.ts` contract).
```ts
/** One fact per line: "for viral-fever this doctor writes paracetamol-650 1-0-1 for 3 days after food". */
export function habitFacts(rx: { diagnosis: string; items: PrescriptionItem[] }, scope: MekoScope): MekoFact[];
/** "in this clinic 'dolo' said aloud means drug paracetamol-650". */
export function namingFact(heard: string, drugId: string, scope: MekoScope): MekoFact;
/** "'she has been coughing' said at the start of a consultation is a diagnosis, not advice". */
export function placementFact(words: string, box: VoiceAction["kind"], scope: MekoScope): MekoFact;
```

**`packages/core/src/voiceAgent.ts`** (new) — the agent loop's *pure* half: tool schemas, grounding and the merge. This file is where §3.3's closed world is enforced.

```ts
/**
 * The four tools the local model may call. Built per call from the clinic's own
 * data, so every identifier the model can emit is one that already exists.
 * There is no free-text field anywhere in these schemas: the model picks from
 * enums or it says nothing.
 */
export function agentTools(drugs: Drug[]): Tool[];
//  place_medicine { drugId: enum(drugs.map(d => d.id)),
//                   strength?: enum(that drug's strengths),
//                   frequency?: enum(FREQUENCIES), durationDays?: integer 1..90,
//                   timing?: enum(TIMINGS) }
//  place_test     { test: enum(COMMON_TESTS) }
//  place_text     { box: "diagnosis" | "advice", /* the doctor's OWN words, verbatim */
//                   spanStart: integer, spanEnd: integer }   ← indices into the transcript
//  set_follow_up  { days: integer 1..180 }

/** True only if every identifier in this action already exists in the clinic's data. */
export function grounded(a: VoiceAction, drugs: Drug[]): boolean;

/**
 * Merges the model's tool calls into the actions the rules already produced.
 *  - rules win on every conflict; the model may only fill a box the rules left empty
 *  - every model action must pass `grounded()` or it is dropped silently
 *  - a dropped action leaves the clause as { kind: "unplaced" }, said back to the doctor
 */
export function mergeAgentActions(rules: VoiceAction[], model: VoiceAction[], drugs: Drug[]): {
  actions: VoiceAction[];
  /** For the thread: which of these came from the agent, and on what recall. */
  provenance: Record<number, { from: "rules" | "agent"; memoryIds: string[] }>;
  /** Model actions thrown away for being ungrounded. Logged, and shown on the swarm board. */
  rejected: { action: VoiceAction; reason: string }[];
};
```

Note `place_text`: diagnosis and advice are **spans of the doctor's own transcript**, given as
start/end indices, not prose the model writes. The model may say *where* a phrase belongs; it
may not say *what* the phrase is. That closes the last channel through which an invented
clinical statement could reach the pad.

**`packages/core/src/mekoGround.ts`** (new) — layer 3 of §3.3.
```ts
/** Turns a recalled Meko sentence back into a checked line, or null. */
export function groundRecall(memoryText: string, drugs: Drug[]): {
  drugId: string; schedule: Schedule & { strength: string };
} | null;
/** A memory naming a drug the clinic no longer stocks, or a strength it no longer
 *  carries, returns null: it is dropped, never resurrected. */
```

**Changed:** `packages/core/src/index.ts` — add four `export *` lines. `packages/core/src/voice.ts` — **one** change: export the existing `routeSpeech` result shape unchanged and add nothing else. The parser is not touched.

**Tests:** `packages/core/test/deidentify.test.ts`, `mekoFacts.test.ts`, `voiceAgent.test.ts`, beside the existing `voice.test.ts`.

### 5.2 `firebase/functions` — the proxy

**`firebase/functions/src/meko.ts`** (new) — the only place with the key.
```ts
import { defineSecret } from "firebase-functions/params";
export const MEKO_API_KEY = defineSecret("MEKO_API_KEY");
export const MEKO_SCOPE_SALT = defineSecret("MEKO_SCOPE_SALT");

const MCP_URL = "https://mcp.mekodata.ai/mcp";
const REST_URL = "https://api.mekodata.ai/api/v1";
const UA = "parcha-clinic/1.0 (+https://github.com/shikhar1809/PARCHA_HACKCBS_9_AFTERBURNERS)";

/** One streamable-HTTP MCP session per warm instance, re-initialised on 401. */
async function mcp(): Promise<Client>;
/** The allowlist. A tool not on it cannot be called, whatever the client asks for. */
export const ALLOWED_TOOLS = [
  "context_search", "memory_search", "memory_add", "memory_get_by_id",
  "memory_delete_by_id", "memory_promote", "knowledgebase_search",
  "conversation_create", "conversation_add_message", "track_token_usage",
] as const;
export async function tool<T>(name: (typeof ALLOWED_TOOLS)[number], args: Record<string, unknown>): Promise<T>;
export async function rest<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T>;
/** Every call lands here: one `mekoCalls` row with latency, tokens, ok/err. */
async function logCall(row: MekoCallRow): Promise<void>;
```

Implementation note: use `@modelcontextprotocol/sdk`'s `Client` + `StreamableHTTPClientTransport`, passing `requestInit.headers` with `Authorization` and `User-Agent`. **This is inferred from the endpoint's observed behaviour plus the MCP spec, not from a Meko code sample** — the docs name no SDK. If it misbehaves, fall back to hand-rolled JSON-RPC POSTs to the same URL; the probe in §1.2 shows plain JSON responses, so a 60-line client is a safe plan B. Budget half a day for this either way.

**`firebase/functions/src/mekoCallables.ts`** (new) — four callables, registered from `index.ts`.

```ts
/**
 * Recall before reasoning. Called once per utterance, before the local model runs.
 *
 * `minInstances: 1` is the ONE exception to options.ts's "no warm instances" rule, and it is
 * deliberate (§13.1 F2). This is the only callable a person waits on mid-sentence: everything
 * else in Parcha is a write the doctor has already committed to. A gcf_gen1 cold start is
 * 2-5 s before our code runs, which blows the 1,200 ms budget in §11 and makes the first
 * consultation of every morning silently degrade — the worst possible moment for trust.
 * One warm 256 MiB instance is roughly Rs 300-500/month. Nothing else gets one.
 */
export const mekoRecall = onCall(
  { secrets: [MEKO_API_KEY, MEKO_SCOPE_SALT], minInstances: 1 },
  async (request) => {
    const caller = await liveCounter(request, "doctor");   // session.ts
    assertAbility(caller, "consult");                       // guards.ts
    // data: { query: string; agents: (...)[]; limit?: number; warm?: true }
    // A warm-up call does the auth check, touches the MCP session, and returns {} —
    // no Meko tool call, no quota spent, not logged to mekoCalls.
    if (request.data?.warm === true) { await mcp(); return { hits: [], degraded: false }; }
    await rateLimit(`meko:recall:${caller.uid}`, 400, 3600);
    // -> { hits: { agent, memoryId, text, score, rawScore }[]; degraded: boolean }
  });

/** Learn. Called on sign, and on an explicit correction. */
export const mekoRemember = onCall({ secrets: [...] }, async (request) =>
  once(request, async () => {                             // guards.ts idempotency
    const caller = await liveCounter(request, "doctor");
    assertAbility(caller, "consult");
    await rateLimit(`meko:remember:${caller.uid}`, 200, 3600);
    // data: { facts: MekoFact[] }  (max 30)
    // -> { stored: number; memoryIds: string[] }
  }));

/** The review queue: Meko's own learnings, for a doctor who can promote. */
export const mekoReview = onCall({ secrets: [...] }, async (request) => {
  const caller = await liveCounter(request, "doctor");
  assertAbility(caller, "manage");
  // -> { nominations: { memoryId, text, agent, seenTimes, firstSeen }[] }
});

/**
 * The Curator — a scheduled function, deliberately NOT an agent (§3.2, §13.2 F5).
 * Ranking memories by recurrence is a query, not a conversation: it has nothing to
 * remember and nothing to learn, so it gets no datapack and no board node of its own.
 * Nightly: read each agent's learnings, keep patterns seen by >= 2 doctors or >= 5 times,
 * mirror them into `mekoNominations` as `pending`. It never promotes: only a human does.
 */
export const mekoCurate = onSchedule(
  { schedule: "0 2 * * *", timeZone: "Asia/Kolkata", secrets: [MEKO_API_KEY] },
  async () => {
    // for each hospital with mekoEnabled:
    //   for each agent datapack: GET /memories?scope=learnings&datapack_id=…
    //   rank, dedupe against existing nominations, write `pending` rows
  });

/** The human decision. Irreversible, so it is its own callable with its own audit row. */
export const mekoPromote = onCall({ secrets: [...] }, async (request) => {
  const caller = await liveCounter(request, "doctor");
  assertAbility(caller, "manage");
  requireRecentSignIn(request);        // same bar as signPrescription: it cannot be undone
  // data: { memoryIds: string[]; decision: "promote" | "keep" }
  // promote -> POST /promote-memories ; keep -> POST /keep-as-memory
  // audit(caller, "meko.promote", { memoryIds })
});
```

Every one of these: **re-runs `deidentify()` server-side and throws `HttpsError("invalid-argument", …)` on a hit.** The client gate is a courtesy; this one is the boundary. It is the same shape as the formulary re-check in `signPrescription` — "the list arrives from a browser".

**Changed:** `firebase/functions/src/index.ts` — add `export * from "./mekoCallables.js";` near the other re-exports. Nothing else in that file changes; `signPrescription` is not touched (the remember call is made by the client *after* a successful sign, so a Meko outage can never block a signature).

**`firebase/functions/src/mekoSeed.ts`** (new, emulator-only, guarded like `seed.ts`) — writes ~40 plausible memories and ~25 `mekoCalls` rows so the swarm view has a history on a cold machine. Every row `seeded: true`.

### 5.3 `apps/clinic` — the agent and the visible context

**`apps/clinic/src/screens/consultation/agent/llm.ts`** (new)
```ts
/** The local model, over 127.0.0.1 only. No hosted endpoint is reachable from here. */
export const LLM_URL = "http://127.0.0.1:11434/v1/chat/completions";
export const LLM_MODEL = "qwen3:8b";
export async function available(): Promise<boolean>;   // GET /api/tags, 400 ms timeout
export async function complete(messages: Message[], tools: Tool[], signal: AbortSignal): Promise<ToolCall[]>;
```

**`apps/clinic/src/screens/consultation/agent/runtime.ts`** (new) — the loop.
```ts
export type AgentResult = {
  actions: VoiceAction[];
  recalled: Recalled[];            // what the Recall strip shows
  degraded: null | "no-meko" | "no-model" | "both";
};
/**
 * 1. rules = routeSpeech(words, drugs, padState, question)      ← unchanged
 * 2. if nothing unplaced and no habit gap → return rules. Most utterances stop here.
 * 3. recall  = await mekoRecall({ query: deidentified(words), agents: [...] })
 * 4. model   = await complete(prompt(rules, recall), AGENT_TOOLS, abort(2500ms))
 * 5. return mergeAgentActions(rules, model)
 * Any failure at 3 or 4 returns `rules` with a `degraded` reason. Never throws.
 */
export async function runAgent(words: string, ctx: AgentContext): Promise<AgentResult>;

/**
 * Fired once when the consultation screen mounts, long before the doctor speaks (§13.1 F2).
 * Warms the Cloud Function instance, the MCP session and the Ollama model together, so the
 * first real utterance of the day meets a warm path instead of a 3-second cold start.
 * Fire-and-forget: it never blocks render and its failure is not shown.
 */
export function warmUp(): void;   // void mekoRecall("", [], { warm: true }).catch(() => {});
                                  // void llm.available();
```

`warmUp()` is called from a `useEffect` in `Pad.tsx` with an empty dependency array, beside the
existing `loadWhisper()` prefetch in `VoiceBar.tsx` — the same pattern, for the same reason:
the expensive first load happens while the doctor is still reading the patient's file.

**`apps/clinic/src/screens/consultation/RecallStrip.tsx`** (new) — the A4 surface. A row of chips above the VoiceBar:

> 🧠 **Your usual for viral fever** — paracetamol 650, 1-0-1, 3 days, after food · *score 0.84* · [Use] [Wrong] [Forget]
> 🏥 **Clinic canon** — "Dolo" here means paracetamol 650 · *promoted 12 Oct by Dr Rao* · [Forget is disabled on canon]

`Forget` → `memory_delete_by_id` through a fifth callable `mekoForget` (same guards as `mekoRemember`). `Wrong` writes a correcting fact *and* drops the chip. Each chip renders strictly from a hit the proxy returned, carrying its real `score` and `raw_similarity_score`; there is no local fabrication path.

**`apps/clinic/src/screens/Swarm.tsx`** (new) + **`apps/clinic/src/screens/swarm/Board.tsx`** — §4.

**Changed — `apps/clinic/src/screens/consultation/Pad.tsx`**, four edits, all additive:

1. `heard()` becomes `async`. Its first line changes from
   `const actions = routeSpeech(words, drugs, padState, question);`
   to `const { actions, recalled, degraded } = await runAgent(words, { drugs, padState, question, mekoEnabled });`
   Everything after it — the whole `for (const a of actions)` block, 90 lines — is **unchanged**. This is the single most important property of this plan: the agent produces the same `VoiceAction[]` the parser already produced.
2. `withHabits()` consults the Habit agent's recall before `memory.lines[drug.id]`, falling back to it. `memory.ts` stays as the offline cache and is still written on sign.
3. After `learn(uid, { diagnosis, items })` in `sign()`, fire `void mekoRemember({ facts: habitFacts(...) })` — **unawaited and `.catch(() => {})`**, so a Meko failure cannot touch the signature path.
4. Render `<RecallStrip recalled={recalled} degraded={degraded} />` above `<VoiceBar … />`.

**Changed — `apps/clinic/src/screens/consultation/VoiceBar.tsx`**: one addition. `Turn` gains `from?: "rules" | "agent"` and `memoryIds?: string[]`; an agent-produced part renders with a small 🧠 and a hover showing which memory it came from. `whisper.ts`, `useMic.ts` and the capture worklet are **not touched at all** — the on-device transcription path is exactly as it is today.

**Changed — `packages/client/src/mutations.ts`**: five thin wrappers beside the existing ones, same `call<TArgs, TResult>` shape.
```ts
export const mekoRecall = (query: string, agents: MekoAgent[]) => call<…>("mekoRecall", { query, agents });
export const mekoRemember = (facts: MekoFact[]) => call<…>("mekoRemember", { facts });
export const mekoForget = (memoryId: string) => call<…>("mekoForget", { memoryId });
export const mekoReview = () => call<…>("mekoReview", {});
export const mekoPromote = (memoryIds: string[], decision: "promote" | "keep") => call<…>("mekoPromote", { memoryIds, decision });
```

**Changed — `packages/client/src/queries.ts`**: `export function useMekoCalls(window: "5m" | "30m" | "all"): Loadable<MekoCall[]>`.

**Changed — `apps/clinic/src/Tabs.tsx`**: one more tab, `Swarm`, gated on the `activity` ability.

### 5.4 Data model

**Firestore (all writes via callables; rules continue to deny client writes).**

```
mekoCalls/{id}            // the swarm view's source of truth
  hospitalId: string
  agent: "habit" | "formulary" | "scribe" | "curator"   // "curator" = the nightly function
  tool: string            // the MCP tool name
  kind: "write" | "recall" | "share" | "promote"
  ok: boolean
  ms: number
  tokens: { in: number; out: number } | null
  summary: string         // de-identified, for the message stream
  seeded?: true
  at: Timestamp

mekoNominations/{id}      // the mekoCurate queue, mirrored so the UI is fast and offline-readable
  hospitalId, memoryId, agent, text, seenTimes, firstSeen
  state: "pending" | "promoted" | "kept"
  decidedBy?: uid, decidedAt?: Timestamp
```

`hospitals/{id}` gains:
```ts
mekoEnabled: boolean;        // the on/off switch, settable in Manage
mekoDatapacks?: Record<MekoAgent, string>;   // datapack_id per agent
```

**`firestore.rules`**: add `match /mekoCalls/{id} { allow read: if signedIn() && sameHospital(); allow write: if false; }` and the same for `mekoNominations`, following the existing deny-write pattern. No rule becomes more permissive.

**`packages/core/src/types.ts`**: `MekoCall`, `MekoNomination`, the two new `Hospital` fields, and
```ts
/** The three agents that own a datapack. "curator" is the nightly function (§3.2), not an agent,
 *  so it appears on MekoCall.agent for the board but never in MekoAgent. */
export type MekoAgent = "habit" | "formulary" | "scribe";
```

**Meko-side, created once by `scripts/meko-bootstrap.mjs`:** three datapacks via `POST /datapacks`, their ids written into `hospitals/{id}.mekoDatapacks`. The clinic's formulary is exported as `formulary.md` and uploaded to `parcha-formulary`'s KB — the one knowledge-base upload this build needs. (Protocol documents belonged to the deferred Safety agent; no KB upload replaces them, and the existing safety panel is untouched.)

---

## 6. Privacy and security

### 6.1 What does not change

**Audio never leaves the computer.** `whisper.ts`, `useMic.ts` and `public/capture-worklet.js` are untouched. Whisper base/tiny still runs in WASM from `/asr/`, `env.allowRemoteModels = false`, the sound is dropped after transcription, and the browser's `SpeechRecognition` is still never used. Replies are still read aloud only by a `localService` voice. **This plan adds no audio path of any kind.**

### 6.2 What crosses the boundary, exactly

Only these, and only to Meko:

| Crosses | Example | Why it is safe |
|---|---|---|
| A de-identified utterance, as a *recall query* | `"viral fever paracetamol 650 twice a day"` | No name, no id, no age, no phone. Gated by `deidentify()` on the client **and rejected** server-side. |
| Habit facts | `"d:7a3f1c2e9b04 writes paracetamol-650 1-0-1 3d after-food for viral-fever"` | A prescribing pattern, not an event. No patient, no date, no visit. |
| Naming facts | `"clinic c:91ab… says 'dolo' for paracetamol-650"` | Vocabulary. |
| Placement facts | `"'patient has' at the start of a line means diagnosis"` | Grammar. |
| Promotion decisions | memory ids + the deciding doctor's `doctorKey` | Already pseudonymous. |

**Never crosses:** audio, the patient's name, phone, `patientId`, `visitId`, age, sex, address, the free-text complaint, vitals, allergies, the body-map selection, the signed prescription itself, the doctor's uid or display name, the hospital's name.

Note the asymmetry deliberately built in: we send *how this doctor prescribes*, never *what happened to this patient*. A full dump of our Meko account would reveal a prescribing style and a clinic's drug vocabulary. It would not reveal that anyone was ill.

### 6.3 The gate

- `deidentify()` **fails closed**. On any pattern hit it returns `{ ok: false }` and the caller sends nothing — the agent silently falls back to the rules. It does not try to scrub and continue.
- The patient's actual name and phone, known to the client from `useVisit`, are passed in as `known` so an exact match is caught even if it looks like an ordinary word.
- The **server repeats the check** and throws. A compromised or modified client cannot push PHI through.
- `conversation_search_opt_out` is set **true** on all three datapacks via `PATCH /datapacks/{id}/conversation-search-opt-out`, so our conversations never surface in Meko's cross-datapack conversation search.
- Keys: two secrets, `MEKO_API_KEY` and `MEKO_SCOPE_SALT`, via `firebase functions:secrets:set`. Never in `.env`, never in the repo, never in the build datapack (the brief's step 4). Keys expire at 365 days — a calendar note, since a silent expiry would degrade the product with no error the doctor understands.
- **Consent and disclosure.** Manage gains a plain-language panel: *"Parcha can learn how you prescribe. It sends the shape of your prescriptions — which medicine, how often, how long — to Meko. It never sends a patient's name, age, phone or complaint, and never sends what the microphone heard. Turn this off and Parcha works exactly as before."* Default **off** for a new clinic; the doctor turns it on.

### 6.4 Quota and cost, honestly

Free tier is 1,000 conversation calls and 10,000 retrievals a month. Our budget per consultation: **1 conversation turn, 2–4 retrievals, 1–3 memory writes on sign.** At 60 patients a day that is ~1,800 conversations a month — **over the free cap on day one of real use.**

Mitigations, all in the plan:
- Step 2 of `runAgent` short-circuits: an utterance the rules fully place never reaches Meko at all. On the existing test corpus that is most of them.
- Recall is cached per visit in `sessionStorage`, keyed by the de-identified query.
- `conversation_add_message` is called **once per consultation** (on sign), not once per utterance. Per-utterance context goes in `memory_search` (a retrieval, not a conversation call).
- For the demo and a single-clinic pilot this fits. A multi-clinic rollout needs a paid plan, and the README says so rather than pretending otherwise.

### 6.5 Threat notes

- **Hallucinated clinical content.** The headline risk of putting any model near a prescription pad. Fully addressed by §3.3's closed world: enum-only tool schemas, `grounded()` before merge, re-grounding of recall, and the untouched server-side formulary check in `signPrescription`. `grounding.test.ts` is the gate, and Phase 3 will not wire the model until it is green.
- **Prompt injection via the knowledge base.** Largely **removed by the F5 cut**: with the Safety agent deferred, no uploaded document is ever read by an LLM. The one remaining upload is `formulary.md`, which the Formulary agent searches for drug names — generated by us from the `drugs` collection, never user-supplied, and its results pass through `grounded()` like everything else. **If the Safety agent is ever built, this threat returns in full** and its mitigation (advisory prose only, no pad-writing tool, `manage`-only upload) must be built with it.
- **Poisoned memory.** Meko is a hosted service holding sentences we later read back. A corrupted or tampered memory is not trusted as text: `groundRecall()` parses it back to a `drugId` and re-checks it against today's formulary before it can touch the pad.
- **Poisoned canon.** A doctor could promote a clinically wrong habit into canon. Mitigations: promotion requires `manage` **and** a recent sign-in, every promotion writes an `audit` row, canon chips show who promoted and when, and the existing `runConflictEngine` still runs underneath and is never overridden by canon.
- **Promotion is irreversible in Meko.** We therefore keep `mekoNominations` as our own mirror with state, and the UI says "this cannot be undone" before the button.

---

## 7. Build order

Each phase leaves the app shippable and has something to show.

### Phase 0 — the switch and the floor (2 h) · *demoable: the "Meko off" half*
`mekoEnabled` on `hospitals`, the `?meko=off` override, `runAgent()` that currently just calls `routeSpeech` and returns `degraded: "both"`, `RecallStrip` rendering an empty state. Nothing else changes; the app behaves exactly as today. **This is the control arm of the A1 comparison, and it exists before any Meko code does.**

### Phase 1 — the proxy (8 h) · *demoable: a terminal round-trip*
`meko.ts`, the MCP client, `mekoRecall` + `mekoRemember`, the `mekoCalls` log, `deidentify()` with its tests, `scripts/meko-bootstrap.mjs` creating the three datapacks. Demo: `firebase emulators` running, a callable invoked from a test, a memory visible in the Meko portal within seconds. **Budget 8 h, not 4** (§13.2 F6): an MCP client in Cloud Functions with no SDK example, plus ESM and secrets wiring, is the riskiest unknown in this plan and it is on the critical path.

### Phase 2 — the Habit agent (4 h) · *demoable: the money shot*
`habitFacts`, write on sign, recall in `withHabits`, `RecallStrip` live. Demo: sign a prescription for Dr Rao on the desk machine; open the app **in a second browser profile** (the ward tablet) as the same doctor; dictate "paracetamol for viral fever" with no frequency and no duration; **the pad fills in her line and asks nothing**, with a chip saying where it came from. With `?meko=off` in that same fresh profile, it asks two questions and writes a flat default. **The second profile is the point** — on her own machine `localStorage` already answers, so that is not evidence (§13.1 F1). **This alone satisfies A1, A2, A3 and A4.**

### Phase 3 — the local model and the Scribe agent (5 h) · *demoable: a sentence the regexes cannot place*
`llm.ts`, `agentTools()`, `grounded()`, `mergeAgentActions`, the Scribe's recall and corrections. Demo: "she's been bringing up phlegm since Tuesday, start her on the usual syrup at bedtime" — today that produces `{ kind: "unplaced" }`; now the Scribe places it, and a correction teaches it.

**Order within this phase is not negotiable: `grounded()` and `grounding.test.ts` are written
and green *before* `llm.ts` is wired to the pad.** The model does not get to reach
`VoiceAction[]` until the gate that filters it exists and is tested. Build the gate, prove it
rejects the adversarial list, then connect the model.

### Phase 4 — the Formulary agent (3 h) · *demoable: cross-agent hand-off*
KB upload of the formulary export; the Formulary agent's naming memory, written by one agent and read by another. Demo: say "Dolo" once, correct it once, say it in the next consultation — placed, with the chip attributing it to the Formulary agent. *(The Safety agent that shared this phase is deferred — §13.2 F5. The existing safety panel is untouched, so nothing regresses.)*

### Phase 5 — curation, review and promotion (4 h) · *demoable: the human-in-the-loop*
`mekoCurate` (the nightly ranking function), `mekoNominations`, the review screen under `manage`, `mekoPromote`. Demo: three doctors' habits converge; `mekoCurate` nominates; Dr Rao approves one; a locum's fresh session gets it as canon immediately. **This phase, not Phase 3, holds the most original idea in the build** — promotion with human review — so it outranks Scribe if time runs short.

### Phase 6 — the swarm view (4 h) · *demoable: the board*
`Swarm.tsx`, edges, counters, stream, replay, the seeded badge. Run the whole demo with the board open on a second screen.

### Phase 7 — polish (3 h)
README in five commands, the demo script timed to under five minutes, the feature proposal written, the LinkedIn post.

**Total ≈ 33 h** at the honest estimates (§13.2 F6), down from ≈ 45 h for the five-agent plan
— the F5 cut removed roughly 11 h and the F6 re-estimate added back 8 h on Phase 1 where the
real risk lives. Two people over a hackathon weekend now has slack instead of a deficit.

**The order to drop things in, decided now rather than at 2 a.m. on Sunday:**

| Priority | Phases | Why |
|---|---|---|
| **Must ship** | 0, 1, 2 | The switch, the proxy, the Habit agent. Satisfies A1–A5 on its own, needs no LLM, and is the part a clinic could actually pilot (§15.1). |
| **Should ship** | 5 | Promotion with human review — the most original idea here, and the locum demo that is §7.6's headline. |
| **Nice to have** | 4, 6 | The Formulary hand-off and the swarm board. Both are demo value rather than product value. |
| **Cut first** | 3 | The Scribe agent and the local model. Highest effort, highest hardware risk (F3), least certain payoff. |

Dropping Phase 3 loses one demo beat and no requirement. **If the machine fails the Qwen probe,
drop it without regret** — the submission is still complete, and §15.1 argues it is the better
product.

### 7.6 The demo story (≤5 min)

**The honest framing, said out loud at 0:20.** Parcha already remembers a doctor's habits *on
one computer*, in `localStorage`. So the demo never pretends a warm profile is a cold one. The
on/off comparison is made against a **warm** profile, on the three things a per-browser cache
structurally cannot do. Saying this to the judges is a point-scorer, not a confession: it shows
we know where our own baseline is.

1. **(0:00)** Dr Meena Rao, Rohini City Hospital. Swarm board on the second screen, empty.
   One line of framing, as above.
2. **(0:30) The warm-up, Meko off** (`?meko=off`), on her own desk machine with her habits
   already cached. Hold Space: *"viral fever, paracetamol 650, azithromycin 500"*. It fills both
   lines and asks nothing. **"That is today's app, and it is already good — on this one
   computer."** ~15 s.
3. **(0:50) Kill the baseline: the second device.** Pick up the ward tablet — a different
   browser, empty `localStorage`, same doctor. Meko still off. Same sentence: **four questions**,
   flat defaults. Then `?meko=on`, same sentence: **asks nothing**, both lines exactly as she
   writes them, two recall chips with their Meko scores. **This is the A1 delta, and no local
   cache can fake it.** ~60 s.
4. **(1:55) Sign it.** One `mekoRemember`; two edges light up on the board.
5. **(2:15) Forget.** Tap `Forget` on the azithromycin chip. Say it again — Parcha asks again.
   The context is hers to correct (A4).
6. **(2:45) Canon.** Last night's `mekoCurate` run nominated *"this clinic says Dolo for
   paracetamol 650"*. Dr Rao approves; the board shows a promotion edge. Human in the loop, on
   screen — and worth saying aloud that **the machine nominates but never promotes**.
7. **(3:20) The headline: the locum.** Sign in as Dr Khan, who has **never used Parcha on any
   machine**. Say *"Dolo 650 at night"*. Placed correctly on his very first utterance, chip
   attributed to clinic canon. **One doctor's experience changed the outcome for another — the
   thing `localStorage` can never do, because it is per-browser and dies with the person.** ~45 s.
8. **(4:05) Cross-agent.** Say a name only the Formulary agent has seen. The Scribe agent places
   it, and the board draws the `formulary → scribe` edge. Two agents, one shared context. ~25 s.
9. **(4:35)** Pull the network cable. Say the same sentence. It still works — the rules floor,
   with a visible "learning is offline" note. Close.

**Why this ordering wins.** Steps 3, 7 and 8 are the three claims a judge cannot attribute to
the cache we already shipped. The old script led with a fresh-profile comparison that a judge
could have punctured by clearing storage; this one hands them the baseline up front and then
beats it three times.

### 7.7 Five-command set-up (README)

```
git clone https://github.com/shikhar1809/PARCHA_HACKCBS_9_AFTERBURNERS.git && cd check
npm install
ollama pull qwen3:8b
node scripts/meko-bootstrap.mjs --api-key mko_tkn_…
npm run dev:emulators
```
(`npm run dev:emulators` = emulators + `npm run seed` + `npm run seed:meko` + the clinic dev server, one script.)

---

## 8. Built with Meko — the one rule, and Check T

Worth 10 points and it is the easiest 10 on the sheet, but only if done from the first commit.

1. One teammate creates the **`parcha-build`** datapack in the portal and invites the others as **Maintainers** (so they can promote) and the judges as **Viewers**.
2. Each teammate connects their coding agent with **their own** key:
   `npx @yugabytedb/meko-mcp@latest --client claude-code --url "https://mcp.mekodata.ai/mcp"` (or `claude mcp add --transport http meko https://mcp.mekodata.ai/mcp --header "Authorization: Bearer mko_tkn_…"`).
3. **The protocol goes in `AGENTS.md` at the repo root** — the file already exists and is already read by our agents. Add a section: *recall `parcha-build` before every task; save a short summary when a task ends; promote every decision the others must follow, naming yourself, because only promoted rows reach the team.* Note the existing caveat in that file about `next dev` rewriting its own block — add our section **below** it so a regeneration does not eat it.
4. **Never** put a key, a patient detail or a `doctorKey` salt in `parcha-build`.

**Keep the two apart.** `parcha-build` is the team's. `parcha-habit|formulary|scribe` are the product's. The coding agents never touch the product's datapacks; the product never reads the build datapack. The bootstrap script refuses to write to any datapack whose name ends in `-build`.

**Check T passes when** the build datapack holds ≥10 promoted decisions from ≥2 teammates' agents, each naming its author, and one teammate's agent can answer, live from Meko, something another teammate decided. Ten decisions this build genuinely produces: the datapack-per-agent split; the deterministic-floor rule; fail-closed de-identification; key-stays-server-side; `MekoFact` shape; the unawaited remember-on-sign; promotion needs `manage` + recent sign-in; `conversation_search_opt_out = true`; the `mekoCalls` schema; three agents rather than five, with the Curator as a scheduled function.

---

## 9. The Meko feature proposal

**The friction, real and ours:** Meko has no way to say *"this memory is about an individual, and must never be promoted"*, and no way to express *"this memory belongs to subject X"* other than smuggling a key into the text and hoping the hybrid scorer keeps it near the top. We had to invent `doctorKey` prefixes, duplicate the filtering server-side because search is a ranker and not an access boundary, and build our own `mekoNominations` mirror because promotion is irreversible with no staging state.

**The feature: scoped, non-promotable memories.**

1. `memory_add` gains `subject: string` (an opaque caller-defined key) and `promotable: boolean` (default `true`).
2. `memory_search` / `context_search` gain `subject` — a **filter**, applied before ranking, not a ranking hint.
3. `memory_promote` and `POST /promote-memories` refuse a memory with `promotable: false`, returning `not_promotable_ids` alongside the existing `not_found_ids`.
4. A new `memory_unpromote` for a staged, reversible window (say 24 h) after a promotion.

```jsonc
// call
{ "tool": "memory_add", "arguments": {
    "text": "writes paracetamol-650 1-0-1 for 3 days after food for viral fever",
    "datapack_id": "dp_…", "subject": "d:7a3f1c2e9b04", "promotable": false } }
// response
{ "memory_id": "mem_…", "subject": "d:7a3f1c2e9b04", "promotable": false }
```

**Before:** every clinic needs its own datapack set to keep doctors apart, we burn the 10-datapack cap at two clinics, and a reviewer can promote one doctor's personal habit into clinic canon by accident — irreversibly.
**After:** one datapack per agent across every clinic, filtering that is an actual boundary, and habits that are structurally impossible to promote.

**Why it's new:** mem0, Zep and LangGraph's checkpointer all give you namespaces, but none of them has Meko's promotion step, so none has the matching idea of *a memory that may be recalled but may never be shared*. That is the gap the promotion model itself creates.

**Risks:** `subject` could become a place to stash PII — so document it as opaque, reject anything that looks like an email or a phone, and never return it in a Viewer's results. Unpromote needs a trace entry of its own so the audit record of "this was canon for a day" survives.

---

## 10. Build in public

One LinkedIn post at the end of Phase 6: the 40-second on/off clip from §7.6 steps 2 and 5, one line on what Meko does in it (*"the pad learns how one doctor prescribes, and a review step makes it the clinic's"*), tagging **Meko**, **YugabyteDB** and **hackCBS 9.0**.

---

## 11. Degradation

Failure is the normal case in a rural clinic. Each mode is a visible state, never a silent one.

| What fails | What happens | What the doctor sees |
|---|---|---|
| Meko unreachable / 5xx / quota | `mekoRecall` returns `{ hits: [], degraded: true }` within a **1,200 ms** timeout; `runAgent` returns the rules' actions | Grey strip: *"Learning is offline. Parcha is working from its rules."* |
| **Cold Cloud Function** (first call of a session) | `minInstances: 1` on `mekoRecall` keeps one warm, **and** `warmUp()` on screen mount touches it before the doctor speaks. If both miss, the 1,200 ms timeout fires and the row above applies | Nothing, in the normal case. This is the row most likely to be hit in practice (§13.1 F2), so **M5 measures p95 cold as well as warm** |
| Ollama not installed / not running | `available()` is false (cached 60 s); step 4 skipped | *"The assistant model is not running on this computer."* — once, not per utterance |
| Model too slow | 2,500 ms `AbortSignal`, rules' actions returned | Nothing; it simply behaves as today |
| `deidentify()` fails closed | Nothing sent, nothing recalled, nothing learnt from that utterance | Nothing — the utterance is placed by rules as normal |
| Key expired (365 d) / revoked | 401 → `degraded`, **and** an `audit` row + a Manage banner | Manage: *"Parcha's learning key needs renewing."* |
| `mekoEnabled` false | No Meko code path runs at all | Today's app, exactly |
| Whisper unavailable | **Unchanged from today** — type to Parcha | Today's message |

**The invariant:** every degraded mode lands on today's shipped behaviour. There is no state in which voice mode is worse than it is now.

---

## 12. Testing against the emulators

### 12.1 Unit (`npm test`, existing vitest in `packages/core`)
- `deidentify.test.ts` — every `PHI_PATTERN` fails closed; a clinically normal sentence passes; the patient's own name passes as `known`; an exact-match name that is also a common word (Asha, Lata) is caught.
- `mekoFacts.test.ts` — a signed prescription of three lines yields three habit facts, no identifiers, stable text across runs (so the same habit doesn't duplicate in Meko).
- `voiceAgent.test.ts` — `mergeAgentActions` never lets the model override a rules action; a model tool call for a box the rules filled is dropped; the existing `voice.test.ts` / `voiceTalk.test.ts` corpus still passes **unchanged** through `runAgent` with `mekoEnabled: false`. **That last one is the regression gate for the whole plan.**
- **`grounding.test.ts` — the §3.3 gate, and the most important test file in this plan.**
  Each of these is an adversarial model output that must produce **nothing on the pad**:
  - a `drugId` that is not in `drugs[]` → dropped
  - a real `drugId` with a strength that drug does not carry (`paracetamol 1500 mg`) → dropped
  - a test name not in `COMMON_TESTS` → dropped
  - a frequency outside the `normaliseFrequency` vocabulary → dropped
  - an `unlisted:` id from the model in any form → dropped (only a human may write one)
  - `place_text` with `spanStart`/`spanEnd` outside the transcript, or reordered to form a
    phrase the doctor did not say → dropped
  - `durationDays` of 0, −1, 365, or non-integer → dropped
  - a diagnosis the model produced that appears nowhere in the transcript → dropped
  - **a fuzz pass:** 500 randomly-generated tool calls over random strings must yield zero
    pad actions. Property: `grounded(a, drugs) === false` ⟹ `a ∉ merge.actions`, always.
  - `groundRecall` on a memory naming a drug removed from the formulary → `null`
  - `groundRecall` on a memory with a strength the drug no longer carries → `null`

### 12.2 Functions against the emulator (`parcha-dev`)
- `firebase emulators:start` + `npm run seed`. Secrets in the emulator come from `firebase/functions/.secret.local` (git-ignored).
- **Fake Meko by default.** `scripts/meko-stub.mjs` — a 100-line Express server speaking the MCP tool subset, started by `npm run dev:emulators`, with `MEKO_BASE` pointing at it. CI never touches the real service and never burns quota. It can be told to return 401, 429, 500 and 3-second hangs, which is how §11's rows get tested.
- **One live smoke test**, run by hand before the demo: `npm run meko:smoke` → `GET /health`, `datapack_list`, a `memory_add` into a throwaway `parcha-smoke` datapack, a `memory_search` that finds it, a `memory_delete_by_id`. Prints latency for each. If this passes, the demo will run.
- Guard tests: `mekoRecall` without the `consult` ability → `permission-denied`; `mekoPromote` without `manage` → `permission-denied`; `mekoPromote` without a recent sign-in → `RECENT_SIGN_IN`; a PHI-carrying payload → `invalid-argument`; `mekoRemember` called twice with the same client id writes once (`once()`).

### 12.3 End to end
- The §7.6 script, run against the emulators with the stub, as a Playwright spec in whatever the repo already uses for `packages/client/src/e2e.ts`.
- **The A1 test, automated — and it must not be allowed to cheat.** The identical utterance
  through `runAgent` with `mekoEnabled` true and false must produce a *different*
  `VoiceAction[]`. **The off-arm runs with `localStorage` seeded from the same signed history
  that fed Meko** (`learn(uid, rx)` called first), because that is the real baseline: an empty
  profile makes this test pass for the wrong reason and proves nothing (§13.1 F1). Three cases,
  all required:
  1. **Second device** — Meko on, `localStorage` **empty**, habit present in Meko → placed.
     Same input, Meko off, storage empty → questions asked. *(The honest on/off delta.)*
  2. **Cross-doctor** — a `doctorKey` with no history of its own, canon seeded → placed.
     Meko off → questions asked. *(No cache can produce this.)*
  3. **Cross-agent** — a name known only to `parcha-formulary`, resolved for the Scribe agent.
  If case 1 ever passes with storage *warm* on both arms, the assertion is wrong, not the
  product: fail the build and fix the test.

---

## 13. Judgement — an honest rejudge of this plan

Written after re-reading the plan against the code it proposes to change. Scores are what a
judge would give **the submission this plan produces if executed as written**, not what the
document deserves as a document.

### 13.1 Two findings that blocked the demo — both now fixed in this document

> **Applied 2026-10-31.** F1 and F2 are no longer outstanding: the demo script (§7.6), the A1
> requirement (§2.1), the Phase 2 demo (§7), the automated A1 test (§12.3), `mekoRecall`'s
> options (§5.2), `warmUp()` (§5.3) and the degradation table (§11) have all been rewritten.
> The findings are kept below because the *reasoning* is the valuable part — anyone changing
> the demo or the function options later needs to know why they are the way they are.

**F1 — The A1 on/off comparison was partly fake, and a judge might have noticed.
(Severity: high. Fixed.)**
§7.6 step 2 claims that with Meko off, the same sentence asks four questions. That is only true
for a doctor with an **empty `localStorage`**. `startingLine()` in `packages/core/src/usual.ts`
already returns `source: "yours"` once a habit is cached locally, and `Pad.tsx` already does
`const ask = theirs ? [] : p.assumed.filter(…)` — so **today's shipped app, with Meko off,
already stops asking after the first signed prescription.** The demo's "off" arm only looks bad
because the browser profile is fresh.

This matters for 30 points: "Meko is load-bearing — the flow differs with Meko on and off."
If the honest comparison is *localStorage vs Meko*, the delta shrinks to things localStorage
genuinely cannot do.

**The fix, now applied in §7.6, makes the demo stronger rather than weaker.** The on/off demo
moved onto the three things `memory.ts` structurally cannot do, with the baseline conceded out
loud at 0:20:
1. **A second computer.** Dr Rao's habits on the ward tablet, having only ever been taught at
   the desk. `localStorage` is per-browser; this is the clean kill.
2. **The locum.** Dr Khan's first-ever utterance, from clinic canon (already §7.6 step 8 —
   promote it to the headline).
3. **Cross-agent recall.** "Dolo" learned by the Formulary agent, used by the Scribe agent.
Keep the fresh-profile version only as the warm-up, and label it as a fresh profile.
**The automated A1 test in §12.3 must seed `localStorage` before asserting a difference**, or it
passes trivially and proves nothing.

**F2 — The 1,200 ms recall budget would have been missed on the first call of every session.
(Severity: high. Fixed.)**
`firebase/functions/src/options.ts` sets `cpu: "gcf_gen1"` (~1/6 CPU), `concurrency: 1`,
`minInstances: 0`. A cold start there is **2–5 s before our code runs**, then Mumbai → Meko
(US-hosted, unconfirmed) and back. The §11 timeout fires, `degraded` shows, and the first
consultation of every morning silently gets no recall — the exact moment the doctor is forming
their opinion of the feature.

**The fix, now applied:** `minInstances: 1` on `mekoRecall` only (§5.2 — ~₹300–500/month for one
warm 256 MiB instance; it is the single exception to `options.ts`'s no-warm-instances rule,
justified in the code comment), **plus** `warmUp()` (§5.3) firing
`mekoRecall({ warm: true })` and `llm.available()` when the consultation screen mounts, beside
the existing `loadWhisper()` prefetch. A warm call spends no Meko quota and is not logged.
**Neither is assumed sufficient:** §14 M5 measures p95 cold as well as warm, and §11 gains an
explicit cold-start row.

### 13.2 Three more real weaknesses

**F3 — The hardware assumption contradicts evidence already in this repo. (Severity: medium.)**
`whisper.ts` exists in its current shape *because clinic machines were too slow*: it times one
pass of Whisper base and silently drops to tiny above `TOO_SLOW_MS = 4000`. A machine that
fails that test cannot run Qwen3 8B — and the plan asks it to run both, concurrently, in the
same browser session. §11 degrades gracefully, so nothing breaks; but on the hardware this
product targets, **the Scribe agent may simply never run**, making Phases 3–4 dead weight in
the field. Add a Qwen capability probe mirroring the Whisper one, record the result, and be
willing to ship with the Habit agent only (which needs no model at all — see F5).

**F4 — `place_text` spans will not work reliably on an 8B model. (Severity: medium.)**
Asking a small model for exact character offsets into a transcript is a known weak spot; it
will return off-by-several indices constantly, and §3.3 correctly drops those. Net effect:
diagnosis/advice routing fails most of the time. **Fix:** have the model return the *substring*
and fuzzy-match it back into the transcript server-side (`fuzzy.ts` already exists in
`packages/core`), accepting only a match above a similarity bar. Keeps the closed-world
guarantee — the text still must come from the doctor's own words — without needing arithmetic
the model is bad at.

**F5 — Five agents was over-built for the value, and for the free tier.
(Severity: medium. Fixed 2026-10-31.)**
7 of the 10 free datapacks went on `parcha-build` + 5 product agents + `parcha-smoke`, leaving
room for **one clinic**. Meanwhile the Habit agent delivers essentially all of the user-visible
win and needs no LLM; Safety and Curator were two of the four build phases and showed up for
~25 seconds of a 5-minute demo.

**Applied.** The swarm is now **Habit + Formulary + Scribe** (§3.2). The Curator became
`mekoCurate`, a nightly scheduled function (§5.2) — ranking memories by recurrence is a query,
not a conversation, so it had nothing to remember and nothing to learn. Safety is **deferred,
not cancelled**: it is the one piece that touches the safety panel, which §16 keeps out of
scope, and it carried the only knowledge-base prompt-injection surface in the design (§6.5 is
correspondingly smaller now).

**What the cut bought:** ~11 h of build time; two clinics inside the free datapack cap instead
of one; one fewer LLM-reading-documents attack surface; and a swarm where every node does real
work. **What it cost:** two board nodes and about 25 seconds of demo. The hand-offs the brief
actually asks about — Formulary → Scribe, both → Habit — are untouched.

**If Phases 0–4 land by Saturday night**, the honest next move is *not* to re-add Safety; it is
to deepen the promotion/review flow, which is where this project's originality actually lives.

**F6 — Estimates were optimistic by roughly 50%. (Severity: medium. Fixed 2026-10-31.)**
Phase 1 at 4 h assumed an MCP client in Cloud Functions works first try, with no SDK example,
ESM/CJS friction, secrets wiring and emulator config. **Phase 1 is now budgeted at 8 h and
flagged as the riskiest unknown on the critical path**, and §7 carries an explicit drop-order
table so the cut decision is made now rather than at 2 a.m. on Sunday.

With F5 applied the honest total is **≈ 33 h**, not the original 30 and not the 45 the
five-agent plan really needed. That is the first version of this schedule with slack in it.

### 13.3 Rubric rejudge

Scored as a judge would, assuming competent execution. **"Was" is the original plan; "Now" is
this document with F1, F2, F5 and F6 applied.** F3 (the Qwen hardware bet) and F4
(`place_text` offsets) remain open, and both are now survivable because Phase 3 is explicitly
the first thing cut.

| Criterion | Max | Was | **Now** | Ceiling | What moves it |
|---|---|---|---|---|---|
| The idea | 20 | 16 | **17** | 18 | Strong, lived, unfakeable domain detail. Caps below 18 because "app learns your habits" is a familiar shape; the *promotion-with-review* step is the original part and now leads both the demo (§7.6 step 7) and the drop-order (§7). |
| Meko's role | 30 | 21 | **27** | 28 | Six primitives with real reasons. F1 was the whole gap: the demo now proves Meko on the three things a per-browser cache cannot do, and the A1 test can no longer pass for the wrong reason. Three working agents read as *more* load-bearing than five with two idle. |
| Build and execution | 25 | 17 | **23** | 23 | Degradation, closed-world rule and privacy work well above hackathon norm. F2 removes the on-stage timeout risk; **F5 and F6 are what move this +3** — 33 h with a written drop-order is a schedule that finishes, and "we cut two agents on purpose, here is the reasoning" is a stronger answer to a judge than two half-built ones. |
| Built with Meko | 10 | 9 | **9** | 10 | Mechanical and well specified. Only risk is forgetting to start it at commit one. |
| Feature proposal | 10 | 8 | **8** | 10 | Grounded in friction genuinely hit, with a concrete tool signature. **Cite the build datapack as evidence** — the brief asks for it explicitly, and that is the missing 2. |
| Build in public | 5 | 3 | **3** | 5 | Still thin: one post at the end. Bonus is likes-weighted, so post during the build too. |
| **Total** | **100** | **74** | **87** | **94** | |

**87 places well; 94 wins.** The remaining 7 points cost no code and no architecture:
cite the build datapack in the feature proposal (**+2**), post during the build rather than
once at the end (**+2**), and sharpen the pitch so promotion-with-review leads instead of habit
recall (**+1**). The last 2 are judge-dependent and not worth chasing.

**The scope cut raised the score.** That is worth stating plainly, because the instinct at a
hackathon is the opposite: five agents sounded more impressive and scored four points lower,
because two of them would not have been finished and the datapack budget only fitted one clinic.

---

## 14. Test metrics — the pass bars

§12 lists tests but sets no bar, which means none of them can fail meaningfully. These are the
numbers. **A metric with no number is a wish.** All are measured on `npm run metrics`, which
runs the corpus below and prints a table; CI fails on any red.

**The corpus.** 200 utterances in `packages/core/test/corpus/`: 120 harvested from the existing
`voice.test.ts` / `voiceTalk.test.ts` cases, 80 new ones written by hand covering Hinglish,
run-on dictation, and the F4 diagnosis/advice cases. Each labelled with its expected
`VoiceAction[]`. **No patient data; all invented.** This file is the regression contract.

| # | Metric | Measures | Red | Target | Stretch | How |
|---|---|---|---|---|---|---|
| **M1** | **Placement accuracy** | correct box + correct `drugId` per clause | < 92% | **≥ 96%** | 98% | corpus vs expected |
| **M2** | **Regression delta** | M1 with `mekoEnabled: false` vs today's `routeSpeech` | **any drop** | **0 drop** | — | the hard gate: the floor may never get worse |
| **M3** | **Ungrounded leak rate** | model actions reaching the pad that fail `grounded()` | **> 0** | **0** | 0 | §12.1 adversarial set + 2,000 mutation cases (take a valid action, perturb one field) |
| **M4** | **PHI leak rate** | payloads leaving `deidentify()` containing a planted identifier | **> 0** | **0** | 0 | 500 synthetic utterances with names/phones/ages planted; recall **must be 100%**, precision ≥ 85% (over-refusal is acceptable, leaking is not) |
| **M5** | **Recall latency p95, warm** | `mekoRecall` round trip with the instance warm | > 1,200 ms | **≤ 700 ms** | 400 ms | 100 calls against live Meko, with `minInstances: 1` live |
| **M5c** | **Recall latency p95, cold** | same, first call after a forced redeploy | > 3,000 ms | **≤ 1,800 ms** | — | 10 forced cold starts. Red here means `warmUp()` is load-bearing rather than belt-and-braces, so **M9 must prove the cold path degrades cleanly** |
| **M6** | **Local model latency p95** | `complete()` on the clinic's actual machine | > 2,500 ms | **≤ 1,500 ms** | 800 ms | 50 calls, Qwen3 8B. Above red → ship Habit-only (F3) |
| **M7** | **Question-reduction rate** | % of `nextQuestion()` prompts avoided, Meko on vs off | < 20% | **≥ 40%** | 60% | **this is the A1 number.** Measured on a **fresh profile with warm Meko** against a **fresh profile with Meko off** — the second-device case from §7.6 step 3. Measured on a warm `localStorage` it would read near zero, which is the correct answer to the wrong question (F1) |
| **M7b** | **Cross-device parity** | M1 on a fresh profile with Meko on vs the same doctor's warm profile with Meko off | < 95% | **≥ 99%** | 100% | the claim the demo makes at 0:50: a second device behaves like the desk machine |
| **M8** | **Cross-scope recall** | locum's first utterance placed correctly from canon alone | < 90% | **100%** | — | 20 seeded canon entries, fresh doctor, no personal history |
| **M9** | **Degradation correctness** | each §11 row lands on today's behaviour | **any failure** | **0 failures** | — | stub returns 401/429/500/timeout for each row |
| **M10** | **Meko call budget** | conversation calls per consultation | > 1 | **≤ 1** | — | counted off `mekoCalls`; retrievals ≤ 4 |
| **M11** | **Setup time** | clone → working demo, clean machine, excluding model download | > 15 min | **≤ 8 min** | 5 min | timed by a teammate who did not write it |

**M2, M3 and M4 are release gates — red blocks merge.** The rest are tracked and reported.
M3 and M4 at zero are non-negotiable because they are the two failures that could harm a
patient or breach a confidence; everything else is a quality number.

---

## 15. Practical usability — will a real doctor actually use this?

Separate from the hackathon score, and lower. A judge rewards ambition; a clinic rewards
reliability at 11 a.m. with 40 people waiting. Scored for **Rohini City Hospital as it really
is**, not for the stage.

| Dimension | Weight | Score | Honest reasoning |
|---|---|---|---|
| **Solves a real daily pain** | 25% | **8/10** | Typing the same line hundreds of times is genuine, and the locum/second-device cases are real. Not a 10 because the existing `memory.ts` already removes much of the sting for a single doctor on one machine. |
| **Works on the actual hardware** | 20% | **4/10** | The weakest link by far (F3). Whisper base already falls back to tiny on these machines; Qwen3 8B alongside it is optimistic. Habit-only needs no model and scores 9 here — which is the argument for shipping that first. |
| **Works on the actual network** | 15% | **8/10** | §11 is genuinely good: everything lands on today's behaviour. F2 fixed (`minInstances: 1` + `warmUp()`) removes the first-call-of-the-morning degradation that would have taught doctors to distrust it. Still −2: unproven until M5/M5c run against live Meko, whose hosting region we never confirmed. |
| **Trustworthy with patient data** | 15% | **9/10** | Audio never moves; the fail-closed gate, the pattern-not-event split and the server re-check are stronger than most production systems. −1 only because it is unproven until M4 runs. |
| **Clinically safe** | 15% | **9/10** | The closed-world rule plus the untouched `signPrescription` formulary check make the dangerous failure structurally unreachable. −1 for the auto-fill-without-asking path: recall makes it ask *less*, and a tired doctor signs what is in front of them. **Keep the "check it" label on anything recalled, as the pad already does for class defaults.** |
| **Learnable in one shift** | 10% | **8/10** | Hold Space is already learned. The Recall strip adds three buttons and one new idea. The promotion/review screen is a second concept, but only a `manage` holder meets it. |
| **Survives staff turnover** | — | bonus | The thing the current build does worst and this plan does best: canon outlives the doctor who taught it. This is the real product argument, and it should lead the pitch. |

**Weighted score: 7.3 → 7.5 / 10** with F1 and F2 applied — *"a genuinely useful feature still
carrying one serious hardware bet."* F2 was the network point; F1 never affected usability at
all, only the honesty of the pitch.
**With F3 taken seriously (ship Habit-first, model optional): 8.4 / 10**, and that remains the
single biggest available improvement to the *product*, as against the score.

### 15.1 What I would actually ship to a clinic

Not all seven phases. **Phases 0, 1, 2 and 5** — the switch, the proxy, the Habit agent and
human-reviewed promotion. That is:
- no LLM on the clinic machine at all, so F3 and M6 vanish entirely;
- the entire user-visible win (it stops asking, on every device, and a locum inherits it);
- the one genuinely original idea (promotion with review);
- **18 h of work** (Phases 0+1+2+5 = 2+8+4+4), and §7's drop-order table now makes this the
  default path rather than a retreat — Phase 3 is named as the first thing cut.

Formulary (Phase 4) and the swarm view (Phase 6) are the *hackathon* half: they make the board
legible and earn demo points without changing what a doctor gets. Scribe (Phase 3) is the
experiment. **Saying this plainly to the judges — "this part ships, this part is the
experiment" — is worth more than pretending all of it is production-ready**, and after the F5
cut it is also simply true.

**The deferred Safety agent is the right follow-up, but not soon.** RAG over protocol documents
as a second opinion is genuinely valuable and genuinely risky: it is the only place in this
design where a model reads clinical prose and a doctor might act on it. It deserves its own
plan, its own clinical review, and the prompt-injection mitigations §6.5 describes — not a
Sunday-afternoon slot.

---

## 16. What is not in scope

The manual pad, the dictation box and `useMic`, drug search, the safety panel's existing deterministic engine, the sign flow, every other screen, the patient app, the desktop wrapper, the Firestore rules' deny-write posture, and the on-device Whisper path. None of them is edited by any phase above.
