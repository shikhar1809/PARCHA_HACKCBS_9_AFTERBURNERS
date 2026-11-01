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
 * for, each strip photographed one medicine at a time, then the schedule it
 * makes, set locked — with any medicine already in the reminders asked about
 * rather than quietly doubled.
 *
 * A slip whose code will not read — creased, faded, or printed before any of
 * this — is photographed instead and read on the phone (CheckMedicines, in its
 * printed mode). A photograph is not signed, so nothing read off it is
 * believed until the person has confirmed every medicine against the paper.
 *
 * The phone's own camera app works too: the code is a link to /rx, which
 * opens here with the prescription already read.
 */
import { errorMessage, readRx, vaultPut, type RxRead, markTouched
} from "@parcha/client";
import { normaliseFrequency, remindersFromPrescription, rxHindi, rxName, toDateString, type PhotoProblem, type Reminder, type RxPayload, type Timing } from "@parcha/core";
import { Screen, cn } from "@parcha/ui";
import { BadgeCheck, Camera, Check, FlaskConical, Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useHandset } from "../auth";
import { NewSchedule } from "../components/NewSchedule";
import { QrScanner } from "../components/QrScanner";
import { usePeople } from "../components/people";
import { StripWalk } from "../components/StripWalk";
import { shrinkPhoto } from "../components/strips";
import { startFromPrintedPhoto } from "./CheckMedicines";
import { checkPhoto, PhotoRejected } from "../components/photoCheck";
import { useT } from "../i18n";
import { BigButton, DoseTiles, Header } from "../kit";

type Step = "scan" | "check" | "who" | "strips" | "schedule" | "done";

export function ScanParcha() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { people, active, openPicker } = usePeople();
  const { handset } = useHandset();
  const [step, setStep] = useState<Step>("scan");
  const [read, setRead] = useState<RxRead | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<PhotoProblem | null>(null);
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
  // With someone chosen on the phone, the medicines can only be theirs. A slip
  // naming another person on this phone is theirs to add, from their own name;
  // a name the phone does not know is asked about, never assumed.
  const forOther = !!active && !!named && named.name !== active;
  const unknownName = !!active && !!rx && !named;
  const choices = active ? people.filter((p) => p.name === active) : people;
  useEffect(() => {
    if (rx && !who && !forOther) setWho(active ?? named?.name ?? (people.length === 1 ? people[0].name : null));
  }, [rx, people, who, named, active, forOther]);

  const steps: Step[] = askWho ? ["scan", "check", "who", "strips"] : ["scan", "check", "strips"];
  const at = steps.indexOf(step);

  /** The code will not read: photograph the slip and read the print instead. */
  async function takePhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const big = await shrinkPhoto(file, 2000);
      // An unclear photo is refused here, before anything is read from it.
      const verdict = await checkPhoto(big);
      if (!verdict.ok) {
        setRefused(verdict.problem);
        setBusy(false);
        return;
      }
      setRefused(null);
      startFromPrintedPhoto(big, await shrinkPhoto(file, 1200));
      navigate("/check", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function finish() {
    if (!who) return;
    setBusy(true);
    setError(null);
    try {
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
      await vaultPut(`parcha:${rx.c}`, { payload: rx, token: read.token, person: who, photo: null, savedAt: new Date().toISOString() });
      // The phone's own copy is now newer than any backup it holds.
      await markTouched();
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
        subtitle={step === "done" || step === "schedule" ? undefined : t(`Step ${at + 1} of ${steps.length}`, `चरण ${at + 1} / ${steps.length}`, `Step ${at + 1} / ${steps.length}`)}
      />
      <Screen className="space-y-5 px-4 pb-10">
        {step !== "done" && step !== "schedule" ? (
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
                {t("Photograph the Parcha", "पर्चे की फ़ोटो लें", "Parche ki photo lein")}
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
                  "This phone reads the printed medicines and times. You then check every one against the paper. The photo stays on this phone.",
                  "यह फ़ोन छपी दवाइयाँ और समय पढ़ेगा। फिर आप हर एक को पर्चे से मिलाएँगे। फ़ोटो इसी फ़ोन में रहती है।",
                  "Yeh phone chhapi dawaiyan aur time padhega. Phir aap har ek ko parche se milayenge. Photo isi phone mein rehti hai.",
                )}
              </p>
              {error ? (
                <p role="alert" className="text-destructive text-base font-bold">
                  {error}
                </p>
              ) : null}
              {refused ? <PhotoRejected problem={refused} what={t("photo of the Parcha", "पर्चे की फ़ोटो", "parche ki photo")} /> : null}
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
            {forOther && rx ? (
              <div role="alert" className="space-y-3 rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-4">
                <p className="text-lg leading-snug font-bold">
                  {t(
                    `This Parcha is for ${named?.shown ?? rx.p[0]}, not ${active}. Switch to ${named?.shown ?? rx.p[0]} to add it, so the reminders and strip photos are theirs.`,
                    `यह पर्चा ${named?.shown ?? rx.p[0]} का है, ${active} का नहीं। इसे जोड़ने के लिए ${named?.shown ?? rx.p[0]} पर बदलें।`,
                    `Yeh Parcha ${named?.shown ?? rx.p[0]} ka hai, ${active} ka nahi. Ise jodne ke liye ${named?.shown ?? rx.p[0]} par badlein.`,
                  )}
                </p>
                <BigButton onClick={openPicker}>{t("Switch person", "व्यक्ति बदलें", "Vyakti badlein")}</BigButton>
              </div>
            ) : (
              <>
                {unknownName && rx ? (
                  <p role="alert" className="rounded-2xl border-2 border-[#232326] bg-[var(--morning-soft)] p-3 text-base leading-snug font-bold">
                    {t(
                      `The slip says ${rx.p[0]}. Add it to ${active} only if it is theirs.`,
                      `पर्चे पर ${rx.p[0]} लिखा है। ${active} में तभी जोड़ें जब यह उन्हीं का हो।`,
                      `Parche par ${rx.p[0]} likha hai. ${active} mein tabhi jodein jab yeh unhi ka ho.`,
                    )}
                  </p>
                ) : null}
                <div className="space-y-2.5" role="radiogroup">
                  {choices.map((p) => (
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
              </>
            )}
              <BigButton disabled={!who || forOther} onClick={() => setStep("strips")}>{t("Next", "आगे", "Aage")}</BigButton>
          </>
        ) : null}

        {step === "strips" && rx ? (
          <>
            <p className="text-xl leading-snug font-bold">
              {t("Now each strip, one at a time. At medicine time you will see the strip to take.", "अब हर पत्ता, एक-एक करके। दवा के समय वही पत्ता दिखेगा।", "Ab har patta, ek-ek karke. Dawa ke time wahi patta dikhega.")}
            </p>
            {busy ? <Loader2 className="mx-auto size-8 animate-spin" aria-label={t("Saving", "रख रहे हैं", "Rakh rahe hain")} /> : null}
            <StripWalk
              medicines={rx.m.map(([name, strength, form]) => ({ name, detail: [strength, form].filter(Boolean).join(" ") }))}
              onDone={() => void finish()}
            />
            {error ? (
              <p role="alert" className="text-destructive text-lg font-bold">
                {error}
              </p>
            ) : null}
          </>
        ) : null}

        {step === "schedule" ? (
          <>
            <p className="text-xl leading-snug font-bold">
              {t("Your medicine times, from the Parcha", "पर्चे से बना आपका दवा का समय", "Parche se bana aapka dawai ka time")}
            </p>
            {/* A medicine already in the reminders is asked about, not doubled. */}
            <NewSchedule proposed={proposed} lock onDone={() => setStep("done")} />
            <button type="button" onClick={() => setStep("done")} className="min-h-11 w-full text-center text-base font-bold underline">
              {t("Not now", "अभी नहीं", "Abhi nahi")}
            </button>
          </>
        ) : null}

        {step === "done" && rx ? (
          <div className="space-y-4 text-center">
            <BadgeCheck className="mx-auto size-16" strokeWidth={2} aria-hidden />
            <p className="text-2xl leading-tight font-bold">{t("Reminders are set", "रिमाइंडर लग गए", "Reminder lag gaye")}</p>
            <p className="text-lg">
              {t(`${rx.m.length} medicine${rx.m.length === 1 ? "" : "s"} for ${who}. We will remind at each time.`, `${who} की ${rx.m.length} दवाइयाँ। हर समय पर याद दिलाएँगे।`, `${who} ki ${rx.m.length} dawaiyan. Har time par yaad dilaayenge.`)}
            </p>
            <BigButton onClick={() => navigate(`/simple/${encodeURIComponent(`parcha:${rx.c}`)}`, { replace: true })}>{t("See my simple Parcha", "मेरा आसान पर्चा देखें", "Mera aasaan Parcha dekhein")}</BigButton>
            <button type="button" onClick={() => navigate("/schedule", { replace: true })} className="min-h-12 w-full text-lg font-bold underline">
              {t("See today's medicines", "आज की दवाइयाँ देखें", "Aaj ki dawaiyan dekhein")}
            </button>
          </div>
        ) : null}
      </Screen>
    </>
  );
}
