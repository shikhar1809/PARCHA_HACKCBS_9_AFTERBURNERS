/**
 * One-tap sign-in for the demo handsets, so the patient app can be shown on a
 * live project without SMS (and before the console's Phone sign-in is set up).
 *
 * Only the handsets the demo seed creates, and only where DEMO_SIGN_IN=on (or
 * on the emulator). The account is a phone account like any other: the ID
 * token carries the phone number, so the rules and functions treat it exactly
 * as if a code had been typed.
 *
 * Two ways in. A custom token, which needs the functions' service account to
 * be allowed to sign (Service Account Token Creator). Where it is not, the
 * handset's account also gets a demo email and password ("password" mode):
 * signing in with those gives the same phone number on the token, so it needs
 * nothing but Email/Password sign-in switched on.
 */
import { randomBytes } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { rateLimit } from "./guards.js";

/** The seeded handsets (scripts and docs/DEMO.md list who is on each). */
export const DEMO_HANDSETS = ["9811044321", "9700881122", "9845512077", "9958770044", "9988112233"];

const enabled = () => process.env.FUNCTIONS_EMULATOR === "true" || process.env.DEMO_SIGN_IN === "on";

/** The demo password, the same as the demo staff's (docs/DEMO.md). */
const DEMO_PASSWORD = "parcha123";
export const handsetEmail = (phone: string) => `${phone}@handset.parcha.test`;

export const demoPhoneSignIn = onCall(async (request) => {
  if (!enabled()) throw new HttpsError("failed-precondition", "Demo sign-in is not on for this project.");
  const phone = String(request.data?.phone ?? "").replace(/\D/g, "").slice(-10);
  if (!DEMO_HANDSETS.includes(phone)) throw new HttpsError("permission-denied", "That is not one of the demo handsets.");
  await rateLimit(`demo-signin:${phone}`, 120, 3600);

  const e164 = `+91${phone}`;
  const auth = getAuth();
  const user = await auth.getUserByPhoneNumber(e164).catch(async (e: { code?: string }) => {
    if (e.code !== "auth/user-not-found") throw e;
    return auth.createUser({ phoneNumber: e164 });
  });
  if (request.data?.mode !== "password") {
    try {
      return { token: await auth.createCustomToken(user.uid) };
    } catch {
      /* this project cannot sign tokens: the password way below */
    }
  }
  const email = handsetEmail(phone);
  if (user.email !== email || !user.providerData.some((p) => p.providerId === "password")) {
    await auth.updateUser(user.uid, { email, password: DEMO_PASSWORD });
  }
  return { email, password: DEMO_PASSWORD };
});

/**
 * The clinic's demo accounts (the seed's @parcha.test team), signed in with one
 * tap and no password, so a live demo opens straight into a hospital. Only
 * existing demo accounts that belong to a hospital, and only where demo
 * sign-in is on.
 */
export const demoStaffSignIn = onCall(async (request) => {
  if (!enabled()) throw new HttpsError("failed-precondition", "Demo sign-in is not on for this project.");
  const email = String(request.data?.email ?? "").trim().toLowerCase();
  if (!/^[a-z0-9.]+@parcha\.test$/.test(email)) throw new HttpsError("permission-denied", "That is not a demo account.");
  await rateLimit(`demo-staff:${email}`, 300, 3600);
  const auth = getAuth();
  const user = await auth.getUserByEmail(email).catch(() => null);
  if (!user || typeof user.customClaims?.hospitalId !== "string") throw new HttpsError("not-found", "No such demo account. Has the demo data been loaded?");
  try {
    return { token: await auth.createCustomToken(user.uid) };
  } catch {
    // This project cannot sign tokens; the app signs in with the demo password.
    throw new HttpsError("unavailable", "One-tap demo sign-in is not available here; use the demo password.");
  }
});

/**
 * "Custom": a new, empty clinic for whoever asks, so each visitor sets up
 * their own (choosing the size, naming it, setting the Manage PIN) without
 * touching anyone else's. They are its owner: they may only manage until the
 * set-up seats them. Marked `sandbox` with when it was made, so a sweep can
 * clear old ones.
 */
export const startNewClinic = onCall(async () => {
  if (!enabled()) throw new HttpsError("failed-precondition", "This is not available on this project.");
  await rateLimit("new-clinic", 300, 3600);
  const id = `h-new-${randomBytes(5).toString("hex")}`;
  const email = `owner-${id.slice(6)}@clinic.parcha.test`;
  const password = randomBytes(12).toString("base64url");
  const auth = getAuth();
  const db = getFirestore();
  await db.collection("hospitals").doc(id).set({
    id,
    name: "New clinic",
    shortName: "New clinic",
    address: "",
    area: "",
    city: "",
    phone: "",
    departments: ["General medicine"],
    respondMinutes: 15,
    accepting: false,
    load: "low",
    hours: "",
    setupDone: false,
    template: null,
    sandbox: true,
    example: true,
    createdAt: FieldValue.serverTimestamp(),
  });
  const user = await auth.createUser({ email, password, displayName: "Clinic owner" });
  const abilities = ["manage"];
  await auth.setCustomUserClaims(user.uid, { accountType: "staff", name: "Clinic owner", admin: true, hospitalId: id, seatId: null, seatName: null, abilities });
  await db.collection("accounts").doc(user.uid).set({
    uid: user.uid,
    displayName: "Clinic owner",
    accountType: "staff",
    counters: [],
    seatId: null,
    seatName: null,
    abilities,
    hospitalId: id,
    department: null,
    admin: true,
    active: true,
    qualification: null,
    registrationNo: null,
    profileDone: false,
  });
  return { email, password };
});
