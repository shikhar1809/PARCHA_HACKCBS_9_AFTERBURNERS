/**
 * "Yes, I have a Parcha": scan its code, and the medicines come in exactly as
 * the doctor wrote them.
 *
 * This is the only way a prescription reaches a phone. Nothing is copied from
 * the clinic: the QR printed on the slip carries the whole thing, signed, and
 * the signature is checked here before a single medicine is believed. What the
 * chemist reads off the paper and what the phone reminds about are therefore
 * the same document, and the clinic's record stays at the clinic.
 *
 * Short steps: scan, check (the slip is shown with who signed it), who it is
 * for, photos of each strip, then the schedule it makes — with any medicine
 * already in the reminders asked about rather than quietly doubled.
 *
 * A slip whose code will not read — creased, faded, or printed before any of
 * this — can still be kept as a photograph. Then it is a picture of a Parcha
 * and nothing more: no medicines are read out of a photograph, and no
 * reminders are set from one. Saying that plainly is better than guessing at
 * a dose.
 *
 * The phone's own camera app works too: the code is a link to /rx, which
 * opens here with the prescription already read.
 */
import { errorMessage, readRx, vaultPut, type RxRead } from "@parcha/client";
import { normaliseFrequency, remindersFromPrescription, rxHindi, rxName, toDateString, type Reminder, type RxPayload, type Timing } from "@parcha/core";
import { Screen, cn } from "@parcha/ui";
import { BadgeCheck, Camera, Check, FlaskConical, ImagePlus, Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useHandset } from "../auth";
import { NewSchedule } from "../components/NewSchedule";
import { QrScanner } from "../components/QrScanner";
import { usePeople } from "../components/people";
import { StripCapture, shrinkPhoto } from "../components/strips";
import { useT } from "../i18n";
import { BigButton, DoseTiles, Header } from "../kit";

type Step = "scan" | "check" | "who" | "strips" | "schedule" | "done";

export function ScanParcha() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { people, active } = usePeople();
  const { handset } = useHandset();
  const [step, setStep] = useState<Step>("scan");
  const [read, setRead] = useState<RxRead | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A photograph of the slip, when its code could not be read. */
  const [photo, setPhoto] = useState<string | null>(null);
  /** The reminders the scanned slip makes, waiting to be checked and set. */
  const [proposed, setProposed] = useState<Omit<Reminder, "id">[]>([]);

  const onRead = useCallback(async (text: string) => {
    const r = await readRx(text);
    setRead(r);
    setStep("check");
  }, []);

  // Opened from the phone's camera: the prescription is in the link.
  useEffect(() => {
    if (location.hash.length > 1) void onRead(`https://parcha.web.app/rx${location.hash}`);
  }, [location.hash, onRead]);

  const rx: RxPayload | null = read?.ok ? read.payload : null;

  // The person the slip names, if they are on this phone.
  const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
  const named = rx ? people.find((p) => same(p.name, rx.p[0])) : undefined;
  // "Who is it for?" is skipped only when the slip names the person already
  // chosen on the phone; a slip for someone else is never quietly theirs.
  const askWho = !active || !named || named.name !== active;
  const someoneElse = !!active && !!rx && !(named && named.name === active);
  useEffect(() => {
    if (rx && !who) setWho(named?.name ?? (!active && people.length === 1 ? people[0].name : null));
  }, [rx, people, who, named, active]);

  // A photograph has nothing to read, so it only asks who it belongs to.
  const photoOnly = !rx && photo !== null;
  const steps: Step[] = photoOnly
    ? ["scan", "who"]
    : askWho
      ? ["scan", "check", "who", "strips"]
      : ["scan", "check", "strips"];
  const at = steps.indexOf(step);

  /** The slip could not be scanned: keep the paper as a picture instead. */
  async function takePhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setPhoto(await shrinkPhoto(file, 1600));
      setStep("who");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!who) return;
    setBusy(true);
    setError(null);
    try {
      if (photoOnly) {
        // A picture of a Parcha, kept on this phone. No medicines are read out
        // of it, so nothing is set from it either.
        await vaultPut(`slip:${Date.now()}`, { person: who, photo, savedAt: new Date().toISOString() });
        setStep("done");
        return;
      }
      if (!rx || !read?.ok) return;
      const items = rx.m.map(([name, strength, form, frequency, days, timing, every]) => ({
        drugId: name.toLowerCase(),
        drugName: name,
        strength,
        form,
        frequency: normaliseFrequency(frequency),
        durationDays: days,
        timing: timing as Timing,
        everyDays: every,
      }));
      setProposed(
        remindersFromPrescription({
          ownerPhone: handset?.phone ?? "",
          personName: who,
          visitId: `parcha:${rx.c}`,
          startDate: toDateString(new Date()),
          items,
        }).slice(0, 20),
      );
      // The slip stays on the phone, encrypted, for "My Parchas".
      await vaultPut(`parcha:${rx.c}`, { payload: rx, token: read.token, person: who, photo, savedAt: new Date().toISOString() });
      setStep("schedule");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header
        back="/"
        title={t("Add your Parcha", "अपना पर्चा जोड़ें", "Apna Parcha jodein")}
        subtitle={step === "done" ? undefined : t(`Step ${at + 1} of ${steps.length}`, `चरण ${at + 1} / ${steps.length}`, `Step ${at + 1} / ${steps.length}`)}
      />
      <Screen className="space-y-5 px-4 pb-10">
        {step !== "done" ? (
          <div className="flex gap-1.5" aria-hidden>
            {steps.map((s, i) => (
              <span key={s} className={cn("h-2 flex-1 rounded-full border-2 border-[#232326]", i <= at ? "bg-[var(--brand)]" : "bg-white")} />
            ))}
          </div>
        ) : null}

        {step === "scan" ? (
          <>
            <QrScanner onRead={(text) => void onRead(text)} />
            <div className="space-y-2 rounded-2xl border-2 border-dashed border-[#232326] p-3.5">
              <p className="text-base leading-snug font-bold">
                {t(
                  "No square code on your slip, or it will not read?",
                  "पर्चे पर चौकोर कोड नहीं है, या पढ़ा नहीं जा रहा?",
                  "Parche par chaukor code nahi hai, ya padha nahi ja raha?",
                )}
              </p>
              <label className="hover-orange flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-white text-lg font-bold">
                {busy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <Camera className="size-6" aria-hidden />}
                {t("Keep a photo of it", "उसकी फ़ोटो रखें", "Uski photo rakhein")}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => void takePhoto(e.target.files?.[0])}
                />
              </label>
              <p className="text-base leading-snug">
                {t(
                  "The photo is kept on this phone with your Parchas. Medicine times cannot be set from a photo — only the square code can do that.",
                  "फ़ोटो इसी फ़ोन में आपके पर्चों के साथ रहेगी। फ़ोटो से दवा का समय नहीं लग सकता — वह सिर्फ़ चौकोर कोड से होता है।",
                  "Photo isi phone mein aapke Parchon ke saath rahegi. Photo se dawai ka time nahi lag sakta — woh sirf chaukor code se hota hai.",
                )}
              </p>
              {error ? (
                <p role="alert" className="text-destructive text-base font-bold">
                  {error}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {step === "check" && read ? (
          read.ok && rx ? (
            <>
              <div className="flex items-start gap-3 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-4">
                <BadgeCheck className="size-8 shrink-0" strokeWidth={2.4} aria-hidden />
                <div className="min-w-0">
                  <p className="text-xl leading-tight font-bold">{t("A genuine Parcha", "असली पर्चा", "Asli Parcha")}</p>
                  <p className="text-base leading-snug">
                    {rx.h} · {rx.d[0]}
                    {rx.d[2] ? ` (${rx.d[2]})` : ""} · {new Date(rx.t).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </p>
                  <p className="text-base leading-snug">
                    {t("For", "किसके लिए", "Kiske liye")}: <b>{rx.p[0]}</b>
                    {rx.x ? ` · ${rx.x}` : ""}
                  </p>
                </div>
              </div>
              <ul className="space-y-2.5">
                {rx.m.map(([name, strength, form, frequency, days, timing, every], i) => (
                  <li key={i} className="space-y-2 rounded-2xl border-[3px] border-[#232326] bg-card p-3">
                    <p className="text-xl leading-tight font-bold">{rxName({ drugName: name, strength, form })}</p>
                    <p className="text-lg">
                      {rxHindi({ frequency, timing: timing as Timing, everyDays: every, form })} · {t(`${days} days`, `${days} दिन`, `${days} din`)}
                    </p>
                    <DoseTiles frequency={normaliseFrequency(frequency)} form={form} compact />
                  </li>
                ))}
              </ul>
              {rx.k.length ? (
                <p className="flex items-start gap-2 rounded-2xl border-2 border-[#232326] bg-white p-3 text-lg">
                  <FlaskConical className="mt-1 size-5 shrink-0" aria-hidden />
                  <span>
                    <b>{t("Tests", "जाँचें", "Jaanch")}:</b> {rx.k.join(", ")}
                  </span>
                </p>
              ) : null}
              <BigButton onClick={() => setStep(askWho ? "who" : "strips")}>{t("This is right", "यह सही है", "Yeh sahi hai")}</BigButton>
            </>
          ) : (
            <div role="alert" className="space-y-3 rounded-2xl border-[3px] border-[#232326] bg-[oklch(0.94_0.05_25)] p-5">
              <p className="flex items-center gap-2 text-xl font-bold">
                <ShieldAlert className="size-7" aria-hidden />
                {read.ok === false && read.reason === "forged"
                  ? t("This code was not made by Parcha, or was changed.", "यह कोड पर्चा का नहीं है, या बदला गया है।", "Yeh code Parcha ka nahi hai, ya badla gaya hai.")
                  : read.ok === false && read.reason === "not-parcha"
                    ? t("This is not a Parcha code.", "यह पर्चा का कोड नहीं है।", "Yeh Parcha ka code nahi hai.")
                    : t("The code could not be read. Try again.", "कोड पढ़ा नहीं गया। फिर कोशिश करें।", "Code padha nahi gaya. Phir try karein.")}
              </p>
              <p className="text-lg">{t("Nothing was added. Your medicines are safe.", "कुछ नहीं जोड़ा गया।", "Kuch nahi joda gaya.")}</p>
              <div className="flex flex-wrap gap-2">
                <BigButton onClick={() => { setRead(null); setStep("scan"); }}>{t("Scan again", "फिर स्कैन करें", "Phir scan karein")}</BigButton>
                <BigButton onClick={() => navigate("/check")}>{t("Check my medicines another way", "दूसरे तरीके से दवा जाँचें", "Doosre tareeke se dawa jaanchein")}</BigButton>
              </div>
            </div>
          )
        ) : null}

        {step === "who" ? (
          <>
            <p className="text-xl font-bold">{t("Who are these medicines for?", "ये दवाइयाँ किसकी हैं?", "Yeh dawaiyan kiski hain?")}</p>
            {someoneElse && rx ? (
              <p role="alert" className="rounded-2xl border-2 border-[#232326] bg-[var(--morning-soft)] p-3 text-base leading-snug font-bold">
                {t(
                  `This Parcha is for ${rx.p[0]}, not ${active}. Choose who takes these medicines. If they are not on this phone, add them in Me first.`,
                  `यह पर्चा ${rx.p[0]} का है, ${active} का नहीं। चुनें कि ये दवाइयाँ कौन लेगा। अगर वे इस फ़ोन पर नहीं हैं, तो पहले "मैं" में जोड़ें।`,
                  `Yeh Parcha ${rx.p[0]} ka hai, ${active} ka nahi. Chunein ki yeh dawaiyan kaun lega. Agar woh is phone par nahi hain, to pehle Me mein jodein.`,
                )}
              </p>
            ) : null}
            <div className="space-y-2.5" role="radiogroup">
              {people.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  role="radio"
                  aria-checked={who === p.name}
                  onClick={() => setWho(p.name)}
                  className={cn(
                    "hover-orange flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 border-[var(--brand-deep)] px-4 text-left text-xl font-bold",
                    who === p.name ? "bg-[var(--brand-soft)] shadow-[0_3px_0_var(--brand-deep)]" : "bg-card",
                  )}
                >
                  {who === p.name ? <Check className="size-6" strokeWidth={3} aria-hidden /> : null}
                  {p.shown}
                </button>
              ))}
            </div>
            {photoOnly ? (
              <>
                {photo ? (
                  <img src={photo} alt="" className="w-full rounded-2xl border-[3px] border-[#232326] object-contain" />
                ) : null}
                {error ? (
                  <p role="alert" className="text-destructive text-lg font-bold">
                    {error}
                  </p>
                ) : null}
                <BigButton disabled={!who || busy} onClick={() => void finish()}>
                  {busy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : t("Keep this Parcha", "यह पर्चा रखें", "Yeh Parcha rakhein")}
                </BigButton>
              </>
            ) : (
              <BigButton disabled={!who} onClick={() => setStep("strips")}>{t("Next", "आगे", "Aage")}</BigButton>
            )}
          </>
        ) : null}

        {step === "strips" && rx ? (
          <>
            <p className="text-xl leading-snug font-bold">
              {t("Take a photo of each strip. At medicine time you will see the strip to take.", "हर पत्ते की फ़ोटो लें। दवा के समय वही पत्ता दिखेगा।", "Har patte ki photo lein. Dawa ke time wahi patta dikhega.")}
            </p>
            {rx.m.map(([name, strength]) => (
              <div key={name} className="space-y-2 rounded-2xl border-[3px] border-[#232326] bg-card p-3">
                <p className="text-lg font-bold">
                  {name} {strength}
                </p>
                <StripCapture medicine={name} />
              </div>
            ))}
            {error ? (
              <p role="alert" className="text-destructive text-lg font-bold">
                {error}
              </p>
            ) : null}
            <BigButton disabled={busy} onClick={() => void finish()}>
              {busy ? <Loader2 className="size-6 animate-spin" /> : t("Next: my medicine times", "आगे: दवा का समय", "Aage: dawai ka time")}
            </BigButton>
            <p className="text-muted-foreground text-center text-base">{t("Photos are optional, and stay on this phone.", "फ़ोटो ज़रूरी नहीं, और इसी फ़ोन में रहती हैं।", "Photo zaroori nahi, aur isi phone mein rehti hain.")}</p>
          </>
        ) : null}

        {step === "schedule" ? (
          <>
            <p className="text-xl leading-snug font-bold">
              {t("Your medicine times, from the Parcha", "पर्चे से बना आपका दवा का समय", "Parche se bana aapka dawai ka time")}
            </p>
            {/* A medicine already in the reminders is asked about, not doubled. */}
            <NewSchedule proposed={proposed} onDone={() => setStep("done")} />
            <button type="button" onClick={() => setStep("done")} className="min-h-11 w-full text-center text-base font-bold underline">
              {t("Not now", "अभी नहीं", "Abhi nahi")}
            </button>
          </>
        ) : null}

        {step === "done" && photoOnly ? (
          <div className="space-y-4 text-center">
            <ImagePlus className="mx-auto size-16" strokeWidth={2} aria-hidden />
            <p className="text-2xl leading-tight font-bold">{t("The Parcha is kept", "पर्चा रख लिया", "Parcha rakh liya")}</p>
            <p className="text-lg leading-relaxed">
              {t(
                `The photo is with ${who}'s Parchas on this phone. For medicine reminders, scan the square code on a printed Parcha.`,
                `फ़ोटो इस फ़ोन में ${who} के पर्चों के साथ है। दवा के रिमाइंडर के लिए छपे पर्चे का चौकोर कोड स्कैन कीजिए।`,
                `Photo is phone mein ${who} ke Parchon ke saath hai. Dawai ke reminder ke liye chhape Parche ka chaukor code scan kijiye.`,
              )}
            </p>
            <BigButton onClick={() => navigate("/records", { replace: true })}>
              {t("See my Parchas", "मेरे पर्चे देखें", "Mere Parche dekhein")}
            </BigButton>
          </div>
        ) : null}

        {step === "done" && rx ? (
          <div className="space-y-4 text-center">
            <BadgeCheck className="mx-auto size-16" strokeWidth={2} aria-hidden />
            <p className="text-2xl leading-tight font-bold">{t("Reminders are set", "रिमाइंडर लग गए", "Reminder lag gaye")}</p>
            <p className="text-lg">
              {t(`${rx.m.length} medicine${rx.m.length === 1 ? "" : "s"} for ${who}. We will remind at each time.`, `${who} की ${rx.m.length} दवाइयाँ। हर समय पर याद दिलाएँगे।`, `${who} ki ${rx.m.length} dawaiyan. Har time par yaad dilaayenge.`)}
            </p>
            <BigButton onClick={() => navigate("/schedule", { replace: true })}>{t("See today's medicines", "आज की दवाइयाँ देखें", "Aaj ki dawaiyan dekhein")}</BigButton>
          </div>
        ) : null}
      </Screen>
    </>
  );
}
