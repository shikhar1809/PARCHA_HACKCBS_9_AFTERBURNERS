/**
 * Messages from one person in the family to the rest: a few seconds of voice.
 *
 * Dadi cannot type, and a reminder that only asks "taken or not?" leaves her
 * no way to say "I have run out", "my chest hurts" or "call me". So the call
 * screen and her simple screen each have one button that records her voice,
 * and the family hears it on the Overview tab.
 *
 * Honest limits, said in the app as well as here:
 *   - this is not an emergency service. Nothing here calls anyone; a message
 *     waits until somebody opens the app. The app says to call 112 for that;
 *   - the voice is kept as she said it. Nothing transcribes it or guesses what
 *     it means, because a wrong guess about an old woman's message is worse
 *     than none;
 *   - it belongs to the phone number on the sign-in, like the reminders, and
 *     only that number can read it.
 */
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { assertOnThisPhone } from "./records.js";
import { db, rateLimit, requirePatientPhone, requireString, tenDigits } from "./guards.js";

/** About thirty seconds of speech at the bitrate the phone records at. */
const MAX_AUDIO_CHARS = 450_000;
const AUDIO = /^data:audio\/(webm|ogg|mp4|aac|mpeg|3gpp|x-m4a)(;[a-z0-9=.-]+)*;base64,[A-Za-z0-9+/=]+$/;

export const sendFamilyMessage = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  await rateLimit(`msg:${phone}`, 40, 3600);
  const from = requireString(request.data?.from, "Who it is from", 120);
  await assertOnThisPhone(phone, from);
  const audio = request.data?.audio;
  if (typeof audio !== "string" || audio.length > MAX_AUDIO_CHARS || !AUDIO.test(audio)) {
    throw new HttpsError("invalid-argument", "The recording is missing, or longer than thirty seconds.");
  }
  const seconds = Number(request.data?.seconds);
  // Made on the phone while offline, so the id is the phone's: a resend is the same message.
  const id = typeof request.data?.id === "string" && /^m_[a-z0-9]{8,40}$/.test(request.data.id) ? request.data.id : null;
  const ref = id ? db().collection("familyMessages").doc(`${phone}__${id}`) : db().collection("familyMessages").doc();
  await ref.set({
    ownerPhone: phone,
    from,
    audio,
    seconds: Number.isFinite(seconds) ? Math.min(Math.max(Math.round(seconds), 1), 60) : null,
    via: request.data?.via === "call" ? "call" : "app",
    createdAt: FieldValue.serverTimestamp(),
    sentAt: new Date().toISOString(),
    heardBy: [],
  });
  return { id: ref.id };
});

export const heardFamilyMessage = onCall(async (request) => {
  const phone = tenDigits(requirePatientPhone(request));
  const id = requireString(request.data?.id, "Message", 80);
  const by = requireString(request.data?.by, "Who heard it", 120);
  const ref = db().collection("familyMessages").doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.ownerPhone !== phone) throw new HttpsError("not-found", "No such message.");
  await ref.update({ heardBy: FieldValue.arrayUnion(by) });
  return { ok: true };
});
