/**
 * What only the Android app can do: remind you while it is closed, loudly.
 *
 * A web page cannot wake a phone, so in a browser reminders appear only while
 * Parcha is open. In the Android app the next days of doses are handed to the
 * phone's own alarm system as local notifications. They fire with the app
 * closed and with no network, because they are scheduled on the phone.
 *
 * A reminder is meant to be noticed, the way a delivery app's alert is:
 *   - a high-importance channel, so it drops down over whatever is on screen
 *     ("heads-up") and shows on the lock screen;
 *   - our own chime and a long vibration, not the default blip;
 *   - the medicine, the person and the time on it, and a larger icon;
 *   - two buttons, Taken and Later, so the answer is one tap;
 *   - a second, nagging reminder ten minutes later, and a third after twenty-five,
 *     which disappear on their own once the dose is ticked off.
 *
 * The schedule is rebuilt whenever the reminders change, and a dose that is
 * ticked off is taken out of it, so you are not reminded about what you have
 * already taken.
 */
import { markDose, useDoseLog, useReminders } from "@parcha/client";
import { addCalendarDays, dosesOn, toDateString, type Dose } from "@parcha/core";
import { Capacitor } from "@capacitor/core";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useHandset } from "../auth";
import { clockIn, currentLang, personLang, tr } from "../i18n";
import { alertsOn } from "./alerts";

export const isNative = Capacitor.isNativePlatform();

const CHANNEL = "doses";
const SOUND = "dose_chime.wav";
const ACTIONS = "DOSE";
/** Phones cap how many alarms an app may hold; the soonest of the coming days is plenty. */
const MAX_SCHEDULED = 60;
const DAYS_AHEAD = 3;
/** The follow-up nags, in minutes after the dose time. */
const NAGS = [10, 25];
const SNOOZE_MINUTES = 10;

/** A stable positive 31-bit number for a dose on a day, which is what a notification id must be. */
function notificationId(date: string, key: string, salt = 0): number {
  let h = 2166136261;
  for (const ch of `${date}|${key}|${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 2147483000 || 1;
}

async function plugin() {
  return (await import("@capacitor/local-notifications")).LocalNotifications;
}

/** Asks the phone for permission to show reminders, and for exact timing. Returns whether alerts may be shown. */
export async function requestNativePermission(): Promise<boolean> {
  if (!isNative) return false;
  const ln = await plugin();
  let granted = (await ln.checkPermissions()).display === "granted";
  if (!granted) granted = (await ln.requestPermissions()).display === "granted";
  if (granted) {
    // Without exact alarms Android may hold a reminder back for several minutes.
    const exact = await ln.checkExactNotificationSetting().catch(() => null);
    if (exact && exact.exact_alarm !== "granted") await ln.changeExactNotificationSetting().catch(() => undefined);
  }
  return granted;
}

export async function clearNativeReminders(): Promise<void> {
  if (!isNative) return;
  const ln = await plugin();
  const pending = await ln.getPending();
  if (pending.notifications.length > 0) await ln.cancel({ notifications: pending.notifications });
}

/** The words of a reminder. `nag` says the first one was missed. */
function content(dose: Dose, nag: number) {
  const who = dose.reminder.personName.split(" ")[0];
  const lang = personLang(dose.reminder.personName) ?? currentLang();
  const when = clockIn(lang, dose.time);
  const detail = dose.reminder.detail ? ` · ${dose.reminder.detail}` : "";
  const name = dose.reminder.title;
  return {
    title:
      nag === 0
        ? tr(lang, `💊 Time for ${name}`, `💊 ${name} का समय`, `💊 ${name} ka time`)
        : tr(lang, `⏰ Still waiting: ${name}`, `⏰ अभी बाकी: ${name}`, `⏰ Abhi baaki: ${name}`),
    body: `${who} · ${when}${detail}`,
    largeBody: [
      `${name}${detail}`,
      `${who} · ${when}`,
      nag === 0
        ? tr(lang, "Tap Taken when you have had it.", "लेने के बाद \"ले ली\" दबाएँ।", "Lene ke baad \"Le li\" dabayein.")
        : tr(lang, "This dose has not been ticked off yet.", "यह खुराक अभी तक नहीं ली गई।", "Yeh dose abhi tak nahi li gayi."),
    ].join("\n"),
    summaryText: tr(lang, "Parcha medicine reminder", "Parcha दवा की याद", "Parcha dawai reminder"),
  };
}

async function setUp() {
  const ln = await plugin();
  await ln.createChannel({
    id: CHANNEL,
    name: "Medicine reminders",
    description: "Tells you when it is time to take a medicine",
    importance: 5, // the highest: heads-up, sound, and on the lock screen
    sound: SOUND,
    vibration: true,
    lights: true,
    lightColor: "#FF7F5A",
    visibility: 1,
  });
  await ln.registerActionTypes({
    types: [
      {
        id: ACTIONS,
        actions: [
          { id: "taken", title: tr(currentLang(), "✓ Taken", "✓ ले ली", "✓ Le li") },
          { id: "snooze", title: tr(currentLang(), `Later (${SNOOZE_MINUTES} min)`, `बाद में (${SNOOZE_MINUTES} मिनट)`, `Baad mein (${SNOOZE_MINUTES} min)`) },
        ],
      },
    ],
  });
  return ln;
}

/** Keeps the phone's alarms in step with the reminders, and answers the buttons. Renders nothing. */
export function NativeReminders() {
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const reminders = useReminders(phone);
  const today = toDateString(new Date());
  const log = useDoseLog(phone, today);
  const navigate = useNavigate();

  // The doses to schedule, as a signature, so it only runs when something real changed.
  const taken = Object.keys(log.data?.taken ?? {});
  const signature = JSON.stringify([
    reminders.data.map((r) => [r.id, r.enabled, r.times, r.days, r.startDate, r.endDate, r.title, r.personName, r.detail]),
    taken,
    today,
  ]);

  useEffect(() => {
    if (!isNative || reminders.loading) return;
    let cancelled = false;
    (async () => {
      if (!alertsOn()) {
        await clearNativeReminders();
        return;
      }
      const ln = await plugin();
      if ((await ln.checkPermissions()).display !== "granted") return;
      await setUp();

      const now = Date.now();
      type Item = { id: number; at: Date; dose: Dose; date: string; nag: number };
      const items: Item[] = [];
      for (let i = 0; i < DAYS_AHEAD; i++) {
        const date = addCalendarDays(today, i);
        for (const dose of dosesOn(reminders.data, date)) {
          if (i === 0 && taken.includes(dose.key)) continue;
          const base = new Date(`${date}T${dose.time}:00`).getTime();
          [0, ...NAGS].forEach((minutes, nag) => {
            const at = new Date(base + minutes * 60_000);
            if (at.getTime() > now + 5_000) items.push({ id: notificationId(date, dose.key, nag), at, dose, date, nag });
          });
        }
      }
      items.sort((a, b) => a.at.getTime() - b.at.getTime());

      const pending = await ln.getPending();
      if (pending.notifications.length > 0) await ln.cancel({ notifications: pending.notifications });
      if (cancelled || items.length === 0) return;
      await ln.schedule({
        notifications: items.slice(0, MAX_SCHEDULED).map(({ id, at, dose, date, nag }) => ({
          id,
          ...content(dose, nag),
          channelId: CHANNEL,
          sound: SOUND,
          smallIcon: "ic_stat_parcha",
          largeIcon: "ic_notify_large",
          iconColor: "#FF7F5A",
          actionTypeId: ACTIONS,
          autoCancel: true,
          group: `dose-${date}-${dose.time}`,
          schedule: { at, allowWhileIdle: true },
          extra: { key: dose.key, date, time: dose.time, title: dose.reminder.title, who: dose.reminder.personName, detail: dose.reminder.detail, route: "/schedule" },
        })),
      });
    })().catch((e) => console.warn("[parcha] could not schedule reminders", e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, reminders.loading]);

  // What the buttons do. Tapping the body opens the schedule.
  useEffect(() => {
    if (!isNative) return;
    let remove: (() => void) | undefined;
    plugin()
      .then((ln) =>
        ln.addListener("localNotificationActionPerformed", async (e) => {
          const extra = (e.notification.extra ?? {}) as { key?: string; date?: string; title?: string; who?: string; detail?: string | null };
          if (e.actionId === "taken" && extra.key && extra.date) {
            await markDose(extra.date, extra.key, true).catch(() => undefined);
            // The dose is done: its follow-up nags go with it.
            const nags = NAGS.map((_, i) => notificationId(extra.date!, extra.key!, i + 1));
            await ln.cancel({ notifications: nags.map((id) => ({ id })) }).catch(() => undefined);
          } else if (e.actionId === "snooze" && extra.key && extra.date) {
            const base = { key: extra.key, date: extra.date };
            await ln.schedule({
              notifications: [
                {
                  id: notificationId(extra.date, extra.key, 9),
                  title: `💊 Time for ${extra.title ?? "your medicine"}`,
                  body: `${(extra.who ?? "").split(" ")[0]} · you asked to be reminded`,
                  channelId: CHANNEL,
                  sound: SOUND,
                  smallIcon: "ic_stat_parcha",
                  largeIcon: "ic_notify_large",
                  actionTypeId: ACTIONS,
                  schedule: { at: new Date(Date.now() + SNOOZE_MINUTES * 60_000), allowWhileIdle: true },
                  extra: { ...extra, ...base },
                },
              ],
            }).catch(() => undefined);
          } else {
            navigate("/schedule");
          }
        }),
      )
      .then((h) => (remove = () => void h.remove()))
      .catch(() => undefined);
    return () => remove?.();
  }, [navigate]);

  return null;
}
