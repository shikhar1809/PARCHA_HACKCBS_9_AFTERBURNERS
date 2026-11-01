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
 *   - no answer buttons on it: tapping it opens the app on the dose cards,
 *     where each medicine is answered against the photo of its strip. A
 *     "Taken" in the tray is a tap on words; a "Taken" under the strip is a
 *     look at the tablet in her hand, which is the check that matters;
 *   - one follow-up thirty minutes later, which disappears on its own once the
 *     dose is ticked off, and moves when she says "not taken".
 *
 * The schedule is rebuilt whenever the reminders change, and a dose that is
 * ticked off is taken out of it, so you are not reminded about what you have
 * already taken.
 */
import { markDose, useDoseLog, useReminders } from "@parcha/client";
import { addCalendarDays, dosesOn, toDateString, type Dose } from "@parcha/core";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useHandset } from "../auth";
import { clockIn, currentLang, personLang, tr } from "../i18n";
import { alertsOn, NOT_TAKEN_MINUTES } from "./alerts";

export const isNative = Capacitor.isNativePlatform();

const CHANNEL = "doses";
const SOUND = "dose_chime.wav";
/** Phones cap how many alarms an app may hold; the soonest of the coming days is plenty. */
const MAX_SCHEDULED = 60;
const DAYS_AHEAD = 3;
/** The follow-up, in minutes after the dose time: the same thirty as "not taken". */
const NAGS = [NOT_TAKEN_MINUTES];
/** The id salt of a follow-up asked for with "not taken". */
const FOLLOW_UP = 9;

/** A stable positive 31-bit number for a dose on a day, which is what a notification id must be. */
function notificationId(date: string, key: string, salt = 0): number {
  let h = 2166136261;
  for (const ch of `${date}|${key}|${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 2147483000 || 1;
}

/**
 * The plugin itself, never awaited or returned from an async function: a
 * Capacitor plugin is a proxy, and resolving a promise with it makes the
 * runtime ask it for `.then`, which the proxy answers by throwing ("then() is
 * not implemented on android"). That one throw is enough to stop every alarm
 * from being scheduled.
 */
const plugin = () => LocalNotifications;

/** Asks the phone for permission to show reminders, and for exact timing. Returns whether alerts may be shown. */
export async function requestNativePermission(): Promise<boolean> {
  if (!isNative) return false;
  const ln = plugin();
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
  const ln = plugin();
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
        ? tr(lang, "Tap to see the strip to take.", "कौन-सा पत्ता लेना है, देखने के लिए छुएँ।", "Kaun sa patta lena hai, dekhne ke liye chhuein.")
        : tr(lang, "This dose has not been ticked off yet.", "यह खुराक अभी तक नहीं ली गई।", "Yeh dose abhi tak nahi li gayi."),
    ].join("\n"),
    summaryText: tr(lang, "Parcha medicine reminder", "Parcha दवा की याद", "Parcha dawai reminder"),
  };
}

async function setUp() {
  const ln = plugin();
  return ln.createChannel({
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
}

/** Ticked off on the cards: the follow-ups for that dose are not needed. */
export async function doseDoneNative(date: string, key: string): Promise<void> {
  if (!isNative) return;
  const ln = plugin();
  const ids = [...NAGS.map((_, i) => notificationId(date, key, i + 1)), notificationId(date, key, FOLLOW_UP)];
  await ln.cancel({ notifications: ids.map((id) => ({ id })) }).catch(() => undefined);
}

/** "Not taken": ask again in thirty minutes from now, instead of at the fixed follow-up. */
export async function followUpNative(dose: Dose, date: string, minutes: number): Promise<void> {
  if (!isNative) return;
  await doseDoneNative(date, dose.key);
  const ln = plugin();
  await ln
    .schedule({
      notifications: [
        {
          id: notificationId(date, dose.key, FOLLOW_UP),
          ...content(dose, 1),
          channelId: CHANNEL,
          sound: SOUND,
          smallIcon: "ic_stat_parcha",
          largeIcon: "ic_notify_large",
          iconColor: "#FF7F5A",
          autoCancel: true,
          schedule: { at: new Date(Date.now() + minutes * 60_000), allowWhileIdle: true },
          extra: { key: dose.key, date, route: "/dose" },
        },
      ],
    })
    .catch(() => undefined);
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
      const ln = plugin();
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
          autoCancel: true,
          group: `dose-${date}-${dose.time}`,
          schedule: { at, allowWhileIdle: true },
          extra: { key: dose.key, date, time: dose.time, title: dose.reminder.title, who: dose.reminder.personName, detail: dose.reminder.detail, route: "/dose" },
        })),
      });
    })().catch((e) => console.warn("[parcha] could not schedule reminders", e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, reminders.loading]);

  // Tapping a reminder opens the dose cards. ("taken" only comes from
  // notifications scheduled by an older build, which still had the button.)
  useEffect(() => {
    if (!isNative) return;
    let remove: (() => void) | undefined;
    Promise.resolve()
      .then(() =>
        plugin().addListener("localNotificationActionPerformed", async (e) => {
          const extra = (e.notification.extra ?? {}) as { key?: string; date?: string };
          if (e.actionId === "taken" && extra.key && extra.date) {
            await markDose(extra.date, extra.key, true).catch(() => undefined);
            await doseDoneNative(extra.date, extra.key);
          } else {
            navigate("/dose");
          }
        }),
      )
      .then((h) => (remove = () => void h.remove()))
      .catch(() => undefined);
    return () => remove?.();
  }, [navigate]);

  return null;
}
