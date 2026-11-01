/**
 * Ask: talk to your own Parchas.
 *
 * Everything on this screen is answered from the Parchas this phone already
 * holds. Type or say a medicine name, or photograph the strip in your hand,
 * and it says what the record says: that this is the medicine, that Dr Khan
 * put it on the Parcha of 14 October at Rohini City Hospital, how it was
 * written, and whether the course is about to end.
 *
 * What it will not do is the point of it. It does not say what a medicine is
 * for, whether to take it, whether to stop, or what to take instead — none of
 * that is on the paper, and a phone inventing it is the thing this product
 * exists to prevent. A question the records cannot answer is answered with
 * "the record does not say".
 *
 * The lookup is plain code (`packages/core/src/askMemory.ts`). A model is used
 * for one thing only: reading a medicine *name* off a photograph. Nothing is
 * sent anywhere until the person taps the button that says so.
 */
import { useReminders } from "@parcha/client";
import { recallAll, recallMedicine, runningOut, rxName, toDateString, type MedicineMemory } from "@parcha/core";
import { Screen } from "@parcha/ui";
import { AlertTriangle, BadgeCheck, Camera, Loader2, MessageCircle, Search, Stethoscope } from "lucide-react";
import { useMemo, useState } from "react";

import { useHandset } from "../auth";
import { useMemoryParchas } from "../components/memory";
import { useActivePerson } from "../components/people";
import { ListenButton } from "../components/speak";
import { readDrugPhoto, drugReadingAvailable } from "../components/drugPhoto";
import { dateIn, useLang, useT, type T, type Lang } from "../i18n";
import { DoseTiles, Header, TimingRow } from "../kit";

/** What the record says about one medicine, said plainly and with its source. */
function MemoryCard({ memory, t, lang }: { memory: MedicineMemory; t: T; lang: Lang }) {
  const { parcha, medicine } = memory.latest;
  const who = [parcha.doctor, parcha.hospital].filter(Boolean).join(" · ");
  const spoken = [
    t(`This is ${medicine.name}.`, `यह ${medicine.name} है।`, `Yeh ${medicine.name} hai.`),
    parcha.doctor
      ? t(
          `It was written by ${parcha.doctor} on ${dateIn(lang, parcha.date)}.`,
          `यह ${parcha.doctor} ने ${dateIn(lang, parcha.date)} को लिखी थी।`,
          `Yeh ${parcha.doctor} ne ${dateIn(lang, parcha.date)} ko likhi thi.`,
        )
      : t(
          `It is on the Parcha of ${dateIn(lang, parcha.date)}.`,
          `यह ${dateIn(lang, parcha.date)} के पर्चे पर है।`,
          `Yeh ${dateIn(lang, parcha.date)} ke Parche par hai.`,
        ),
  ].join(" ");

  return (
    <article className="space-y-3 rounded-2xl border-[3px] border-[#232326] bg-card p-3.5 shadow-[0_3px_0_#232326]">
      <div className="flex items-start gap-3">
        {parcha.certain ? <BadgeCheck className="mt-0.5 size-7 shrink-0" aria-hidden /> : <Stethoscope className="mt-0.5 size-7 shrink-0" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="text-xl leading-tight font-bold">
            {medicine.strength || medicine.form
              ? rxName({ drugName: medicine.name, strength: medicine.strength ?? "", form: medicine.form ?? "" })
              : medicine.name}
          </p>
          <p className="text-base">{who || t("From your own Parchas", "आपके ही पर्चों से", "Aapke hi Parchon se")}</p>
          <p className="text-base font-bold">{dateIn(lang, parcha.date)}</p>
        </div>
      </div>

      {/* How it was written, drawn rather than abbreviated: never 1-0-1, never HS. */}
      {medicine.frequency ? <DoseTiles frequency={medicine.frequency} form={medicine.form ?? undefined} /> : null}
      {medicine.timing ? <TimingRow timing={medicine.timing} form={medicine.form ?? undefined} /> : null}
      {medicine.durationDays ? (
        <p className="text-base font-bold">
          {t(`For ${medicine.durationDays} days`, `${medicine.durationDays} दिन के लिए`, `${medicine.durationDays} din ke liye`)}
        </p>
      ) : null}
      {medicine.instructions ? <p className="text-base">{medicine.instructions}</p> : null}

      {!parcha.certain ? (
        <p className="flex items-start gap-2 rounded-xl border-2 border-[#232326] bg-[var(--morning-soft)] p-2.5 text-base">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          {t(
            "This one was added by your family from a bill, not scanned from a signed Parcha.",
            "यह आपके परिवार ने बिल से जोड़ी थी, साइन किए पर्चे से स्कैन नहीं हुई।",
            "Yeh aapke family ne bill se jodi thi, sign kiye Parche se scan nahi hui.",
          )}
        </p>
      ) : null}

      {memory.mentions.length > 1 ? (
        <details className="rounded-xl border-2 border-[#232326] p-2.5">
          <summary className="min-h-11 cursor-pointer text-base font-bold">
            {t(
              `On ${memory.mentions.length} of your Parchas`,
              `आपके ${memory.mentions.length} पर्चों पर`,
              `Aapke ${memory.mentions.length} Parchon par`,
            )}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {memory.mentions.map(({ parcha: p, medicine: m }, i) => (
              <li key={i} className="text-base">
                {dateIn(lang, p.date)} · {[p.doctor, p.hospital].filter(Boolean).join(", ") || t("Added here", "यहाँ जोड़ा", "Yahan joda")}
                {m.frequency ? ` · ${m.frequency}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <ListenButton text={spoken} label={t("Listen", "सुनें", "Sunein")} lang={lang === "en" ? "en" : "hi"} />

      <p className="text-sm">
        {t(
          "Parcha reads your records back to you. It does not say what a medicine is for, or whether to take it — ask your doctor.",
          "पर्चा आपके ही रिकॉर्ड पढ़कर बताता है। दवा किस लिए है या लेनी है या नहीं, यह डॉक्टर से पूछें।",
          "Parcha aapke hi record padhkar batata hai. Dawa kis liye hai ya leni hai ya nahi, yeh doctor se poochhein.",
        )}
      </p>
    </article>
  );
}

export function Ask() {
  const t = useT();
  const lang = useLang();
  const person = useActivePerson();
  const { handset } = useHandset();
  const parchas = useMemoryParchas(person?.name ?? null);
  const reminders = useReminders(handset?.phone ?? null);

  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = toDateString(new Date());
  const mine = person ? reminders.data.filter((r) => r.personName === person.name) : reminders.data;
  const ending = runningOut(mine, 3, today);
  const everything = useMemo(() => recallAll(parchas), [parchas]);
  const found = asked ? recallMedicine(parchas, asked) : null;

  function look(name: string) {
    setError(null);
    setAsked(name.trim() || null);
  }

  /** The one place a model is used: a name read off the strip in their hand. */
  async function fromPhoto(file: File) {
    setError(null);
    setReading(true);
    try {
      const name = await readDrugPhoto(file);
      if (!name) {
        setError(t("The name on the strip could not be read. Try typing it.", "पत्ते पर नाम पढ़ा नहीं गया। टाइप करके देखें।", "Patte par naam padha nahi gaya. Type karke dekhein."));
        return;
      }
      setQuery(name);
      look(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      <Header
        title={t("Ask", "पूछें", "Poochhein")}
        subtitle={person?.shown ?? t("Choose a family member first", "पहले परिवार का सदस्य चुनें", "Pehle family member chunein")}
      />
      <Screen className="space-y-4 px-4 pb-5">
        <div className="rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-4">
          <MessageCircle className="mb-2 size-8" aria-hidden />
          <p className="text-lg font-bold">{t("Ask about your own medicines", "अपनी दवाइयों के बारे में पूछें", "Apni dawaiyon ke baare mein poochhein")}</p>
          <p className="mt-2 text-base">
            {t(
              "Type a medicine name, or photograph the strip. Parcha answers only from the Parchas on this phone, and says who wrote it and when.",
              "दवा का नाम लिखें, या पत्ते की फ़ोटो लें। पर्चा सिर्फ़ इस फ़ोन के पर्चों से जवाब देता है, और बताता है किसने कब लिखी।",
              "Dawa ka naam likhein, ya patte ki photo lein. Parcha sirf is phone ke Parchon se jawab deta hai, aur batata hai kisne kab likhi.",
            )}
          </p>
        </div>

        {/* A course about to end: read off the reminders, not a recommendation. */}
        {ending.length > 0 ? (
          <section className="space-y-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-3.5">
            <p className="text-lg font-bold">{t("About to finish", "ख़त्म होने वाली", "Khatam hone wali")}</p>
            <ul className="space-y-1.5">
              {ending.map((s) => (
                <li key={s.reminder.id} className="text-base">
                  <strong>{s.reminder.title}</strong>{" "}
                  {s.daysLeft === 1
                    ? t("— last day today", "— आज आख़िरी दिन", "— aaj aakhri din")
                    : t(`— ${s.daysLeft} days left`, `— ${s.daysLeft} दिन बचे`, `— ${s.daysLeft} din bache`)}
                  {s.dosesLeft ? t(` (${s.dosesLeft} doses)`, ` (${s.dosesLeft} खुराक)`, ` (${s.dosesLeft} doses)`) : ""}
                </li>
              ))}
            </ul>
            <p className="text-sm">
              {t(
                "This is the course as it was written. Whether to carry on is for your doctor to say.",
                "यह वही कोर्स है जो लिखा गया था। आगे जारी रखना है या नहीं, यह डॉक्टर बताएँगे।",
                "Yeh wahi course hai jo likha gaya tha. Aage jaari rakhna hai ya nahi, yeh doctor batayenge.",
              )}
            </p>
          </section>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            look(query);
          }}
          className="space-y-3"
        >
          <label className="block text-lg font-bold" htmlFor="ask-medicine">
            {t("Which medicine?", "कौन सी दवा?", "Kaun si dawa?")}
          </label>
          <input
            id="ask-medicine"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={120}
            placeholder={t("Paracetamol", "पैरासिटामोल", "Paracetamol")}
            className="w-full rounded-2xl border-[3px] border-[#232326] bg-card p-3 text-xl"
          />
          <div className="grid grid-cols-2 gap-3">
            <button
              type="submit"
              disabled={!query.trim() || !parchas.length}
              className="flex min-h-16 items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-lg font-bold disabled:opacity-40"
            >
              <Search className="size-6" aria-hidden />
              {t("Look it up", "ढूँढें", "Dhoondhein")}
            </button>
            <label
              className={`flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-card text-lg font-bold ${
                drugReadingAvailable && parchas.length ? "" : "pointer-events-none opacity-40"
              }`}
            >
              {reading ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <Camera className="size-6" aria-hidden />}
              {t("Photo of a strip", "पत्ते की फ़ोटो", "Patte ki photo")}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={reading || !drugReadingAvailable}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void fromPhoto(file);
                }}
              />
            </label>
          </div>
          {!drugReadingAvailable ? (
            <p className="text-sm">
              {t(
                "Reading a photograph needs the online reader, which is not set up yet. Typing the name works now.",
                "फ़ोटो पढ़ने के लिए ऑनलाइन रीडर चाहिए, जो अभी सेट नहीं है। नाम लिखकर अभी ढूँढ सकते हैं।",
                "Photo padhne ke liye online reader chahiye, jo abhi set nahi hai. Naam likhkar abhi dhoondh sakte hain.",
              )}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-base font-bold text-[#b3261e]">
              {error}
            </p>
          ) : null}
        </form>

        <div aria-live="polite" className="space-y-3">
          {asked && found ? <MemoryCard memory={found} t={t} lang={lang} /> : null}
          {asked && !found ? (
            <p className="rounded-2xl border-[3px] border-[#232326] bg-card p-3.5 text-lg">
              {t(
                `No Parcha on this phone mentions "${asked}". The record does not say anything about it.`,
                `इस फ़ोन के किसी पर्चे में "${asked}" नहीं है। रिकॉर्ड इसके बारे में कुछ नहीं कहता।`,
                `Is phone ke kisi Parche mein "${asked}" nahi hai. Record iske baare mein kuch nahi kehta.`,
              )}
            </p>
          ) : null}
        </div>

        {!parchas.length ? (
          <p className="text-lg">
            {t(
              "Add a Parcha for this person first, and then you can ask about anything on it.",
              "पहले इस व्यक्ति का पर्चा जोड़ें, फिर उसमें की हर चीज़ पूछ सकते हैं।",
              "Pehle is person ka Parcha jodein, phir usmein ki har cheez poochh sakte hain.",
            )}
          </p>
        ) : (
          <section className="space-y-2">
            <p className="text-lg font-bold">{t("Everything on your Parchas", "आपके पर्चों की सारी दवाइयाँ", "Aapke Parchon ki saari dawaiyan")}</p>
            <ul className="flex flex-wrap gap-2">
              {everything.map((m) => (
                <li key={m.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery(m.name);
                      look(m.name);
                    }}
                    className="min-h-11 rounded-full border-[3px] border-[#232326] bg-card px-3 py-1 text-base font-bold"
                  >
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Screen>
    </>
  );
}
