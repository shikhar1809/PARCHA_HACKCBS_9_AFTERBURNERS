/**
 * The family on one screen: how each of them is doing with today's medicines,
 * and what has happened — Dadi took her 8 o'clock tablet, Dadi's 9 pm one is
 * late, Dadi left a voice message.
 *
 * It is for looking, not for answering. A dose is ticked only by the person
 * who takes it, from their own name (see DoseCards), so nothing here has a
 * Taken button. What it can do is let Prashant hear his mother's message and
 * see, at a glance, whether she has had her medicine.
 *
 * Everything comes from what the family's phones already record: the dose
 * ticks and the messages. "Late" means past its time and not ticked — which
 * may mean taken and not ticked, and the words say "not ticked", not
 * "missed", for exactly that reason.
 */
import { useDoseLog, useFamilyMessages, useRecentDoseLogs, useReminders } from "@parcha/client";
import { dosesOn, minutesSince, toDateString, type Dose } from "@parcha/core";
import { cn } from "@parcha/ui";
import { Check, ChevronDown, Clock, Mic, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { useHandset } from "../auth";
import { clockIn, useLang, useT } from "../i18n";
import { useNow } from "./alerts";
import { Avatar } from "./art";
import { usePeople } from "./people";
import { useStrip } from "./strips";
import { PlayMessage } from "./VoiceMessage";

/** A dose this long past its time, unticked, is called late. */
const LATE_AFTER_MINUTES = 30;

type Event =
  | { kind: "taken"; at: string; person: string; title: string }
  | { kind: "late"; at: string; person: string; title: string; time: string }
  | { kind: "message"; at: string; person: string; id: string };

export function FamilyOverview() {
  const t = useT();
  const lang = useLang();
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const now = useNow(30_000);
  const today = toDateString(now);
  const reminders = useReminders(phone);
  const log = useDoseLog(phone, today);
  const logs = useRecentDoseLogs(phone);
  const messages = useFamilyMessages(phone);
  const { people, active } = usePeople();
  const [open, setOpen] = useState<string | null>(null);

  const taken = log.data?.taken ?? {};
  const todays = dosesOn(reminders.data, today).filter((d) => d.reminder.kind === "medicine");
  const shown = (name: string) => people.find((p) => p.name === name)?.shown ?? name.split(" ")[0];
  const isLate = (d: Dose) => !(d.key in taken) && minutesSince(d.time, now) > LATE_AFTER_MINUTES;

  // What happened, newest first: ticks today and yesterday, late doses, messages.
  const byId = new Map(reminders.data.map((r) => [r.id, r]));
  const events: Event[] = [];
  const yesterday = toDateString(new Date(now.getTime() - 86_400_000));
  for (const day of logs.data.filter((l) => l.date === today || l.date === yesterday)) {
    const ticks = day.date === today ? { ...day.taken, ...taken } : day.taken;
    for (const [key, at] of Object.entries(ticks)) {
      const r = byId.get(key.split("@")[0]);
      if (r) events.push({ kind: "taken", at, person: r.personName, title: r.title });
    }
  }
  if (!logs.data.some((l) => l.date === today)) {
    for (const [key, at] of Object.entries(taken)) {
      const r = byId.get(key.split("@")[0]);
      if (r) events.push({ kind: "taken", at, person: r.personName, title: r.title });
    }
  }
  for (const d of todays.filter(isLate)) {
    const [h, m] = d.time.split(":").map(Number);
    const at = new Date(now);
    at.setHours(h, m + LATE_AFTER_MINUTES, 0, 0);
    events.push({ kind: "late", at: at.toISOString(), person: d.reminder.personName, title: d.reminder.title, time: d.time });
  }
  for (const m of messages.data.slice(0, 10)) events.push({ kind: "message", at: m.sentAt, person: m.from, id: m.id });
  events.sort((a, b) => b.at.localeCompare(a.at));
  const unheard = messages.data.filter((m) => active && m.from !== active && !m.heardBy.includes(active)).length;

  const timeOf = (iso: string) => {
    const d = new Date(iso);
    const day = toDateString(d) === today ? "" : t("Yesterday · ", "कल · ", "Kal · ");
    return day + clockIn(lang, `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
  };

  const family = people.filter((p) => todays.some((d) => d.reminder.personName === p.name) || p.name !== active);
  if (people.length < 2 && events.length === 0) return null;

  return (
    <section className="space-y-3" aria-label={t("Family", "परिवार", "Parivaar")}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-bold">{t("Family today", "आज परिवार", "Aaj parivaar")}</h2>
        {unheard ? (
          <span className="rounded-full border-2 border-[#232326] bg-[var(--brand)] px-2.5 py-0.5 text-sm font-bold">
            {t(`${unheard} new message${unheard === 1 ? "" : "s"}`, `${unheard} नया संदेश`, `${unheard} naya sandesh`)}
          </span>
        ) : null}
      </div>

      <ul className="space-y-2">
        {family.map((p) => {
          const theirs = todays.filter((d) => d.reminder.personName === p.name);
          const done = theirs.filter((d) => d.key in taken).length;
          const late = theirs.filter(isLate).length;
          const next = theirs.find((d) => !(d.key in taken) && minutesSince(d.time, now) < 0);
          const expanded = open === p.name;
          return (
            <li key={p.name} className="rounded-2xl border-[3px] border-[#232326] bg-card shadow-[0_3px_0_#232326]">
              <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.name)} className="flex w-full items-center gap-3 p-3 text-left">
                <Avatar name={p.name} sex={p.sex} age={p.ageYears} look={p.look} size={46} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg leading-tight font-bold">
                    {p.shown}
                    {p.name === active ? <span className="text-sm font-normal"> · {t("you", "आप", "aap")}</span> : null}
                  </span>
                  <span className="block text-base">
                    {theirs.length === 0
                      ? t("No medicines today", "आज कोई दवा नहीं", "Aaj koi dawai nahi")
                      : t(`${done} of ${theirs.length} ticked`, `${theirs.length} में से ${done} ली`, `${theirs.length} mein se ${done} li`)}
                    {late ? <b className="text-[#b3261e]"> · {t(`${late} late`, `${late} देर से`, `${late} late`)}</b> : null}
                    {!late && next ? ` · ${t("next", "अगली", "agli")} ${clockIn(lang, next.time)}` : null}
                  </span>
                  {theirs.length ? (
                    <span className="mt-1.5 flex gap-1" aria-hidden>
                      {theirs.map((d) => (
                        <span key={d.key} className={cn("h-2.5 flex-1 rounded-full border-2 border-[#232326]", d.key in taken ? "bg-[#2e9e5b]" : isLate(d) ? "bg-[#f08a7e]" : "bg-white")} />
                      ))}
                    </span>
                  ) : null}
                </span>
                <ChevronDown className={cn("size-6 shrink-0 transition-transform", expanded && "rotate-180")} aria-hidden />
              </button>
              {expanded && theirs.length ? (
                <ul className="space-y-1.5 border-t-2 border-[#232326] p-3">
                  {theirs.map((d) => (
                    <DoseLine key={d.key} dose={d} takenAt={(taken as Record<string, string>)[d.key]} late={isLate(d)} />
                  ))}
                  {p.name !== active ? (
                    <li className="pt-1 text-sm">{t(`Only ${p.shown} can tick these, from their own name.`, `इन्हें सिर्फ़ ${p.shown} अपने नाम से टिक कर सकते हैं।`, `Inhein sirf ${p.shown} apne naam se tick kar sakte hain.`)}</li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      {events.length ? (
        <div className="rounded-2xl border-[3px] border-[#232326] bg-white p-3">
          <p className="mb-2 text-base font-bold">{t("What happened", "क्या हुआ", "Kya hua")}</p>
          <ol className="space-y-2">
            {events.slice(0, 12).map((e, i) => {
              const msg = e.kind === "message" ? messages.data.find((m) => m.id === e.id) : undefined;
              return (
                <li key={i} className="flex items-center gap-2.5">
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-[#232326]", e.kind === "taken" ? "bg-[#c9f2d8]" : e.kind === "late" ? "bg-[oklch(0.92_0.06_25)]" : "bg-[var(--brand)]")}>
                    {e.kind === "taken" ? <Check className="size-5" strokeWidth={3} aria-hidden /> : e.kind === "late" ? <TriangleAlert className="size-5" aria-hidden /> : <Mic className="size-5" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 text-base leading-snug">
                    <b>{shown(e.person)}</b>{" "}
                    {e.kind === "taken"
                      ? t(`took ${e.title}`, `ने ${e.title} ली`, `ne ${e.title} li`)
                      : e.kind === "late"
                        ? t(`has not ticked ${e.title} (${clockIn(lang, e.time)})`, `ने ${e.title} (${clockIn(lang, e.time)}) टिक नहीं की`, `ne ${e.title} (${clockIn(lang, e.time)}) tick nahi ki`)
                        : msg?.via === "call"
                          ? t("left a voice message from the reminder call", "ने रिमाइंडर कॉल से संदेश भेजा", "ne reminder call se sandesh bheja")
                          : t("sent a voice message", "ने संदेश भेजा", "ne sandesh bheja")}
                    <span className="block text-sm">{e.kind === "late" ? clockIn(lang, e.time) : timeOf(e.at)}</span>
                  </span>
                  {msg ? <PlayMessage message={msg} by={active} /> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function DoseLine({ dose, takenAt, late }: { dose: Dose; takenAt?: string; late: boolean }) {
  const t = useT();
  const lang = useLang();
  const strip = useStrip(dose.reminder.title);
  return (
    <li className="flex items-center gap-2.5">
      <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-[#232326] bg-white">
        {strip?.front ? <img src={strip.front} alt="" className="size-full object-cover" /> : <Clock className="size-5" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-bold">{dose.reminder.title}</span>
        <span className="block text-sm">{clockIn(lang, dose.time)}</span>
      </span>
      <span className={cn("rounded-full border-2 border-[#232326] px-2 py-0.5 text-sm font-bold", takenAt ? "bg-[#c9f2d8]" : late ? "bg-[oklch(0.92_0.06_25)]" : "bg-white")}>
        {takenAt
          ? t(`Taken ${clockIn(lang, `${String(new Date(takenAt).getHours()).padStart(2, "0")}:${String(new Date(takenAt).getMinutes()).padStart(2, "0")}`)}`, "ले ली", "Le li")
          : late
            ? t("Not ticked", "टिक नहीं", "Tick nahi")
            : t("Later", "बाद में", "Baad mein")}
      </span>
    </li>
  );
}
