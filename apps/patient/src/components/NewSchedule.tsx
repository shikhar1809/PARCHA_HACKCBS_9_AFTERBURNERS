/**
 * After a consultation: what the phone says, and the schedule a Parcha makes.
 *
 * The clinic's prescription is not copied onto the phone. The phone knows the
 * consultation finished, because the visit itself is the hospital's queue and
 * the family watches it; it does not know what was prescribed, and does not
 * ask. The Parcha is the printed slip in their hand, and it arrives here when
 * they add it: the QR on it carries the whole prescription, signed, so what
 * lands on the phone is the document itself rather than a copy of it that
 * could drift. That keeps the clinic's record and the family's phone apart,
 * which is the point: nothing clinical leaves the clinic unless the person
 * holding the paper brings it.
 *
 * So the prompt at the end of a visit does two things, and no more: it asks
 * how it went, while it is fresh, and it offers to add the Parcha.
 *
 * The schedule is then made from the Parcha that was added. A new medicine
 * already in their reminders (the same medicine, often at a new dose or time)
 * is a clash, and they choose what happens: use the new times (the old
 * reminder ends the day before, so its history stays), keep both, or keep the
 * current one. Nothing is replaced without asking.
 */
import { errorMessage, saveReminders, useHospitals, useReminders, type ReminderInput } from "@parcha/client";
import { applyClashChoices, clashesWith, formatClock, type ClashChoice, type Reminder, type Visit } from "@parcha/core";
import { cn } from "@parcha/ui";
import { AlertTriangle, Bell, CalendarCheck, CheckCircle2, Loader2, Pill, QrCode } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useHandset } from "../auth";
import { dateIn, useLang, useT } from "../i18n";
import { Feedback } from "./Feedback";
import { usePeople } from "./people";
import { useSavedParcha } from "./parchas";
import { Sheet } from "./records";

const seenKey = (visitId: string) => `parcha.rxSeen.${visitId}`;
const wasSeen = (visitId: string) => {
  try {
    return localStorage.getItem(seenKey(visitId)) === "1";
  } catch {
    return false;
  }
};
const markSeen = (visitId: string) => {
  try {
    localStorage.setItem(seenKey(visitId), "1");
  } catch {
    /* the prompt may come back once more; nothing is lost */
  }
};

/** The new schedule, clashes asked about, and the one button that sets it. */
export function NewSchedule({
  proposed,
  onDone,
}: {
  /** Made from the Parcha that was added, by `remindersFromPrescription`. */
  proposed: Omit<Reminder, "id">[];
  onDone: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const { handset } = useHandset();
  const existing = useReminders(handset?.phone ?? null);
  const planned = clashesWith(existing.data, proposed);
  const [choices, setChoices] = useState<Record<number, ClashChoice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clashes = planned.filter((p) => p.clash).length;

  async function set() {
    setBusy(true);
    setError(null);
    try {
      const { save, end } = applyClashChoices(planned, choices);
      const ended = end.map(({ reminder, endDate }) => ({ ...reminder, endDate }));
      const all = [...save, ...ended].slice(0, 20) as ReminderInput[];
      if (all.length) await saveReminders(all);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (existing.loading || proposed.length === 0) {
    return existing.loading ? <div className="skeleton h-40 rounded-2xl border-[3px] border-[#232326]" role="status" aria-label={t("Loading", "खुल रहा है", "Khul raha hai")} /> : null;
  }

  const CHOICES: { id: ClashChoice; label: [string, string, string] }[] = [
    { id: "replace", label: ["Use the new times", "नए समय रखें", "Naye time rakhein"] },
    { id: "both", label: ["Keep both", "दोनों रखें", "Dono rakhein"] },
    { id: "keep", label: ["Keep my current one", "पुराना ही रखें", "Purana hi rakhein"] },
  ];

  return (
    <div className="space-y-3">
      {clashes ? (
        <p className="flex items-start gap-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-3 text-base leading-snug font-bold">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          {t(
            `${clashes} of these ${clashes === 1 ? "is" : "are"} already in your reminders. Choose what to do with ${clashes === 1 ? "it" : "each"}.`,
            `इनमें से ${clashes} पहले से आपके रिमाइंडर में ${clashes === 1 ? "है" : "हैं"}। चुनें क्या करना है।`,
            `Inmein se ${clashes} pehle se aapke reminders mein ${clashes === 1 ? "hai" : "hain"}. Chunein kya karna hai.`,
          )}
        </p>
      ) : null}
      <ul className="space-y-2.5">
        {planned.map(({ reminder, clash }, i) => {
          const choice = choices[i] ?? "replace";
          return (
            <li key={i} className={cn("rounded-2xl border-[3px] border-[#232326] p-3", clash ? "bg-white" : "bg-card")}>
              <p className="flex items-center gap-2 text-lg leading-tight font-bold">
                {reminder.kind === "followup" ? <CalendarCheck className="size-5 shrink-0" aria-hidden /> : <Pill className="size-5 shrink-0" aria-hidden />}
                {reminder.title}
              </p>
              {reminder.detail ? <p className="text-sm">{reminder.detail}</p> : null}
              <p className="mt-1 text-base font-bold">
                {reminder.times.map(formatClock).join(" · ")}
                {reminder.kind === "followup"
                  ? ` · ${dateIn(lang, reminder.startDate)}`
                  : reminder.endDate
                    ? t(` · until ${dateIn(lang, reminder.endDate)}`, ` · ${dateIn(lang, reminder.endDate)} तक`, ` · ${dateIn(lang, reminder.endDate)} tak`)
                    : ""}
              </p>
              {clash ? (
                <div className="mt-2 rounded-xl border-2 border-[#232326] bg-[var(--morning-soft)] p-2.5">
                  <p className="text-sm leading-snug">
                    {t("Already in your reminders:", "पहले से रिमाइंडर में:", "Pehle se reminders mein:")} <b>{clash.title}</b> · {clash.times.map(formatClock).join(" · ")}
                  </p>
                  <div className="mt-2 grid gap-1.5" role="radiogroup" aria-label={t(`What to do with ${reminder.title}`, `${reminder.title} का क्या करें`, `${reminder.title} ka kya karein`)}>
                    {CHOICES.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={choice === c.id}
                        onClick={() => setChoices({ ...choices, [i]: c.id })}
                        className={cn("min-h-11 rounded-xl border-[3px] border-[#232326] px-3 text-left text-base font-bold", choice === c.id ? "bg-[var(--brand)] shadow-[0_2px_0_#232326]" : "bg-white")}
                      >
                        {t(...c.label)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-base font-bold text-[#b3261e]">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void set()}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-lg font-bold shadow-[0_4px_0_#232326] disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Bell className="size-5" aria-hidden />}
        {t("Set my new schedule", "मेरा नया समय लगाएँ", "Mera naya schedule lagayein")}
      </button>
    </div>
  );
}

/**
 * The prompt that comes up on its own once a consultation is finished.
 *
 * It is built from the visit alone — the stage, the hospital, the day — which
 * is all the phone has and all it needs. Two things are offered: say how it
 * went, and add the Parcha from the slip the patient is holding. Once a Parcha
 * has been added for that visit the prompt stops coming, and "Later" puts it
 * away; the Parchas tab goes on offering to add it.
 */
export function ConsultationDone({ visits }: { visits: Visit[] }) {
  const t = useT();
  const { active } = usePeople();
  const hospitals = useHospitals();
  const [closed, setClosed] = useState<string[]>([]);

  const fresh = visits
    .filter((v) => v.stage === "prescribed" && v.prescribedAt && Date.now() - new Date(v.prescribedAt).getTime() < 3 * 86400000)
    .filter((v) => !active || v.patientName === active)
    .filter((v) => !closed.includes(v.id) && !wasSeen(v.id))
    .sort((a, b) => (b.prescribedAt ?? "").localeCompare(a.prescribedAt ?? ""));
  const visit = fresh[0];
  // Already added from the paper: there is nothing left to ask them for.
  const saved = useSavedParcha(visit?.visitCode ?? null);

  if (!visit || saved.loading || saved.parcha) return null;
  const hospital = hospitals.data.find((h) => h.id === visit.hospitalId)?.name;
  const close = () => {
    markSeen(visit.id);
    setClosed((c) => [...c, visit.id]);
  };

  return (
    <Sheet title={t("Consultation finished", "जाँच पूरी हुई", "Consultation poora hua")} onClose={close}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-3.5">
          <CheckCircle2 className="mt-0.5 size-7 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-lg leading-tight font-bold">
              {t("The doctor has signed your Parcha", "डॉक्टर ने आपका पर्चा साइन कर दिया", "Doctor ne aapka Parcha sign kar diya")}
            </p>
            <p className="text-base">{[visit.patientName, hospital].filter(Boolean).join(" · ")}</p>
          </div>
        </div>

        {/* Asked while it is fresh. It is the one thing the hospital hears back. */}
        <Feedback visit={visit} />

        <Link
          to="/scan"
          onClick={close}
          className="flex items-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-white p-3.5 shadow-[0_3px_0_#232326]"
        >
          <QrCode className="size-7 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block text-lg leading-tight font-bold">
              {t("Add your Parcha", "अपना पर्चा जोड़ें", "Apna Parcha jodein")}
            </span>
            <span className="block text-sm leading-snug">
              {t(
                "Scan the square code printed on your slip. The medicines and their times come from the slip itself, so nothing can be written down wrong.",
                "पर्चे पर छपे चौकोर कोड को स्कैन कीजिए। दवाइयाँ और उनका समय पर्चे से ही आते हैं, इसलिए ग़लती की गुंजाइश नहीं।",
                "Parche par chhape chaukor code ko scan kijiye. Dawaiyan aur unka time parche se hi aate hain, isliye galti ki gunjaish nahi.",
              )}
            </span>
          </span>
        </Link>

        <button type="button" onClick={close} className="min-h-11 w-full text-center text-base font-bold underline">
          {t("Later", "बाद में", "Baad mein")}
        </button>
      </div>
    </Sheet>
  );
}
