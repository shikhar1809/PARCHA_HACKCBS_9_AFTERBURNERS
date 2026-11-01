/**
 * The medicine reminder that arrives like a call.
 *
 * On the Android app a dose can take the whole screen — over the lock screen,
 * ringing, buzzing, and said out loud — instead of appearing as a line in the
 * notification tray. The screen itself is native (`CallActivity.java`), so it
 * comes up instantly with the app not running at all; this file is only the
 * doorway to it, and the place the answers come back.
 *
 * It is this phone's own alarm, not a telephone call. That is what makes it
 * free, unregulated and good with no network — and it is also why it cannot
 * reach a phone that does not have Parcha on it. The telephone agent in
 * `docs/CALLING.md` is still the answer for that, and the two are not the
 * same promise. Nothing in the app says "we called her" about this one.
 *
 * In a browser there is no such screen, and `ringForDose` says so rather than
 * pretending: a web page cannot draw over a locked phone.
 */
import { markDose } from "@parcha/client";
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Dose } from "@parcha/core";

type Answer = { key: string; date: string; outcome: "taken" | "snoozed"; at: number };

type CallScreenPlugin = {
  ring(options: {
    title: string;
    person: string;
    detail: string;
    time: string;
    key: string;
    date: string;
    lang: string;
  }): Promise<{ overLockScreen: boolean }>;
  canRing(): Promise<{ overLockScreen: boolean }>;
  requestPermission(): Promise<void>;
  pending(): Promise<{ answers: Answer[] }>;
  clear(): Promise<void>;
};

const CallScreen = registerPlugin<CallScreenPlugin>("CallScreen");

/** Only the Android app has a screen that can do this. */
export const callScreenAvailable = Capacitor.getPlatform() === "android";

/**
 * Whether a dose can ring over a locked phone, or only while Parcha is open.
 * From Android 14 the first needs a permission the person grants on a settings
 * page, so a screen that offers this should be able to say which it has.
 */
export async function callScreenReach(): Promise<"locked" | "open" | "none"> {
  if (!callScreenAvailable) return "none";
  try {
    return (await CallScreen.canRing()).overLockScreen ? "locked" : "open";
  } catch {
    return "none";
  }
}

/** Opens the one settings page that can grant it. */
export async function askForCallScreen(): Promise<void> {
  if (!callScreenAvailable) return;
  try {
    await CallScreen.requestPermission();
  } catch {
    /* no such page on this build */
  }
}

/** Rings this phone for one dose, now. */
export async function ringForDose(
  dose: Dose,
  date: string,
  lang: string,
): Promise<{ rang: boolean; overLockScreen: boolean }> {
  if (!callScreenAvailable) return { rang: false, overLockScreen: false };
  try {
    const result = await CallScreen.ring({
      title: dose.reminder.title,
      person: dose.reminder.personName,
      detail: dose.reminder.detail ?? "",
      time: dose.time,
      key: dose.key,
      date,
      lang: lang === "en" ? "en" : "hi",
    });
    return { rang: true, overLockScreen: result.overLockScreen };
  } catch {
    return { rang: false, overLockScreen: false };
  }
}

/**
 * Takes in what was answered while the app was closed.
 *
 * The call screen writes to this phone and nothing else, because the app may
 * not be running and the network may be gone. This drains that queue into the
 * same `markDose` every other tick goes through, which means it joins the
 * outbox and is sent whenever the connection comes back. Each answer is
 * forgotten only once it has been handed over, so a failure here leaves it to
 * be tried again next time rather than losing it.
 */
export async function drainCallAnswers(): Promise<number> {
  if (!callScreenAvailable) return 0;
  let answers: Answer[] = [];
  try {
    answers = (await CallScreen.pending()).answers ?? [];
  } catch {
    return 0;
  }
  if (!answers.length) return 0;

  let taken = 0;
  for (const answer of answers) {
    // "Later" is not a tick: the dose stays due, and the reminder comes back.
    if (answer.outcome !== "taken" || !answer.key || !answer.date) continue;
    try {
      await markDose(answer.date, answer.key, true);
      taken += 1;
    } catch {
      // Left in the queue: better a second attempt than a lost dose.
      return taken;
    }
  }
  try {
    await CallScreen.clear();
  } catch {
    /* it will be drained again next time; markDose is idempotent per dose */
  }
  return taken;
}
