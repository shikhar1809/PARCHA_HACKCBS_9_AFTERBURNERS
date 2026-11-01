/**
 * The Parcha, made simple: the version for Dadi to keep.
 *
 * A prescription is written for a chemist. This is the same prescription
 * written for the person who has to take it: one big card per medicine, the
 * photo of the strip at the top (it is how she knows it), the name large, the
 * three times of day drawn as pictures rather than "1-0-1", food as a word she
 * uses, and the last day as a date instead of a count. It can be read aloud.
 *
 * It is drawn from what is already kept on this phone (a scanned slip, or the
 * medicines checked from a bill), so it is never a second copy that could
 * drift from the first. And it says where it came from, plainly: signed by the
 * doctor, or checked by the family against the bill. That difference matters
 * and is not smoothed over.
 */
import { vaultGet } from "@parcha/client";
import { addCalendarDays, normaliseFrequency, toDateString, type RxPayload } from "@parcha/core";
import { Screen } from "@parcha/ui";
import { BadgeCheck, CalendarDays, FlaskConical, ReceiptText, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { usePeople } from "../components/people";
import { speak } from "../components/speak";
import { StripPictures } from "../components/strips";
import { dateIn, tr, useLang, useT } from "../i18n";
import { DoseTiles, Header, TimingRow, timingWords } from "../kit";

type Med = { name: string; strength?: string; form?: string; frequency: string; timing: string; days: number; note?: string };
type Simple = {
  person: string;
  from: "signed" | "checked" | "read";
  when: string;
  doctor?: string;
  hospital?: string;
  why?: string;
  meds: Med[];
  tests: string[];
  advice?: string;
  followUpDays?: number;
};

type ScannedDoc = { payload: RxPayload; person: string; savedAt: string; token?: string | null };
type CheckedDoc = { person: string; from?: "printed" | "bill"; savedAt: string; medicines: { name: string; frequency: string; timing?: string; days?: number }[] };

/** Either kind of kept Parcha, in the one shape this screen draws. */
function simplify(key: string, doc: ScannedDoc | CheckedDoc): Simple {
  if (key.startsWith("parcha:")) {
    const s = doc as ScannedDoc;
    const p = s.payload;
    return {
      person: s.person,
      // A demo slip has no token: it says so rather than claiming a signature.
      from: s.token ? "signed" : "read",
      when: p.t,
      doctor: p.d[0],
      hospital: p.h,
      why: p.x ?? undefined,
      meds: p.m.map(([name, strength, form, frequency, days, timing, , note]) => ({ name, strength, form, frequency: normaliseFrequency(frequency), timing, days, note: note ?? undefined })),
      tests: p.k,
      advice: p.a ?? undefined,
      followUpDays: p.f ?? undefined,
    };
  }
  const c = doc as CheckedDoc;
  return {
    person: c.person,
    from: c.from === "printed" ? "read" : "checked",
    when: c.savedAt,
    meds: c.medicines.map((m) => ({ name: m.name, frequency: m.frequency, timing: m.timing ?? "", days: m.days ?? 0 })),
    tests: [],
  };
}

export function SimpleParcha() {
  const t = useT();
  const lang = useLang();
  const { key = "" } = useParams();
  const { people } = usePeople();
  const [doc, setDoc] = useState<Simple | null | "missing">(null);

  useEffect(() => {
    let live = true;
    const k = decodeURIComponent(key);
    void vaultGet<ScannedDoc | CheckedDoc>(k).then((d) => live && setDoc(d ? simplify(k, d) : "missing"));
    return () => {
      live = false;
    };
  }, [key]);

  if (doc === null) return <Screen className="p-4"><div className="skeleton h-80 rounded-3xl border-[3px] border-[#232326]" /></Screen>;
  if (doc === "missing") {
    return (
      <>
        <Header back="/records" title={t("Simple Parcha", "आसान पर्चा", "Aasaan Parcha")} />
        <Screen className="p-5 text-lg">{t("This Parcha is not on this phone.", "यह पर्चा इस फ़ोन में नहीं है।", "Yeh Parcha is phone mein nahi hai.")}</Screen>
      </>
    );
  }

  const shown = people.find((p) => p.name === doc.person)?.shown ?? doc.person;
  const start = toDateString(new Date(doc.when));
  const lastDay = (days: number) => (days > 0 ? addCalendarDays(start, days - 1) : null);
  const SLOT_WORDS: [string, string, string][] = [["morning", "सुबह", "subah"], ["afternoon", "दोपहर", "dopahar"], ["night", "रात", "raat"]];
  const sayMed = (m: Med) => {
    const slots = m.frequency.split("-").map(Number);
    const when =
      m.frequency === "SOS"
        ? tr(lang, "only when needed", "सिर्फ़ ज़रूरत पर", "sirf zaroorat par")
        : SLOT_WORDS.filter((_, i) => slots[i] > 0).map((w) => tr(lang, ...w)).join(tr(lang, " and ", " और ", " aur "));
    const end = lastDay(m.days);
    return `${m.name}: ${when}, ${timingWords(lang, m.timing)}${end ? tr(lang, `, until ${dateIn(lang, end, false)}`, `, ${dateIn(lang, end, false)} तक`, `, ${dateIn(lang, end, false)} tak`) : ""}.`;
  };
  const sayAll = [tr(lang, `${shown}'s medicines.`, `${shown} की दवाइयाँ।`, `${shown} ki dawaiyan.`), ...doc.meds.map(sayMed), doc.advice ?? ""].join(" ");

  const BADGE = {
    signed: { icon: BadgeCheck, words: t("Signed by the doctor. Read from the code on the slip.", "डॉक्टर के हस्ताक्षर वाला। पर्चे के कोड से पढ़ा गया।", "Doctor ke signature wala. Parche ke code se padha gaya."), bg: "bg-[var(--brand-soft)]" },
    checked: { icon: ReceiptText, words: t("Checked by the family against the bill. No doctor signed this copy.", "परिवार ने बिल से मिलाया। इस कॉपी पर डॉक्टर के हस्ताक्षर नहीं हैं।", "Parivaar ne bill se milaya. Is copy par doctor ke signature nahi hain."), bg: "bg-[var(--morning-soft)]" },
    read: { icon: ReceiptText, words: t("Read from a photo and confirmed by the family. Not signed.", "फ़ोटो से पढ़ा और परिवार ने पक्का किया। हस्ताक्षर नहीं।", "Photo se padha aur parivaar ne pakka kiya. Signature nahi."), bg: "bg-[var(--morning-soft)]" },
  }[doc.from];
  const Badge = BADGE.icon;

  return (
    <>
      <Header back="/records" title={t(`${shown}'s simple Parcha`, `${shown} का आसान पर्चा`, `${shown} ka aasaan Parcha`)} subtitle={dateIn(lang, doc.when)} />
      <Screen className="space-y-4 px-4 pb-10">
        <p className={`flex items-start gap-2 rounded-2xl border-[3px] border-[#232326] p-3 text-base leading-snug font-bold ${BADGE.bg}`}>
          <Badge className="mt-0.5 size-6 shrink-0" aria-hidden />
          <span>
            {BADGE.words}
            {doc.doctor ? <span className="block font-normal">{doc.doctor}{doc.hospital ? ` · ${doc.hospital}` : ""}</span> : null}
            {doc.why ? <span className="block font-normal">{doc.why}</span> : null}
          </span>
        </p>

        <button
          type="button"
          onClick={() => void speak(sayAll, lang === "hi" ? "hi" : "en")}
          className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-white text-xl font-bold shadow-[0_4px_0_#232326]"
        >
          <Volume2 className="size-7" aria-hidden /> {t("Read it out to me", "मुझे पढ़कर सुनाएँ", "Mujhe padhkar sunaayein")}
        </button>

        <ol className="space-y-4">
          {doc.meds.map((m, i) => {
            const end = lastDay(m.days);
            return (
              <li key={i} className="space-y-3 rounded-3xl border-[3px] border-[#232326] bg-card p-4 shadow-[0_4px_0_#232326]">
                <div className="flex items-baseline gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full border-[3px] border-[#232326] bg-[var(--brand)] text-xl font-bold">{i + 1}</span>
                  <p className="min-w-0 text-3xl leading-tight font-bold break-words">
                    {m.name}
                    {m.strength ? <span className="text-xl font-normal"> {m.strength}</span> : null}
                  </p>
                </div>
                <StripPictures medicine={m.name} />
                <DoseTiles frequency={m.frequency} form={m.form} />
                {m.timing ? <TimingRow timing={m.timing} form={m.form} /> : null}
                <p className="flex items-center gap-2 text-xl font-bold">
                  <CalendarDays className="size-6 shrink-0" aria-hidden />
                  {end
                    ? t(`Until ${dateIn(lang, end, false)} (${m.days} days)`, `${dateIn(lang, end, false)} तक (${m.days} दिन)`, `${dateIn(lang, end, false)} tak (${m.days} din)`)
                    : t("Keep taking until the doctor says stop", "जब तक डॉक्टर बंद न करें", "Jab tak doctor band na karein")}
                </p>
                {m.note ? <p className="rounded-xl border-2 border-[#232326] bg-white p-2.5 text-lg leading-snug">{m.note}</p> : null}
              </li>
            );
          })}
        </ol>

        {doc.tests.length ? (
          <p className="flex items-start gap-2 rounded-2xl border-[3px] border-[#232326] bg-white p-3 text-lg">
            <FlaskConical className="mt-1 size-6 shrink-0" aria-hidden />
            <span>
              <b>{t("Tests to get done", "ये जाँचें करानी हैं", "Yeh jaanch karaani hain")}:</b> {doc.tests.join(", ")}
            </span>
          </p>
        ) : null}
        {doc.advice ? <p className="rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-3 text-lg leading-snug">{doc.advice}</p> : null}
        {doc.followUpDays ? (
          <p className="rounded-2xl border-[3px] border-[#232326] bg-white p-3 text-xl font-bold">
            {t(`See the doctor again on ${dateIn(lang, addCalendarDays(start, doc.followUpDays), false)}`, `${dateIn(lang, addCalendarDays(start, doc.followUpDays), false)} को डॉक्टर को फिर दिखाएँ`, `${dateIn(lang, addCalendarDays(start, doc.followUpDays), false)} ko doctor ko phir dikhayein`)}
          </p>
        ) : null}
        <p className="text-muted-foreground text-center text-base">
          {t("Any doubt about a medicine: ask the doctor or chemist, not this app.", "दवा पर कोई शक हो तो डॉक्टर या केमिस्ट से पूछें, इस ऐप से नहीं।", "Dawai par koi shak ho to doctor ya chemist se poochhein, is app se nahi.")}
        </p>
      </Screen>
    </>
  );
}
