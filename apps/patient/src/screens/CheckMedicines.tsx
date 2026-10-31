/**
 * "No, I don't have a Parcha": checking the medicines another way (from RapidRX).
 *
 * A handwritten prescription cannot be trusted to be read right, so the app
 * does not bet on it. Instead it lines up two sources: the medicines on the
 * pharmacy bill (printed, so the names are reliable) and what the doctor or
 * chemist said (the authority on when to take them). Each medicine comes out
 * green (they agree), yellow (needs a look) or red (they disagree, and the
 * person picks). Nothing is decided silently, and no time is invented.
 *
 * The photos of the prescription and bill are kept on the phone for the family
 * to look at. The bill can be read on the phone (BillReader): the printed
 * medicine names are found and boxed on the photo, each with why, and the
 * person adds the ones that are right; anything else is added by searching.
 * The handwritten prescription is never read.
 */
import { errorMessage, saveReminders, useFormulary, vaultPut, type ReminderInput } from "@parcha/client";
import { crossCheck, remindersFromPrescription, searchDrugs, toDateString, type CheckedMedicine, type Drug, type Timing } from "@parcha/core";
import { Screen, cn } from "@parcha/ui";
import { BadgeCheck, Camera, Check, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useHandset } from "../auth";
import { usePeople } from "../components/people";
import { BillReader } from "../components/BillReader";
import { shrinkPhoto, StripCapture } from "../components/strips";
import { useT } from "../i18n";
import { BigButton, Header } from "../kit";

type Step = "who" | "photos" | "said" | "medicines" | "check" | "strips" | "done";
const ALL_STEPS: Step[] = ["who", "photos", "said", "medicines", "check", "strips"];

type Line = { drug: Drug; slots: [number, number, number]; sos: boolean; timing: Timing; days: number };
const freqOf = (l: Line) => (l.sos ? "SOS" : l.slots.join("-"));

export function CheckMedicines() {
  const t = useT();
  const navigate = useNavigate();
  const { handset } = useHandset();
  const { people, active } = usePeople();
  // Someone already chosen on the phone is who the medicines are for: no need to ask.
  const STEPS: Step[] = active ? ALL_STEPS.filter((s) => s !== "who") : ALL_STEPS;
  const formulary = useFormulary();

  const [step, setStep] = useState<Step>(active ? "photos" : "who");
  const [who, setWho] = useState<string | null>(active ?? (people.length === 1 ? people[0].name : null));
  const [photos, setPhotos] = useState<{ rx?: string; bill?: string }>({});
  // The bill at a size the reader can read; on screen only, never saved.
  const [billToRead, setBillToRead] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [resolved, setResolved] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hits = useMemo(() => (query.trim().length >= 2 ? searchDrugs(formulary.data, query, 5) : []), [formulary.data, query]);
  const checked: CheckedMedicine[] = useMemo(
    () => crossCheck(lines.map((l) => ({ name: l.drug.genericName, aliases: l.drug.commonBrands, frequency: freqOf(l), timing: l.timing })), said),
    [lines, said],
  );
  const allSettled = checked.every((c) => c.status === "green" || resolved[c.name]);
  const at = STEPS.indexOf(step);
  const go = (s: Step) => setStep(s);

  function add(drug: Drug) {
    if (lines.some((l) => l.drug.id === drug.id)) return;
    setLines([...lines, { drug, slots: [1, 0, 1], sos: false, timing: "after_food", days: 5 }]);
    setQuery("");
  }
  const update = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /** Take what the doctor said for this medicine, instead of what was entered. */
  function takeHeard(c: CheckedMedicine) {
    const i = lines.findIndex((l) => l.drug.genericName === c.name);
    if (i < 0 || !c.heard) return;
    const f = c.heard.frequency;
    const slots = f && f !== "SOS" ? (f.split("-").map(Number).slice(0, 3) as [number, number, number]) : lines[i].slots;
    update(i, { slots, sos: f === "SOS", timing: c.heard.timing ?? lines[i].timing });
    setResolved({ ...resolved, [c.name]: true });
  }

  async function photo(kind: "rx" | "bill", file: File | undefined) {
    if (!file) return;
    setPhotos({ ...photos, [kind]: await shrinkPhoto(file, 1200) });
    if (kind === "bill") setBillToRead(await shrinkPhoto(file, 2000));
  }

  async function finish() {
    if (!who) return;
    setBusy(true);
    setError(null);
    try {
      const id = `check:${Date.now()}`;
      await vaultPut(id, { person: who, photos, said, medicines: lines.map((l) => ({ name: l.drug.genericName, frequency: freqOf(l), timing: l.timing, days: l.days })), savedAt: new Date().toISOString() });
      const reminders = remindersFromPrescription({
        ownerPhone: handset?.phone ?? "",
        personName: who,
        visitId: id,
        startDate: toDateString(new Date()),
        items: lines.map((l) => ({ drugId: l.drug.id, drugName: l.drug.genericName, strength: l.drug.defaultStrength, form: l.drug.defaultForm, frequency: freqOf(l), durationDays: l.days, timing: l.timing })),
      });
      if (reminders.length) await saveReminders(reminders.slice(0, 20) as ReminderInput[]);
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

  return (
    <>
      <Header
        back="/"
        title={t("Check my medicines", "मेरी दवाइयाँ जाँचें", "Meri dawaiyan jaanchein")}
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
                onClick={() => setWho(p.name)}
                className={cn("hover-orange flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 border-[var(--brand-deep)] px-4 text-left text-xl font-bold", who === p.name ? "bg-[var(--brand-soft)]" : "bg-card")}
              >
                {who === p.name ? <Check className="size-6" strokeWidth={3} aria-hidden /> : null}
                {p.shown}
              </button>
            ))}
            <BigButton disabled={!who} onClick={() => go("photos")}>{t("Next", "आगे", "Aage")}</BigButton>
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
            <p className="text-muted-foreground text-base">{t("Kept on this phone so the family can see them. Optional.", "इसी फ़ोन में रहती हैं, परिवार देख सके। ज़रूरी नहीं।", "Isi phone mein rehti hain, parivaar dekh sake. Zaroori nahi.")}</p>
            <BigButton onClick={() => go("said")}>{t("Next", "आगे", "Aage")}</BigButton>
          </>
        ) : null}

        {step === "said" ? (
          <>
            <p className="text-xl leading-snug font-bold">{t("What did the doctor or chemist say?", "डॉक्टर या केमिस्ट ने क्या कहा?", "Doctor ya chemist ne kya kaha?")}</p>
            <textarea
              value={said}
              onChange={(e) => setSaid(e.target.value)}
              rows={5}
              placeholder={t("For example: Crocin morning and night after food. Cetirizine at night.", "जैसे: क्रोसिन सुबह-रात खाने के बाद। सेट्रिज़िन रात को।", "Jaise: Crocin subah raat khane ke baad. Cetirizine raat ko.")}
              className="bg-card w-full rounded-2xl border-2 border-[var(--color-input)] px-4 py-3 text-lg leading-snug outline-none focus:border-[var(--brand)]"
            />
            <p className="text-muted-foreground text-base">{t("You can speak: tap the microphone on your keyboard.", "बोलकर भी लिख सकते हैं: कीबोर्ड का माइक दबाएँ।", "Bolkar bhi likh sakte hain: keyboard ka mic dabaayein.")}</p>
            <BigButton onClick={() => go("medicines")}>{t("Next", "आगे", "Aage")}</BigButton>
          </>
        ) : null}

        {step === "medicines" ? (
          <>
            <p className="text-xl leading-snug font-bold">{t("Add each medicine from the bill", "बिल से हर दवा जोड़ें", "Bill se har dawa jodein")}</p>
            {billToRead ? (
              <BillReader picture={billToRead} drugs={formulary.data} added={lines.map((l) => l.drug.id)} onAdd={add} />
            ) : (
              <label className="hover-orange flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#232326] bg-white px-4 text-center text-lg font-bold">
                <Camera className="size-6 shrink-0" aria-hidden />
                {t("Photo of the bill, to read it on this phone", "बिल की फ़ोटो, इसी फ़ोन पर पढ़ने के लिए", "Bill ki photo, isi phone par padhne ke liye")}
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void photo("bill", e.target.files?.[0])} />
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
              <div key={l.drug.id} className="space-y-2.5 rounded-2xl border-[3px] border-[#232326] bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xl font-bold">{l.drug.genericName}</p>
                  <button type="button" aria-label={t("Remove", "हटाएँ", "Hataayein")} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded-lg p-2 hover:bg-black/10">
                    <Trash2 className="size-5" aria-hidden />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[t("Morning", "सुबह", "Subah"), t("Afternoon", "दोपहर", "Dopahar"), t("Night", "रात", "Raat")].map((label, s) => (
                    <Toggle key={s} on={!l.sos && l.slots[s] > 0} onClick={() => update(i, { sos: false, slots: l.slots.map((n, k) => (k === s ? (n ? 0 : 1) : n)) as Line["slots"] })}>
                      {label}
                    </Toggle>
                  ))}
                  <Toggle on={l.sos} onClick={() => update(i, { sos: !l.sos })}>
                    {t("When needed", "ज़रूरत पर", "Zaroorat par")}
                  </Toggle>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["after_food", t("After food", "खाने के बाद", "Khane ke baad")],
                      ["before_food", t("Before food", "खाने से पहले", "Khane se pehle")],
                      ["empty_stomach", t("Empty stomach", "खाली पेट", "Khaali pet")],
                    ] as const
                  ).map(([v, label]) => (
                    <Toggle key={v} on={l.timing === v} onClick={() => update(i, { timing: v })}>
                      {label}
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
              </div>
            ))}
            <BigButton disabled={lines.length === 0 || lines.some((l) => !l.days || (!l.sos && l.slots.every((n) => !n)))} onClick={() => go("check")}>
              {t("Check them", "जाँचें", "Jaanchein")}
            </BigButton>
          </>
        ) : null}

        {step === "check" ? (
          <>
            <p className="text-xl leading-snug font-bold">{t("Bill and words, side by side", "बिल और कही बात, आमने-सामने", "Bill aur kahi baat, aamne-saamne")}</p>
            {checked.map((c) => {
              const l = lines.find((x) => x.drug.genericName === c.name)!;
              const done = c.status === "green" || resolved[c.name];
              return (
                <div key={c.name} className={cn("space-y-2 rounded-2xl border-[3px] border-[#232326] p-3", TONE[c.status])}>
                  <p className="flex items-center justify-between gap-2 text-xl font-bold">
                    {c.name}
                    <span className="rounded-full border-2 border-[#232326] bg-white px-2.5 py-0.5 text-sm">{WORD[c.status]}</span>
                  </p>
                  <p className="text-lg">
                    {t("You entered", "आपने लिखा", "Aapne likha")}: <b>{freqOf(l)}</b>
                    {c.heard?.frequency ? (
                      <>
                        {" · "}
                        {t("Words say", "कही बात", "Kahi baat")}: <b>{c.heard.frequency}</b>
                      </>
                    ) : null}
                  </p>
                  {c.status === "red" ? (
                    <div className="flex flex-wrap gap-2">
                      <Toggle on={false} onClick={() => takeHeard(c)}>{t("Use what was said", "कही बात मानें", "Kahi baat maanein")}</Toggle>
                      <Toggle on={!!resolved[c.name]} onClick={() => setResolved({ ...resolved, [c.name]: true })}>{t("Keep mine", "मेरा रखें", "Mera rakhein")}</Toggle>
                    </div>
                  ) : c.status === "yellow" ? (
                    <Toggle on={!!resolved[c.name]} onClick={() => setResolved({ ...resolved, [c.name]: !resolved[c.name] })}>
                      {t("I have checked this with the doctor or chemist", "मैंने डॉक्टर या केमिस्ट से पक्का किया", "Maine doctor ya chemist se pakka kiya")}
                    </Toggle>
                  ) : null}
                  {done ? <Check className="size-6" strokeWidth={3} aria-label={t("Settled", "तय", "Tay")} /> : null}
                </div>
              );
            })}
            <BigButton disabled={!allSettled} onClick={() => go("strips")}>{t("Next", "आगे", "Aage")}</BigButton>
            {!allSettled ? <p className="text-center text-base">{t("Settle every yellow and red one first.", "पहले हर पीला और लाल तय करें।", "Pehle har peela aur laal tay karein.")}</p> : null}
          </>
        ) : null}

        {step === "strips" ? (
          <>
            <p className="text-xl leading-snug font-bold">{t("Take a photo of each strip", "हर पत्ते की फ़ोटो लें", "Har patte ki photo lein")}</p>
            {lines.map((l) => (
              <div key={l.drug.id} className="space-y-2 rounded-2xl border-[3px] border-[#232326] bg-card p-3">
                <p className="text-lg font-bold">{l.drug.genericName}</p>
                <StripCapture medicine={l.drug.genericName} />
              </div>
            ))}
            {error ? <p role="alert" className="text-destructive text-lg font-bold">{error}</p> : null}
            <BigButton disabled={busy} onClick={() => void finish()}>
              {busy ? <Loader2 className="size-6 animate-spin" /> : t("Set my reminders", "मेरे रिमाइंडर लगाएँ", "Mere reminder lagaayein")}
            </BigButton>
          </>
        ) : null}

        {step === "done" ? (
          <div className="space-y-4 text-center">
            <BadgeCheck className="mx-auto size-16" strokeWidth={2} aria-hidden />
            <p className="text-2xl leading-tight font-bold">{t("Reminders are set", "रिमाइंडर लग गए", "Reminder lag gaye")}</p>
            <BigButton onClick={() => navigate("/schedule", { replace: true })}>{t("See today's medicines", "आज की दवाइयाँ देखें", "Aaj ki dawaiyan dekhein")}</BigButton>
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
