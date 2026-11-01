import {
  errorMessage,
  markDose,
  useDoseLog,
  useReminders,
} from "@parcha/client";
import {
  addCalendarDays,
  dayPart,
  dosesOn,
  minutesSince,
  toDateString,
  type Dose,
  type Reminder,
} from "@parcha/core";
import { Screen } from "@parcha/ui";
import { Bell, BellOff, Check, ListChecks, Loader2, PhoneCall, Pill, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useHandset } from "../auth";
import { Avatar, CalendarArt, PillsArt } from "../components/art";
import { CallReminders } from "../components/calls";
import { askForCallScreen, callScreenAvailable, callScreenReach, ringForDose } from "../components/callScreen";
import { usePeople } from "../components/people";
import { EditReminder, ManageReminders, kindIcon } from "../components/reminders";
import { Sheet } from "../components/records";
import { Header } from "../kit";
import { alertsOn, setAlerts, useNow } from "../components/alerts";
import { isNative } from "../components/native";
import { clockIn, dateIn, dayIn, tr, useLang, useT, type Lang } from "../i18n";

const PARTS = ["Morning", "Afternoon", "Evening", "Night"] as const;
const PART_WORDS: Record<(typeof PARTS)[number], [string, string, string]> = {
  Morning: ["Morning", "सुबह", "Subah"],
  Afternoon: ["Afternoon", "दोपहर", "Dopahar"],
  Evening: ["Evening", "शाम", "Shaam"],
  Night: ["Night", "रात", "Raat"],
};

const dayLabel = (lang: Lang, date: string, today: string) => {
  if (date === today) return tr(lang, "Today", "आज", "Aaj");
  if (date === addCalendarDays(today, 1)) return tr(lang, "Tomorrow", "कल", "Kal");
  if (date === addCalendarDays(today, -1)) return tr(lang, "Yesterday", "बीता कल", "Kal (beeta)");
  const d = new Date(date + "T00:00");
  return `${dayIn(lang, d)} ${dateIn(lang, d, false)}`;
};

/** A little ring: how much of the day's doses are done. */
function Ring({ done, total }: { done: number; total: number }) {
  const t = useT();
  const r = 20;
  const c = 2 * Math.PI * r;
  const pct = total === 0 ? 0 : done / total;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={t(`${done} of ${total} taken`, `${total} में से ${done} लीं`, `${total} mein se ${done} li`)}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="#232326" strokeOpacity=".15" strokeWidth="7" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke={pct === 1 ? "#2e9e5b" : "#ff7f5a"}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 28 28)"
        style={{ transition: "stroke-dashoffset 600ms var(--ease-out), stroke 300ms" }}
      />
      <text x="28" y="33" textAnchor="middle" fontSize="15" fontWeight="700" fill="#232326">
        {done}/{total}
      </text>
    </svg>
  );
}

/**
 * The day, hour by hour: medicines to take (tick them as you go) and check-ups.
 * A strip of days along the top, a ring for how the day is going, and every
 * reminder managed from here.
 */
export function Schedule() {
  const t = useT();
  const lang = useLang();
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const now = useNow(20_000);
  const today = toDateString(now);

  const [date, setDate] = useState(today);
  // On a shared phone the schedule opens on whoever is using it.
  const { active } = usePeople();
  const [picked, setPerson] = useState<string | null>(null);
  // The person using the phone, once chosen, is the only one shown.
  const person = active ?? picked;
  const [sheet, setSheet] = useState<null | { kind: "new" } | { kind: "edit"; r: Reminder } | { kind: "manage" } | { kind: "calls" }>(null);
  const [alerts, setAlertsState] = useState(alertsOn());
  const [callNote, setCallNote] = useState<string | null>(null);
  const [alertNote, setAlertNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  // Keep "today" honest if the screen is left open past midnight.
  useEffect(() => {
    setDate((d) => (d < addCalendarDays(today, -2) ? today : d));
  }, [today]);

  const reminders = useReminders(phone);
  const log = useDoseLog(phone, date);

  const people = useMemo(() => [...new Set(reminders.data.map((r) => r.personName))], [reminders.data]);
  const mine = person ? reminders.data.filter((r) => r.personName === person) : reminders.data;
  const doses = dosesOn(mine, date);
  const taken = log.data?.taken ?? {};
  const isTaken = (d: Dose) => d.key in taken;

  const doneCount = doses.filter(isTaken).length;
  const upNext = date === today ? doses.find((d) => !isTaken(d) && minutesSince(d.time, now) < 30) : undefined;

  const strip = Array.from({ length: 7 }, (_, i) => addCalendarDays(today, i - 1));
  const hasItems = (d: string) => dosesOn(reminders.data, d).length > 0;

  async function toggle(d: Dose) {
    if (pending.has(d.key)) return;
    setPending((p) => new Set(p).add(d.key));
    setError(null);
    try {
      await markDose(date, d.key, !isTaken(d));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(d.key);
        return n;
      });
    }
  }

  /**
   * Rings this phone for one dose, now: the whole screen, like a call. It is
   * this phone's own alarm, not a telephone call, and the note says so the
   * first time Android will only allow it while Parcha is open.
   */
  async function ring(d: Dose) {
    setCallNote(null);
    const reach = await callScreenReach();
    const { rang } = await ringForDose(d, date, lang);
    if (!rang) {
      setCallNote(t("This phone cannot show a call screen.", "यह फ़ोन कॉल स्क्रीन नहीं दिखा सकता।", "Yeh phone call screen nahi dikha sakta."));
      return;
    }
    if (reach === "open") {
      setCallNote(
        t(
          "Android allows this only while Parcha is open. Allow full-screen reminders to let it ring on a locked phone.",
          "Android अभी यह सिर्फ़ पर्चा खुला रहने पर दिखाने देता है। बंद फ़ोन पर बजाने के लिए फ़ुल-स्क्रीन रिमाइंडर की अनुमति दें।",
          "Android abhi yeh sirf Parcha khula rehne par dikhane deta hai. Band phone par bajane ke liye full-screen reminder ki ijazat dein.",
        ),
      );
    }
  }

  async function toggleAlerts() {
    setAlertNote(null);
    const result = await setAlerts(!alerts);
    setAlertsState(result.on);
    if (result.note) setAlertNote(result.note);
  }

  const groups = PARTS.map((part) => ({ part, items: doses.filter((d) => dayPart(d.time) === part) })).filter((g) => g.items.length > 0);

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-4 pt-4 pb-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl leading-tight font-bold">{t("Medicines", "दवाई", "Dawai")}</h1>
          <p className="text-base font-bold">{dayLabel(lang, date, today)}</p>
        </div>
        <button
          type="button"
          aria-pressed={alerts}
          aria-label={alerts ? t("Alerts are on", "सूचना चालू है", "Alerts chalu hain") : t("Turn alerts on", "सूचना चालू करें", "Alerts chalu karein")}
          onClick={() => void toggleAlerts()}
          className={`flex size-12 items-center justify-center rounded-full border-[3px] border-[#232326] shadow-[0_2px_0_#232326] ${alerts ? "bg-[var(--brand)]" : "bg-card"}`}
        >
          {alerts ? <Bell className="size-5" aria-hidden /> : <BellOff className="size-5" aria-hidden />}
        </button>
        <button
          type="button"
          aria-label={t("Phone call reminders", "फ़ोन कॉल से याद", "Phone call reminders")}
          onClick={() => setSheet({ kind: "calls" })}
          className="flex size-12 items-center justify-center rounded-full border-[3px] border-[#232326] bg-card shadow-[0_2px_0_#232326]"
        >
          <PhoneCall className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("All reminders", "सारे रिमाइंडर", "Saare reminders")}
          onClick={() => setSheet({ kind: "manage" })}
          className="flex size-12 items-center justify-center rounded-full border-[3px] border-[#232326] bg-card shadow-[0_2px_0_#232326]"
        >
          <ListChecks className="size-5" aria-hidden />
        </button>
      </header>

      <div className="flex shrink-0 gap-1.5 px-4 pb-2" role="tablist" aria-label={t("Day", "दिन", "Din")}>
        {strip.map((d) => {
          const on = d === date;
          const dt = new Date(d + "T00:00");
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setDate(d)}
              className={`relative flex min-w-0 flex-1 flex-col items-center rounded-xl border-[3px] border-[#232326] py-1 ${on ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card"}`}
            >
              <span className="text-sm leading-tight font-bold">{dayIn(lang, dt)}</span>
              <span className="text-lg leading-none font-bold">{dt.getDate()}</span>
              <span aria-hidden className={`mt-0.5 size-1.5 rounded-full ${hasItems(d) ? "bg-[#232326]" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>

      {people.length > 1 && !active ? (
        <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-2" aria-label={t("Who", "कौन", "Kaun")}>
          {[null, ...people].map((p) => (
            <button
              key={p ?? "all"}
              type="button"
              aria-pressed={person === p}
              onClick={() => setPerson(p)}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-[3px] border-[#232326] py-0.5 pr-3 text-base font-bold ${p ? "pl-0.5" : "pl-3"} ${person === p ? "bg-[var(--brand-soft)]" : "bg-card"}`}
            >
              {p ? <Avatar name={p} size={26} /> : null}
              {p ? p.split(" ")[0] : t("Everyone", "सब", "Sab")}
            </button>
          ))}
        </div>
      ) : null}

      <Screen className="space-y-3 px-4 pb-4">
        {callNote ? (
          <button
            type="button"
            onClick={() => void askForCallScreen()}
            role="status"
            className="w-full rounded-xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-2.5 text-left text-base font-bold"
          >
            {callNote}
          </button>
        ) : null}

        {alertNote ? (
          <p role="status" className="rounded-xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-2.5 text-base font-bold">
            {alertNote}
          </p>
        ) : alerts ? (
          <p className="text-center text-sm">
            {isNative
              ? t("Reminders ring on this phone even when Parcha is closed.", "पर्चा बंद होने पर भी इस फ़ोन पर रिमाइंडर बजेंगे।", "Parcha band hone par bhi is phone par reminders bajenge.")
              : t("Alerts appear on this phone while Parcha is open.", "पर्चा खुला रहने पर इस फ़ोन पर सूचना आएगी।", "Parcha khula rehne par is phone par alerts aayenge.")}
          </p>
        ) : null}

        {doses.length > 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-card p-3 shadow-[0_3px_0_#232326]">
            <Ring done={doneCount} total={doses.length} />
            <div className="min-w-0 flex-1">
              <p className="text-base leading-tight font-bold">
                {doneCount === doses.length
                  ? t("All done for the day", "आज की सारी दवा हो गई", "Aaj ki saari dawai ho gayi")
                  : t(`${doses.length - doneCount} still to take`, `${doses.length - doneCount} अभी लेनी हैं`, `${doses.length - doneCount} abhi leni hain`)}
              </p>
              <p className="line-clamp-2 text-base">
                {upNext
                  ? t(`Next: ${upNext.reminder.title} at ${clockIn(lang, upNext.time)}`, `अगली: ${upNext.reminder.title}, ${clockIn(lang, upNext.time)}`, `Agli: ${upNext.reminder.title}, ${clockIn(lang, upNext.time)}`)
                  : doneCount === doses.length
                    ? t("Well done.", "बहुत अच्छा।", "Bahut achha.")
                    : t("Tap a medicine when you take it.", "दवा लेते ही उसे छुएँ।", "Dawai lete hi use tap karein.")}
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-base font-bold text-[#b3261e]">
            {error}
          </p>
        ) : null}

        {reminders.loading ? (
          <div className="space-y-2.5" role="status" aria-label={t("Loading", "खुल रहा है", "Khul raha hai")}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16 rounded-2xl border-[3px] border-[#232326]" />
            ))}
          </div>
        ) : doses.length === 0 ? (
          <div className="pop flex flex-col items-center px-2 py-4 text-center">
            {reminders.data.length === 0 ? <PillsArt size={104} /> : <CalendarArt size={104} />}
            <p className="text-lg font-bold">
              {reminders.data.length === 0 ? t("No reminders yet", "अभी कोई रिमाइंडर नहीं", "Abhi koi reminder nahi") : t("Nothing on this day", "इस दिन कुछ नहीं", "Is din kuch nahi")}
            </p>
            <p className="max-w-72 text-base">
              {reminders.data.length === 0
                ? t("Add your medicines and check-ups, and tick them off as you go.", "अपनी दवा और जाँच जोड़ें, और लेते जाएँ तो टिक करें।", "Apni dawai aur check-up jodein, aur lete jaayein to tick karein.")
                : t("Pick another day, or add a reminder.", "दूसरा दिन चुनें, या रिमाइंडर जोड़ें।", "Doosra din chunein, ya reminder jodein.")}
            </p>
          </div>
        ) : (
          <div key={date + (person ?? "")} className="stagger space-y-3">
            {groups.map(({ part, items }) => (
              <section key={part}>
                <p className="mb-1.5 text-base font-bold">{t(...PART_WORDS[part])}</p>
                <ul className="space-y-2">
                  {items.map((d) => {
                    const done = isTaken(d);
                    const late = date === today && !done && minutesSince(d.time, now) > 30;
                    const due = date === today && !done && !late && minutesSince(d.time, now) >= 0;
                    const Icon = d.reminder.kind === "medicine" ? Pill : kindIcon(d.reminder.kind);
                    const canTick = date <= today;
                    return (
                      <li key={d.key}>
                        <div
                          className={`flex items-center gap-3 rounded-2xl border-[3px] border-[#232326] p-2.5 shadow-[0_3px_0_#232326] ${
                            done ? "bg-[var(--brand-soft)]" : due ? "halo bg-[var(--morning-soft)]" : "bg-card"
                          }`}
                        >
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={done}
                            aria-label={`${d.reminder.title}, ${clockIn(lang, d.time)}`}
                            disabled={!canTick || pending.has(d.key)}
                            onClick={() => void toggle(d)}
                            className={`flex size-12 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] ${done ? "bg-[#2e9e5b] text-white" : "bg-white"} disabled:opacity-40`}
                          >
                            {pending.has(d.key) ? <Loader2 className="size-5 animate-spin" aria-hidden /> : done ? <Check className="pop size-6" strokeWidth={3.4} aria-hidden /> : null}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-base leading-tight font-bold ${done ? "line-through opacity-60" : ""}`}>{d.reminder.title}</p>
                            <p className="flex items-center gap-1.5 truncate text-base">
                              <Icon className="size-4 shrink-0" aria-hidden />
                              <span className="truncate">
                                {people.length > 1 && !person ? `${d.reminder.personName.split(" ")[0]} · ` : ""}
                                {d.reminder.detail ?? ""}
                              </span>
                            </p>
                          </div>
                          {/* Ring this phone for this medicine, now. */}
                          {callScreenAvailable && !done ? (
                            <button
                              type="button"
                              onClick={() => void ring(d)}
                              aria-label={t(`Ring me for ${d.reminder.title}`, `${d.reminder.title} के लिए कॉल करें`, `${d.reminder.title} ke liye call karein`)}
                              className="flex size-11 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-white"
                            >
                              <PhoneCall className="size-5" aria-hidden />
                            </button>
                          ) : null}
                          <div className="shrink-0 text-right">
                            <p className="text-base leading-tight font-bold">{clockIn(lang, d.time)}</p>
                            {late ? <p className="text-sm font-bold">{t("Not yet", "अभी नहीं ली", "Abhi nahi li")}</p> : due ? <p className="text-sm font-bold">{t("Now", "अभी", "Abhi")}</p> : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setSheet({ kind: "new" })}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-base font-bold shadow-[0_4px_0_#232326]"
        >
          <Plus className="size-5" strokeWidth={2.8} aria-hidden /> {t("Add a reminder", "रिमाइंडर जोड़ें", "Reminder jodein")}
        </button>
      </Screen>

      {sheet?.kind === "new" ? <EditReminder people={people} defaultPerson={person ?? people[0] ?? ""} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "edit" ? <EditReminder people={people} existing={sheet.r} defaultPerson={sheet.r.personName} onClose={() => setSheet({ kind: "manage" })} /> : null}
      {sheet?.kind === "calls" ? <CallReminders onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "manage" ? (
        <ManageReminders reminders={reminders.data} people={people} onEdit={(r) => setSheet({ kind: "edit", r })} onClose={() => setSheet(null)} />
      ) : null}
    </>
  );
}
