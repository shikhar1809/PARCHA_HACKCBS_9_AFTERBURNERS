import { useDoseLog, useReminders } from "@parcha/client";
import { Capacitor } from "@capacitor/core";
import { dosesOn, minutesSince, spokenReminder, toDateString, type Dose, type Reminder } from "@parcha/core";
import { Bell, ChevronRight, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useHandset } from "../auth";
import { clockIn, currentLang, tr, useLang, useT } from "../i18n";
import { showDoseNotification } from "./notify";
import { usePeople } from "./people";
import { speak } from "./speak";
import { useStrip } from "./strips";

/** A clock that ticks, so "due now" and "late" stay true without a refresh. */
export function useNow(everyMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const KEY = "parcha.alerts";

export function alertsOn(): boolean {
  try {
    // Only the person's choice. A refused phone permission still leaves the
    // alerts that appear inside the app.
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Turns alerts on or off. Turning on asks the phone for permission to show
 * notifications; if it is refused, alerts still appear inside the app, and the
 * note says how to allow the rest.
 */
export async function setAlerts(on: boolean): Promise<{ on: boolean; note?: string }> {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode: the toggle still works for this visit */
  }
  if (!on) return { on: false };
  // In the Android app the phone's own alarms do the work, closed or open.
  if (Capacitor.isNativePlatform()) {
    const { requestNativePermission } = await import("./native");
    return (await requestNativePermission())
      ? { on: true }
      : { on: true, note: tr(currentLang(), "Parcha is not allowed to show notifications. Turn them on in the phone's settings for Parcha.", "Parcha को सूचना दिखाने की इजाज़त नहीं है। फ़ोन की सेटिंग में Parcha के लिए चालू करें।", "Parcha ko notification dikhane ki permission nahi hai. Phone ki settings mein Parcha ke liye on karein.") };
  }
  if (typeof Notification === "undefined") {
    return { on: true, note: tr(currentLang(), "This phone's browser cannot show notifications. Alerts will appear inside Parcha.", "इस फ़ोन का ब्राउज़र सूचना नहीं दिखा सकता। याद Parcha के अंदर ही दिखेगी।", "Is phone ka browser notification nahi dikha sakta. Yaad Parcha ke andar hi dikhegi.") };
  }
  if (Notification.permission === "default") {
    const answer = await Notification.requestPermission();
    if (answer !== "granted") {
      return { on: true, note: tr(currentLang(), "Phone alerts are blocked. Alerts will appear inside Parcha. To allow them, change the site's notification setting.", "फ़ोन पर सूचना बंद है। याद Parcha के अंदर दिखेगी। चालू करने के लिए साइट की सूचना सेटिंग बदलें।", "Phone par notification band hai. Yaad Parcha ke andar dikhegi. On karne ke liye site ki notification setting badlein.") };
    }
  }
  if (Notification.permission === "denied") {
    return { on: true, note: tr(currentLang(), "Phone alerts are blocked. Alerts will appear inside Parcha.", "फ़ोन पर सूचना बंद है। याद Parcha के अंदर दिखेगी।", "Phone par notification band hai. Yaad Parcha ke andar dikhegi.") };
  }
  return { on: true };
}

const seenKey = (date: string, key: string) => `parcha.alerted.${date}.${key}`;

/** How long "Not taken" waits before asking again. The telephone call waits the same. */
export const NOT_TAKEN_MINUTES = 30;
/** A dose is asked about for this long after its time, then left to the day's list. */
const DUE_FOR_MINUTES = 240;

const DEFER = "parcha.deferred";
/**
 * Doses the person said "not taken" or "later" to, and until when. Kept on the
 * phone rather than in memory, so closing the app does not forget the follow-up.
 */
function deferrals(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(DEFER) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** Hides a dose's reminder for a while; it comes back, and rings again, afterwards. */
export function snoozeDose(key: string, date: string, minutes: number) {
  const all = deferrals();
  // Old follow-ups are dropped as new ones are written.
  for (const k of Object.keys(all)) if (all[k] < Date.now() - 86_400_000) delete all[k];
  all[`${date}|${key}`] = Date.now() + minutes * 60_000;
  try {
    localStorage.setItem(DEFER, JSON.stringify(all));
    sessionStorage.removeItem(seenKey(date, key));
  } catch {
    /* it will still re-show; it may not ring a second time */
  }
}

const snoozed = (date: string, key: string) => (deferrals()[`${date}|${key}`] ?? 0) > Date.now();

/**
 * The doses to ask about right now: due, not ticked, and not waiting on a
 * follow-up. With a person chosen on the phone, only theirs: on a shared phone
 * Prashant must not be able to tick off Dadi's dose by tapping through cards.
 */
export function dueNow(reminders: Reminder[], taken: Record<string, unknown>, now: Date, person?: string | null): Dose[] {
  const today = toDateString(now);
  return dosesOn(reminders, today).filter(
    (d) => d.reminder.kind === "medicine" && (!person || d.reminder.personName === person) && !(d.key in taken) && !snoozed(today, d.key) && minutesSince(d.time, now) >= 0 && minutesSince(d.time, now) < DUE_FOR_MINUTES,
  );
}

/**
 * Watches today's doses and, when one is due, shows a banner at the top of the
 * app (and a phone notification if allowed). It runs only while Parcha is open:
 * a web app cannot wake a closed phone without a push service, which this build
 * does not have.
 */
export function DueAlerts() {
  const t = useT();
  const lang = useLang();
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const now = useNow(15_000);
  const today = toDateString(now);
  const reminders = useReminders(phone);
  const log = useDoseLog(phone, today);
  const [, bump] = useState(0);
  const notified = useRef<Set<string>>(new Set());
  const [on, setOn] = useState(alertsOn());

  // Pick up the toggle from the Schedule screen without a reload.
  useEffect(() => {
    const t = setInterval(() => setOn(alertsOn()), 3000);
    return () => clearInterval(t);
  }, []);

  const navigate = useNavigate();
  // Not over the dose cards themselves, nor over Ask, whose message bar sits where the banner would.
  const path = useLocation().pathname;
  const onCards = path === "/dose" || path === "/ask";
  const taken = log.data?.taken ?? {};
  const { people, active } = usePeople();
  const due: Dose[] = on ? dueNow(reminders.data, taken, now, active) : [];
  const first = due[0];
  // How this person takes a reminder: spoken for someone who cannot see well,
  // flashing and vibrating for someone who cannot hear.
  const access = people.find((p) => p.name === first?.reminder.personName)?.access;
  const sayIt = first ? spokenReminder(first.reminder.personName, due.filter((d) => d.time === first.time).map((d) => d.reminder.title)) : "";

  useEffect(() => {
    if (!first || notified.current.has(first.key)) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem(seenKey(today, first.key)) === "1";
      sessionStorage.setItem(seenKey(today, first.key), "1");
    } catch {
      /* fall through: notify once per page load */
    }
    notified.current.add(first.key);
    // A real system notification, with Taken / Later on it, as well as the banner.
    if (!seen) void showDoseNotification(first, today);
    if (!seen && access?.lowVision) void speak(sayIt);
    if (!seen && access?.deaf) buzz();
  }, [first, today, access?.lowVision, access?.deaf, sayIt]);

  // Wake up when a snooze runs out, so the reminder comes back by itself.
  useEffect(() => {
    const t = setInterval(() => bump((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  // The strip to take, even on the banner: it is what she recognises.
  const strip = useStrip(first?.reminder.title);
  if (!first || onCards) return null;
  return (
    <>
    {/* Someone who cannot hear the chime sees the whole screen pulse instead. */}
    {access?.deaf ? <div aria-hidden className="alert-flash pointer-events-none absolute inset-0 z-40" /> : null}
    {/* The banner only says it is time; the answer is given on the cards,
        against the picture of the strip, one medicine at a time. */}
    <div role="alert" className="pop absolute inset-x-3 bottom-[6.25rem] z-50 flex items-center gap-2.5 rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-2.5 shadow-[0_4px_0_#232326]">
      <button type="button" onClick={() => navigate("/dose")} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-[#232326] bg-white">
          {strip?.front ? <img src={strip.front} alt="" className="size-full object-cover" /> : <Bell className="size-5" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-lg leading-tight font-bold">
            {due.length > 1
              ? t(`Time for ${due.length} medicines`, `${due.length} दवाइयों का समय`, `${due.length} dawaiyon ka time`)
              : t(`Time for ${first.reminder.title}`, `${first.reminder.title} का समय`, `${first.reminder.title} ka time`)}
          </span>
          <span className="block truncate text-base">
            {first.reminder.personName.split(" ")[0]} · {clockIn(lang, first.time)} · {t("Tap to see", "देखने के लिए छुएँ", "Dekhne ke liye chhuein")}
          </span>
        </span>
        <ChevronRight className="size-6 shrink-0" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`${t("Listen", "सुनें", "Suniye")}: ${sayIt}`}
        onClick={() => void speak(sayIt)}
        className="flex size-12 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-white"
      >
        <Volume2 className="size-5" aria-hidden />
      </button>
    </div>
    </>
  );
}

/** A long, insistent vibration for someone who cannot hear the chime. */
export function buzz() {
  const pattern = [600, 250, 600, 250, 600, 250, 1200];
  void import("@capacitor/haptics")
    .then(async ({ Haptics }) => {
      for (const ms of pattern.filter((_, i) => i % 2 === 0)) {
        await Haptics.vibrate({ duration: ms });
        await new Promise((r) => setTimeout(r, ms + 250));
      }
    })
    .catch(() => navigator.vibrate?.(pattern));
}
