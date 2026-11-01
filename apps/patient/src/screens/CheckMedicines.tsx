/**
 * Adding medicines without a code to scan. Two ways in, one way out.
 *
 * A printed Parcha whose code will not read: its photo is read on the phone,
 * and each medicine name comes with the times printed on the same line. A
 * photograph is not signed, so nothing read off it counts until the person has
 * confirmed it against the paper.
 *
 * No printed Parcha: a handwritten prescription cannot be
 * trusted to be read right, so the app does not bet on it. It lines up two
 * sources instead: the medicines on the pharmacy bill (printed, so the names
 * are reliable) and what the doctor or chemist said (the authority on when to
 * take them). Each medicine is added from the bill with what was said for it
 * already filled in, then comes out green (they agree), yellow (needs a look)
 * or red (they disagree, and the person picks).
 *
 * Either way, every medicine is confirmed one by one — green ones too — then
 * each strip is photographed, and the schedule is set locked. No time is
 * invented: a medicine nobody said or printed a time for starts empty and
 * cannot go on until the person fills it in.
 *
 * The photos are kept on the phone for the family to look at. The handwritten
 * prescription is never read.
 */
import { errorMessage, saveReminders, useFormulary, vaultPut, type ReminderInput } from "@parcha/client";
import { crossCheck, doseOnLine, frequencySlots, remindersFromPrescription, searchDrugs, toDateString, type CheckedMedicine, type Drug, type Finding, type Timing } from "@parcha/core";
import { Screen, cn } from "@parcha/ui";
import { BadgeCheck, Camera, Check, Lock, Mic, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useHandset } from "../auth";
import { usePeople } from "../components/people";
import { BillReader } from "../components/BillReader";
import { StripWalk } from "../components/StripWalk";
import { shrinkPhoto } from "../components/strips";
import { useT } from "../i18n";
import { BigButton, Header } from "../kit";

type Step = "who" | "photos" | "said" | "medicines" | "check" | "strips" | "done";

type Line = { drug: Drug; slots: [number, number, number]; sos: boolean; timing: Timing; days: number; /** The printed line it was read from. */ printed?: string };
const freqOf = (l: Line) => (l.sos ? "SOS" : l.slots.join("-"));
const unset = (l: Line) => !l.days || (!l.sos && l.slots.every((n) => !n));

/** A photo of a printed Parcha, handed over from the scan screen. Read once. */
let printedPhoto: { big: string; small: string } | null = null;
export function startFromPrintedPhoto(big: string, small: string) {
  printedPhoto = { big, small };
}

/** "1-0-1" as three slots, or null when it is not a three-slot pattern. */
function slotsOf(frequency: string | null | undefined): [number, number, number] | null {
  const s = frequency ? frequencySlots(frequency) : null;
  return s && s.length === 3 ? (s.map((n) => Math.min(n, 1)) as [number, number, number]) : null;
}

export function CheckMedicines() {
  const t = useT();
  const navigate = useNavigate();
  const { handset } = useHandset();
  const { people, active } = usePeople();
  const formulary = useFormulary();

  const [printed] = useState(() => {
    const p = printedPhoto;
    printedPhoto = null;
    return p;
  });
  const ALL: Step[] = printed ? ["who", "medicines", "check", "strips"] : ["who", "photos", "said", "medicines", "check", "strips"];
  // Someone already chosen on the phone is who the medicines are for: no need to ask.
  const STEPS: Step[] = active ? ALL.filter((s) => s !== "who") : ALL;

  const [step, setStep] = useState<Step>(STEPS[0]);
  const [who, setWho] = useState<string | null>(active ?? (people.length === 1 ? people[0].name : null));
  const [photos, setPhotos] = useState<{ rx?: string; bill?: string }>(printed ? { rx: printed.small } : {});
  // The paper at a size the reader can read; on screen only, never saved.
  const [toRead, setToRead] = useState<string | null>(printed?.big ?? null);
  const [said, setSaid] = useState("");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [resolved, setResolved] = useState<Record<string, boolean>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  /** Where the checked medicines were kept, for the simple Parcha. */
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hits = useMemo(() => (query.trim().length >= 2 ? searchDrugs(formulary.data, query, 5) : []), [formulary.data, query]);
  const checked: CheckedMedicine[] = useMemo(
    () => crossCheck(lines.map((l) => ({ name: l.drug.genericName, aliases: l.drug.commonBrands, frequency: freqOf(l), timing: l.timing })), said),
    [lines, said],
  );
  const allConfirmed = lines.length > 0 && lines.every((l) => confirmed[l.drug.genericName]);
  const at = STEPS.indexOf(step);
  const go = (s: Step) => setStep(s);

  /**
   * A medicine joins with only what is known about it: the times printed on its
   * line, or what the doctor said about it. Nothing else is filled in.
   */
  function add(drug: Drug, finding?: Finding) {
    if (lines.some((l) => l.drug.id === drug.id)) return;
    let line: Line = { drug, slots: [0, 0, 0], sos: false, timing: "after_food", days: 0 };
    if (printed && finding) {
      const dose = doseOnLine(finding.line);
      line = { ...line, slots: slotsOf(dose.frequency) ?? line.slots, sos: dose.frequency === "SOS", timing: dose.timing ?? line.timing, days: dose.days ?? 0, printed: finding.line };
    } else if (said.trim()) {
      const heard = crossCheck([{ name: drug.genericName, aliases: drug.commonBrands, frequency: "", timing: line.timing }], said)[0]?.heard;
      if (heard) line = { ...line, slots: slotsOf(heard.frequency) ?? line.slots, sos: heard.frequency === "SOS", timing: heard.timing ?? line.timing };
    }
    setLines([...lines, line]);
    setQuery("");
  }
  const update = (i: number, patch: Partial<Line>) => {
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    // A changed medicine is confirmed again.
    setConfirmed({ ...confirmed, [lines[i].drug.genericName]: false });
  };

  /** Take what the doctor said for this medicine, instead of what was entered. */
  function takeHeard(c: CheckedMedicine) {
    const i = lines.findIndex((l) => l.drug.genericName === c.name);
    if (i < 0 || !c.heard) return;
    const f = c.heard.frequency;
    update(i, { slots: slotsOf(f) ?? lines[i].slots, sos: f === "SOS", timing: c.heard.timing ?? lines[i].timing });
    setResolved({ ...resolved, [c.name]: true });
  }

  async function photo(kind: "rx" | "bill", file: File | undefined) {
    if (!file) return;
    setPhotos({ ...photos, [kind]: await shrinkPhoto(file, 1200) });
    // The paper to read: the bill, or the printed Parcha when that is what this is.
    if (kind === "bill" || printed) setToRead(await shrinkPhoto(file, 2000));
  }

  async function finish() {
    if (!who) return;
    setBusy(true);
    setError(null);
    try {
      const id = `check:${Date.now()}`;
      await vaultPut(id, {
        person: who,
        from: printed ? "printed" : "bill",
        photos,
        said,
        medicines: lines.map((l) => ({ name: l.drug.genericName, frequency: freqOf(l), timing: l.timing, days: l.days })),
        savedAt: new Date().toISOString(),
      });
      const reminders = remindersFromPrescription({
        ownerPhone: handset?.phone ?? "",
        personName: who,
        visitId: id,
        startDate: toDateString(new Date()),
        items: lines.map((l) => ({ drugId: l.drug.id, drugName: l.drug.genericName, strength: l.drug.defaultStrength, form: l.drug.defaultForm, frequency: freqOf(l), durationDays: l.days, timing: l.timing })),
      });
      // Checked one by one and every strip photographed: locked.
      if (reminders.length) await saveReminders(reminders.slice(0, 20).map((r) => ({ ...r, locked: true })) as ReminderInput[]);
      setSavedAs(id);
      go("done");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const TONE = { green: "bg-[#c9f2d8]", yellow: "bg-[var(--morning-soft)]", red: "bg-[oklch(0.92_0.06_25)]" } as const;
  const WORD = {
    green: t("Matches what was said", "जो कहा गया, उससे मेल खाता है", "Jo kaha gaya, usse mel khaata hai"),
    yellow: t("Needs a look", "एक बार देख लें", "Ek baar dekh lein"),
    red: t("Does not match: choose one", "मेल नहीं खाता: एक चुनें", "Mel nahi khaata: ek chunein"),
  };
  const SLOT_NAMES = [t("Morning", "सुबह", "Subah"), t("Afternoon", "दोपहर", "Dopahar"), t("Night", "रात", "Raat")];
  const TIMING_NAMES: Record<string, string> = {
    after_food: t("after food", "खाने के बाद", "khane ke baad"),
    before_food: t("before food", "खाने से पहले", "khane se pehle"),
    empty_stomach: t("empty stomach", "खाली पेट", "khaali pet"),
  };
  const plain = (l: Line) =>
    `${l.sos ? t("When needed", "ज़रूरत पर", "Zaroorat par") : SLOT_NAMES.filter((_, s) => l.slots[s]).join(" · ")} · ${TIMING_NAMES[l.timing] ?? ""} · ${t(`${l.days} days`, `${l.days} दिन`, `${l.days} din`)}`;

  return (
    <>
      <Header
        back="/"
        title={printed ? t("Read my Parcha", "मेरा पर्चा पढ़ें", "Mera Parcha padhein") : t("Check my medicines", "मेरी दवाइयाँ जाँचें", "Meri dawaiyan jaanchein")}
        subtitle={step === "done" ? undefined : t(`Step ${at + 1} of ${STEPS.length}`, `चरण ${at + 1} / ${STEPS.length}`, `Step ${at + 1} / ${STEPS.length}`)}
      />
      <Screen className="space-y-5 px-4 pb-10">
        {step !== "done" ? (
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <span key={s} className={cn("h-2 flex-1 rounded-full border-2 border-[#232326]", i <= at ? "bg-[var(--brand)]" : "bg-white")} />
            ))}
          </div>
        ) : null}

        {step === "who" ? (
          <>
            <p className="text-xl font-bold">{t("Who are the medicines for?", "दवाइयाँ किसकी हैं?", "Dawaiyan kiski hain?")}</p>
            {people.map((p) => (
              <button
                key={p.name}
                type="button"
                aria-pressed={who === p.name}
                onClick={() => setWho(p.name)}
                className={cn("hover-orange flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 border-[var(--brand-deep)] px-4 text-left text-xl font-bold", who === p.name ? "bg-[var(--brand-soft)]" : "bg-card")}
              >
                {who === p.name ? <Check className="size-6" strokeWidth={3} aria-hidden /> : null}
                {p.shown}
              </button>
            ))}
            <BigButton disabled={!who} onClick={() => go(STEPS[1])}>{t("Next", "आगे", "Aage")}</BigButton>
          </>
        ) : null}

        {step === "photos" ? (
          <>
            <p className="text-xl leading-snug font-bold">{t("Photos of the prescription and the bill", "पर्चे और बिल की फ़ोटो", "Parche aur bill ki photo")}</p>
            <div className="grid grid-cols-2 gap-3">
              {(["rx", "bill"] as const).map((k) => (
                <label key={k} className="hover-orange relative flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-[#232326] bg-white p-2 text-center text-lg font-bold">
                  {photos[k] ? <img src={photos[k]} alt="" className="absolute inset-0 size-full object-cover" /> : <Camera className="size-9" aria-hidden />}
                  <span className={photos[k] ? "relative rounded-full bg-white/90 px-2" : ""}>
                    {k === "rx" ? t("Prescription", "पर्चा", "Parcha") : t("Pharmacy bill", "दवा का बिल", "Dawa ka bill")}
                  </span>
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void photo(k, e.target.files?.[0])} />
                </label>
              ))}
            </div>
            <p className="text-muted-foreground text-base">{t("The bill is read on this phone. Both photos stay here so the family can see them.", "बिल इसी फ़ोन पर पढ़ा जाता है। दोनों फ़ोटो यहीं रहती हैं, परिवार देख सके।", "Bill isi phone par padha jaata hai. Dono photo yahin rehti hain, parivaar dekh sake.")}</p>
            <BigButton onClick={() => go("said")}>{t("Next", "आगे", "Aage")}</BigButton>
          </>
        ) : null}

        {step === "said" ? (
          <>
            <p className="text-xl leading-snug font-bold">{t("What did the doctor or chemist say?", "डॉक्टर या केमिस्ट ने क्या कहा?", "Doctor ya chemist ne kya kaha?")}</p>
            <p className="flex items-start gap-2 rounded-2xl border-2 border-[#232326] bg-[var(--brand-soft)] p-3 text-base leading-snug">
              <Mic className="mt-0.5 size-5 shrink-0" aria-hidden />
              {t(
                "Tap the box, then the microphone on the keyboard, and hold the phone near the doctor or chemist while they say it.",
                "बॉक्स दबाएँ, फिर कीबोर्ड का माइक, और डॉक्टर या केमिस्ट के बोलते समय फ़ोन पास रखें।",
                "Box dabayein, phir keyboard ka mic, aur doctor ya chemist ke bolte samay phone paas rakhein.",
              )}
            </p>
            <textarea
              value={said}
              onChange={(e) => setSaid(e.target.value)}
              rows={5}
              placeholder={t("For example: Crocin morning and night after food. Cetirizine at night.", "जैसे: क्रोसिन सुबह-रात खाने के बाद। सेट्रिज़िन रात को।", "Jaise: Crocin subah raat khane ke baad. Cetirizine raat ko.")}
              className="bg-card w-full rounded-2xl border-2 border-[var(--color-input)] px-4 py-3 text-lg leading-snug outline-none focus:border-[var(--brand)]"
            />
            <BigButton onClick={() => go("medicines")}>{t("Next", "आगे", "Aage")}</BigButton>
          </>
        ) : null}

        {step === "medicines" ? (
          <>
            <p className="text-xl leading-snug font-bold">
              {printed ? t("The medicines on your Parcha", "आपके पर्चे की दवाइयाँ", "Aapke Parche ki dawaiyan") : t("Add each medicine from the bill", "बिल से हर दवा जोड़ें", "Bill se har dawa jodein")}
            </p>
            {toRead ? (
              <BillReader picture={toRead} paper={printed ? "parcha" : "bill"} drugs={formulary.data} added={lines.map((l) => l.drug.id)} onAdd={add} onRetake={() => setToRead(null)} />
            ) : (
              <label className="hover-orange flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#232326] bg-white px-4 text-center text-lg font-bold">
                <Camera className="size-6 shrink-0" aria-hidden />
                {printed
                  ? t("Photo of the Parcha, to read it on this phone", "पर्चे की फ़ोटो, इसी फ़ोन पर पढ़ने के लिए", "Parche ki photo, isi phone par padhne ke liye")
                  : t("Photo of the bill, to read it on this phone", "बिल की फ़ोटो, इसी फ़ोन पर पढ़ने के लिए", "Bill ki photo, isi phone par padhne ke liye")}
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void photo(printed ? "rx" : "bill", e.target.files?.[0])} />
              </label>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Name or brand, e.g. Dolo", "नाम या ब्रांड, जैसे Dolo", "Naam ya brand, jaise Dolo")}
                className="bg-card h-14 w-full rounded-2xl border-2 border-[var(--color-input)] pr-3 pl-10 text-lg outline-none focus:border-[var(--brand)]"
              />
            </div>
            {hits.map((h) => (
              <button key={h.drug.id} type="button" onClick={() => add(h.drug)} className="hover-orange flex w-full items-center gap-3 rounded-2xl border-2 border-[#232326] bg-white px-4 py-3 text-left">
                <Plus className="size-5 shrink-0" aria-hidden />
                <span className="text-lg font-bold">
                  {h.name}
                  {h.name !== h.drug.genericName ? <span className="font-normal"> · {h.drug.genericName}</span> : null}
                </span>
              </button>
            ))}
            {lines.map((l, i) => (
              <div key={l.drug.id} className={cn("space-y-2.5 rounded-2xl border-[3px] border-[#232326] p-3", unset(l) ? "bg-[var(--morning-soft)]" : "bg-card")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xl font-bold">{l.drug.genericName}</p>
                  <button type="button" aria-label={t("Remove", "हटाएँ", "Hataayein")} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded-lg p-2 hover:bg-black/10">
                    <Trash2 className="size-5" aria-hidden />
                  </button>
                </div>
                {l.printed ? (
                  <p className="rounded-lg border-2 border-dashed border-[#232326] bg-white px-2 py-1 font-mono text-sm">
                    {t("Printed", "छपा है", "Chhapa hai")}: {l.printed}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {SLOT_NAMES.map((label, s) => (
                    <Toggle key={s} on={!l.sos && l.slots[s] > 0} onClick={() => update(i, { sos: false, slots: l.slots.map((n, k) => (k === s ? (n ? 0 : 1) : n)) as Line["slots"] })}>
                      {label}
                    </Toggle>
                  ))}
                  <Toggle on={l.sos} onClick={() => update(i, { sos: !l.sos })}>
                    {t("When needed", "ज़रूरत पर", "Zaroorat par")}
                  </Toggle>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["after_food", "before_food", "empty_stomach"] as const).map((v) => (
                    <Toggle key={v} on={l.timing === v} onClick={() => update(i, { timing: v })}>
                      {TIMING_NAMES[v]}
                    </Toggle>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-lg font-bold">
                  {t("For how many days?", "कितने दिन?", "Kitne din?")}
                  <input
                    inputMode="numeric"
                    value={l.days || ""}
                    onChange={(e) => update(i, { days: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                    className="h-12 w-20 rounded-xl border-2 border-[var(--color-input)] text-center text-lg"
                  />
                </label>
                {unset(l) ? <p className="text-base font-bold">{t("Choose when, and for how many days.", "कब और कितने दिन, चुनें।", "Kab aur kitne din, chunein.")}</p> : null}
              </div>
            ))}
            <BigButton disabled={lines.length === 0 || lines.some(unset)} onClick={() => go("check")}>
              {t("Check them one by one", "एक-एक करके जाँचें", "Ek-ek karke jaanchein")}
            </BigButton>
          </>
        ) : null}

        {step === "check" ? (
          <>
            <p className="text-xl leading-snug font-bold">
              {printed
                ? t("Look at the paper. Is each one right?", "पर्चा देखें। क्या हर एक सही है?", "Parcha dekhein. Kya har ek sahi hai?")
                : t("Bill and words, side by side. Is each one right?", "बिल और कही बात, आमने-सामने। क्या हर एक सही है?", "Bill aur kahi baat, aamne-saamne. Kya har ek sahi hai?")}
            </p>
            {printed && photos.rx ? <img src={photos.rx} alt={t("Your Parcha", "आपका पर्चा", "Aapka Parcha")} className="w-full rounded-2xl border-[3px] border-[#232326]" /> : null}
            {lines.map((l) => {
              const c = checked.find((x) => x.name === l.drug.genericName);
              const status = printed ? null : (c?.status ?? "yellow");
              const blocked = status === "red" && !resolved[l.drug.genericName];
              const ok = !!confirmed[l.drug.genericName];
              return (
                <div key={l.drug.id} className={cn("space-y-2 rounded-2xl border-[3px] border-[#232326] p-3", ok ? "bg-[#c9f2d8]" : status ? TONE[status] : "bg-card")}>
                  <p className="flex flex-wrap items-center justify-between gap-2 text-xl font-bold">
                    {l.drug.genericName}
                    {status && !ok ? <span className="rounded-full border-2 border-[#232326] bg-white px-2.5 py-0.5 text-sm">{WORD[status]}</span> : null}
                  </p>
                  <p className="text-lg">{plain(l)}</p>
                  {c?.heard?.frequency && !printed ? (
                    <p className="text-base">
                      {t("Words say", "कही बात", "Kahi baat")}: <b>{c.heard.frequency}</b>
                    </p>
                  ) : null}
                  {status === "red" && !resolved[l.drug.genericName] ? (
                    <div className="flex flex-wrap gap-2">
                      <Toggle on={false} onClick={() => c && takeHeard(c)}>{t("Use what was said", "कही बात मानें", "Kahi baat maanein")}</Toggle>
                      <Toggle on={false} onClick={() => setResolved({ ...resolved, [l.drug.genericName]: true })}>{t("Keep mine", "मेरा रखें", "Mera rakhein")}</Toggle>
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={blocked}
                      aria-pressed={ok}
                      onClick={() => setConfirmed({ ...confirmed, [l.drug.genericName]: !ok })}
                      className={cn(
                        "flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border-[3px] border-[#232326] text-base font-bold disabled:opacity-50",
                        ok ? "bg-white" : "bg-[var(--brand)] shadow-[0_2px_0_#232326]",
                      )}
                    >
                      <Check className="size-5" strokeWidth={3} aria-hidden /> {ok ? t("Confirmed", "पक्का", "Pakka") : t("Yes, this is right", "हाँ, यह सही है", "Haan, yeh sahi hai")}
                    </button>
                    <button type="button" onClick={() => go("medicines")} className="flex min-h-12 items-center gap-1.5 rounded-xl border-2 border-[#232326] bg-white px-3 text-base font-bold">
                      <Pencil className="size-4" aria-hidden /> {t("Change", "बदलें", "Badlein")}
                    </button>
                  </div>
                </div>
              );
            })}
            <BigButton disabled={!allConfirmed} onClick={() => go("strips")}>{t("Next: the strips", "आगे: पत्ते", "Aage: patte")}</BigButton>
            {!allConfirmed ? <p className="text-center text-base">{t("Confirm every medicine first.", "पहले हर दवा पक्की करें।", "Pehle har dawa pakki karein.")}</p> : null}
          </>
        ) : null}

        {step === "strips" ? (
          <>
            <p className="text-xl leading-snug font-bold">{t("Now each strip, one at a time", "अब हर पत्ता, एक-एक करके", "Ab har patta, ek-ek karke")}</p>
            <StripWalk
              medicines={lines.map((l) => ({ name: l.drug.genericName, detail: plain(l) }))}
              onDone={() => void finish()}
              finishLabel={busy ? t("Locking…", "लॉक हो रहा है…", "Lock ho raha hai…") : t("Lock my schedule", "मेरा समय लॉक करें", "Mera schedule lock karein")}
            />
            {error ? <p role="alert" className="text-destructive text-lg font-bold">{error}</p> : null}
          </>
        ) : null}

        {step === "done" ? (
          <div className="space-y-4 text-center">
            <BadgeCheck className="mx-auto size-16" strokeWidth={2} aria-hidden />
            <p className="flex items-center justify-center gap-2 text-2xl leading-tight font-bold">
              <Lock className="size-6" aria-hidden /> {t("Schedule locked", "समय लॉक हो गया", "Schedule lock ho gaya")}
            </p>
            <p className="text-lg">
              {t(
                `${lines.length} medicine${lines.length === 1 ? "" : "s"} for ${who}. At each time you will see the strip to take.`,
                `${who} की ${lines.length} दवाइयाँ। हर समय पर वही पत्ता दिखेगा।`,
                `${who} ki ${lines.length} dawaiyan. Har time par wahi patta dikhega.`,
              )}
            </p>
            {savedAs ? (
              <BigButton onClick={() => navigate(`/simple/${encodeURIComponent(savedAs)}`, { replace: true })}>{t("See my simple Parcha", "मेरा आसान पर्चा देखें", "Mera aasaan Parcha dekhein")}</BigButton>
            ) : null}
            <button type="button" onClick={() => navigate("/schedule", { replace: true })} className="min-h-12 w-full text-lg font-bold underline">
              {t("See today's medicines", "आज की दवाइयाँ देखें", "Aaj ki dawaiyan dekhein")}
            </button>
          </div>
        ) : null}

        {step !== STEPS[0] && step !== "done" ? (
          <button type="button" onClick={() => go(STEPS[Math.max(0, at - 1)])} className="w-full text-center text-lg font-bold underline">
            {t("Back", "वापस", "Wapas")}
          </button>
        ) : null}
      </Screen>
    </>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("min-h-12 rounded-xl border-2 border-[#232326] px-3.5 text-base font-bold", on ? "bg-[var(--brand)] shadow-[0_2px_0_#232326]" : "bg-white")}
    >
      {children}
    </button>
  );
}
