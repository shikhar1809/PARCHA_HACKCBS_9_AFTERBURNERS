/**
 * Adding a Parcha: every source the family has, each checked
 * by a person, then one plan.
 *
 *   1. Papers     — the prescription and the pharmacy bill, photographed. A
 *                   printed prescription and the bill are read on the phone;
 *                   handwriting is read by Gemini only when the person taps it.
 *   2. Doctor     — what the doctor said, recorded and transcribed, then each
 *                   point confirmed or marked "not said". Can be skipped…
 *   3. Pharmacist — …and then the chemist's words are required instead.
 *   4. Strips     — front and back of each medicine, one at a time.
 *   5. Plan       — the sources merged medicine by medicine: the name trusted
 *                   from print (bill, then prescription), the timing from what
 *                   was said (doctor, then prescription, then chemist). Where
 *                   two sources disagree both are shown and a person picks.
 *                   Then the schedule, with any clash with today's reminders
 *                   asked about, set locked.
 *
 * Nothing is invented at any step: a point nobody said or wrote stays empty
 * until a person fills it in, and a source that was skipped is recorded as
 * "not provided", never as blank agreement.
 */
import { call, errorMessage, useFormulary, vaultPut } from "@parcha/client";
import { doseOnLine, frequencySlots, remindersFromPrescription, sameMedicine, searchDrugs, toDateString, type Drug, type Finding, type PhotoProblem, type Reminder, type Timing } from "@parcha/core";
import { Screen, cn } from "@parcha/ui";
import { BadgeCheck, Camera, Check, Loader2, Lock, Mic, Plus, ScanText, Search, SkipForward, Square, Stethoscope, Store, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useHandset } from "../auth";
import { BillReader } from "../components/BillReader";
import { NewSchedule } from "../components/NewSchedule";
import { usePeople } from "../components/people";
import { checkPhoto, PhotoRejected } from "../components/photoCheck";
import { StripWalk } from "../components/StripWalk";
import { shrinkPhoto } from "../components/strips";
import { useT } from "../i18n";
import { BigButton, Header } from "../kit";

type Step = "papers" | "doctor" | "pharmacist" | "strips" | "plan" | "done";
type Src = "rx" | "bill" | "doctor" | "pharmacist" | "typed";
type Slots = [number, number, number];

/** One source's word on one medicine. Every field but the name is "only if it said so". */
type Mention = { src: Src; name: string; strength?: string | null; slots?: Slots | null; sos?: boolean; timing?: Timing | null; days?: number | null; quote?: string };

/** One medicine as the recording heard it (firebase/functions/src/assistant.ts). */
type Heard = { name: string; strength?: string | null; morning?: number | null; afternoon?: number | null; night?: number | null; sos: boolean; food?: Timing | null; days?: number | null; said: string };
type HeardReply = { transcript: string; medicines: Heard[]; notes: string[] };
type Point = "name" | "when" | "food" | "days";
type Check = Partial<Record<Point, "ok" | "no">>;

const slotsOfHeard = (h: Heard): Slots | null =>
  h.morning == null && h.afternoon == null && h.night == null ? null : [h.morning ?? 0, h.afternoon ?? 0, h.night ?? 0];
const slotsOf = (f: string | null | undefined): Slots | null => {
  const s = f ? frequencySlots(f) : null;
  return s && s.length === 3 ? (s as Slots) : null;
};
const sameSlots = (a?: Slots | null, b?: Slots | null) => !!a && !!b && a.every((n, i) => (n > 0) === (b[i] > 0));

/** What the recording said that a person confirmed, as a source. Wrong or unsaid points are left out. */
function confirmedMention(h: Heard, c: Check, src: Src): Mention | null {
  if (c.name !== "ok") return null;
  return {
    src,
    name: h.name,
    strength: h.strength ?? null,
    slots: c.when === "ok" ? slotsOfHeard(h) : null,
    sos: c.when === "ok" ? h.sos : false,
    timing: c.food === "ok" ? (h.food ?? null) : null,
    days: c.days === "ok" ? (h.days ?? null) : null,
    quote: h.said,
  };
}

/* ======================================================================= */

export function AddParcha() {
  const t = useT();
  const navigate = useNavigate();
  const printed = new URLSearchParams(useLocation().search).get("printed") === "1";
  const { handset } = useHandset();
  const { active, people } = usePeople();
  const who = active ?? (people.length === 1 ? people[0].name : null);
  const formulary = useFormulary();

  const [step, setStep] = useState<Step>("papers");
  const [rxPhoto, setRxPhoto] = useState<{ small: string; big: string } | null>(null);
  const [billPhoto, setBillPhoto] = useState<{ small: string; big: string } | null>(null);
  const [noBill, setNoBill] = useState(false);
  const [refused, setRefused] = useState<{ which: "rx" | "bill"; problem: PhotoProblem } | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [doctor, setDoctor] = useState<{ skipped: boolean; heard: HeardReply | null; checks: Check[] }>({ skipped: false, heard: null, checks: [] });
  const [chemist, setChemist] = useState<{ skipped: boolean; heard: HeardReply | null; checks: Check[] }>({ skipped: false, heard: null, checks: [] });
  const [proposed, setProposed] = useState<Omit<Reminder, "id">[]>([]);
  const [savedAs, setSavedAs] = useState<string | null>(null);

  const STEPS: Step[] = ["papers", "doctor", "pharmacist", "strips", "plan"];
  const at = STEPS.indexOf(step);

  /* ------------------------------------------------------------ papers */

  async function photo(which: "rx" | "bill", file: File | undefined) {
    if (!file) return;
    const big = await shrinkPhoto(file, 2000);
    const verdict = await checkPhoto(big);
    if (!verdict.ok) {
      setRefused({ which, problem: verdict.problem });
      return;
    }
    setRefused(null);
    const p = { big, small: await shrinkPhoto(file, 1200) };
    if (which === "rx") setRxPhoto(p);
    else setBillPhoto(p);
  }

  const addMention = (m: Mention) =>
    setMentions((all) => (all.some((x) => x.src === m.src && sameMedicine(x.name, m.name)) ? all : [...all, m]));
  /** Which of the medicine list's entries this source already has, so its Add button says Added. */
  const addedIds = (src: Src) => formulary.data.filter((d) => mentions.some((m) => m.src === src && sameMedicine(m.name, d.genericName))).map((d) => d.id);
  const paperNames = useMemo(() => [...new Set(mentions.map((m) => m.name))], [mentions]);

  /* ------------------------------------------------------------ the plan */

  const heardMentions = useMemo(() => {
    const out: Mention[] = [];
    doctor.heard?.medicines.forEach((h, i) => {
      const m = confirmedMention(h, doctor.checks[i] ?? {}, "doctor");
      if (m) out.push(m);
    });
    chemist.heard?.medicines.forEach((h, i) => {
      const m = confirmedMention(h, chemist.checks[i] ?? {}, "pharmacist");
      if (m) out.push(m);
    });
    return out;
  }, [doctor, chemist]);

  /** Medicine by medicine: every source that named it. */
  const merged = useMemo(() => {
    const groups: Mention[][] = [];
    for (const m of [...mentions, ...heardMentions]) {
      const g = groups.find((x) => x.some((y) => sameMedicine(y.name, m.name)));
      if (g) g.push(m);
      else groups.push([m]);
    }
    const rank = (order: Src[]) => (m: Mention) => (order.indexOf(m.src) < 0 ? 99 : order.indexOf(m.src));
    return groups.map((g) => {
      // What it is: print first, because print reads reliably and speech does not.
      const identity = [...g].sort((a, b) => rank(["bill", "rx", "typed", "doctor", "pharmacist"])(a) - rank(["bill", "rx", "typed", "doctor", "pharmacist"])(b))[0];
      // When: what was said first, because the bill says nothing about it.
      const timed = [...g].filter((m) => m.slots || m.sos).sort((a, b) => rank(["doctor", "rx", "pharmacist"])(a) - rank(["doctor", "rx", "pharmacist"])(b));
      const conflict = timed.length > 1 && timed.some((m) => !(m.sos === timed[0].sos && (m.sos || sameSlots(m.slots, timed[0].slots))));
      return { key: identity.name.toLowerCase(), name: identity.name, strength: g.find((m) => m.strength)?.strength ?? null, mentions: g, timed, conflict };
    });
  }, [mentions, heardMentions]);

  /* ------------------------------------------------------------ render */

  const canLeavePapers = !!rxPhoto && (!!billPhoto || noBill) && mentions.length > 0;
  // The chemist is required when the doctor was skipped, or said nothing a person confirmed.
  const doctorGave = !doctor.skipped && heardMentions.some((m) => m.src === "doctor");

  return (
    <>
      <Header
        back="/start"
        title={printed ? t("Add a printed Parcha", "छपा पर्चा जोड़ें", "Chhapa Parcha jodein") : t("Add my medicines", "मेरी दवाइयाँ जोड़ें", "Meri dawaiyan jodein")}
        subtitle={step === "done" ? undefined : t(`Step ${at + 1} of ${STEPS.length}`, `चरण ${at + 1} / ${STEPS.length}`, `Step ${at + 1} / ${STEPS.length}`)}
      />
      <Screen className="space-y-5 px-4 pb-10">
        {step !== "done" ? (
          <ol className="grid grid-cols-5 gap-1.5 text-center text-[0.7rem] leading-tight font-bold" aria-label={t("Steps", "चरण", "Steps")}>
            {[t("Papers", "कागज़", "Kagaz"), t("Doctor", "डॉक्टर", "Doctor"), t("Chemist", "केमिस्ट", "Chemist"), t("Strips", "पत्ते", "Patte"), t("Plan", "समय", "Plan")].map((l, i) => (
              <li key={l} className="space-y-1">
                <span className={cn("block h-2 rounded-full border-2 border-[#232326]", i <= at ? "bg-[var(--chosen)]" : "bg-white")} />
                {l}
              </li>
            ))}
          </ol>
        ) : null}

        {step === "papers" ? (
          <>
            <p className="text-xl leading-snug font-bold">{t("Photos of the prescription and the bill", "पर्चे और बिल की फ़ोटो", "Parche aur bill ki photo")}</p>
            <div className="grid grid-cols-2 gap-3">
              <PhotoSlot label={t("Prescription", "पर्चा", "Parcha")} src={rxPhoto?.small} onFile={(f) => void photo("rx", f)} />
              {noBill ? (
                <button type="button" onClick={() => setNoBill(false)} className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#232326] bg-[var(--morning-soft)] p-2 text-center text-base font-bold">
                  {t("No bill — tap to add one", "बिल नहीं — जोड़ने के लिए दबाएँ", "Bill nahi — jodne ke liye dabayein")}
                </button>
              ) : (
                <PhotoSlot label={t("Pharmacy bill", "दवा का बिल", "Dawa ka bill")} src={billPhoto?.small} onFile={(f) => void photo("bill", f)} />
              )}
            </div>
            {refused ? <PhotoRejected problem={refused.problem} what={refused.which === "rx" ? t("photo of the prescription", "पर्चे की फ़ोटो", "parche ki photo") : t("photo of the bill", "बिल की फ़ोटो", "bill ki photo")} /> : null}
            {!billPhoto && !noBill ? (
              <button type="button" onClick={() => setNoBill(true)} className="w-full text-base font-bold underline">
                {t("I don't have the bill", "मेरे पास बिल नहीं है", "Mere paas bill nahi hai")}
              </button>
            ) : null}

            {rxPhoto ? (
              printed ? (
                <BillReader picture={rxPhoto.big} paper="parcha" drugs={formulary.data} added={addedIds("rx")} onRetake={() => setRxPhoto(null)} onAdd={(d, f) => addMention(fromFinding("rx", d, f))} />
              ) : (
                <Handwriting picture={rxPhoto.big} onRead={(list) => list.forEach(addMention)} />
              )
            ) : null}
            {billPhoto ? (
              <BillReader picture={billPhoto.big} drugs={formulary.data} added={addedIds("bill")} onRetake={() => setBillPhoto(null)} onAdd={(d, f) => addMention(fromFinding("bill", d, f))} />
            ) : null}
            {rxPhoto ? <AddByName drugs={formulary.data} onAdd={(d) => addMention({ src: "typed", name: d.genericName, strength: d.defaultStrength ?? null })} /> : null}

            {mentions.length ? (
              <div className="rounded-2xl border-[3px] border-[#232326] bg-card p-3">
                <p className="mb-2 text-base font-bold">{t("Found so far", "अब तक मिलीं", "Ab tak mili")}</p>
                <ul className="flex flex-wrap gap-2">
                  {mentions.map((m, i) => (
                    <li key={i} className="flex items-center gap-1.5 rounded-full border-2 border-[#232326] bg-white py-1 pr-1 pl-3 text-base font-bold">
                      {m.name} <SrcTag src={m.src} />
                      <button type="button" aria-label={t("Remove", "हटाएँ", "Hatayein")} onClick={() => setMentions(mentions.filter((_, j) => j !== i))} className="rounded-full p-1 hover:bg-black/10">
                        <X className="size-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <BigButton disabled={!canLeavePapers} onClick={() => setStep("doctor")}>{t("Next: the doctor's words", "आगे: डॉक्टर ने क्या कहा", "Aage: doctor ne kya kaha")}</BigButton>
            {!canLeavePapers ? (
              <p className="text-center text-base">{t("Photograph the prescription and the bill, and add at least one medicine.", "पर्चे और बिल की फ़ोटो लें, और कम से कम एक दवा जोड़ें।", "Parche aur bill ki photo lein, aur kam se kam ek dawai jodein.")}</p>
            ) : null}
          </>
        ) : null}

        {step === "doctor" ? (
          <Words
            who="doctor"
            known={paperNames}
            state={doctor}
            setState={setDoctor}
            canSkip
            onNext={() => setStep("pharmacist")}
          />
        ) : null}

        {step === "pharmacist" ? (
          <Words
            who="pharmacist"
            known={paperNames}
            state={chemist}
            setState={setChemist}
            canSkip={doctorGave}
            onNext={() => setStep("strips")}
          />
        ) : null}

        {step === "strips" ? (
          <>
            <p className="text-xl leading-snug font-bold">{t("Now each strip, front and back, one at a time", "अब हर पत्ता, आगे और पीछे, एक-एक करके", "Ab har patta, aage aur peeche, ek-ek karke")}</p>
            <StripWalk medicines={merged.map((m) => ({ name: m.name, detail: m.strength ?? undefined }))} onDone={() => setStep("plan")} finishLabel={t("Next: the plan", "आगे: दवा का समय", "Aage: dawai ka plan")} />
          </>
        ) : null}

        {step === "plan" ? (
          <Plan
            merged={merged}
            onBuilt={async (lines) => {
              const id = `check:${Date.now()}`;
              await vaultPut(id, {
                person: who,
                from: printed ? "printed" : "bill",
                photos: { rx: rxPhoto?.small, bill: billPhoto?.small },
                said: [doctor.heard?.transcript, chemist.heard?.transcript].filter(Boolean).join("\n"),
                notProvided: [noBill ? "bill" : null, doctor.skipped ? "doctor" : null, chemist.skipped ? "pharmacist" : null].filter(Boolean),
                medicines: lines.map((l) => ({ name: l.name, frequency: l.frequency, timing: l.timing, days: l.days })),
                savedAt: new Date().toISOString(),
              });
              setSavedAs(id);
              setProposed(
                remindersFromPrescription({
                  ownerPhone: handset?.phone ?? "",
                  personName: who ?? "",
                  visitId: id,
                  startDate: toDateString(new Date()),
                  items: lines.map((l) => ({ drugId: l.name.toLowerCase(), drugName: l.name, strength: l.strength ?? "", form: "tablet", frequency: l.frequency, durationDays: l.days, timing: l.timing })),
                }).slice(0, 20),
              );
            }}
            proposed={proposed}
            onDone={() => setStep("done")}
          />
        ) : null}

        {step === "done" ? (
          <div className="space-y-4 text-center">
            <BadgeCheck className="mx-auto size-16" strokeWidth={2} aria-hidden />
            <p className="flex items-center justify-center gap-2 text-2xl leading-tight font-bold">
              <Lock className="size-6" aria-hidden /> {t("Schedule added and locked", "समय जुड़ गया और लॉक हुआ", "Schedule jud gaya aur lock hua")}
            </p>
            {savedAs ? <BigButton onClick={() => navigate(`/simple/${encodeURIComponent(savedAs)}`, { replace: true })}>{t("See my simple Parcha", "मेरा आसान पर्चा देखें", "Mera aasaan Parcha dekhein")}</BigButton> : null}
            <button type="button" onClick={() => navigate("/schedule", { replace: true })} className="min-h-12 w-full text-lg font-bold underline">
              {t("See today's medicines", "आज की दवाइयाँ देखें", "Aaj ki dawaiyan dekhein")}
            </button>
          </div>
        ) : null}

        {step !== "papers" && step !== "done" ? (
          <button type="button" onClick={() => setStep(STEPS[Math.max(0, at - 1)])} className="w-full text-center text-lg font-bold underline">
            {t("Back", "वापस", "Wapas")}
          </button>
        ) : null}
      </Screen>
    </>
  );
}

/** A medicine found on a printed paper, with the times printed on its line. */
function fromFinding(src: "rx" | "bill", d: Drug, f: Finding): Mention {
  if (src === "bill") return { src, name: d.genericName, strength: f.strength ?? null, quote: f.line };
  const dose = doseOnLine(f.line);
  return { src, name: d.genericName, strength: f.strength ?? null, slots: slotsOf(dose.frequency), sos: dose.frequency === "SOS", timing: dose.timing, days: dose.days, quote: f.line };
}

/* ======================================================================= pieces */

function PhotoSlot({ label, src, onFile }: { label: string; src?: string; onFile: (f: File | undefined) => void }) {
  return (
    <label className="hover-orange relative flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-[#232326] bg-white p-2 text-center text-lg font-bold">
      {src ? <img src={src} alt="" className="absolute inset-0 size-full object-cover" /> : <Camera className="size-9" aria-hidden />}
      <span className={src ? "relative rounded-full bg-white/90 px-2" : ""}>
        {src ? <Check className="mr-1 inline size-4" strokeWidth={3} aria-hidden /> : null}
        {label}
      </span>
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}

function SrcTag({ src }: { src: Src }) {
  const t = useT();
  const word = { rx: t("Rx", "पर्चा", "Rx"), bill: t("Bill", "बिल", "Bill"), doctor: t("Doctor", "डॉक्टर", "Doctor"), pharmacist: t("Chemist", "केमिस्ट", "Chemist"), typed: t("Typed", "लिखा", "Likha") }[src];
  return <span className="rounded-full bg-[#232326] px-2 py-0.5 text-xs text-white">{word}</span>;
}

/** Handwriting goes to Gemini only on a tap that says so. */
function Handwriting({ picture, onRead }: { picture: string; onRead: (m: Mention[]) => void }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "reading" | "done" | "failed">("idle");
  const [result, setResult] = useState<HeardReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function read() {
    setState("reading");
    setError(null);
    try {
      const r = await call<{ image: string }, HeardReply>("readHandwriting", { image: picture });
      setResult(r);
      onRead(r.medicines.map((h) => ({ src: "rx", name: h.name, strength: h.strength ?? null, slots: slotsOfHeard(h), sos: h.sos, timing: h.food ?? null, days: h.days ?? null, quote: h.said })));
      setState("done");
    } catch (e) {
      setError(errorMessage(e));
      setState("failed");
    }
  }
  return (
    <div className="space-y-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-4">
      {state === "done" && result ? (
        <p className="text-base leading-snug">
          <ScanText className="mr-1 inline size-5" aria-hidden />
          {result.medicines.length
            ? t(`Read ${result.medicines.length} from the handwriting. You will check each one.`, `लिखावट से ${result.medicines.length} पढ़ीं। हर एक आप जाँचेंगे।`, `Likhawat se ${result.medicines.length} padhi. Har ek aap jaanchenge.`)
            : `${t("Nothing could be read clearly.", "कुछ साफ़ नहीं पढ़ा गया।", "Kuch saaf nahi padha gaya.")} ${result.transcript}`}
        </p>
      ) : (
        <>
          <button type="button" disabled={state === "reading"} onClick={() => void read()} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-white text-lg font-bold shadow-[0_3px_0_#232326]">
            {state === "reading" ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <ScanText className="size-6" aria-hidden />}
            {t("Read the handwriting", "लिखावट पढ़ें", "Likhawat padhein")}
          </button>
          <p className="text-sm leading-snug">{t("The photo is sent to Google's Gemini to read. Everything it reads is checked by you.", "फ़ोटो पढ़ने के लिए Google के Gemini को भेजी जाती है। जो पढ़ा, वह आप जाँचेंगे।", "Photo padhne ke liye Google ke Gemini ko bheji jaati hai. Jo padha, woh aap jaanchenge.")}</p>
          {error ? <p role="alert" className="text-base font-bold text-[#b3261e]">{error}</p> : null}
        </>
      )}
    </div>
  );
}

function AddByName({ drugs, onAdd }: { drugs: Drug[]; onAdd: (d: Drug) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const hits = useMemo(() => (q.trim().length >= 2 ? searchDrugs(drugs, q, 4) : []), [drugs, q]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Missed one? Type its name", "कोई छूटी? नाम लिखें", "Koi chhooti? Naam likhein")} className="bg-card h-14 w-full rounded-2xl border-2 border-[var(--color-input)] pr-3 pl-10 text-lg outline-none focus:border-[var(--brand)]" />
      </div>
      {hits.map((h) => (
        <button key={h.drug.id} type="button" onClick={() => { onAdd(h.drug); setQ(""); }} className="hover-orange flex w-full items-center gap-3 rounded-2xl border-2 border-[#232326] bg-white px-4 py-3 text-left text-lg font-bold">
          <Plus className="size-5 shrink-0" aria-hidden /> {h.name}
          {h.name !== h.drug.genericName ? <span className="font-normal"> · {h.drug.genericName}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ the doctor's / chemist's words */

const MAX_SECONDS = 120;
const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

function Words({
  who,
  known,
  state,
  setState,
  canSkip,
  onNext,
}: {
  who: "doctor" | "pharmacist";
  known: string[];
  state: { skipped: boolean; heard: HeardReply | null; checks: Check[] };
  setState: (s: { skipped: boolean; heard: HeardReply | null; checks: Check[] }) => void;
  canSkip: boolean;
  onNext: () => void;
}) {
  const t = useT();
  const doctor = who === "doctor";
  const [phase, setPhase] = useState<"idle" | "recording" | "hearing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((x) => x.stop());
  }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
      const parts: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((x) => x.stop());
        const blob = new Blob(parts, { type: (r.mimeType || "audio/webm").split(";")[0] });
        if (blob.size < 2000) {
          setPhase("idle");
          setError(t("Nothing was recorded. Try again, closer to them.", "कुछ रिकॉर्ड नहीं हुआ। पास से फिर कोशिश करें।", "Kuch record nahi hua. Paas se phir koshish karein."));
          return;
        }
        setPhase("hearing");
        try {
          const audio = await blobToDataUrl(blob);
          const heard = await call<Record<string, unknown>, HeardReply>("hearInstructions", { audio, who, known });
          setState({ skipped: false, heard, checks: heard.medicines.map(() => ({})) });
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setPhase("idle");
        }
      };
      rec.current = r;
      r.start();
      setPhase("recording");
      setSeconds(0);
      const began = Date.now();
      timer.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - began) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) stop();
      }, 250);
    } catch {
      setError(t("The microphone could not be opened. Allow Parcha to use it.", "माइक नहीं खुला। Parcha को माइक की इजाज़त दें।", "Mic nahi khula. Parcha ko mic ki permission dein."));
    }
  }
  function stop() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (rec.current?.state === "recording") rec.current.stop();
  }

  const heard = state.heard;
  const pointsOf = (h: Heard): Point[] => (["name", "when", "food", "days"] as Point[]).filter((p) => p === "name" || (p === "when" ? !!slotsOfHeard(h) || h.sos : p === "food" ? !!h.food : h.days != null));
  const settled = heard ? heard.medicines.every((h, i) => {
    const c = state.checks[i] ?? {};
    return c.name === "no" || pointsOf(h).every((p) => c[p]);
  }) : false;
  const setCheck = (i: number, p: Point, v: "ok" | "no") => setState({ ...state, checks: state.checks.map((c, j) => (j === i ? { ...c, [p]: v } : c)) });

  return (
    <>
      <p className="flex items-center gap-2 text-xl leading-snug font-bold">
        {doctor ? <Stethoscope className="size-7 shrink-0" aria-hidden /> : <Store className="size-7 shrink-0" aria-hidden />}
        {doctor ? t("What did the doctor say?", "डॉक्टर ने क्या कहा?", "Doctor ne kya kaha?") : t("What did the chemist say?", "केमिस्ट ने क्या कहा?", "Chemist ne kya kaha?")}
      </p>
      {!doctor && !canSkip ? (
        <p role="alert" className="rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-3 text-base leading-snug font-bold">
          {t("The doctor's words were skipped, so the chemist's are needed: someone must say how to take these.", "डॉक्टर की बात छोड़ी गई, इसलिए केमिस्ट की बात ज़रूरी है: किसी को बताना होगा कि दवा कैसे लेनी है।", "Doctor ki baat chhodi gayi, isliye chemist ki baat zaroori hai: kisi ko batana hoga ki dawai kaise leni hai.")}
        </p>
      ) : null}

      {!heard ? (
        <div className="space-y-3 rounded-3xl border-[3px] border-[#232326] bg-white p-4">
          <p className="text-base leading-snug">
            {doctor
              ? t("Hold the phone near the doctor and ask them to say each medicine and when to take it.", "फ़ोन डॉक्टर के पास रखें और हर दवा और उसका समय बोलने को कहें।", "Phone doctor ke paas rakhein aur har dawai aur uska time bolne ko kahein.")
              : t("Hold the phone near the chemist and ask them to say each medicine and when to take it.", "फ़ोन केमिस्ट के पास रखें और हर दवा और उसका समय बोलने को कहें।", "Phone chemist ke paas rakhein aur har dawai aur uska time bolne ko kahein.")}
          </p>
          {phase === "recording" ? (
            <button type="button" onClick={stop} className="flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-[#b3261e] text-2xl font-bold text-white">
              <Square className="size-7 fill-current" aria-hidden /> {t(`Stop · ${seconds}s`, `रोकें · ${seconds} सेकंड`, `Rokein · ${seconds}s`)}
            </button>
          ) : phase === "hearing" ? (
            <p role="status" className="flex min-h-20 items-center justify-center gap-3 text-xl font-bold">
              <Loader2 className="size-7 animate-spin" aria-hidden /> {t("Listening to the recording…", "रिकॉर्डिंग सुन रहे हैं…", "Recording sun rahe hain…")}
            </p>
          ) : (
            <button type="button" onClick={() => void start()} className="flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-2xl font-bold shadow-[0_4px_0_#232326]">
              <Mic className="size-8" aria-hidden /> {t("Start recording", "रिकॉर्डिंग शुरू करें", "Recording shuru karein")}
            </button>
          )}
          <p className="text-sm leading-snug">{t("The recording is sent to Google's Gemini to write down. Every point is checked by you.", "रिकॉर्डिंग लिखने के लिए Google के Gemini को भेजी जाती है। हर बात आप जाँचेंगे।", "Recording likhne ke liye Google ke Gemini ko bheji jaati hai. Har baat aap jaanchenge.")}</p>
          {error ? <p role="alert" className="text-base font-bold text-[#b3261e]">{error}</p> : null}
        </div>
      ) : (
        <>
          <details className="rounded-2xl border-2 border-[#232326] bg-white p-3">
            <summary className="cursor-pointer text-base font-bold">{t("What was heard", "जो सुना गया", "Jo suna gaya")}</summary>
            <p className="mt-2 text-base leading-snug">{heard.transcript}</p>
            {heard.notes.length ? <p className="mt-2 text-sm">{t("Advice", "सलाह", "Salaah")}: {heard.notes.join(" · ")}</p> : null}
          </details>
          {heard.medicines.length === 0 ? (
            <p className="rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-3 text-base font-bold">{t("No medicines were heard in the recording.", "रिकॉर्डिंग में कोई दवा नहीं सुनी गई।", "Recording mein koi dawai nahi suni gayi.")}</p>
          ) : null}
          {heard.medicines.map((h, i) => (
            <HeardCard key={i} heard={h} check={state.checks[i] ?? {}} points={pointsOf(h)} onCheck={(p, v) => setCheck(i, p, v)} />
          ))}
          <button type="button" onClick={() => setState({ skipped: false, heard: null, checks: [] })} className="w-full text-base font-bold underline">
            {t("Record again", "फिर से रिकॉर्ड करें", "Phir se record karein")}
          </button>
          <BigButton disabled={!settled} onClick={onNext}>{t("Next", "आगे", "Aage")}</BigButton>
          {!settled ? <p className="text-center text-base">{t("Answer every point first: right, or not said / wrong.", "पहले हर बात का जवाब दें: सही, या नहीं कहा / गलत।", "Pehle har baat ka jawab dein: sahi, ya nahi kaha / galat.")}</p> : null}
        </>
      )}

      {canSkip ? (
        <button
          type="button"
          onClick={() => {
            setState({ skipped: true, heard: null, checks: [] });
            onNext();
          }}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#232326] text-base font-bold"
        >
          <SkipForward className="size-5" aria-hidden />
          {doctor ? t("Skip — I'll ask the chemist instead", "छोड़ें — केमिस्ट से पूछूँगा", "Chhodein — chemist se poochhunga") : t("Skip — the doctor's words are enough", "छोड़ें — डॉक्टर की बात काफ़ी है", "Chhodein — doctor ki baat kaafi hai")}
        </button>
      ) : null}
    </>
  );
}

/** One medicine as heard, point by point: right, or not said / wrong. */
function HeardCard({ heard, check, points, onCheck }: { heard: Heard; check: Check; points: Point[]; onCheck: (p: Point, v: "ok" | "no") => void }) {
  const t = useT();
  const slots = slotsOfHeard(heard);
  const SLOT = [t("morning", "सुबह", "subah"), t("afternoon", "दोपहर", "dopahar"), t("night", "रात", "raat")];
  const FOOD: Record<string, string> = { after_food: t("after food", "खाने के बाद", "khane ke baad"), before_food: t("before food", "खाने से पहले", "khane se pehle"), empty_stomach: t("empty stomach", "खाली पेट", "khaali pet") };
  const value: Record<Point, string> = {
    name: `${heard.name}${heard.strength ? ` ${heard.strength}` : ""}`,
    when: heard.sos ? t("only when needed", "ज़रूरत पर", "zaroorat par") : slots ? SLOT.filter((_, i) => slots[i] > 0).map((s, i) => `${s}${slots.filter((n) => n > 0)[i] > 1 ? ` ×${slots.filter((n) => n > 0)[i]}` : ""}`).join(" · ") : "",
    food: heard.food ? FOOD[heard.food] : "",
    days: heard.days != null ? t(`${heard.days} days`, `${heard.days} दिन`, `${heard.days} din`) : "",
  };
  const LABEL: Record<Point, string> = { name: t("Medicine", "दवा", "Dawai"), when: t("When", "कब", "Kab"), food: t("Food", "खाना", "Khana"), days: t("How long", "कितने दिन", "Kitne din") };
  const dropped = check.name === "no";
  return (
    <div className={cn("space-y-2 rounded-2xl border-[3px] border-[#232326] p-3", dropped ? "bg-[#eee] opacity-70" : "bg-card")}>
      <p className="text-sm italic">“{heard.said}”</p>
      {(["name", "when", "food", "days"] as Point[]).map((p) => {
        const said = points.includes(p);
        if (dropped && p !== "name") return null;
        return (
          <div key={p} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-sm font-bold">{LABEL[p]}</span>
            <span className={cn("min-w-0 flex-1 text-base", said ? "font-bold" : "italic")}>{said ? value[p] : t("not said", "नहीं कहा", "nahi kaha")}</span>
            {said ? (
              <>
                <button type="button" aria-pressed={check[p] === "ok"} aria-label={t("Right", "सही", "Sahi")} onClick={() => onCheck(p, "ok")} className="flex size-11 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-white">
                  <Check className="size-5" strokeWidth={3} aria-hidden />
                </button>
                <button type="button" aria-label={t("Not said, or wrong", "नहीं कहा या गलत", "Nahi kaha ya galat")} onClick={() => onCheck(p, "no")} className={cn("flex size-11 items-center justify-center rounded-xl border-[3px] border-[#232326]", check[p] === "no" ? "bg-[#f08a7e]" : "bg-white")}>
                  <X className="size-5" strokeWidth={3} aria-hidden />
                </button>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ the plan */

type Merged = { key: string; name: string; strength: string | null; mentions: Mention[]; timed: Mention[]; conflict: boolean };
type Line = { name: string; strength: string | null; frequency: string; timing: Timing; days: number };

function Plan({ merged, onBuilt, proposed, onDone }: { merged: Merged[]; onBuilt: (lines: Line[]) => Promise<void>; proposed: Omit<Reminder, "id">[]; onDone: () => void }) {
  const t = useT();
  type Choice = { pick?: number; slots?: Slots; sos?: boolean; timing?: Timing; days?: number; out?: boolean; ok?: boolean };
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const SLOT = [t("Morning", "सुबह", "Subah"), t("Afternoon", "दोपहर", "Dopahar"), t("Night", "रात", "Raat")];
  const FOOD: [Timing, string][] = [["after_food", t("After food", "खाने के बाद", "Khane ke baad")], ["before_food", t("Before food", "खाने से पहले", "Khane se pehle")], ["empty_stomach", t("Empty stomach", "खाली पेट", "Khaali pet")]];

  /** The line a medicine becomes: the picked or only timing source, then what a person set by hand. */
  const lineOf = (m: Merged): Partial<Line> & { needs: string[] } => {
    const c = choices[m.key] ?? {};
    const src = m.conflict ? (c.pick != null ? m.timed[c.pick] : undefined) : m.timed[0];
    const slots = c.slots ?? src?.slots ?? null;
    const sos = c.sos ?? src?.sos ?? false;
    const timing = c.timing ?? src?.timing ?? m.mentions.find((x) => x.timing)?.timing ?? undefined;
    const days = c.days ?? src?.days ?? m.mentions.find((x) => x.days)?.days ?? undefined;
    const needs: string[] = [];
    if (m.conflict && c.pick == null) needs.push("pick");
    if (!sos && !(slots && slots.some((n) => n > 0))) needs.push("when");
    if (!timing) needs.push("food");
    if (!days) needs.push("days");
    return { name: m.name, strength: m.strength, frequency: sos ? "SOS" : (slots ?? [0, 0, 0]).join("-"), timing, days, needs };
  };
  const kept = merged.filter((m) => !choices[m.key]?.out);
  const ready = kept.length > 0 && kept.every((m) => lineOf(m).needs.length === 0 && choices[m.key]?.ok);
  const set = (k: string, patch: Choice) => setChoices({ ...choices, [k]: { ...choices[k], ...patch, ok: patch.ok ?? false } });

  if (proposed.length) {
    return (
      <>
        <p className="text-xl leading-snug font-bold">{t("Add this to your schedule?", "इसे अपने समय में जोड़ें?", "Ise apne schedule mein jodein?")}</p>
        {/* A medicine already in the reminders is asked about, not doubled. */}
        <NewSchedule proposed={proposed} lock onDone={onDone} />
      </>
    );
  }

  return (
    <>
      <p className="text-xl leading-snug font-bold">{t("Everything, medicine by medicine. Is each one right?", "सब कुछ, एक-एक दवा। क्या हर एक सही है?", "Sab kuch, ek-ek dawai. Kya har ek sahi hai?")}</p>
      {merged.map((m) => {
        const c = choices[m.key] ?? {};
        const line = lineOf(m);
        const out = !!c.out;
        return (
          <div key={m.key} className={cn("space-y-2.5 rounded-2xl border-[3px] border-[#232326] p-3", out ? "bg-[#eee] opacity-70" : c.ok ? "bg-[#c9f2d8]" : m.conflict ? "bg-[oklch(0.92_0.06_25)]" : "bg-card")}>
            <p className="text-xl font-bold">
              {m.name}
              {m.strength ? <span className="font-normal"> {m.strength}</span> : null}
            </p>
            {/* Every source, in its own words. */}
            <ul className="space-y-1">
              {m.mentions.map((x, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <SrcTag src={x.src} />
                  <span>{x.quote ?? x.name}</span>
                </li>
              ))}
            </ul>
            {out ? (
              <button type="button" onClick={() => set(m.key, { out: false })} className="text-base font-bold underline">{t("Put it back", "वापस रखें", "Wapas rakhein")}</button>
            ) : (
              <>
                {m.conflict ? (
                  <div className="space-y-1.5">
                    <p className="text-base font-bold">{t("They disagree on when. Choose one:", "समय पर अलग-अलग बात है। एक चुनें:", "Time par alag-alag baat hai. Ek chunein:")}</p>
                    {m.timed.map((x, i) => (
                      <button key={i} type="button" aria-pressed={c.pick === i} onClick={() => set(m.key, { pick: i })} className="flex min-h-12 w-full items-center gap-2 rounded-xl border-[3px] border-[#232326] bg-white px-3 text-left text-base font-bold">
                        <SrcTag src={x.src} /> {x.sos ? t("when needed", "ज़रूरत पर", "zaroorat par") : SLOT.filter((_, k) => (x.slots ?? [0, 0, 0])[k] > 0).join(" · ")}
                      </button>
                    ))}
                  </div>
                ) : null}
                {line.needs.includes("when") ? (
                  <div className="space-y-1.5">
                    <p className="text-base font-bold">{t("Nobody said when. Set it only as the doctor or chemist told you:", "किसी ने समय नहीं बताया। वही लगाएँ जो डॉक्टर या केमिस्ट ने कहा:", "Kisi ne time nahi bataya. Wahi lagayein jo doctor ya chemist ne kaha:")}</p>
                    <div className="flex flex-wrap gap-2">
                      {SLOT.map((label, k) => {
                        const cur = c.slots ?? [0, 0, 0];
                        return (
                          <button key={k} type="button" aria-pressed={cur[k] > 0} onClick={() => set(m.key, { slots: cur.map((n, j) => (j === k ? (n ? 0 : 1) : n)) as Slots })} className="min-h-12 rounded-xl border-2 border-[#232326] bg-white px-3.5 text-base font-bold">
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {line.needs.includes("food") ? (
                  <div className="flex flex-wrap gap-2">
                    {FOOD.map(([v, label]) => (
                      <button key={v} type="button" aria-pressed={c.timing === v} onClick={() => set(m.key, { timing: v })} className="min-h-12 rounded-xl border-2 border-[#232326] bg-white px-3.5 text-base font-bold">
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {line.needs.includes("days") || c.days ? (
                  <label className="flex items-center gap-2 text-base font-bold">
                    {t("For how many days?", "कितने दिन?", "Kitne din?")}
                    <input inputMode="numeric" value={c.days ?? ""} onChange={(e) => set(m.key, { days: Number(e.target.value.replace(/\D/g, "")) || undefined })} className="h-12 w-20 rounded-xl border-2 border-[var(--color-input)] text-center text-lg" />
                  </label>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={line.needs.length > 0}
                    aria-pressed={!!c.ok}
                    onClick={() => setChoices({ ...choices, [m.key]: { ...c, ok: !c.ok } })}
                    className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border-[3px] border-[#232326] bg-[var(--brand)] text-base font-bold disabled:opacity-50"
                  >
                    <Check className="size-5" strokeWidth={3} aria-hidden /> {c.ok ? t("Confirmed", "पक्का", "Pakka") : t("Yes, this is right", "हाँ, यह सही है", "Haan, yeh sahi hai")}
                  </button>
                  <button type="button" onClick={() => set(m.key, { out: true })} className="min-h-12 rounded-xl border-2 border-[#232326] bg-white px-3 text-base font-bold">
                    {t("Leave out", "छोड़ दें", "Chhod dein")}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
      {error ? <p role="alert" className="text-lg font-bold text-[#b3261e]">{error}</p> : null}
      <BigButton
        disabled={!ready || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onBuilt(kept.map((m) => lineOf(m) as Line));
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : t("Next: add to my schedule", "आगे: समय में जोड़ें", "Aage: schedule mein jodein")}
      </BigButton>
      {!ready ? <p className="text-center text-base">{t("Settle and confirm every medicine, or leave it out.", "हर दवा तय करके पक्की करें, या छोड़ दें।", "Har dawai tay karke pakki karein, ya chhod dein.")}</p> : null}
    </>
  );
}
