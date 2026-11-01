import { deleteReminder, errorMessage, saveReminders, type ReminderInput } from "@parcha/client";
import {
  addCalendarDays,
  toDateString,
  type Reminder,
  type ReminderKind,
} from "@parcha/core";
import { Bell, CalendarCheck, Loader2, Lock, Pencil, Pill, Plus, Stethoscope, Trash2, X, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Avatar } from "./art";
import { Sheet } from "./records";
import { clockIn, tr, useLang, useT, type Lang } from "../i18n";

export const REMINDER_KINDS: { id: ReminderKind; label: [string, string, string]; icon: LucideIcon }[] = [
  { id: "medicine", label: ["Medicine", "दवा", "Dawai"], icon: Pill },
  { id: "appointment", label: ["Appointment", "विज़िट", "Visit"], icon: CalendarCheck },
  { id: "followup", label: ["Check-up", "जाँच", "Check-up"], icon: Stethoscope },
  { id: "other", label: ["Other", "और कुछ", "Aur kuch"], icon: Bell },
];

export const kindIcon = (k: ReminderKind) => (REMINDER_KINDS.find((x) => x.id === k) ?? REMINDER_KINDS[3]).icon;

const WEEKDAYS: Record<Lang, string[]> = {
  en: ["S", "M", "T", "W", "T", "F", "S"],
  hi: ["र", "सो", "मं", "बु", "गु", "शु", "श"],
  hg: ["Ra", "So", "Ma", "Bu", "Gu", "Shu", "Sha"],
};
const WEEKDAY_NAMES: Record<Lang, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  hi: ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"],
  hg: ["Ravivaar", "Somvaar", "Mangalvaar", "Budhvaar", "Guruvaar", "Shukravaar", "Shanivaar"],
};
const DURATIONS: { days: number | null }[] = [{ days: 1 }, { days: 3 }, { days: 5 }, { days: 7 }, { days: 30 }, { days: null }];
const durationLabel = (lang: Lang, days: number | null) =>
  days === null ? tr(lang, "No end", "कोई अंत नहीं", "Koi end nahi") : tr(lang, `${days} day${days === 1 ? "" : "s"}`, `${days} दिन`, `${days} din`);

const field =
  "h-12 w-full rounded-xl border-[3px] border-[#232326] bg-card px-3 text-base outline-none focus:bg-[var(--hover-soft)]";

/** "8 am, 9 pm" */
export const timesLabel = (lang: Lang, times: string[]) => times.map((x) => clockIn(lang, x)).join(", ");

/** "Every day", "Mon, Wed", "for 5 days": what a reminder repeats, in words. */
export function repeatLabel(lang: Lang, r: Pick<Reminder, "days" | "startDate" | "endDate">): string {
  const names = WEEKDAY_NAMES[lang].map((n) => n.slice(0, lang === "en" ? 3 : n.length));
  const days = r.days.length === 0 || r.days.length === 7 ? tr(lang, "Every day", "रोज़", "Roz") : r.days.map((d) => names[d]).join(", ");
  if (!r.endDate) return days;
  const span = Math.round((new Date(r.endDate).getTime() - new Date(r.startDate).getTime()) / 86400000) + 1;
  return span <= 1 ? tr(lang, "One day", "एक दिन", "Ek din") : `${days} · ${tr(lang, `${span} days`, `${span} दिन`, `${span} din`)}`;
}

/** Make or change a reminder. */
export function EditReminder({
  people,
  existing,
  defaultPerson,
  onClose,
}: {
  people: string[];
  existing?: Reminder;
  defaultPerson: string;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const today = toDateString(new Date());
  const [kind, setKind] = useState<ReminderKind>(existing?.kind ?? "medicine");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [person, setPerson] = useState(existing?.personName ?? defaultPerson);
  const [times, setTimes] = useState<string[]>(existing?.times ?? ["09:00"]);
  const [days, setDays] = useState<number[]>(existing?.days ?? []);
  const [startDate, setStartDate] = useState(existing?.startDate ?? today);
  const [duration, setDuration] = useState<number | null | "custom">(() => {
    if (!existing) return 5;
    if (!existing.endDate) return null;
    const span = Math.round((new Date(existing.endDate).getTime() - new Date(existing.startDate).getTime()) / 86400000) + 1;
    return DURATIONS.some((d) => d.days === span) ? span : "custom";
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setTime = (i: number, v: string) => setTimes((t) => t.map((x, j) => (j === i ? v : x)));
  const valid = title.trim().length > 0 && times.every((t) => /^\d\d:\d\d$/.test(t)) && times.length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const endDate =
        duration === "custom" ? (existing?.endDate ?? null) : duration === null ? null : addCalendarDays(startDate, duration - 1);
      const input: ReminderInput = {
        id: existing?.id,
        personName: person,
        kind,
        title: title.trim(),
        detail: existing?.detail ?? null,
        times: [...new Set(times)].sort(),
        days,
        startDate,
        endDate,
        enabled: existing?.enabled ?? true,
        source: existing?.source ?? null,
      };
      await saveReminders([input]);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Sheet title={existing ? t("Change reminder", "रिमाइंडर बदलें", "Reminder badlein") : t("New reminder", "नया रिमाइंडर", "Naya reminder")} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-2">
          {REMINDER_KINDS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={kind === id}
              onClick={() => setKind(id)}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border-[3px] border-[#232326] px-1 text-center text-sm leading-tight font-bold ${
                kind === id ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card"
              }`}
            >
              <Icon className="size-5" aria-hidden />
              {t(...label)}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1 block text-base font-bold">{t("What for?", "किसके लिए?", "Kis cheez ke liye?")}</span>
          <input
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "medicine" ? t("Medicine name", "दवा का नाम", "Dawai ka naam") : kind === "appointment" ? t("Visit to Dr. Khan", "डॉ. ख़ान के पास विज़िट", "Dr. Khan ke paas visit") : t("What to remember", "क्या याद रखना है", "Kya yaad rakhna hai")}
            className={field}
          />
        </label>

        {people.length > 1 ? (
          <div>
            <p className="mb-1 text-base font-bold">{t("For whom?", "किसके लिए?", "Kiske liye?")}</p>
            <div className="flex flex-wrap gap-2">
              {people.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={p === person}
                  onClick={() => setPerson(p)}
                  className={`flex min-h-11 items-center gap-1.5 rounded-full border-[3px] border-[#232326] py-0.5 pr-3 pl-0.5 text-base font-bold ${
                    p === person ? "bg-[var(--brand-soft)]" : "bg-card"
                  }`}
                >
                  <Avatar name={p} size={26} />
                  {p.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-1 text-base font-bold">{t("At what time?", "किस समय?", "Kis time?")}</p>
          <div className="space-y-2">
            {times.map((x, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="time"
                  value={x}
                  aria-label={t(`Time ${i + 1}`, `समय ${i + 1}`, `Time ${i + 1}`)}
                  onChange={(e) => setTime(i, e.target.value)}
                  className={field}
                />
                {times.length > 1 ? (
                  <button
                    type="button"
                    aria-label={t("Remove this time", "यह समय हटाएँ", "Yeh time hatayein")}
                    onClick={() => setTimes((x) => x.filter((_, j) => j !== i))}
                    className="flex size-12 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-card"
                  >
                    <X className="size-5" aria-hidden />
                  </button>
                ) : null}
              </div>
            ))}
            {times.length < 6 ? (
              <button
                type="button"
                onClick={() => setTimes((x) => [...x, "14:00"])}
                className="flex min-h-12 items-center gap-1.5 rounded-xl border-[3px] border-dashed border-[#232326] px-3 text-base font-bold"
              >
                <Plus className="size-4" aria-hidden /> {t("Another time", "एक और समय", "Ek aur time")}
              </button>
            ) : null}
          </div>
        </div>

        <div>
          <p className="mb-1 text-base font-bold">{t("Which days?", "कौन से दिन?", "Kaun se din?")}</p>
          <div className="grid grid-cols-8 gap-1.5">
            <button
              type="button"
              aria-pressed={days.length === 0}
              onClick={() => setDays([])}
              className={`col-span-2 min-h-11 rounded-full border-[3px] border-[#232326] text-sm font-bold ${days.length === 0 ? "bg-[var(--brand)]" : "bg-card"}`}
            >
              {t("Daily", "रोज़", "Roz")}
            </button>
            {WEEKDAYS[lang].map((w, d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-label={WEEKDAY_NAMES[lang][d]}
                  aria-pressed={on}
                  onClick={() => setDays((x) => (on ? x.filter((y) => y !== d) : [...x, d].sort()))}
                  className={`min-h-11 rounded-full border-[3px] border-[#232326] text-sm font-bold ${on ? "bg-[var(--brand)]" : "bg-card"}`}
                >
                  {w}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-1 text-base font-bold">{t("For how long?", "कितने दिन?", "Kitne din?")}</p>
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button
                key={String(d.days)}
                type="button"
                aria-pressed={duration === d.days}
                onClick={() => setDuration(d.days)}
                className={`min-h-11 rounded-full border-[3px] border-[#232326] px-3 py-1.5 text-base font-bold ${duration === d.days ? "bg-[var(--brand-soft)]" : "bg-card"}`}
              >
                {durationLabel(lang, d.days)}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-base font-bold">{t("Starting", "कब से", "Kab se")}</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
        </label>

        {error ? (
          <p role="alert" className="text-base font-bold text-[#b3261e]">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void save()}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-lg font-bold shadow-[0_4px_0_#232326] disabled:opacity-45"
        >
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
          {busy ? t("Saving…", "सहेज रहे हैं…", "Save ho raha hai…") : t("Save reminder", "रिमाइंडर सहेजें", "Reminder save karein")}
        </button>
      </div>
    </Sheet>
  );
}

/** Every reminder, to switch off, change or delete. */
export function ManageReminders({
  reminders,
  people,
  onEdit,
  onClose,
}: {
  reminders: Reminder[];
  people: string[];
  onEdit: (r: Reminder) => void;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet title={t("My reminders", "मेरे रिमाइंडर", "Mere reminders")} onClose={onClose}>
      {error ? (
        <p role="alert" className="mb-3 text-base font-bold text-[#b3261e]">
          {error}
        </p>
      ) : null}
      {reminders.length === 0 ? (
        <p className="py-10 text-center text-lg">{t("No reminders yet.", "अभी कोई रिमाइंडर नहीं।", "Abhi koi reminder nahi.")}</p>
      ) : (
        <ul className="stagger space-y-2.5">
          {reminders.map((r) => {
            const Icon = kindIcon(r.kind);
            return (
              <li key={r.id} className="rounded-2xl border-[3px] border-[#232326] bg-card p-3 shadow-[0_3px_0_#232326]">
                <div className="flex items-start gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border-2 border-[#232326] bg-[var(--brand-soft)]">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-base leading-tight font-bold ${r.enabled ? "" : "opacity-50"}`}>{r.title}</p>
                    <p className="text-base">
                      {timesLabel(lang, r.times)} · {repeatLabel(lang, r)}
                    </p>
                    {people.length > 1 ? <p className="text-base">{r.personName}</p> : null}
                  </div>
                  {r.locked ? (
                    <span aria-label={t("Locked", "लॉक है", "Locked hai")} className="flex size-9 shrink-0 items-center justify-center rounded-xl border-2 border-[#232326] bg-white">
                      <Lock className="size-5" aria-hidden />
                    </span>
                  ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={r.enabled}
                    aria-label={r.enabled ? t("Switch off", "बंद करें", "Band karein") : t("Switch on", "चालू करें", "Chalu karein")}
                    disabled={busy === r.id}
                    onClick={() =>
                      void run(r.id, () =>
                        saveReminders([{ ...r, enabled: !r.enabled }]),
                      )
                    }
                    className={`relative h-8 w-14 shrink-0 rounded-full border-[3px] border-[#232326] ${r.enabled ? "bg-[var(--brand)]" : "bg-white"}`}
                  >
                    <span
                      className="absolute top-0.5 size-5 rounded-full border-2 border-[#232326] bg-white"
                      style={{ left: r.enabled ? "1.6rem" : "0.15rem", transition: "left 200ms var(--ease-spring)" }}
                    />
                  </button>
                  )}
                </div>
                {/* A checked schedule is not changed by hand: a newer Parcha replaces it. */}
                {r.locked ? (
                  <p className="mt-2.5 rounded-xl border-2 border-[#232326] bg-[var(--brand-soft)] p-2.5 text-base leading-snug">
                    {t(
                      "Checked and locked. To change it, add the new Parcha.",
                      "जाँचा हुआ और लॉक। बदलने के लिए नया पर्चा जोड़ें।",
                      "Jaancha hua aur locked. Badalne ke liye naya Parcha jodein.",
                    )}
                  </p>
                ) : (
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(r)}
                    className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border-[3px] border-[#232326] bg-card text-base font-bold"
                  >
                    <Pencil className="size-4" aria-hidden /> {t("Change", "बदलें", "Badlein")}
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void run(r.id, () => deleteReminder(r.id))}
                    className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border-[3px] border-[#232326] bg-[oklch(0.94_0.05_25)] text-base font-bold"
                  >
                    <Trash2 className="size-4" aria-hidden /> {t("Delete", "मिटाएँ", "Mitayein")}
                  </button>
                </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
