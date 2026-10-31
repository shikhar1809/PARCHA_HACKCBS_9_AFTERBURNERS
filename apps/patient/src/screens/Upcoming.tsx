import {
  cancelMyRequest,
  errorMessage,
  escalateRequest,
  usePatientHospitals,
} from "@parcha/client";
import {
  secondsLeft,
  timeOf,
  type Hospital,
  type Visit,
} from "@parcha/core";
import { cn } from "@parcha/ui";
import { Check, Loader2, Phone, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { BringList } from "../components/BringList";
import { Countdown } from "../components/Countdown";
import { HospitalMap } from "../components/LazyHospitalMap";
import { clockIn, dayWordIn, slotIn, useLang, useT } from "../i18n";
import { Heading, StageChip } from "../kit";

const STEPS: [string, string, string][] = [
  ["You asked", "आपने अनुरोध भेजा", "Aapne request bheji"],
  ["The hospital finds a doctor", "अस्पताल डॉक्टर ढूँढ रहा है", "Hospital doctor dhoondh raha hai"],
  ["The doctor confirms a time", "डॉक्टर समय तय करेंगे", "Doctor time pakka karenge"],
  ["You come to the hospital", "आप अस्पताल आइए", "Aap hospital aaiye"],
];

/** How far along the first three steps a request is. */
const DONE_THROUGH: Record<string, number> = {
  requested: 1,
  proposed: 2,
  scheduled: 3,
};

/**
 * What a patient sees before they have been in: which hospital is being asked,
 * how long it has to answer, where the request has already been, and, once a
 * doctor has said yes, when to come.
 *
 * The countdown is the hospital's promise made visible. If it runs out, the
 * phone asks the server to move the request on, and the server only does so if
 * the hospital really is overdue; the app never decides that by itself.
 */
export function Upcoming({ visit }: { visit: Visit }) {
  const t = useT();
  const lang = useLang();
  const hospitals = usePatientHospitals();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelled = visit.stage === "cancelled";
  const waiting = visit.stage === "requested" || visit.stage === "proposed";
  const done = DONE_THROUGH[visit.stage] ?? 0;
  const declined = (visit.declines ?? []).length > 0 && visit.stage === "requested";

  const attempts = visit.attempts ?? [];
  const here = attempts[attempts.length - 1];
  const byId = new Map<string, Hospital>(hospitals.data.map((h) => [h.id, h]));
  const current = byId.get(visit.hospitalId);
  const total = (current?.respondMinutes ?? 15) * 60;
  const triedIds = attempts
    .filter((a) => a.outcome === "timed_out" || a.outcome === "declined")
    .map((a) => a.hospitalId);

  const moving = useMoveOnWhenOverdue(visit, waiting);

  async function cancel() {
    setError(null);
    setBusy(true);
    try {
      await cancelMyRequest(visit.id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="rise">
      <div className="px-5 pt-1">
        <StageChip stage={visit.stage} />
      </div>

      {visit.exhausted ? (
        <Exhausted attempts={attempts} byId={byId} />
      ) : cancelled ? (
        <div className="mx-4 mt-6 rounded-3xl border-2 border-dashed border-[var(--color-input)] p-6 text-center">
          <p className="text-xl font-bold">{t("This request was cancelled.", "यह अनुरोध रद्द हो गया।", "Yeh request cancel ho gayi.")}</p>
          <p className="text-muted-foreground mt-1.5 text-lg">
            {t("You can book another one any time.", "आप कभी भी दूसरी बुक कर सकते हैं।", "Aap kabhi bhi doosri book kar sakte hain.")}
          </p>
        </div>
      ) : visit.stage === "scheduled" && visit.scheduledFor ? (
        <div className="mx-4 mt-6 rounded-3xl border-2 border-[var(--brand-deep)] bg-[var(--brand-soft)] p-5 shadow-[0_4px_0_var(--brand-deep)]">
          <p className="text-lg font-bold">{t("Please come on", "कृपया इस समय आइए", "Please is time par aaiye")}</p>
          <p className="mt-1 text-3xl leading-tight font-bold tracking-tight">{slotIn(lang, visit.scheduledFor)}</p>
          {visit.assignedDoctorName ? (
            <p className="mt-2 text-xl font-bold">{visit.assignedDoctorName}</p>
          ) : null}
          {here ? <p className="text-lg font-bold">{here.hospitalName}</p> : null}
          {current ? <p className="text-base">{current.address}</p> : null}
          <p className="mt-3 text-lg leading-relaxed">
            {t("Go to the front desk and say your name. They will take it from there.", "काउंटर पर जाकर अपना नाम बताइए। आगे वे सँभाल लेंगे।", "Counter par jaakar apna naam bataiye. Aage woh sambhal lenge.")}
          </p>
        </div>
      ) : (
        <div className="mx-4 mt-6 flex items-center gap-4 rounded-3xl border-2 border-[var(--color-input)] bg-card p-4">
          {visit.respondBy ? (
            <Countdown deadline={visit.respondBy} totalSeconds={total} />
          ) : null}
          <div className="min-w-0">
            <p className="text-base font-bold">{t("Asking", "पूछ रहे हैं", "Pooch rahe hain")}</p>
            <p className="text-2xl leading-tight font-bold">{here?.hospitalName ?? t("the hospital", "अस्पताल", "hospital")}</p>
            <p className="mt-1 text-lg leading-snug">
              {moving
                ? t("No answer yet. Asking the next hospital now.", "अभी जवाब नहीं आया। अब अगले अस्पताल से पूछ रहे हैं।", "Abhi jawab nahi aaya. Ab agle hospital se pooch rahe hain.")
                : visit.stage === "proposed"
                  ? t(`${visit.assignedDoctorName ?? "A doctor"} is looking at it.`, `${visit.assignedDoctorName ?? "एक डॉक्टर"} देख रहे हैं।`, `${visit.assignedDoctorName ?? "Ek doctor"} dekh rahe hain.`)
                  : declined
                    ? t("Finding you another doctor here.", "यहीं दूसरे डॉक्टर ढूँढ रहे हैं।", "Yahin doosre doctor dhoondh rahe hain.")
                    : t("They are finding you a doctor.", "वे आपके लिए डॉक्टर ढूँढ रहे हैं।", "Woh aapke liye doctor dhoondh rahe hain.")}
            </p>
            {visit.respondBy ? (
              <p className="text-muted-foreground mt-1 text-base">
                {t(`They will answer by ${clockIn(lang, timeOf(visit.respondBy))}.`, `${clockIn(lang, timeOf(visit.respondBy))} तक जवाब देंगे।`, `${clockIn(lang, timeOf(visit.respondBy))} tak jawab denge.`)}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* Where the request is, and where it has been. */}
      {hospitals.data.length > 0 && !visit.exhausted ? (
        <div className="px-4 pt-4">
          <HospitalMap
            hospitals={hospitals.data}
            currentId={waiting ? visit.hospitalId : null}
            selectedId={visit.stage === "scheduled" ? visit.hospitalId : null}
            triedIds={triedIds}
            compact
            className="h-44"
          />
        </div>
      ) : null}

      {(visit.bring ?? []).length > 0 || visit.bringNote ? <BringList visit={visit} /> : null}

      {attempts.length > 1 ? (
        <>
          <Heading>{t("Where we have asked", "कहाँ-कहाँ पूछा", "Kahan-kahan poocha")}</Heading>
          <ol className="space-y-2.5 px-5">
            {attempts.map((a, i) => (
              <li key={i} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-[var(--brand-deep)]",
                    a.outcome === "waiting" && "bg-[var(--brand)]",
                    a.outcome === "answered" && "bg-[var(--brand-soft)]",
                    (a.outcome === "timed_out" || a.outcome === "declined") && "bg-white opacity-70",
                  )}
                >
                  {a.outcome === "answered" ? (
                    <Check className="size-4" strokeWidth={3} />
                  ) : a.outcome === "waiting" ? (
                    <span className="size-2.5 rounded-full bg-[var(--brand-deep)]" />
                  ) : (
                    <X className="size-4" strokeWidth={3} />
                  )}
                </span>
                <span className={cn("text-lg font-bold", a.outcome !== "waiting" && a.outcome !== "answered" && "opacity-60")}>
                  {a.hospitalName}
                  <span className="block text-base font-normal">
                    {a.outcome === "waiting"
                      ? t("Waiting for an answer", "जवाब का इंतज़ार", "Jawab ka intezaar")
                      : a.outcome === "answered"
                        ? t("Confirmed", "पक्का", "Pakka")
                        : a.outcome === "timed_out"
                          ? t("Did not answer in time", "समय पर जवाब नहीं दिया", "Time par jawab nahi diya")
                          : t("Could not take it", "नहीं ले सके", "Nahi le sake")}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {!cancelled ? (
        <>
          <Heading>{t("Where things stand", "अभी क्या हुआ", "Abhi kya hua")}</Heading>
          <ol className="space-y-3 px-5">
            {STEPS.map((s, i) => {
              const finished = i < done;
              const current = i === done;
              return (
                <li key={s[0]} className="flex items-center gap-3.5">
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-[var(--brand-deep)] text-base font-bold",
                      finished && "bg-[var(--brand-deep)] text-white",
                      current && "bg-[var(--brand)]",
                      !finished && !current && "bg-white opacity-60",
                    )}
                  >
                    {finished ? <Check className="size-5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={cn(!finished && !current && "opacity-60")}>
                    <span className="block text-lg leading-tight font-bold">{t(...s)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      {visit.complaint ? (
        <section>
          <Heading>{t("What you told us", "आपने क्या बताया", "Aapne kya bataya")}</Heading>
          <p className="px-5 text-lg leading-relaxed">{visit.complaint}</p>
          {visit.preferredDate ? (
            <p className="text-muted-foreground px-5 pt-1.5 text-base">
              {t(`You would like to come: ${dayWordIn(lang, visit.preferredDate)}.`, `आप आना चाहते हैं: ${dayWordIn(lang, visit.preferredDate)}।`, `Aap aana chahte hain: ${dayWordIn(lang, visit.preferredDate)}.`)}
            </p>
          ) : null}
        </section>
      ) : null}

      {!cancelled && !visit.exhausted ? (
        <div className="px-4 pt-8">
          {error ? (
            <p role="alert" className="text-destructive pb-3 text-lg font-bold">
              {error}
            </p>
          ) : null}
          {confirming ? (
            <div className="rounded-2xl border-2 border-[var(--brand-deep)] bg-card p-4">
              <p className="text-lg font-bold">{t("Cancel this request?", "यह अनुरोध रद्द करें?", "Yeh request cancel karein?")}</p>
              <div className="mt-3 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => void cancel()}
                  disabled={busy}
                  className="flex h-12 flex-1 items-center justify-center rounded-xl border-2 border-[var(--brand-deep)] bg-[oklch(0.94_0.05_25)] text-lg font-bold"
                >
                  {busy ? <Loader2 className="size-5 animate-spin" /> : t("Yes, cancel it", "हाँ, रद्द करें", "Haan, cancel karein")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="hover-orange h-12 flex-1 rounded-xl border-2 border-[var(--brand-deep)] bg-card text-lg font-bold"
                >
                  {t("No, keep it", "नहीं, रहने दें", "Nahi, rehne dein")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="hover-orange w-full rounded-2xl border-2 border-[var(--color-input)] py-3.5 text-lg font-bold"
            >
              {t("Cancel this request", "यह अनुरोध रद्द करें", "Yeh request cancel karein")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Asks the server to move a request on once its hospital is overdue.
 *
 * The phone only knocks; the server decides. It knocks once when the deadline
 * passes and again every half minute while the request is still stuck, so a
 * dropped connection at the wrong moment delays the move-on by seconds, not
 * forever. Returns true while that is happening, for the screen to say so.
 */
function useMoveOnWhenOverdue(visit: Visit, waiting: boolean): boolean {
  const [moving, setMoving] = useState(false);
  const lastKnock = useRef(0);

  useEffect(() => {
    if (!waiting || !visit.respondBy) return;
    const tick = async () => {
      if (secondsLeft(visit.respondBy!) > 0) {
        setMoving(false);
        return;
      }
      setMoving(true);
      if (Date.now() - lastKnock.current < 25_000) return;
      lastKnock.current = Date.now();
      try {
        await escalateRequest(visit.id);
      } catch {
        // Still within time on the server's clock, or a blip: the next tick knocks again.
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 2000);
    return () => clearInterval(t);
  }, [visit.id, visit.respondBy, waiting]);

  return moving;
}

/** Every hospital in reach was tried and none answered. */
function Exhausted({
  attempts,
  byId,
}: {
  attempts: NonNullable<Visit["attempts"]>;
  byId: Map<string, Hospital>;
}) {
  const t = useT();
  return (
    <div className="mx-4 mt-6 rounded-3xl border-2 border-[var(--brand-deep)] bg-[var(--morning-soft)] p-5">
      <p className="text-2xl leading-tight font-bold">{t("No hospital could answer in time.", "कोई अस्पताल समय पर जवाब नहीं दे सका।", "Koi hospital time par jawab nahi de saka.")}</p>
      <p className="mt-2 text-lg leading-relaxed">
        {t(`We asked ${attempts.length} hospital${attempts.length === 1 ? "" : "s"}. Please call one of them, or try again.`, `हमने ${attempts.length} अस्पतालों से पूछा। किसी को फ़ोन करें, या फिर कोशिश करें।`, `Humne ${attempts.length} hospitals se poocha. Kisi ko phone karein, ya phir try karein.`)}
      </p>
      <ul className="mt-3 space-y-2">
        {attempts.map((a) => {
          const h = byId.get(a.hospitalId);
          return (
            <li key={a.hospitalId}>
              {h ? (
                <a
                  href={`tel:${h.phone.replace(/\s/g, "")}`}
                  className="hover-orange flex items-center gap-3 rounded-xl border-2 border-[var(--brand-deep)] bg-card px-4 py-3 text-lg font-bold"
                >
                  <Phone className="size-5 shrink-0" strokeWidth={2.6} />
                  <span className="min-w-0 flex-1">
                    {h.name}
                    <span className="block text-base font-normal">{h.phone}</span>
                  </span>
                </a>
              ) : (
                <span className="text-lg font-bold">{a.hospitalName}</span>
              )}
            </li>
          );
        })}
      </ul>
      <Link
        to="/book"
        className="hover-orange mt-4 inline-block rounded-xl border-2 border-[var(--brand-deep)] bg-[var(--brand)] px-5 py-3 text-lg font-bold shadow-[0_3px_0_var(--brand-deep)]"
      >
        {t("Try again", "फिर कोशिश करें", "Phir try karein")}
      </Link>
    </div>
  );
}
