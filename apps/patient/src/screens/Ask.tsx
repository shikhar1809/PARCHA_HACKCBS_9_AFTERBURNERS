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
import { call, errorMessage, useReminders } from "@parcha/client";
import { addCalendarDays, dosesOn, recallAll, recallMedicine, rxName, sameMedicine, toDateString, type MedicineMemory } from "@parcha/core";
import { Screen, cn } from "@parcha/ui";
import { AlertTriangle, BadgeCheck, Camera, Loader2, Send, Stethoscope } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useHandset } from "../auth";
import { useMemoryParchas } from "../components/memory";
import { useActivePerson } from "../components/people";
import { checkPhoto } from "../components/photoCheck";
import { ListenButton } from "../components/speak";
import { shrinkPhoto } from "../components/strips";
import { clockIn, dateIn, useLang, useT, type T, type Lang } from "../i18n";
import { DoseTiles, Header, TimingRow } from "../kit";

/** What the record says about one medicine, said plainly and with its source. */
export function MemoryCard({ memory, t, lang }: { memory: MedicineMemory; t: T; lang: Lang }) {
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

/** The facts the server checked about one photographed medicine. */
type Fact = {
  printedName: string;
  strength: string | null;
  onRecord: { name: string; strength: string | null; when: string | null; food: string | null; until: string | null; doctor: string | null; signed: boolean } | null;
  expiry: { printed: string | null; lastDay?: string; status: "expired" | "soon" | "ok" | "unreadable"; daysLeft?: number };
  readConfidence: string;
};
type Turn = { who: "me" | "parcha"; text: string; image?: string; facts?: Fact[]; chips?: string[]; refused?: boolean; memory?: number };
type AskReply = { kind: "answer" | "refused"; reply: string; chips: string[]; read: Fact[]; problem?: string; memoryUsed?: number };

/**
 * Ask, as a conversation: "what is this one?", "has it expired?", "when was I
 * to take it?" — answered from this person's own Parchas.
 *
 * A photo is checked on the phone first and refused if it is not clear
 * (photoQuality). A clear one goes to the server, where Gemini reads what is
 * printed, plain code decides whether it is on the Parcha and whether it has
 * expired, Meko brings back what this person asked before, and the reply is
 * written from those facts only (firebase/functions/src/assistant.ts). With no
 * connection, the old answers still work: a medicine name typed in is looked up
 * in the Parchas on the phone.
 */
export function Ask() {
  const t = useT();
  const lang = useLang();
  const person = useActivePerson();
  const { handset } = useHandset();
  const parchas = useMemoryParchas(person?.name ?? null);
  const reminders = useReminders(handset?.phone ?? null);
  const today = toDateString(new Date());
  const mine = useMemo(() => (person ? reminders.data.filter((r) => r.personName === person.name && r.kind === "medicine") : []), [reminders.data, person]);
  const everything = useMemo(() => recallAll(parchas), [parchas]);
  const first = person?.shown.split(" ")[0] ?? "";

  const CHIPS = {
    identify: t("📷 What is this medicine?", "📷 यह कौन सी दवा है?", "📷 Yeh kaun si dawai hai?"),
    expiry: t("📅 Has it expired?", "📅 एक्सपायर तो नहीं हुई?", "📅 Expire to nahi hui?"),
    today: t("⏰ What is due today?", "⏰ आज कौन सी दवा है?", "⏰ Aaj kaun si dawai hai?"),
    all: t("💊 My medicines", "💊 मेरी दवाइयाँ", "💊 Meri dawaiyan"),
  };
  const [turns, setTurns] = useState<Turn[]>(() => [
    {
      who: "parcha",
      text: t(
        `Namaste${first ? ` ${first}` : ""}. Show me a medicine, or ask about your medicines. I answer only from your Parchas.`,
        `नमस्ते${first ? ` ${first} जी` : ""}। कोई दवा दिखाइए, या अपनी दवाइयों के बारे में पूछिए। मैं सिर्फ़ आपके पर्चों से जवाब देता हूँ।`,
        `Namaste${first ? ` ${first} ji` : ""}. Koi dawai dikhaiye, ya apni dawaiyon ke baare mein poochhiye. Main sirf aapke Parchon se jawab deta hoon.`,
      ),
      chips: [CHIPS.identify, CHIPS.expiry, CHIPS.today, CHIPS.all],
    },
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const pendingQuestion = useRef<string>("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  /** What this one question needs from the records on the phone, and nothing more. */
  const records = useMemo(() => {
    const out = everything.map((m) => {
      const { parcha, medicine } = m.latest;
      const r = mine.find((x) => sameMedicine(x.title, medicine.name));
      return {
        name: medicine.name,
        strength: medicine.strength ?? null,
        when: r ? r.times.map((x) => clockIn("en", x)).join(", ") : (medicine.frequency ?? null),
        food: medicine.timing ?? (r?.detail ?? null),
        // The reminder's last day, or the course length written on the Parcha.
        until: r?.endDate ?? (medicine.durationDays ? addCalendarDays(parcha.date, medicine.durationDays - 1) : null),
        doctor: parcha.doctor ?? null,
        signed: parcha.certain,
      };
    });
    for (const r of mine) {
      if (!out.some((o) => sameMedicine(o.name, r.title))) {
        out.push({ name: r.title, strength: null, when: r.times.map((x) => clockIn("en", x)).join(", "), food: r.detail, until: r.endDate, doctor: null, signed: false });
      }
    }
    return out;
  }, [everything, mine]);

  const say = (turn: Turn) => setTurns((all) => [...all, turn]);

  /** Answers that need nothing but the phone. */
  function localAnswer(kind: "today" | "all") {
    if (kind === "today") {
      const doses = dosesOn(mine, today);
      say({
        who: "parcha",
        text: doses.length
          ? t(
              `Today: ${doses.map((d) => `${d.reminder.title} at ${clockIn(lang, d.time)}`).join("; ")}.`,
              `आज: ${doses.map((d) => `${d.reminder.title} ${clockIn(lang, d.time)}`).join("; ")}।`,
              `Aaj: ${doses.map((d) => `${d.reminder.title} ${clockIn(lang, d.time)}`).join("; ")}.`,
            )
          : t("No medicines are set for today.", "आज कोई दवा तय नहीं है।", "Aaj koi dawai tay nahi hai."),
        chips: [CHIPS.identify, CHIPS.all],
      });
    } else {
      say({
        who: "parcha",
        text: everything.length
          ? t(`Your Parchas have: ${everything.map((m) => m.name).join(", ")}.`, `आपके पर्चों में: ${everything.map((m) => m.name).join(", ")}।`, `Aapke Parchon mein: ${everything.map((m) => m.name).join(", ")}.`)
          : t("There are no Parchas on this phone yet.", "इस फ़ोन में अभी कोई पर्चा नहीं है।", "Is phone mein abhi koi Parcha nahi hai."),
        chips: [CHIPS.identify, CHIPS.today],
      });
    }
  }

  async function ask(question: string, image?: string) {
    setBusy(image ? t("Reading the photo…", "फ़ोटो पढ़ रहे हैं…", "Photo padh rahe hain…") : t("Thinking…", "सोच रहे हैं…", "Soch rahe hain…"));
    try {
      const history = turns.slice(-6).map((x) => ({ who: x.who, text: x.text }));
      const r = await call<Record<string, unknown>, AskReply>("askParcha", { person: person?.name ?? "", lang, question, image, records, history });
      say({ who: "parcha", text: r.reply, facts: r.read, refused: r.kind === "refused", memory: r.memoryUsed, chips: r.kind === "refused" ? [CHIPS.identify] : r.chips?.length ? r.chips : [CHIPS.expiry, CHIPS.today] });
    } catch (e) {
      // No connection, or the reader is busy: the Parchas on the phone still answer a name.
      const found = !image && question ? recallMedicine(parchas, question) : null;
      say({
        who: "parcha",
        text: found
          ? t(`${found.name} is on your Parcha from ${found.latest.parcha.doctor ?? "your doctor"}.`, `${found.name} आपके पर्चे पर है (${found.latest.parcha.doctor ?? "डॉक्टर"})।`, `${found.name} aapke Parche par hai (${found.latest.parcha.doctor ?? "doctor"}).`)
          : `${t("I could not get an answer just now.", "अभी जवाब नहीं मिल पाया।", "Abhi jawab nahi mil paaya.")} ${errorMessage(e)}`,
        chips: [CHIPS.today, CHIPS.all],
      });
    } finally {
      setBusy(null);
    }
  }

  function chip(c: string) {
    if (c === CHIPS.today) return void (say({ who: "me", text: c }), localAnswer("today"));
    if (c === CHIPS.all) return void (say({ who: "me", text: c }), localAnswer("all"));
    if (c === CHIPS.identify || c === CHIPS.expiry || /photo|फ़ोटो|📷/i.test(c)) {
      pendingQuestion.current = c === CHIPS.expiry ? t("Has this expired? When is it good until?", "क्या यह एक्सपायर हो गई है? कब तक ठीक है?", "Kya yeh expire ho gayi hai? Kab tak theek hai?") : t("What is this medicine and when do I take it?", "यह कौन सी दवा है और कब लेनी है?", "Yeh kaun si dawai hai aur kab leni hai?");
      return camera.current?.click();
    }
    say({ who: "me", text: c });
    void ask(c);
  }

  async function photo(file: File | undefined) {
    if (!file) return;
    const verdict = await checkPhoto(file);
    const small = await shrinkPhoto(file, 1280);
    say({ who: "me", text: pendingQuestion.current || t("What is this?", "यह क्या है?", "Yeh kya hai?"), image: small });
    if (!verdict.ok) {
      // Refused here, before anything is sent: an unclear photo is never read hopefully.
      say({ who: "parcha", refused: true, text: t("This photo is not clear enough, so I have not assumed anything. Take it again close up, in good light, with the name showing.", "यह फ़ोटो साफ़ नहीं है, इसलिए मैंने कुछ नहीं माना। नाम दिखाते हुए, रोशनी में, पास से फिर फ़ोटो लें।", "Yeh photo saaf nahi hai, isliye maine kuch nahi maana. Naam dikhate hue, roshni mein, paas se phir photo lein."), chips: [CHIPS.identify] });
      return;
    }
    await ask(pendingQuestion.current, small);
    pendingQuestion.current = "";
  }

  function send() {
    const q = text.trim();
    if (!q || busy) return;
    setText("");
    say({ who: "me", text: q });
    void ask(q);
  }

  return (
    <>
      <Header title={t("Ask Parcha", "पर्चा से पूछें", "Parcha se poochhein")} subtitle={person?.shown ?? t("Choose a family member first", "पहले परिवार का सदस्य चुनें", "Pehle family member chunein")} />
      <Screen className="flex min-h-0 flex-1 flex-col px-4 pb-2">
        <p className="mb-3 rounded-xl border-2 border-[#232326] bg-[var(--morning-soft)] px-3 py-2 text-sm leading-snug">
          {t(
            "Photos and questions are read by Google's Gemini. A short note without your name is kept so I remember. I never say what a medicine is for or whether to take it — that is your doctor's.",
            "फ़ोटो और सवाल Google का Gemini पढ़ता है। याद रखने के लिए आपके नाम के बिना एक छोटा नोट रखा जाता है। दवा किस लिए है या लेनी है या नहीं, यह मैं नहीं बताता — वह डॉक्टर बताएँगे।",
            "Photo aur sawaal Google ka Gemini padhta hai. Yaad rakhne ke liye aapke naam ke bina ek chhota note rakha jaata hai. Dawai kis liye hai ya leni hai ya nahi, yeh main nahi batata — woh doctor batayenge.",
          )}
        </p>
        <ol className="flex-1 space-y-3" aria-live="polite">
          {turns.map((turn, i) => (
            <li key={i} className={cn("flex", turn.who === "me" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[88%] space-y-2 rounded-3xl border-[3px] border-[#232326] p-3 shadow-[0_3px_0_#232326]", turn.who === "me" ? "rounded-br-md bg-[var(--brand)]" : turn.refused ? "rounded-bl-md bg-[oklch(0.94_0.05_25)]" : "rounded-bl-md bg-card")}>
                {turn.image ? <img src={turn.image} alt="" className="max-h-48 w-full rounded-2xl border-2 border-[#232326] object-cover" /> : null}
                <p className="text-lg leading-snug">{turn.text}</p>
                {turn.facts?.map((f, j) => <FactCard key={j} fact={f} />)}
                {turn.who === "parcha" && i > 0 ? (
                  <div className="flex items-center gap-2">
                    <ListenButton text={turn.text} label={t("Listen", "सुनें", "Sunein")} lang={lang === "en" ? "en" : "hi"} />
                    {turn.memory ? <span className="text-xs font-bold">{t(`Remembered ${turn.memory} earlier question${turn.memory === 1 ? "" : "s"}`, `${turn.memory} पुरानी बातें याद रखीं`, `${turn.memory} purani baatein yaad rakhi`)}</span> : null}
                  </div>
                ) : null}
                {turn.chips?.length && i === turns.length - 1 && !busy ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {turn.chips.map((c) => (
                      <button key={c} type="button" onClick={() => chip(c)} className="min-h-11 rounded-full border-[3px] border-[#232326] bg-white px-3 text-base font-bold">
                        {c}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
          {busy ? (
            <li className="flex justify-start">
              <p role="status" className="flex items-center gap-2 rounded-3xl rounded-bl-md border-[3px] border-[#232326] bg-card p-3 text-lg font-bold">
                <Loader2 className="size-5 animate-spin" aria-hidden /> {busy}
              </p>
            </li>
          ) : null}
          {/* Room under the last answer, so the message bar never covers it. */}
          <div ref={end} className="h-24" />
        </ol>
        <div className="sticky bottom-0 mt-3 flex items-center gap-2 bg-[var(--background)] py-2">
          <button type="button" aria-label={t("Photograph a medicine", "दवा की फ़ोटो लें", "Dawai ki photo lein")} onClick={() => chip(CHIPS.identify)} className="flex size-14 shrink-0 items-center justify-center rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)]">
            <Camera className="size-7" aria-hidden />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={t("Ask: ye dawai kab leni thi?", "पूछें: यह दवा कब लेनी थी?", "Poochhein: ye dawai kab leni thi?")}
            className="h-14 min-w-0 flex-1 rounded-2xl border-[3px] border-[#232326] bg-card px-3 text-lg outline-none"
          />
          <button type="button" aria-label={t("Send", "भेजें", "Bhejein")} disabled={!text.trim() || !!busy} onClick={send} className="flex size-14 shrink-0 items-center justify-center rounded-2xl border-[3px] border-[#232326] bg-[#2e9e5b] text-white disabled:opacity-50">
            <Send className="size-6" aria-hidden />
          </button>
          <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void photo(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </Screen>
    </>
  );
}

/** What was checked about one photographed medicine: on the Parcha or not, when, and its expiry. */
function FactCard({ fact }: { fact: Fact }) {
  const t = useT();
  const lang = useLang();
  const r = fact.onRecord;
  const EXP = {
    expired: { bg: "bg-[#f08a7e]", word: t("Expired — do not take", "एक्सपायर — न लें", "Expire — na lein") },
    soon: { bg: "bg-[#f5b942]", word: t("Expires soon", "जल्द एक्सपायर", "Jaldi expire") },
    ok: { bg: "bg-[#c9f2d8]", word: t("Not expired", "एक्सपायर नहीं", "Expire nahi") },
    unreadable: { bg: "bg-white", word: t("Expiry not readable", "एक्सपायरी पढ़ी नहीं गई", "Expiry padhi nahi gayi") },
  }[fact.expiry.status];
  return (
    <div className="space-y-2 rounded-2xl border-2 border-[#232326] bg-white p-2.5">
      <p className="text-base">
        {t("Printed on it", "इस पर छपा", "Is par chhapa")}: <b>{fact.printedName}{fact.strength ? ` ${fact.strength}` : ""}</b>
      </p>
      <p className={cn("rounded-xl border-2 border-[#232326] px-2.5 py-1.5 text-base font-bold", r ? "bg-[#c9f2d8]" : "bg-[#f08a7e]")}>
        {r
          ? t(`On your Parcha${r.doctor ? ` (${r.doctor})` : ""}${r.when ? ` · ${r.when}` : ""}${r.food ? ` · ${r.food.replace(/_/g, " ")}` : ""}`, `आपके पर्चे पर${r.doctor ? ` (${r.doctor})` : ""}${r.when ? ` · ${r.when}` : ""}`, `Aapke Parche par${r.doctor ? ` (${r.doctor})` : ""}${r.when ? ` · ${r.when}` : ""}`)
          : t("Not on your Parcha — ask the doctor before taking it", "आपके पर्चे पर नहीं — लेने से पहले डॉक्टर से पूछें", "Aapke Parche par nahi — lene se pehle doctor se poochhein")}
      </p>
      <p className={cn("rounded-xl border-2 border-[#232326] px-2.5 py-1.5 text-base font-bold", EXP.bg)}>
        {EXP.word}
        {fact.expiry.lastDay ? ` · ${t("good until", "तक ठीक", "tak theek")} ${dateIn(lang, fact.expiry.lastDay)}` : fact.expiry.printed ? ` · ${fact.expiry.printed}` : ""}
      </p>
    </div>
  );
}
