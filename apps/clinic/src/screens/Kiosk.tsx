import { errorMessage, kioskComplaint, useQueue } from "@parcha/client";
import {
  BODY_PARTS,
  HOW_BAD,
  HOW_LONG,
  complaintFrom,
  daysFor,
  type BodyPart,
  type HowBad,
  type HowLong,
} from "@parcha/core";
import { BodyMap, cn, type BodyView } from "@parcha/ui";
import { ArrowLeft, Check, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * The waiting-room kiosk.
 *
 * A screen the clinic stands in the waiting room, facing the patients. It asks
 * the one question a desk never has time for and a patient can always answer:
 * where does it hurt, how long, how bad. They point at a drawing of a body, so
 * it works for somebody who cannot read, cannot write, or has no word in
 * common with whoever is at the counter.
 *
 * What it writes is the complaint on their own visit, which the desk sees
 * already filled in when it takes their vitals and the doctor reads first. It
 * cannot do anything else: not register, not choose a doctor, not move the
 * visit on. The desk is still the desk.
 *
 * Everything on it is built for a stranger using it once, in a hurry, while
 * other people wait: three languages chosen by one tap, one question per
 * screen, buttons a thumb cannot miss, and no way to see anybody's name or
 * papers. It forgets the person as soon as they walk away — after a minute
 * with nothing touched, it clears itself and goes back to the start, so the
 * next patient never sees the last one's answers.
 */

type Lang = "en" | "hi" | "hinglish";
type Step = "who" | "where" | "howLong" | "howBad" | "done";

/** The kiosk's own words. The rest of the clinic app is English; this screen is not for staff. */
const say = (lang: Lang) => (en: string, hi: string, hinglish: string) =>
  lang === "hi" ? hi : lang === "hinglish" ? hinglish : en;

const nameOf = (lang: Lang, p: BodyPart) => (lang === "hi" ? p.hi : lang === "hinglish" ? p.hinglish : p.en);

/** Nothing touched for this long and the screen forgets everything. */
const IDLE_MS = 60_000;

export function Kiosk() {
  const [lang, setLang] = useState<Lang>("hi");
  const t = say(lang);

  const [step, setStep] = useState<Step>("who");
  const [typed, setTyped] = useState("");
  const [visitId, setVisitId] = useState<string | null>(null);
  const [view, setView] = useState<BodyView>("front");
  const [parts, setParts] = useState<string[]>([]);
  const [howLong, setHowLong] = useState<HowLong | null>(null);
  const [howBad, setHowBad] = useState<HowBad | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only people the desk has already registered and who are still waiting: the
  // kiosk never sees anybody else's visit, and never sees a name until a whole
  // phone number has been typed.
  const waiting = useQueue(["registered"]);
  const phone = typed.replace(/\D/g, "");
  const mine = phone.length === 10 ? waiting.data.filter((v) => v.patientPhone === phone) : [];
  const chosen = waiting.data.find((v) => v.id === visitId) ?? null;

  function reset() {
    setStep("who");
    setTyped("");
    setVisitId(null);
    setParts([]);
    setView("front");
    setHowLong(null);
    setHowBad(null);
    setError(null);
  }

  // A kiosk is used once and walked away from. Anything left on screen belongs
  // to somebody who has gone, so it is cleared rather than left for the next
  // person to read.
  const touched = useRef(Date.now());
  useEffect(() => {
    const mark = () => (touched.current = Date.now());
    for (const e of ["pointerdown", "keydown"] as const) window.addEventListener(e, mark);
    const timer = setInterval(() => {
      if (Date.now() - touched.current > IDLE_MS && (step !== "who" || typed !== "")) reset();
    }, 5_000);
    return () => {
      clearInterval(timer);
      for (const e of ["pointerdown", "keydown"] as const) window.removeEventListener(e, mark);
    };
  }, [step, typed]);

  // "Thank you" stays up long enough to read, then the screen is ready for the next person.
  useEffect(() => {
    if (step !== "done") return;
    const timer = setTimeout(reset, 12_000);
    return () => clearTimeout(timer);
  }, [step]);

  async function send() {
    if (!chosen || parts.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await kioskComplaint({
        visitId: chosen.id,
        complaint: complaintFrom({ parts, howLong, howBad }),
        durationDays: daysFor(howLong),
        severity: howBad === "very_bad" ? "severe" : howBad === "bad" ? "moderate" : howBad ? "mild" : null,
        language: lang === "en" ? "en" : "hi",
      });
      setStep("done");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const steps: Step[] = ["who", "where", "howLong", "howBad"];
  const at = Math.max(0, steps.indexOf(step));
  const back = () => setStep(steps[Math.max(0, at - 1)]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-background)]">
      <header className="flex items-center justify-between gap-3 border-b-[3px] border-[#232326] px-4 py-3">
        <p className="text-xl font-bold">
          {t("Tell us what is wrong", "बताइए क्या तकलीफ़ है", "Bataiye kya takleef hai")}
        </p>
        <div className="flex items-center gap-2">
          {(["hi", "hinglish", "en"] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={cn(
                "min-h-11 rounded-2xl border-[3px] border-[#232326] px-3 text-base font-bold",
                lang === l ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-white",
              )}
            >
              {l === "hi" ? "हिंदी" : l === "hinglish" ? "Hinglish" : "English"}
            </button>
          ))}
          {/* The way back out, for the person who runs the clinic, not the patient. */}
          <Link to="/desk" className="text-muted-foreground min-h-11 px-2 py-2 text-sm underline">
            {t("Desk", "काउंटर", "Counter")}
          </Link>
        </div>
      </header>

      {step !== "done" ? (
        <div className="flex gap-1.5 px-4 pt-3" aria-hidden>
          {steps.map((s, i) => (
            <span
              key={s}
              className={cn("h-2 flex-1 rounded-full border-2 border-[#232326]", i <= at ? "bg-[var(--brand)]" : "bg-white")}
            />
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {step === "who" ? (
          <section className="mx-auto max-w-xl space-y-4">
            <h2 className="text-2xl leading-tight font-bold">
              {t("Type your phone number", "अपना फ़ोन नंबर लिखिए", "Apna phone number likhiye")}
            </h2>
            <p className="text-lg leading-relaxed">
              {t(
                "The same number you gave at the counter.",
                "वही नंबर जो काउंटर पर दिया था।",
                "Wahi number jo counter par diya tha.",
              )}
            </p>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold">+91</span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                autoComplete="off"
                aria-label={t("Phone number", "फ़ोन नंबर", "Phone number")}
                className="h-16 w-full rounded-2xl border-[3px] border-[#232326] bg-white px-4 text-3xl tracking-[0.2em] tabular-nums outline-none"
              />
            </div>

            {phone.length === 10 ? (
              waiting.loading ? (
                <p className="text-lg">{t("Looking…", "देख रहे हैं…", "Dekh rahe hain…")}</p>
              ) : mine.length === 0 ? (
                <p className="rounded-2xl border-2 border-dashed border-[#232326] p-4 text-lg leading-relaxed">
                  {t(
                    "Nobody is waiting on this number. Please go to the counter first — they will write your name, and then you can use this screen.",
                    "इस नंबर पर कोई इंतज़ार में नहीं है। पहले काउंटर पर जाइए — वहाँ नाम लिखा जाएगा, फिर यह स्क्रीन काम करेगी।",
                    "Is number par koi intezaar mein nahi hai. Pehle counter par jaiye — wahan naam likha jayega, phir yeh screen kaam karegi.",
                  )}
                </p>
              ) : (
                <div className="space-y-2.5" role="radiogroup">
                  <p className="text-lg font-bold">{t("Who is it for?", "किसके लिए?", "Kiske liye?")}</p>
                  {mine.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={visitId === v.id}
                      onClick={() => {
                        setVisitId(v.id);
                        setStep("where");
                      }}
                      className={cn(
                        "flex min-h-16 w-full items-center gap-3 rounded-2xl border-[3px] border-[#232326] px-4 text-left text-xl font-bold",
                        visitId === v.id ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-white",
                      )}
                    >
                      {v.patientName}
                      {v.patientAgeYears != null ? (
                        <span className="text-muted-foreground text-lg font-normal">· {v.patientAgeYears}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )
            ) : null}
          </section>
        ) : step === "where" ? (
          <section className="mx-auto max-w-xl space-y-4">
            <h2 className="text-2xl leading-tight font-bold">
              {t("Where does it hurt?", "कहाँ तकलीफ़ है?", "Kahan takleef hai?")}
            </h2>
            <p className="text-lg leading-relaxed">
              {t(
                "Touch the picture. You can touch more than one place.",
                "तस्वीर पर छूइए। एक से ज़्यादा जगह भी छू सकते हैं।",
                "Tasveer par chhuiye. Ek se zyada jagah bhi chhu sakte hain.",
              )}
            </p>
            <div className="flex justify-center gap-2">
              {(["front", "back"] as BodyView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "min-h-12 rounded-2xl border-[3px] border-[#232326] px-5 text-lg font-bold",
                    view === v ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-white",
                  )}
                >
                  {v === "front"
                    ? t("Front", "सामने", "Saamne")
                    : t("Back", "पीठ की तरफ़", "Peeth ki taraf")}
                </button>
              ))}
            </div>
            <BodyMap
              view={view}
              chosen={parts}
              onToggle={(id) => setParts((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
              label={(p) => nameOf(lang, p)}
            />
            {parts.length ? (
              <p className="text-center text-lg font-bold">
                {parts
                  .map((id) => BODY_PARTS.find((p) => p.id === id))
                  .filter(Boolean)
                  .map((p) => nameOf(lang, p as BodyPart))
                  .join(", ")}
              </p>
            ) : null}
          </section>
        ) : step === "howLong" ? (
          <Choices
            title={t("How long has it been?", "कब से है?", "Kab se hai?")}
            options={HOW_LONG.map((h) => ({ id: h.id, label: nameIn(lang, h) }))}
            value={howLong}
            onPick={(id) => {
              setHowLong(id as HowLong);
              setStep("howBad");
            }}
          />
        ) : step === "howBad" ? (
          <Choices
            title={t("How bad is it?", "कितनी तकलीफ़ है?", "Kitni takleef hai?")}
            options={HOW_BAD.map((h) => ({ id: h.id, label: nameIn(lang, h) }))}
            value={howBad}
            onPick={(id) => setHowBad(id as HowBad)}
          />
        ) : (
          <section className="mx-auto max-w-xl space-y-4 pt-10 text-center">
            <Check className="mx-auto size-20" strokeWidth={3} aria-hidden />
            <h2 className="text-3xl leading-tight font-bold">
              {t("Thank you. Please wait.", "धन्यवाद। बैठिए, नाम पुकारा जाएगा।", "Dhanyavaad. Baithiye, naam pukara jayega.")}
            </h2>
            <p className="text-xl leading-relaxed">
              {t(
                "The counter has it. They will call your name.",
                "काउंटर तक पहुँच गया है। वहाँ से नाम पुकारा जाएगा।",
                "Counter tak pahunch gaya hai. Wahan se naam pukara jayega.",
              )}
            </p>
            <button
              type="button"
              onClick={reset}
              className="mx-auto flex min-h-14 items-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-white px-6 text-lg font-bold"
            >
              <RotateCcw className="size-5" aria-hidden />
              {t("Next person", "अगला व्यक्ति", "Agla vyakti")}
            </button>
          </section>
        )}
      </div>

      {step !== "who" && step !== "done" ? (
        <div className="space-y-2 border-t-[3px] border-[#232326] p-4">
          {error ? (
            <p role="alert" className="text-destructive text-lg font-bold">
              {error}
            </p>
          ) : null}
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <button
              type="button"
              onClick={back}
              className="flex min-h-16 items-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-white px-5 text-lg font-bold"
            >
              <ArrowLeft className="size-5" aria-hidden />
              {t("Back", "वापस", "Wapas")}
            </button>
            <button
              type="button"
              disabled={busy || (step === "where" && parts.length === 0) || (step === "howBad" && howBad === null)}
              onClick={() =>
                step === "where" ? setStep("howLong") : step === "howLong" ? setStep("howBad") : void send()
              }
              className="flex min-h-16 flex-1 items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-2xl font-bold shadow-[0_4px_0_#232326] disabled:opacity-50 disabled:shadow-none"
            >
              {busy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : null}
              {step === "howBad" ? t("Send", "भेजिए", "Bhejiye") : t("Next", "आगे", "Aage")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const nameIn = (lang: Lang, h: { en: string; hi: string; hinglish: string }) =>
  lang === "hi" ? h.hi : lang === "hinglish" ? h.hinglish : h.en;

/** One question, answered by tapping one big card. */
function Choices({
  title,
  options,
  value,
  onPick,
}: {
  title: string;
  options: { id: string; label: string }[];
  value: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h2 className="text-2xl leading-tight font-bold">{title}</h2>
      <div className="space-y-3" role="radiogroup">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onPick(o.id)}
            className={cn(
              "min-h-20 w-full rounded-2xl border-[3px] border-[#232326] px-5 text-left text-2xl font-bold",
              value === o.id ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-white",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
