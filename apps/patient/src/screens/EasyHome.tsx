import { spokenReminder } from "@parcha/core";
import { isMuted, ListenButton, setMuted, speak } from "../components/speak";
import { buzz } from "../components/alerts";
import { errorMessage, markDose, useDoseLog, useReminders } from "@parcha/client";
import { dosesOn, minutesSince, spokenTimeHindi, toDateString, type Dose } from "@parcha/core";
import { Check, HeartHandshake, LayoutGrid, Loader2, Phone, PhoneCall, PhoneOff, Pill, Settings2, Undo2, Volume2, VolumeX, Mic } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useHandset } from "../auth";
import { Avatar } from "../components/art";
import { StripPictures } from "../components/strips";
import { RecordMessage } from "../components/VoiceMessage";
import { useNow } from "../components/alerts";
import { checkPin, hasPin, PinPad } from "../components/pin";
import { usePeople, type Person } from "../components/people";
import { Sheet } from "../components/records";
import { setFullAppFor } from "../components/full-app";
import { clockIn, speechLang, tr, useLang, useT, type Lang } from "../i18n";

const hour = (d: Date) => d.getHours();
const hello = (lang: Lang, d: Date) =>
  hour(d) < 12 ? tr(lang, "Good morning", "नमस्ते, सुप्रभात", "Good morning") : hour(d) < 17 ? tr(lang, "Hello", "नमस्ते", "Namaste") : tr(lang, "Good evening", "शुभ संध्या", "Good evening");

/** A dose is "due" from ten minutes before its time until it is ticked, so the big button is there when it is wanted. */
const DUE_LEAD_MINUTES = 10;

/**
 * The simple screen, for a person who cannot manage the phone themselves.
 *
 * One thing at a time. Big type, a big face, and when it is time for medicine, a
 * single enormous button that says "I took it". Everything else (settings, other
 * people, the rest of the app) is behind a helper's PIN. There is nothing here
 * to get lost in and nothing that can be undone by accident: a tick can be taken
 * back with one tap.
 */
export function EasyHome({ person }: { person: Person }) {
  const t = useT();
  const lang = useLang();
  const voice = speechLang(lang);
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const { setActive } = usePeople();
  const now = useNow(15_000);
  const today = toDateString(now);
  const reminders = useReminders(phone);
  const log = useDoseLog(phone, today);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justTook, setJustTook] = useState<Dose[] | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [laterUntil, setLaterUntil] = useState(0);
  const [ringing, setRinging] = useState(false);

  const mine = useMemo(() => reminders.data.filter((r) => r.personName === person.name && r.kind === "medicine"), [reminders.data, person.name]);
  const doses = dosesOn(mine, today);
  const taken = log.data?.taken ?? {};
  const pending = doses.filter((d) => !(d.key in taken));
  const due = pending.filter((d) => minutesSince(d.time, now) >= -DUE_LEAD_MINUTES);

  // What is said aloud: only when, never the medicine's name. A long drug name
  // read by a phone is noise to her; the time is what she needs, and the strip
  // on screen says which one.
  const timeLine = tr(lang, "It's time for your medicine.", "आपकी दवा का समय हो गया है।", "Aapki dawai ka samay ho gaya hai.");

  // When it is time: said aloud ("dawai lene ka time ho gaya"), and flashed and
  // vibrated for someone who cannot hear. Once for each new set of medicines.
  const dueKeys = due.map((d) => d.key).join(",");
  const announced = useRef("");
  useEffect(() => {
    if (!dueKeys || announced.current === dueKeys) return;
    announced.current = dueKeys;
    void speak(timeLine, voice);
    if (person.access.deaf) buzz();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueKeys, person.access.lowVision, person.access.deaf]);
  const next = pending.find((d) => minutesSince(d.time, now) < -DUE_LEAD_MINUTES);
  const snoozed = Date.now() < laterUntil;

  // On opening, the screen says when the next medicine is, in her language.
  const nextLine = next
    ? tr(lang, `Your next medicine is at ${clockIn(lang, next.time)}.`, `आपकी अगली दवा का समय ${spokenTimeHindi(next.time)} है।`, `Aapki agli dawai ka samay ${spokenTimeHindi(next.time)} hai.`)
    : doses.length
      ? tr(lang, "All of today's medicines are done.", "आज की सारी दवा हो गई है।", "Aaj ki saari dawai ho gayi hai.")
      : "";
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current || reminders.loading || dueKeys || !nextLine) return;
    greeted.current = true;
    void speak(nextLine, voice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminders.loading, nextLine, dueKeys]);
  const [muted, setMutedState] = useState(isMuted());
  const [recording, setRecording] = useState(false);

  async function tookIt(list: Dose[]) {
    setBusy(true);
    setError(null);
    try {
      for (const d of list) await markDose(today, d.key, true);
      setJustTook(list);
      setTimeout(() => setJustTook(null), 12_000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!justTook) return;
    setBusy(true);
    try {
      for (const d of justTook) await markDose(today, d.key, false);
      setJustTook(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Where the helper PIN leads once it is right: another person, or this person's full app.
  const [after, setAfter] = useState<"switch" | "full">("switch");
  function go(to: "switch" | "full") {
    if (to === "full") setFullAppFor(person.name);
    else setActive(null);
  }
  function ask(to: "switch" | "full") {
    if (hasPin()) {
      setAfter(to);
      setLeaving(true);
    } else go(to);
  }
  async function leave(pin: string) {
    if (await checkPin(pin)) {
      setLeaving(false);
      go(after);
    } else {
      setPinError(t("That is not the right PIN. Try again.", "यह सही PIN नहीं है। फिर कोशिश करें।", "Yeh sahi PIN nahi hai. Phir try karein."));
    }
  }

  return (
    <div className="page-in relative flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 px-5 pt-5">
        <Avatar name={person.name} size={84} />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">{hello(lang, now)}</p>
          <h1 className="truncate text-3xl leading-tight font-bold">{person.shown}</h1>
        </div>
        <button
          type="button"
          aria-label={muted ? t("Sound off. Tap to turn on.", "आवाज़ बंद। चालू करने के लिए दबाएँ।", "Awaaz band. Chalu karne ke liye dabayein.") : t("Sound on. Tap to mute.", "आवाज़ चालू। बंद करने के लिए दबाएँ।", "Awaaz chalu. Band karne ke liye dabayein.")}
          onClick={() => {
            setMuted(!muted);
            setMutedState(!muted);
            if (muted) void speak(next ? nextLine : timeLine, voice);
          }}
          className={`flex size-14 shrink-0 items-center justify-center rounded-full border-[3px] border-[#232326] ${muted ? "bg-[#f08a7e]" : "bg-card"}`}
        >
          {muted ? <VolumeX className="size-7" aria-hidden /> : <Volume2 className="size-7" aria-hidden />}
        </button>
        <button
          type="button"
          aria-label={t("Helper", "मददगार", "Helper")}
          onClick={() => ask("switch")}
          className="flex size-12 shrink-0 items-center justify-center rounded-full border-[3px] border-[#232326] bg-card"
        >
          <Settings2 className="size-5" aria-hidden />
        </button>
      </header>

      {ringing ? <ReminderCall line={timeLine} voice={voice} onEnd={() => setRinging(false)} /> : null}
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-5">
        {due.length > 0 && !snoozed ? (
          <section className={`pop halo rounded-3xl border-[3px] border-[#232326] bg-[var(--brand)] p-5 ${person.access.deaf ? "alert-flash" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-2xl leading-tight font-bold">{t("It's time to take your medicine", "दवाई लेने का टाइम हो गया", "Dawai lene ka time ho gaya")}</p>
              </div>
              <ListenButton text={spokenReminder(person.name, due.map((d) => d.reminder.title), voice)} label={t("Listen", "सुनें", "Suniye")} lang={voice} />
            </div>
            <ul className="mt-3 space-y-2">
              {due.map((d) => (
                <li key={d.key} className="rounded-2xl border-[3px] border-[#232326] bg-white p-3">
                  <div className="flex items-center gap-3">
                    <Pill className="size-8 shrink-0" aria-hidden />
                    {/* The name gets the whole width (larger text must never cut a medicine name); the time sits under it. */}
                    <span className="min-w-0 flex-1">
                      <span className="block text-2xl leading-tight font-bold">{d.reminder.title}</span>
                      <span className="block text-lg font-bold">
                        {clockIn(lang, d.time)}
                        {d.reminder.detail ? <span className="font-normal"> · {d.reminder.detail}</span> : null}
                      </span>
                    </span>
                  </div>
                  {/* The strip they photographed: the one in their hand to take. */}
                  <StripPictures medicine={d.reminder.title} className="mt-2" />
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={busy}
              onClick={() => void tookIt(due)}
              className="mt-4 flex min-h-24 w-full flex-col items-center justify-center rounded-3xl border-[4px] border-[#232326] bg-[#2e9e5b] text-white shadow-[0_6px_0_#232326] active:translate-y-1"
            >
              {busy ? <Loader2 className="size-9 animate-spin" aria-hidden /> : <Check className="size-10" strokeWidth={4} aria-hidden />}
              <span className="text-3xl font-bold">{t("I took it", "मैंने ले ली", "Maine le li")}</span>
            </button>
            <button type="button" onClick={() => setLaterUntil(Date.now() + 10 * 60_000)} className="mt-3 w-full text-center text-lg font-bold underline">
              {t("Remind me in 10 minutes", "10 मिनट बाद याद दिलाओ", "10 minute baad yaad dilao")}
            </button>
            <button type="button" onClick={() => setRinging(true)} className="mt-2 flex w-full items-center justify-center gap-2 text-center text-base font-bold underline">
              <PhoneCall className="size-5" aria-hidden /> {t("Hear the reminder call (demo)", "रिमाइंडर कॉल सुनें (डेमो)", "Reminder call sunein (demo)")}
            </button>
          </section>
        ) : justTook ? (
          <section className="pop rounded-3xl border-[3px] border-[#232326] bg-[#bdf0cf] p-5 text-center">
            <Check className="mx-auto size-14" strokeWidth={4} aria-hidden />
            <p className="text-2xl font-bold">{t("Well done!", "बहुत अच्छा!", "Bahut achha!")}</p>
            <button type="button" onClick={() => void undo()} className="mx-auto mt-2 flex min-h-12 items-center gap-1.5 text-lg font-bold underline">
              <Undo2 className="size-5" aria-hidden /> {t("Undo", "वापस लें", "Wapas lein")}
            </button>
          </section>
        ) : pending.length === 0 && doses.length > 0 ? (
          <section className="pop rounded-3xl border-[3px] border-[#232326] bg-[#bdf0cf] p-6 text-center">
            <Check className="mx-auto size-14" strokeWidth={4} aria-hidden />
            <p className="text-2xl font-bold">{t("All your medicines are done for today", "आज की सारी दवा हो गई", "Aaj ki saari dawai ho gayi")}</p>
          </section>
        ) : next || (snoozed && due.length > 0) ? (
          <section className="pop rounded-3xl border-[3px] border-[#232326] bg-card p-5">
            <p className="text-lg font-bold">
              {snoozed && due.length > 0 ? t("We will remind you again", "फिर याद दिलाएँगे", "Phir yaad dilayenge") : t("Next medicine", "अगली दवा", "Agli dawai")}
            </p>
            <p className="mt-1 text-3xl leading-tight font-bold">{(snoozed && due.length > 0 ? due[0] : next!).reminder.title}</p>
            <p className="text-2xl font-bold">{clockIn(lang, (snoozed && due.length > 0 ? due[0] : next!).time)}</p>
            {/* The strip to look for, before it is even time. */}
            <StripPictures medicine={(snoozed && due.length > 0 ? due[0] : next!).reminder.title} className="mt-3" />
          </section>
        ) : (
          <section className="rounded-3xl border-[3px] border-dashed border-[#232326] p-6 text-center">
            <p className="text-xl font-bold">{t("No medicine today", "आज कोई दवा नहीं", "Aaj koi dawai nahi")}</p>
          </section>
        )}

        {doses.length > 0 ? (
          <section>
            <p className="mb-2 text-lg font-bold">{t("Today's medicines", "आज की दवा", "Aaj ki dawai")}</p>
            <ul className="space-y-2">
              {doses.map((d) => {
                const done = d.key in taken;
                return (
                  <li key={d.key} className={`flex items-center gap-3 rounded-2xl border-[3px] border-[#232326] p-3 ${done ? "bg-[var(--brand-soft)]" : "bg-card"}`}>
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] ${done ? "bg-[#2e9e5b] text-white" : "bg-white"}`}>
                      {done ? <Check className="size-6" strokeWidth={4} aria-hidden /> : null}
                    </span>
                    <span className={`min-w-0 flex-1 text-xl leading-tight font-bold break-words ${done ? "line-through opacity-60" : ""}`}>{d.reminder.title}</span>
                    <span className="shrink-0 text-lg font-bold">{clockIn(lang, d.time)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="text-lg font-bold text-[#b3261e]">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => ask("full")}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border-[3px] border-dashed border-[#232326] bg-transparent text-base font-bold"
        >
          <LayoutGrid className="size-5" aria-hidden /> {t("Caretaker view", "देखभाल करने वाले का व्यू", "Caretaker view")}
        </button>
      </main>

      {/* Always in reach, never scrolled away: her voice for the family, and
          the one person she would phone. */}
      <nav className="grid shrink-0 grid-cols-2 gap-3 border-t-[3px] border-[#232326] bg-[var(--background)] px-4 pt-3 pb-4" aria-label={t("Reach the family", "परिवार से बात", "Parivaar se baat")}>
        <button
          type="button"
          onClick={() => setRecording(true)}
          className="flex min-h-20 flex-col items-center justify-center gap-0.5 rounded-3xl border-[3px] border-[#232326] bg-[var(--brand)] text-lg leading-tight font-bold shadow-[0_4px_0_#232326]"
        >
          <Mic className="size-8" aria-hidden />
          {t("Message family", "परिवार को संदेश", "Parivaar ko sandesh")}
        </button>
        {person.helperNumber ? (
          <a
            href={`tel:+91${person.helperNumber}`}
            className="flex min-h-20 flex-col items-center justify-center gap-0.5 rounded-3xl border-[3px] border-[#232326] bg-card text-lg leading-tight font-bold shadow-[0_4px_0_#232326]"
          >
            <Phone className="size-8" aria-hidden />
            {person.helperName ? t(`Call ${person.helperName}`, `${person.helperName} को फ़ोन`, `${person.helperName} ko phone`) : t("Call my helper", "मददगार को फ़ोन", "Helper ko phone")}
          </a>
        ) : (
          <p className="flex min-h-20 items-center justify-center gap-2 rounded-3xl border-[3px] border-dashed border-[#232326] px-2 text-center text-base">
            <HeartHandshake className="size-6 shrink-0" aria-hidden /> {t("Ask your helper if you need anything.", "कुछ चाहिए तो मददगार से कहें।", "Kuch chahiye to helper se kahein.")}
          </p>
        )}
      </nav>

      {recording ? (
        <Sheet title={t("A message for the family", "परिवार के लिए संदेश", "Parivaar ke liye sandesh")} onClose={() => setRecording(false)}>
          <RecordMessage from={person.name} />
        </Sheet>
      ) : null}

      {leaving ? (
        <Sheet title={t("Helper", "मददगार", "Helper")} onClose={() => { setLeaving(false); setPinError(null); }}>
          <PinPad
            title={t("Enter the helper PIN", "मददगार का PIN डालें", "Helper ka PIN daalein")}
            hint={after === "full" ? t("The caretaker view opens, for whoever looks after them.", "देखभाल करने वाले के लिए व्यू खुलेगा।", "Caretaker ke liye view khulega.") : t("Only a helper should leave this screen.", "यह स्क्रीन सिर्फ़ मददगार छोड़े।", "Yeh screen sirf helper chhode.")} error={pinError} onDone={(p) => void leave(p)} onCancel={() => { setLeaving(false); setPinError(null); }} />
        </Sheet>
      ) : null}
    </div>
  );
}

/**
 * What the reminder call looks and sounds like (a demo: real calls go through
 * the calling agent, which is not live yet). It rings, and on answering says
 * "dawai lene ka time ho gaya" with the medicines due.
 */
function ReminderCall({ line, voice, onEnd }: { line: string; voice: ReturnType<typeof speechLang>; onEnd: () => void }) {
  const t = useT();
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    if (answered) return;
    buzz();
    const id = window.setInterval(buzz, 1800);
    return () => window.clearInterval(id);
  }, [answered]);
  return (
    <div role="dialog" aria-label={t("Reminder call", "रिमाइंडर कॉल", "Reminder call")} className="absolute inset-0 z-50 flex flex-col items-center justify-between bg-[#232326] p-8 text-white">
      <div className="mt-10 text-center">
        <p className="text-lg opacity-80">{answered ? t("On the call", "कॉल चालू है", "Call chalu hai") : t("Incoming call", "कॉल आ रही है", "Call aa rahi hai")}</p>
        <p className="mt-2 text-4xl font-bold">Parcha</p>
        <p className="mt-1 text-lg opacity-80">{t("Medicine reminder", "दवा रिमाइंडर", "Dawa reminder")}</p>
        {answered ? <p className="mx-auto mt-8 max-w-xs text-2xl leading-snug font-bold">“{line}”</p> : null}
      </div>
      <div className="mb-6 flex w-full justify-around">
        <button type="button" onClick={onEnd} aria-label={t("End call", "कॉल काटें", "Call kaatein")} className="flex size-20 items-center justify-center rounded-full bg-[#e5484d]">
          <PhoneOff className="size-9" aria-hidden />
        </button>
        {!answered ? (
          <button
            type="button"
            onClick={() => {
              setAnswered(true);
              void speak(line, voice);
            }}
            aria-label={t("Answer", "उठाएँ", "Uthaayein")}
            className="flex size-20 animate-bounce items-center justify-center rounded-full bg-[#2e9e5b]"
          >
            <Phone className="size-9" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
