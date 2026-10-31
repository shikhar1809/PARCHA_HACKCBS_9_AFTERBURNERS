/**
 * System notifications for the web app.
 *
 * Shown through the service worker, not `new Notification()`, because only a
 * service worker can attach buttons and keep the notification until it is
 * dealt with. In the Android app the phone's own alarms do this job instead
 * (see native.tsx), so nothing here runs there.
 */
import { markDose } from "@parcha/client";
import { type Dose } from "@parcha/core";
import { Capacitor } from "@capacitor/core";
import { useEffect } from "react";

import { clockIn, currentLang, personLang, tr } from "../i18n";

/** The look of a dose reminder: loud enough to notice, and with the two answers on it. */
export function doseNotification(dose: Dose, date: string): [string, NotificationOptions & { vibrate?: number[]; actions?: { action: string; title: string }[] }] {
  const who = dose.reminder.personName.split(" ")[0];
  const lang = personLang(dose.reminder.personName) ?? currentLang();
  return [
    tr(lang, `💊 Time for ${dose.reminder.title}`, `💊 ${dose.reminder.title} का समय`, `💊 ${dose.reminder.title} ka time`),
    {
      body: `${who} · ${clockIn(lang, dose.time)}${dose.reminder.detail ? ` · ${dose.reminder.detail}` : ""}`,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: dose.key,
      // A reminder that vanishes after five seconds is a reminder that was missed.
      requireInteraction: true,
      vibrate: [400, 150, 400, 150, 600],
      actions: [
        { action: "taken", title: tr(lang, "✓ Taken", "✓ ले ली", "✓ Le li") },
        { action: "later", title: tr(lang, "Later (10 min)", "बाद में (10 मिनट)", "Baad mein (10 min)") },
      ],
      data: { key: dose.key, date },
    },
  ];
}

/** Shows one reminder. Returns whether it was shown. */
export async function showDoseNotification(dose: Dose, date: string): Promise<boolean> {
  if (Capacitor.isNativePlatform()) return false;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const [title, options] = doseNotification(dose, date);
    if (reg) {
      await reg.showNotification(title, options);
      return true;
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

const SNOOZE_MINUTES = 10;

/**
 * Listens for the buttons on a notification: "Taken" ticks the dose, "Later"
 * asks again in ten minutes (while the app is open). Mount once, near the top.
 */
export function useNotificationActions(onOpenSchedule: () => void, onSnooze: (key: string, date: string, minutes: number) => void) {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;

    const handle = (m: { type?: string; action?: string; key?: string; date?: string }) => {
      if (m.type === "open-schedule") onOpenSchedule();
      if (m.type === "dose-action" && m.key && m.date) {
        if (m.action === "taken") void markDose(m.date, m.key, true).catch(() => undefined);
        if (m.action === "later") onSnooze(m.key, m.date, SNOOZE_MINUTES);
        onOpenSchedule();
      }
    };

    const onMessage = (e: MessageEvent) => handle(e.data ?? {});
    navigator.serviceWorker?.addEventListener("message", onMessage);

    // The app was closed when the button was pressed: the worker opened it with the answer in the address.
    const q = new URLSearchParams(window.location.search);
    if (q.get("dose") && q.get("key") && q.get("date")) {
      handle({ type: "dose-action", action: q.get("dose") ?? "", key: q.get("key") ?? "", date: q.get("date") ?? "" });
      window.history.replaceState({}, "", window.location.pathname);
    }
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
