import { errorMessage, signPrescription, useFormulary, usePrescriptions, useVisit, useVisitsForPatient } from "@parcha/client";
import {
  TIMINGS,
  TIMING_LABELS,
  normaliseFrequency,
  parseDictation,
  startingLine,
  suggestedQuantity,
  EVERY_DAYS,
  everyText,
  fromFourSlots,
  slotNames,
  toFourSlots,
  validateItem,
  COMMON_TESTS,
  UNLISTED_FORMS,
  cleanTests,
  isUnlisted,
  unlistedItem,
  type Drug,
  type Pregnancy,
  type DictationResult,
  type PrescriptionItem,
  type ScheduleSource,
  type Timing,
  lineFromProposal,
  matchesRemoval,
  nextQuestion,
  questionKey,
  routeSpeech,
  sayFrequency,
  sayLine,
  sayPrescription,
  type PadState,
} from "@parcha/core";
import { DosePictogram, cn } from "@parcha/ui";
import {
  Baby,
  Bookmark,
  Check,
  FlaskConical,
  ChevronDown,
  History,
  Loader2,
  Mic,
  Plus,
  Star,
  Trash2,
  X,
  Moon,
  Sun,
  Sunrise,
  Sunset,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useIdentity } from "../../auth";
import { Btn, Card, FIELD, Label } from "../../bits";
import { DrugSearch, WordSuggest } from "./DrugSearch";
import { deleteSet, learn, loadMemory, saveSet, top, type RxSet } from "./memory";
import { SafetyPanel, useSafetyCheck } from "./SafetyPanel";
import { useMic } from "./useMic";
import { VoiceBar, type Placed, type Turn } from "./VoiceBar";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const PRESETS = ["OD", "BD", "TDS", "QID", "HS", "SOS"];

/** Advice a doctor gives forty times a day: one tap adds the line, Hindi first. */
const ADVICE = [
  "Aaram karein, paani zyada piyein. (Rest, drink plenty of water.)",
  "Dawai khana khane ke baad lein. (Take the medicines after food.)",
  "Tel, masala aur bahar ka khana kam karein. (Less oil, spice and outside food.)",
  "Namak kam karein. (Less salt.)",
  "Meetha band karein, roz 30 minute chalein. (No sweets; walk 30 minutes a day.)",
  "Bukhar 3 din se zyada rahe to turant aayein. (Come back at once if the fever lasts over 3 days.)",
  "Saans phoole ya seene mein dard ho to turant aayein. (Come at once if breathless or chest pain.)",
];
const FOLLOW_UPS = [3, 5, 7, 14, 30];

type LineSource = ScheduleSource | "last" | "set";
const SOURCE_LABEL: Record<LineSource, string> = {
  last: "As at the last visit",
  set: "From your set",
  yours: "As you usually write it",
  class: "Usual starting schedule: check it",
  default: "Default schedule: check it",
};

/**
 * The prescribing pad, built for a doctor seeing a patient every few minutes.
 *
 * The fastest ways in come first: the same as last visit, a saved set, or one
 * of the doctor's own usual medicines, each one tap. Then the search (type,
 * Enter). A medicine starts as this doctor usually writes it, else as its
 * class is usually started, so most lines need no edit at all. Dictation is
 * there for several at once, and asks the doctor to confirm only what it
 * guessed. Ctrl+Enter signs. Nothing is sent until the doctor signs: the
 * signature is the act, and every line is in view above it.
 *
 * Writing the first thing calls the patient in (the consultation starts), so
 * there is no separate Start step.
 */
export function Pad({ visitId, started, onStart }: { visitId: string; started: boolean; onStart: () => Promise<void> }) {
  const formulary = useFormulary();
  const { identity } = useIdentity();
  const visit = useVisit(visitId);
  const drugs = formulary.data;
  const uid = identity?.uid;
  const [memory, setMemory] = useState(() => loadMemory(uid));
  useEffect(() => setMemory(loadMemory(uid)), [uid]);

  const [text, setText] = useState("");
  const [dictating, setDictating] = useState(false);
  const [parsed, setParsed] = useState<DictationResult | null>(null);
  const [items, setItems] = useState<PrescriptionItem[]>([]);
  const [sources, setSources] = useState<Record<string, LineSource>>({});
  const [diagnosis, setDiagnosis] = useState("");
  const [advice, setAdvice] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [tests, setTests] = useState<string[]>([]);
  const [testDraft, setTestDraft] = useState("");
  const [pregnancy, setPregnancy] = useState<Pregnancy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [setName, setSetName] = useState<string | null>(null);
  // Voice first: what the voice only defaulted (and so must ask), questions skipped, and what it just placed.
  const [guessed, setGuessed] = useState<Record<string, string[]>>({});
  const [skipped, setSkipped] = useState<string[]>([]);
  // The conversation with Parcha for this visit, kept while the tab is open.
  const threadKey = `parcha.voice.thread.${visitId}`;
  const [thread, setThread] = useState<Turn[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(threadKey) ?? "[]") as Turn[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(threadKey, JSON.stringify(thread.slice(-60)));
    } catch {
      /* kept on screen only */
    }
  }, [thread, threadKey]);
  /** The medicines last talked about: what "it", "that" and "both" mean. */
  const [focus, setFocus] = useState<string[]>([]);
  /** The pad before each thing said, so "undo" can put it back. */
  const before = useRef<{ items: PrescriptionItem[]; diagnosis: string; advice: string; followUp: string; tests: string[]; guessed: Record<string, string[]> }[]>([]);
  const safety = useSafetyCheck(visitId, items, pregnancy);
  // Pregnancy is asked of a woman who could be pregnant (or whose age is not known).
  const age = visit.data?.patientAgeYears ?? null;
  const askPregnancy = visit.data?.patientSex === "female" && (age === null || (age >= 12 && age <= 50));
  const unread = safety.flags.filter((f) => f.severity === "high" && !acknowledged.has(f.key));

  // The patient's last signed prescription, for "same as last visit".
  const history = useVisitsForPatient(visit.data?.patientId ?? null);
  const last = history.data.find((h) => h.id !== visitId && h.stage === "prescribed") ?? null;
  const lastRx = usePrescriptions(last?.id ?? null).data[0] ?? null;

  const mic = useMic((heard) => {
    setDictating(true);
    setText((t) => (t.trim() ? `${t.trim()}\n${heard}` : heard));
  });

  // Writing anything calls the patient in, once.
  const starting = useRef(false);
  const ensureStarted = async () => {
    if (started || starting.current) return;
    starting.current = true;
    try {
      await onStart();
    } catch (e) {
      starting.current = false;
      setError(errorMessage(e));
    }
  };

  const problems = items.flatMap((i) => validateItem(i).map((p) => `${i.drugName || "A line"}: ${p}`));
  const canSign = items.length > 0 && problems.length === 0 && !busy && unread.length === 0 && !safety.checking;

  function put(item: PrescriptionItem, source?: LineSource) {
    void ensureStarted();
    setItems((list) => (list.some((l) => l.drugId === item.drugId) ? list.map((l) => (l.drugId === item.drugId ? item : l)) : [...list, item]));
    if (source) setSources((s) => ({ ...s, [item.drugId]: source }));
  }

  function addDrug(drug: Drug, strength?: string | null) {
    const { item, source } = startingLine(drug, memory.lines[drug.id]);
    put(strength && drug.strengths.includes(strength) ? { ...item, strength } : item, source);
  }

  function applyLines(lines: PrescriptionItem[], from: LineSource) {
    for (const l of lines) if (drugs.some((d) => d.id === l.drugId) || isUnlisted(l)) put({ ...l }, from);
  }

  function applySet(s: RxSet) {
    applyLines(s.items, "set");
    if (s.diagnosis && !diagnosis.trim()) setDiagnosis(s.diagnosis);
    if (s.advice && !advice.trim()) setAdvice(s.advice);
    if (s.followUp && !followUp) setFollowUp(s.followUp);
  }

  function update(index: number, patch: Partial<PrescriptionItem>) {
    setItems((list) =>
      list.map((it, i) => {
        if (i !== index) return it;
        const next = { ...it, ...patch };
        // Keep the count in step with the schedule, unless the schedule is
        // one that has no arithmetic (SOS, STAT).
        if ("frequency" in patch || "durationDays" in patch || "everyDays" in patch) {
          const q = suggestedQuantity(next.frequency, next.durationDays, next.everyDays ?? 1);
          if (q !== null) next.quantity = q;
        }
        return next;
      }),
    );
  }

  async function sign() {
    if (!canSign) return;
    setError(null);
    setBusy(true);
    try {
      await ensureStarted();
      await signPrescription(
        {
          visitId,
          diagnosis: diagnosis.trim(),
          advice: advice.trim(),
          followUpDays: followUp ? Number(followUp) : null,
          items,
          tests: cleanTests(tests),
          pregnancy: askPregnancy ? pregnancy : null,
          acknowledged: [...acknowledged],
        },
        identity && visit.data ? { prescriberName: identity.displayName, prescriberUid: identity.uid, patientId: visit.data.patientId } : undefined,
      );
      if (uid) learn(uid, { diagnosis, items });
      // The visit's stage moves to "prescribed" and the screen follows it.
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  // Ctrl+Enter (or Cmd+Enter) signs from anywhere on the pad.
  const signRef = useRef(sign);
  signRef.current = sign;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void signRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // What dictation did not say starts as this doctor writes it (or the usual
  // schedule), not a flat default; it is still marked as guessed.
  function withHabits(result: DictationResult): DictationResult {
    return {
      ...result,
      proposals: result.proposals.map((p) => {
        const drug = drugs.find((d) => d.id === p.item.drugId);
        if (!drug) return p;
        const start = startingLine(drug, memory.lines[drug.id]).item;
        const item = { ...p.item };
        if (p.assumed.includes("frequency")) item.frequency = start.frequency;
        if (p.assumed.includes("duration")) item.durationDays = start.durationDays;
        if (p.assumed.includes("timing")) item.timing = start.timing;
        if (p.assumed.includes("strength")) item.strength = start.strength;
        item.quantity = suggestedQuantity(item.frequency, item.durationDays) ?? item.durationDays;
        return { ...p, item };
      }),
    };
  }

  // ------------------------------------------------------------------ voice
  const padState: PadState = { diagnosis, followUp, items, guessed, skipped, focus };
  const question = nextQuestion(padState);

  // What Parcha still needs is asked in the conversation too, once.
  useEffect(() => {
    if (!question) return;
    setThread((t) => (t.at(-1)?.text === question.ask ? t : [...t, { who: "parcha", text: question.ask, ask: true }]));
  }, [question?.ask]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Does what the doctor said (or typed to Parcha), and says back what it did. */
  function heard(words: string, typed = false) {
    const actions = routeSpeech(words, drugs, padState, question);
    const said: Placed[] = [];
    const talkedAbout: string[] = [];
    if (actions.some((a) => a.kind !== "readBack" && a.kind !== "undo")) {
      before.current = [...before.current.slice(-19), { items, diagnosis, advice, followUp, tests, guessed }];
    }
    for (const a of actions) {
      if (a.kind === "diagnosis") {
        void ensureStarted();
        setDiagnosis(a.value);
        said.push({ box: "Diagnosis", text: a.value, say: `Diagnosis: ${a.value}.` });
      } else if (a.kind === "advice") {
        void ensureStarted();
        setAdvice((v) => (v.trim() ? `${v.trim()}\n${a.value}` : a.value));
        said.push({ box: "Advice", text: a.value, say: `Advice: ${a.value}.` });
      } else if (a.kind === "followUp") {
        setFollowUp(String(a.days));
        said.push({ box: "Follow-up", text: `in ${a.days} days`, say: `Follow-up in ${a.days} days.` });
      } else if (a.kind === "tests") {
        void ensureStarted();
        setTests((t) => [...new Set([...t, ...a.values])]);
        said.push({ box: "Tests", text: a.values.join(", "), say: `Tests: ${a.values.join(", ")}.` });
      } else if (a.kind === "medicines") {
        for (const p of withHabits({ proposals: a.proposals, unresolved: [] }).proposals) {
          const drug = drugs.find((d) => d.id === p.item.drugId);
          // What the doctor did not say but usually writes is theirs; only a plain default is asked about.
          const theirs = drug ? startingLine(drug, memory.lines[drug.id]).source === "yours" : false;
          const ask = theirs ? [] : p.assumed.filter((f) => f === "frequency" || f === "duration");
          const line = lineFromProposal(p);
          // Fully spoken lines carry no "check it" label; a default does.
          put(line, p.assumed.length === 0 ? undefined : theirs ? "yours" : "default");
          setGuessed((g) => ({ ...g, [line.drugId]: ask }));
          talkedAbout.push(line.drugId);
          // What was not said is named, so a filled-in default never reads as if the doctor said it.
          const unsaid = p.assumed.filter((f) => f !== "medicine").map((f) => ({ frequency: "how often", duration: "how long", timing: "when", strength: "strength" })[f] ?? f);
          const usual = !unsaid.length ? "" : theirs ? " (your usual for what was not said)" : ` (not said: ${unsaid.join(", ")}; check)`;
          said.push({ box: "Medicine", text: sayLine(line) + usual, say: `Added ${sayLine(line)}${usual}.` });
        }
      } else if (a.kind === "change") {
        const index = items.findIndex((it) => it.drugId === a.drugId);
        if (index >= 0 && Object.keys(a.patch).length) {
          update(index, a.patch);
          setGuessed((g) => ({ ...g, [a.drugId]: (g[a.drugId] ?? []).filter((f) => !(f === "duration" && "durationDays" in a.patch) && !(f === "frequency" && "frequency" in a.patch)) }));
          const now = { ...items[index], ...a.patch };
          said.push({ box: "Changed", text: sayLine(now), say: `${a.drugName} is now ${sayLine(now).slice(sayLine(now).indexOf(",") + 2)}.` });
        } else said.push({ box: "Already on", text: a.drugName, say: `${a.drugName} is already on the prescription. Say what to change: how often, how long, or when.` });
        talkedAbout.push(a.drugId);
      } else if (a.kind === "remove") {
        const last = /\blast\b/i.test(a.drugName);
        const target = last ? items[items.length - 1] : items.find((it) => matchesRemoval(it, a.drugName));
        if (target) {
          setItems((list) => list.filter((it) => it.drugId !== target.drugId));
          said.push({ box: "Removed", text: target.drugName, say: `Removed ${target.drugName}.` });
        } else said.push({ box: "Not found", text: `No ${a.drugName} on the prescription`, tone: "miss", say: `${cap(a.drugName)} is not on the prescription.` });
      } else if (a.kind === "answer") {
        const q = a.question;
        if ("drugId" in q) {
          const index = items.findIndex((it) => it.drugId === q.drugId);
          if (index >= 0) update(index, a.patch as Partial<PrescriptionItem>);
          setGuessed((g) => ({ ...g, [q.drugId]: (g[q.drugId] ?? []).filter((f) => f !== q.kind) }));
          talkedAbout.push(q.drugId);
          const v = q.kind === "duration" ? `${(a.patch as { durationDays: number }).durationDays} days` : sayFrequency((a.patch as { frequency: string }).frequency);
          said.push({ box: q.drugName, text: v, say: `${q.drugName}: ${v}.` });
        } else if (q.kind === "diagnosis") {
          setDiagnosis((a.patch as { diagnosis: string }).diagnosis);
          said.push({ box: "Diagnosis", text: (a.patch as { diagnosis: string }).diagnosis, say: `Diagnosis: ${(a.patch as { diagnosis: string }).diagnosis}.` });
        } else {
          setFollowUp(String((a.patch as { followUp: number }).followUp));
          said.push({ box: "Follow-up", text: `in ${(a.patch as { followUp: number }).followUp} days`, say: `Follow-up in ${(a.patch as { followUp: number }).followUp} days.` });
        }
      } else if (a.kind === "undo") {
        const prev = before.current.pop();
        if (prev) {
          setItems(prev.items);
          setDiagnosis(prev.diagnosis);
          setAdvice(prev.advice);
          setFollowUp(prev.followUp);
          setTests(prev.tests);
          setGuessed(prev.guessed);
          said.push({ box: "Undone", text: "the last change", say: "Undone. The prescription is back to how it was." });
        } else said.push({ box: "Undo", text: "nothing to undo", tone: "miss", say: "There is nothing to undo." });
      } else if (a.kind === "readBack") {
        said.push({ box: "Prescription", text: "read back", say: sayPrescription({ diagnosis, items, tests, advice, followUp }) });
      } else {
        said.push({ box: "Not placed", text: `"${a.words}"`, tone: "miss", say: `I did not understand "${a.words}". Say it again, or type it.` });
      }
    }
    if (talkedAbout.length) setFocus(talkedAbout);
    const reply = said.length ? said.map((p) => p.say).join(" ") : "I did not hear anything to place. Say it again, or type it.";
    setThread((t) => [...t, { who: "doctor", text: words, typed }, { who: "parcha", text: reply, parts: said }]);
  }

  const usual = useMemo(
    () =>
      top(memory.counts, 10)
        .map((id) => drugs.find((d) => d.id === id))
        .filter((d): d is Drug => !!d && !items.some((i) => i.drugId === d.id)),
    [memory, drugs, items],
  );
  const recentDiagnoses = top(memory.diagnoses, 6).filter((d) => d !== diagnosis);
  const lastDate = last?.prescribedAt ? new Date(last.prescribedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";

  return (
    // Its own container, so the `@lg` layouts below measure this column and
    // not the whole pane.
    <div className="@container space-y-5 p-4">
      {!started ? (
        <p className="rounded-xl border-2 border-dashed border-[#232326]/40 px-3 py-2 text-sm">
          Not called in yet. Writing anything calls {visit.data?.patientName ?? "the patient"} in, so the desk sees them “in the room”.
        </p>
      ) : null}

      <div>
        <Label>Diagnosis</Label>
        <input
          value={diagnosis}
          onChange={(e) => {
            setDiagnosis(e.target.value);
            void ensureStarted();
          }}
          placeholder="What you found"
          className={FIELD}
        />
        {recentDiagnoses.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recentDiagnoses.map((d) => (
              <Chip key={d} onClick={() => setDiagnosis(d)}>
                {d}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      {askPregnancy ? (
        <div>
          <Label>Pregnancy</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            <Baby className="size-5" aria-hidden />
            {(
              [
                ["pregnant", "Pregnant"],
                ["breastfeeding", "Breastfeeding"],
                ["no", "Neither"],
              ] as const
            ).map(([value, label]) => (
              <Chip key={value} on={pregnancy === value} onClick={() => setPregnancy(pregnancy === value ? null : value)}>
                {label}
              </Chip>
            ))}
            {pregnancy === null ? <span className="text-sm">Not asked yet</span> : null}
          </div>
        </div>
      ) : null}

      {/* The fastest ways in. */}
      {lastRx || memory.sets.length || usual.length ? (
        <div className="space-y-2.5 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-3">
          {lastRx && lastRx.items.length ? (
            <button
              type="button"
              onClick={() => {
                applyLines(lastRx.items, "last");
                if (lastRx.diagnosisText && !diagnosis.trim()) setDiagnosis(lastRx.diagnosisText);
                if (lastRx.tests?.length && tests.length === 0) setTests(lastRx.tests);
              }}
              className="flex w-full items-center gap-3 rounded-xl border-[3px] border-[#232326] bg-white px-3 py-2.5 text-left shadow-[0_3px_0_#232326] active:translate-y-0.5"
            >
              <History className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block text-base font-bold">Same as last visit{lastDate ? ` (${lastDate})` : ""}</span>
                <span className="block truncate text-sm">
                  {lastRx.diagnosisText ? `${lastRx.diagnosisText}: ` : ""}
                  {lastRx.items.map((i) => i.drugName).join(", ")}
                </span>
              </span>
            </button>
          ) : null}
          {memory.sets.length ? (
            <div>
              <p className="mb-1.5 text-xs font-bold tracking-wide uppercase">Your sets</p>
              <div className="flex flex-wrap gap-1.5">
                {memory.sets.map((s) => (
                  <span key={s.name} className="inline-flex items-center rounded-full border-2 border-[#232326] bg-white">
                    <button type="button" onClick={() => applySet(s)} className="flex items-center gap-1 py-1 pr-1.5 pl-3 text-sm font-bold" title={s.items.map((i) => i.drugName).join(", ")}>
                      <Bookmark className="size-3.5" aria-hidden /> {s.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete the set ${s.name}`}
                      onClick={() => {
                        if (uid) deleteSet(uid, s.name);
                        setMemory(loadMemory(uid));
                      }}
                      className="rounded-full p-1 pr-2 hover:bg-black/10"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {usual.length ? (
            <div>
              <p className="mb-1.5 text-xs font-bold tracking-wide uppercase">Your usual medicines</p>
              <div className="flex flex-wrap gap-1.5">
                {usual.map((d) => (
                  <Chip key={d.id} onClick={() => addDrug(d)}>
                    <Star className="size-3.5" aria-hidden /> {d.genericName}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <Label>Add a medicine: type, then Enter</Label>
        <DrugSearch drugs={drugs} onPick={(d, strength) => addDrug(d, strength)} onWrite={(name) => put(unlistedItem(name))} />
        {formulary.error ? (
          <p role="alert" className="text-destructive mt-2 text-sm">
            Could not load the formulary. {formulary.error}
          </p>
        ) : null}
      </div>

      <div>
        <Label>On the prescription ({items.length})</Label>
        {items.length === 0 ? (
          <Card>
            <p className="text-base">Nothing yet. Pick from above, search, or dictate several at once below.</p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {items.map((item, i) => (
              <ItemEditor
                key={item.drugId}
                item={item}
                source={sources[item.drugId]}
                drug={drugs.find((d) => d.id === item.drugId)}
                onChange={(patch) => update(i, patch)}
                onRemove={() => setItems((list) => list.filter((_, j) => j !== i))}
              />
            ))}
          </ul>
        )}
      </div>

      <div>
        <button type="button" onClick={() => setDictating(!dictating)} className="flex items-center gap-2 text-base font-bold" aria-expanded={dictating}>
          <ChevronDown className={cn("size-5 transition", dictating && "rotate-180")} aria-hidden />
          Dictate or type several at once
        </button>
        {dictating ? (
          <div className="mt-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder={"Augmentin 625 twice daily after food 5 days\nParacetamol 650 sos"}
              className={`${FIELD} resize-y leading-snug`}
            />
            <WordSuggest drugs={drugs} text={text} onReplace={setText} />
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
              <Btn kind="primary" disabled={!text.trim() || formulary.loading} onClick={() => setParsed(withHabits(parseDictation(text, drugs)))}>
                Read it
              </Btn>
              {mic.supported ? (
                <Btn onClick={mic.toggle} aria-pressed={mic.listening}>
                  <Mic className="size-5" />
                  {mic.listening ? "Stop" : "Dictate"}
                </Btn>
              ) : null}
              {mic.listening ? <span className="text-sm">Listening…</span> : null}
            </div>
            {mic.error ? <p className="mt-2 text-sm">{mic.error}</p> : null}
          </div>
        ) : null}
      </div>

      {parsed ? (
        <Proposals
          result={parsed}
          added={items.map((i) => i.drugId)}
          onAdd={(item) => put(item)}
          onClear={() => {
            setParsed(null);
            setText("");
          }}
        />
      ) : null}

      <div>
        <Label>Tests to get done ({tests.length})</Label>
        <div className="flex flex-wrap gap-1.5">
          {[...COMMON_TESTS, ...tests.filter((t) => !COMMON_TESTS.includes(t))].map((t) => (
            <Chip key={t} on={tests.includes(t)} onClick={() => setTests((list) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]))}>
              {tests.includes(t) ? <Check className="size-3.5" aria-hidden /> : <FlaskConical className="size-3.5" aria-hidden />} {t}
            </Chip>
          ))}
        </div>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setTests((list) => cleanTests([...list, testDraft]));
            setTestDraft("");
          }}
        >
          <input value={testDraft} onChange={(e) => setTestDraft(e.target.value)} placeholder="Another test, then Enter" aria-label="Another test" className={FIELD} />
          <Btn type="submit" disabled={!testDraft.trim()}>
            Add
          </Btn>
        </form>
      </div>

      <div className="grid gap-4 @lg:grid-cols-[1fr_11rem]">
        <div>
          <Label>Advice to the patient</Label>
          <textarea value={advice} onChange={(e) => setAdvice(e.target.value)} rows={3} className={`${FIELD} resize-y`} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ADVICE.filter((a) => !advice.includes(a)).map((a) => (
              <Chip key={a} onClick={() => setAdvice((t) => (t.trim() ? `${t.trim()}\n${a}` : a))}>
                <Plus className="size-3.5" aria-hidden /> {a.split(" (")[0]}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <Label>Follow up (days)</Label>
          <input value={followUp} onChange={(e) => setFollowUp(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={FIELD} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FOLLOW_UPS.map((d) => (
              <Chip key={d} on={followUp === String(d)} onClick={() => setFollowUp(followUp === String(d) ? "" : String(d))}>
                {d}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <SafetyPanel
        state={safety}
        hasItems={items.length > 0}
        acknowledged={acknowledged}
        onToggle={(key) =>
          setAcknowledged((a) => {
            const n = new Set(a);
            if (!n.delete(key)) n.add(key);
            return n;
          })
        }
      />

      {problems.length > 0 ? (
        <ul className="space-y-1 text-sm" role="alert">
          {problems.map((p) => (
            <li key={p}>• {p}</li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-base">
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        <Btn kind="primary" disabled={!canSign} onClick={() => void sign()} className="h-14 w-full text-lg">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
          Sign
          <span className="text-sm font-normal opacity-70">Ctrl+Enter</span>
        </Btn>
        {items.length > 0 ? (
          setName === null ? (
            <button type="button" onClick={() => setSetName(diagnosis.trim())} className="flex items-center gap-1.5 text-sm font-bold underline">
              <Bookmark className="size-4" aria-hidden /> Save this as a set for next time
            </button>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!uid || !setName.trim()) return;
                saveSet(uid, { name: setName.trim().slice(0, 40), diagnosis, advice, followUp, items });
                setMemory(loadMemory(uid));
                setSetName(null);
              }}
            >
              <input autoFocus value={setName} onChange={(e) => setSetName(e.target.value)} placeholder="Name, e.g. Viral fever" aria-label="Name of the set" className={FIELD} />
              <Btn type="submit" disabled={!setName.trim()}>
                Save
              </Btn>
              <Btn onClick={() => setSetName(null)}>Cancel</Btn>
            </form>
          )
        ) : null}
      </div>
      {/* Voice first: hold Space anywhere (but in a text box) and talk. */}
      <VoiceBar
        onHeard={heard}
        thread={thread}
        question={question?.ask ?? null}
        onSkip={() => {
          if (!question) return;
          setSkipped((s) => [...s, questionKey(question)]);
          setThread((t) => [...t, { who: "parcha", text: "Skipped." }]);
        }}
        onClear={() => setThread([])}
      />
      {/* Room at the bottom, so the marker never covers the last line. */}
      <div aria-hidden className="h-28" />
    </div>
  );
}

function Chip({ children, onClick, on }: { children: React.ReactNode; onClick: () => void; on?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("inline-flex items-center gap-1 rounded-full border-2 border-[#232326] px-3 py-1 text-sm font-bold", on ? "bg-[#232326] text-white" : "bg-white hover:bg-[var(--hover-soft)]")}
    >
      {children}
    </button>
  );
}

/** The five things that matter on a line. */
const CHECKS = [
  { key: "medicine", label: "Medicine", assumes: "medicine" },
  { key: "strength", label: "Strength", assumes: "strength" },
  { key: "dosage", label: "Dose and how often", assumes: "frequency" },
  { key: "duration", label: "For how long", assumes: "duration" },
  { key: "timing", label: "When to take it", assumes: "timing" },
] as const;

function checkValue(item: PrescriptionItem, key: (typeof CHECKS)[number]["key"]): string {
  switch (key) {
    case "medicine":
      return item.drugName;
    case "strength":
      return item.strength || "—";
    case "dosage":
      return `${item.frequency}${(item.everyDays ?? 1) > 1 ? ` · ${everyText(item.everyDays).toLowerCase()}` : ""} · qty ${item.quantity}`;
    case "duration":
      return `${item.durationDays} day${item.durationDays === 1 ? "" : "s"}`;
    case "timing":
      return TIMING_LABELS[item.timing];
  }
}

/**
 * What dictation heard, line by line. What was said is shown plainly; only
 * what the parser had to GUESS (not said) needs the doctor's tick before the
 * line can be added, so a fully spoken line is one tap. Every added line is
 * still read on the prescription above the signature.
 */
function Proposals({
  result,
  added,
  onAdd,
  onClear,
}: {
  result: DictationResult;
  added: string[];
  onAdd: (item: PrescriptionItem) => void;
  onClear: () => void;
}) {
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const toggle = (line: string, key: string) =>
    setTicked((t) => {
      const has = t[line]?.includes(key);
      const next = has ? (t[line] ?? []).filter((k) => k !== key) : [...(t[line] ?? []), key];
      return { ...t, [line]: next };
    });
  const guessesOf = (p: DictationResult["proposals"][number]) => CHECKS.filter((c) => c.assumes !== null && p.assumed.includes(c.assumes));
  const ready = result.proposals.filter((p) => !added.includes(p.item.drugId) && guessesOf(p).every((c) => (ticked[p.key] ?? []).includes(c.key)));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Label>Heard ({result.proposals.length})</Label>
        <div className="mb-2 flex items-center gap-3">
          {ready.length > 1 ? (
            <Btn kind="primary" onClick={() => ready.forEach((p) => onAdd(p.item))}>
              <Plus className="size-4" /> Add all {ready.length}
            </Btn>
          ) : null}
          <button type="button" onClick={onClear} className="flex items-center gap-1 text-sm underline">
            <X className="size-4" /> Clear
          </button>
        </div>
      </div>

      <ul className="space-y-3">
        {result.proposals.map((p) => {
          const done = added.includes(p.item.drugId);
          const have = ticked[p.key] ?? [];
          const guesses = guessesOf(p);
          const confirmed = guesses.every((c) => have.includes(c.key));
          return (
            <li key={p.key}>
              <Card tone={done ? "ok" : "plain"}>
                <p className="text-muted-foreground text-sm">Heard “{p.source}”</p>
                <p className="mt-1 text-lg leading-tight font-bold">
                  {p.item.drugName} {p.item.strength}
                </p>
                <p className="text-base">
                  {checkValue(p.item, "dosage")} · {checkValue(p.item, "duration")} · {checkValue(p.item, "timing")}
                </p>
                {guesses.length && !done ? (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-sm font-bold">Not said, so guessed. Tick if right, or fix it after adding:</p>
                    {guesses.map((c) => {
                      const on = have.includes(c.key);
                      return (
                        <button
                          key={c.key}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => toggle(p.key, c.key)}
                          className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl border-[3px] border-[#232326] px-3 py-1.5 text-left", on ? "bg-[var(--brand-soft)]" : "bg-[var(--morning-soft)]")}
                        >
                          <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md border-[3px] border-[#232326] bg-white">
                            {on ? <Check className="size-4" /> : null}
                          </span>
                          <span className="text-sm">{c.label}:</span>
                          <span className="text-base font-bold">{checkValue(p.item, c.key)}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="mt-3">
                  <Btn kind={done ? "quiet" : "primary"} onClick={() => onAdd(p.item)} disabled={done || !confirmed}>
                    {done ? <Check className="size-5" /> : <Plus className="size-5" />}
                    {done ? "Added" : confirmed ? "Add" : `Tick the ${guesses.length} guessed`}
                  </Btn>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      {result.unresolved.length > 0 ? (
        <div className="mt-3 space-y-2">
          {result.unresolved.map((u) => (
            <Card key={u.key} tone="danger">
              <p className="text-base">“{u.source}”</p>
              <p className="text-sm">{u.reason} Search for it above to add it by hand.</p>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const SLOT_ICONS = [Sunrise, Sun, Sunset, Moon];

/**
 * The schedule, by hand: how many at subah, dopahar, shaam and raat, or only
 * when needed, and how often (every day, every 2 days, once a week...). No
 * dictation needed; every choice is a tap.
 */
function ManualSchedule({ item, onChange }: { item: PrescriptionItem; onChange: (patch: Partial<PrescriptionItem>) => void }) {
  const sos = item.frequency.toUpperCase() === "SOS";
  const four = toFourSlots(item.frequency);
  const names = slotNames(4);
  const setSlot = (i: number, n: number) => {
    const next = [...four];
    next[i] = Math.max(0, Math.min(4, n));
    onChange({ frequency: fromFourSlots(next) });
  };
  return (
    <div className="mt-3 space-y-3">
      <div>
        <p className="mb-1.5 text-sm">When to take it</p>
        <div className={cn("grid grid-cols-2 gap-2 @md:grid-cols-4", sos && "opacity-40")}>
          {names.map((n, i) => {
            const Icon = SLOT_ICONS[i];
            const count = four[i];
            return (
              <div key={n.en} className={cn("rounded-xl border-[3px] border-[#232326] p-2", count > 0 ? "bg-[var(--brand-soft)]" : "bg-white")}>
                {/* Hindi over English, so every box is the same height however narrow the pad gets. */}
                <p className="flex items-center gap-1.5">
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 leading-tight">
                    <span className="block text-sm font-bold">{n.hi}</span>
                    <span className="block truncate text-xs">{n.en}</span>
                  </span>
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-1">
                  <button type="button" disabled={sos || count === 0} onClick={() => setSlot(i, count - 1)} aria-label={`One less in the ${n.en.toLowerCase()}`} className="flex size-9 items-center justify-center rounded-lg border-[3px] border-[#232326] bg-white text-lg font-bold disabled:opacity-40">
                    −
                  </button>
                  <span className="text-2xl font-bold tabular-nums" aria-live="polite" aria-label={`${count} in the ${n.en.toLowerCase()}`}>
                    {count}
                  </span>
                  <button type="button" disabled={sos || count >= 4} onClick={() => setSlot(i, count + 1)} aria-label={`One more in the ${n.en.toLowerCase()}`} className="flex size-9 items-center justify-center rounded-lg border-[3px] border-[#232326] bg-white text-lg font-bold disabled:opacity-40">
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={sos}
          onClick={() => onChange(sos ? { frequency: "1-0-1" } : { frequency: "SOS", everyDays: 1 })}
          className={cn("mt-2 rounded-full border-[3px] border-[#232326] px-3 py-1 text-sm font-bold", sos ? "bg-[#232326] text-white" : "bg-white")}
        >
          Only when needed (SOS)
        </button>
      </div>
      <div>
        <p className="mb-1.5 text-sm">How often</p>
        <div className={cn("flex flex-wrap gap-2", sos && "opacity-40")}>
          {EVERY_DAYS.map((e) => {
            const on = (item.everyDays ?? 1) === e.days;
            return (
              <button
                key={e.days}
                type="button"
                disabled={sos}
                aria-pressed={on}
                onClick={() => onChange({ everyDays: e.days })}
                className={cn("rounded-full border-[3px] border-[#232326] px-3 py-1 text-sm", on ? "bg-[var(--brand)] font-bold" : "bg-card")}
              >
                {e.en} <span className="text-xs">· {e.hi}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * One line, compact: strength, days, timing and quantity in a row, the usual
 * shortcuts (OD, BD, TDS...) one tap, and the full four-time schedule and the
 * patient's picture a tap away. It says where its schedule came from, so a
 * guessed one is never mistaken for a choice.
 */
function ItemEditor({
  item,
  source,
  drug,
  onChange,
  onRemove,
}: {
  item: PrescriptionItem;
  source?: LineSource;
  drug: Drug | undefined;
  onChange: (patch: Partial<PrescriptionItem>) => void;
  onRemove: () => void;
}) {
  const strengths = drug?.strengths ?? [];
  const [more, setMore] = useState(false);
  return (
    <li>
      <Card className="!p-3">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-lg leading-tight font-bold">
            {item.drugName}
            <span className="text-muted-foreground block text-sm font-normal">
              {item.unlisted ? (
                <span className="mr-1.5 font-bold text-[#8a4b00]">Written by hand · not checked ·</span>
              ) : null}
              <span className="capitalize">{item.form}</span>
              {source ? <span className={cn("ml-1.5", (source === "class" || source === "default") && "font-bold text-[#8a4b00]")}>· {SOURCE_LABEL[source]}</span> : null}
            </span>
          </p>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.drugName}`}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] hover:bg-[oklch(0.94_0.05_25)]"
          >
            <Trash2 className="size-4" />
          </button>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 @lg:grid-cols-4">
          {item.unlisted ? (
            <label className="block text-xs">
              Form
              <select value={item.form} onChange={(e) => onChange({ form: e.target.value })} className={`${FIELD} mt-0.5 !py-1.5`}>
                {UNLISTED_FORMS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-xs">
            Strength
            {strengths.length > 1 ? (
              <select value={item.strength} onChange={(e) => onChange({ strength: e.target.value })} className={`${FIELD} mt-0.5 !py-1.5`}>
                {strengths.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            ) : (
              <input value={item.strength} onChange={(e) => onChange({ strength: e.target.value })} placeholder="e.g. 500 mg" className={`${FIELD} mt-0.5 !py-1.5`} />
            )}
          </label>
          <label className="block text-xs">
            Days
            <input
              value={item.durationDays || ""}
              inputMode="numeric"
              onChange={(e) => onChange({ durationDays: Number(e.target.value.replace(/\D/g, "")) || 0 })}
              className={`${FIELD} mt-0.5 !py-1.5`}
            />
          </label>
          <label className="block text-xs">
            Timing
            <select value={item.timing} onChange={(e) => onChange({ timing: e.target.value as Timing })} className={`${FIELD} mt-0.5 !py-1.5`}>
              {TIMINGS.map((t) => (
                <option key={t} value={t}>
                  {TIMING_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            Quantity
            <input
              value={item.quantity || ""}
              inputMode="numeric"
              onChange={(e) => onChange({ quantity: Number(e.target.value.replace(/\D/g, "")) || 0 })}
              className={`${FIELD} mt-0.5 !py-1.5`}
            />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => {
            const value = normaliseFrequency(p);
            const on = item.frequency === value;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onChange({ frequency: value })}
                aria-pressed={on}
                className={`rounded-full border-2 border-[#232326] px-2.5 py-0.5 text-sm ${on ? "bg-[var(--brand)] font-bold" : "bg-card hover:bg-[var(--hover-soft)]"}`}
              >
                {p}
              </button>
            );
          })}
          <input
            value={item.frequency}
            onChange={(e) => onChange({ frequency: e.target.value })}
            onBlur={(e) => onChange({ frequency: normaliseFrequency(e.target.value) })}
            aria-label="Frequency pattern"
            className={`${FIELD} !w-24 !py-1 text-center tabular-nums`}
          />
          {(item.everyDays ?? 1) > 1 ? <span className="text-sm font-bold">{everyText(item.everyDays)}</span> : null}
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="ml-auto flex items-center gap-1 text-sm font-bold underline">
            <ChevronDown className={cn("size-4 transition", more && "rotate-180")} aria-hidden />
            Subah, dopahar, shaam, raat
          </button>
        </div>

        {more ? (
          <>
            <ManualSchedule item={item} onChange={onChange} />
            <div className="bg-background mt-3 rounded-xl border-2 border-[#232326]/25 p-3">
              <p className="text-muted-foreground mb-2 text-xs">What the patient will see</p>
              <DosePictogram frequency={item.frequency} form={item.form} />
              {(item.everyDays ?? 1) > 1 ? <p className="mt-2 text-sm font-bold">{everyText(item.everyDays)}</p> : null}
            </div>
          </>
        ) : null}
      </Card>
    </li>
  );
}
