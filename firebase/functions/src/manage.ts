/**
 * Running a clinic: setting it up, a doctor's own profile, and the Manage page.
 *
 * SET-UP. A clinic starts empty. The first person with the Manage ability picks
 * a template (a doctor alone, a small clinic, a hospital), names the clinic,
 * sets a Manage PIN, and takes the template's owner seat.
 *
 * PROFILE. A doctor fills in their qualification and registration number the
 * first time they sign in; the prescription carries them.
 *
 * MANAGE. Seats, the team and the clinic's settings sit behind a PIN, on top of
 * the person's own sign-in and the Manage ability. A right PIN gives a pass
 * that lasts 15 minutes from the last use; five wrong PINs lock the page for 15
 * minutes. Every opening and every change goes into the activity log.
 *
 * Guard rails: the last person who can manage the clinic cannot be moved out of
 * that seat, have Manage switched off, or be deactivated, so a clinic can never
 * lock itself out.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import { cleanBillLines, cleanRazorpayPage } from "../../../packages/core/src/counter.js";
import { generateCode } from "../../../packages/core/src/paths.js";
import {
  ABILITIES,
  accountTypeFor,
  cleanAbilities,
  cleanSessionRules,
  countersFor,
  DEFAULT_SESSION_RULES,
  PIN_RE,
  seatIdFrom,
  templateById,
  type Ability,
  type SessionRules,
} from "../../../packages/core/src/seats.js";
import { assertAbility, audit, db, rateLimit, requireRecentSignIn, requireString, type Caller } from "./guards.js";
import { actorLabel, forgetSessionRules, liveStaff, logActivity } from "./session.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: string, len: number) => Promise<Buffer>;

const PASS_MINUTES = 15;
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

type StoredSeat = { name: string; abilities: Ability[]; order: number };
type Private = {
  pinHash?: string;
  pinSalt?: string;
  failures?: number;
  lockedUntil?: Timestamp | null;
  sessionRules?: SessionRules;
};

const seatsOf = (hospitalId: string) => db().collection("hospitals").doc(hospitalId).collection("seats");
const privateOf = (hospitalId: string) => db().collection("hospitalPrivate").doc(hospitalId);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  return { pinSalt: salt, pinHash: (await scrypt(pin, salt, 32)).toString("hex") };
}

function readPin(data: unknown): string {
  const pin = String((data as { pin?: unknown } | undefined)?.pin ?? "");
  if (!PIN_RE.test(pin)) throw new HttpsError("invalid-argument", "The PIN is four to six digits.");
  return pin;
}

/** The seats a person sits in. Older accounts carry one `seatId`. */
export const seatIdsOf = (a: { seatIds?: unknown; seatId?: unknown } | undefined): string[] =>
  Array.isArray(a?.seatIds) ? (a.seatIds as unknown[]).filter((x): x is string => typeof x === "string") : typeof a?.seatId === "string" && a.seatId ? [a.seatId] : [];

/** Reads a list of seat ids from a request: `seatIds`, or the older single `seatId`. */
function requireSeatIds(data: Record<string, unknown>): string[] {
  const raw = Array.isArray(data.seatIds) ? data.seatIds : data.seatId != null ? [data.seatId] : [];
  const ids = [...new Set(raw.map((x) => requireString(x, "Seat", 60)))];
  if (ids.length === 0) throw new HttpsError("invalid-argument", "Choose at least one role.");
  if (ids.length > 6) throw new HttpsError("invalid-argument", "Six roles at most for one person.");
  return ids;
}

/** Loads seats by id, in the clinic's order; a missing one is refused. */
async function loadSeats(hospitalId: string, ids: string[]): Promise<(StoredSeat & { id: string })[]> {
  const docs = await Promise.all(ids.map((id) => seatsOf(hospitalId).doc(id).get()));
  const missing = docs.find((d) => !d.exists);
  if (missing) throw new HttpsError("not-found", "Choose one of the clinic's roles.");
  return docs.map((d) => ({ id: d.id, ...(d.data() as StoredSeat) })).sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
}

/** Everything a set of seats lets a person do, together. */
const unionAbilities = (seats: { abilities: Ability[] }[]) => cleanAbilities(seats.flatMap((s) => s.abilities));

/**
 * Seats a person, in one seat or several: their claims (what the server and
 * the rules check) and their account document (what the screens show). Several
 * seats add up: someone who is both the doctor and the pharmacy can do both.
 * The app refreshes its token when it sees the account change.
 */
async function seatPerson(uid: string, hospitalId: string, seats: { id: string; name: string; abilities: Ability[] }[]) {
  const abilities = unionAbilities(seats);
  const accountType = accountTypeFor(abilities);
  const seatIds = seats.map((s) => s.id);
  const seatId = seatIds[0] ?? null;
  const seatName = seats.map((s) => s.name).join(" + ") || null;
  const user = await getAuth().getUser(uid);
  const claims = user.customClaims ?? {};
  await getAuth().setCustomUserClaims(uid, {
    ...claims,
    accountType,
    hospitalId,
    seatId,
    seatName,
    abilities,
    admin: abilities.includes("manage"),
  });
  const ref = db().collection("accounts").doc(uid);
  const before = (await ref.get()).data();
  await ref.set(
    {
      accountType,
      counters: countersFor(abilities),
      seatId,
      seatIds,
      seatName,
      abilities,
      admin: abilities.includes("manage"),
      // A new doctor starts out taking patients.
      ...(accountType === "doctor" && !before?.availability ? { availability: "available" } : {}),
      claimsUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** How many active people could still manage the clinic if `change` were made. */
async function managersAfter(hospitalId: string, change: (uid: string, abilities: Ability[], seatIds: string[]) => Ability[] | null) {
  const team = await db().collection("accounts").where("hospitalId", "==", hospitalId).get();
  let n = 0;
  for (const d of team.docs) {
    const a = d.data();
    if (a.active === false) continue;
    const after = change(d.id, cleanAbilities(a.abilities ?? (a.admin ? ["manage"] : [])), seatIdsOf(a));
    if (after?.includes("manage")) n++;
  }
  return n;
}

const lockoutGuard = () =>
  new HttpsError("failed-precondition", "That would leave nobody able to manage the clinic. Give the Manage ability to someone else first.");

const abilityWords = (abilities: Ability[]) =>
  abilities.length === 0 ? "nothing yet" : abilities.map((a) => ABILITIES.find((x) => x.id === a)!.label.toLowerCase()).join(", ");

/* ------------------------------------------------------------------ set-up */

/** First run of a clinic: its details, a template's seats, the Manage PIN, and the owner's seat. */
export const setupClinic = onCall(async (request) => {
  const caller = await liveStaff(request);
  assertAbility(caller, "manage");
  await rateLimit(`setup:${caller.uid}`, 20, 3600);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const hospitalRef = db().collection("hospitals").doc(caller.hospitalId);
  const hospital = (await hospitalRef.get()).data();
  if (hospital?.setupDone === true) throw new HttpsError("failed-precondition", "This clinic is already set up. Use the Manage page to change it.");

  const template = templateById(String(data.template ?? ""));
  if (!template) throw new HttpsError("invalid-argument", "Choose how the clinic works.");
  const name = requireString(data.name, "Clinic name", 80);
  const area = typeof data.area === "string" ? data.area.trim().slice(0, 80) : "";
  const address = typeof data.address === "string" ? data.address.trim().slice(0, 200) : "";
  const phone = typeof data.phone === "string" ? data.phone.trim().slice(0, 20) : "";
  const lat = Number(data.lat);
  const lng = Number(data.lng);
  const pin = readPin(data);

  await hospitalRef.set(
    {
      id: caller.hospitalId,
      name,
      shortName: name,
      area: area || hospital?.area || "",
      address: address || hospital?.address || "",
      city: hospital?.city ?? "",
      phone: phone || hospital?.phone || "",
      ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
      departments: hospital?.departments ?? ["General medicine"],
      respondMinutes: hospital?.respondMinutes ?? 15,
      accepting: hospital?.accepting ?? true,
      load: hospital?.load ?? "low",
      hours: hospital?.hours ?? "",
      setupDone: true,
      template: template.id,
    },
    { merge: true },
  );

  // The template's seats replace whatever was there.
  const old = await seatsOf(caller.hospitalId).get();
  const batch = db().batch();
  old.docs.forEach((d) => batch.delete(d.ref));
  template.seats.forEach((s, i) => batch.set(seatsOf(caller.hospitalId).doc(s.id), { name: s.name, abilities: s.abilities, order: i }));
  await batch.commit();

  await privateOf(caller.hospitalId).set(
    { ...(await hashPin(pin)), failures: 0, lockedUntil: null, sessionRules: DEFAULT_SESSION_RULES, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  const owner = template.seats.find((s) => s.id === template.ownerSeat)!;
  await seatPerson(caller.uid, caller.hospitalId, [owner]);
  await logActivity(caller, "clinic.setup", `${actorLabel(caller)} set up ${name} as ${template.name.toLowerCase()}, and took the seat ${owner.name}.`, { request });
  return { ok: true, seatName: owner.name };
});

/** A person's own profile, filled in at their first sign-in. Doctors must give a registration number. */
export const saveMyProfile = onCall(async (request) => {
  const caller = await liveStaff(request);
  await rateLimit(`profile:${caller.uid}`, 30, 3600);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const opt = (k: string, max = 80) => (typeof data[k] === "string" ? (data[k] as string).trim().slice(0, max) || null : null);
  const displayName = requireString(data.displayName, "Name", 80);
  const registrationNo = opt("registrationNo", 40);
  if (caller.abilities.includes("consult") && !registrationNo) {
    throw new HttpsError("invalid-argument", "A doctor's registration number goes on every prescription. Please add it.");
  }
  await db()
    .collection("accounts")
    .doc(caller.uid)
    .set(
      {
        displayName,
        qualification: opt("qualification"),
        registrationNo,
        department: opt("department"),
        phone: opt("phone", 20),
        consultingHours: opt("consultingHours"),
        profileDone: true,
      },
      { merge: true },
    );
  const user = await getAuth().getUser(caller.uid);
  await getAuth().setCustomUserClaims(caller.uid, { ...(user.customClaims ?? {}), name: displayName });
  await getAuth().updateUser(caller.uid, { displayName });
  await logActivity(caller, "profile.saved", `${displayName} completed their profile${registrationNo ? ` (registration ${registrationNo})` : ""}.`, { request });
  return { ok: true };
});

/* ------------------------------------------------------------------ the PIN */

/** Checks the Manage PIN and gives a pass for 15 minutes. Five wrong tries lock it for 15 minutes. */
export const openManage = onCall(async (request) => {
  const caller = await liveStaff(request);
  assertAbility(caller, "manage");
  await rateLimit(`manage-pin:${caller.uid}`, 60, 3600);
  const pin = readPin(request.data);
  const ref = privateOf(caller.hospitalId);
  const p = ((await ref.get()).data() ?? {}) as Private;
  if (!p.pinHash || !p.pinSalt) throw new HttpsError("failed-precondition", "No Manage PIN is set yet. Finish setting up the clinic first.");
  if (p.lockedUntil && p.lockedUntil.toMillis() > Date.now()) {
    const mins = Math.ceil((p.lockedUntil.toMillis() - Date.now()) / 60_000);
    throw new HttpsError("resource-exhausted", `Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
  const given = await scrypt(pin, p.pinSalt, 32);
  if (!timingSafeEqual(given, Buffer.from(p.pinHash, "hex"))) {
    const failures = (p.failures ?? 0) + 1;
    const locked = failures >= LOCK_AFTER;
    await ref.update({ failures: locked ? 0 : failures, lockedUntil: locked ? Timestamp.fromMillis(Date.now() + LOCK_MINUTES * 60_000) : null });
    await logActivity(
      caller,
      locked ? "manage.locked" : "manage.wrong_pin",
      locked
        ? `${actorLabel(caller)} entered a wrong Manage PIN ${LOCK_AFTER} times, so the Manage page is locked for ${LOCK_MINUTES} minutes.`
        : `${actorLabel(caller)} entered a wrong Manage PIN (${failures} of ${LOCK_AFTER}).`,
      { request },
    );
    throw new HttpsError("permission-denied", locked ? `Wrong PIN. The Manage page is locked for ${LOCK_MINUTES} minutes.` : `Wrong PIN. ${LOCK_AFTER - failures} more tries before it locks.`);
  }
  const token = randomBytes(24).toString("hex");
  const expiresAt = Date.now() + PASS_MINUTES * 60_000;
  await ref.update({ failures: 0, lockedUntil: null });
  await ref.collection("passes").doc(caller.uid).set({ tokenHash: sha(token), expiresAt: Timestamp.fromMillis(expiresAt) });
  await logActivity(caller, "manage.opened", `${actorLabel(caller)} opened the Manage page.`, { request });
  return { token, expiresAt };
});

/** A caller holding the Manage ability and a live pass. Each use extends the pass. */
export async function requireManage(request: CallableRequest): Promise<Caller> {
  const caller = await liveStaff(request);
  assertAbility(caller, "manage");
  const token = String((request.data as { manageToken?: unknown } | undefined)?.manageToken ?? "");
  const ref = privateOf(caller.hospitalId).collection("passes").doc(caller.uid);
  const pass = (await ref.get()).data() as { tokenHash: string; expiresAt: Timestamp } | undefined;
  if (!token || !pass || pass.tokenHash !== sha(token) || pass.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "MANAGE_PIN: Enter the Manage PIN again.");
  }
  await ref.update({ expiresAt: Timestamp.fromMillis(Date.now() + PASS_MINUTES * 60_000) });
  return caller;
}

/** Closes the pass (leaving the Manage page). */
export const closeManage = onCall(async (request) => {
  const caller = await liveStaff(request);
  await privateOf(caller.hospitalId).collection("passes").doc(caller.uid).delete();
  return { ok: true };
});

/* ------------------------------------------------------------------ manage */

/** Everything the Manage page shows. */
export const manageState = onCall(async (request) => {
  const caller = await requireManage(request);
  const [seats, team, p, hospital] = await Promise.all([
    seatsOf(caller.hospitalId).orderBy("order").get(),
    db().collection("accounts").where("hospitalId", "==", caller.hospitalId).get(),
    privateOf(caller.hospitalId).get(),
    db().collection("hospitals").doc(caller.hospitalId).get(),
  ]);
  const uids = team.docs.map((d) => ({ uid: d.id }));
  const emails = new Map<string, string>();
  for (let i = 0; i < uids.length; i += 100) {
    const r = await getAuth().getUsers(uids.slice(i, i + 100));
    r.users.forEach((u) => emails.set(u.uid, u.email ?? ""));
  }
  const h = hospital.data() ?? {};
  return {
    seats: seats.docs.map((d) => ({ id: d.id, ...(d.data() as StoredSeat) })),
    team: team.docs
      .map((d) => {
        const a = d.data();
        return {
          uid: d.id,
          displayName: a.displayName,
          email: emails.get(d.id) ?? "",
          seatId: a.seatId ?? null,
          seatIds: seatIdsOf(a),
          seatName: a.seatName ?? null,
          abilities: cleanAbilities(a.abilities ?? []),
          active: a.active !== false,
          department: a.department ?? null,
        };
      })
      .sort((x, y) => x.displayName.localeCompare(y.displayName)),
    sessionRules: cleanSessionRules((p.data() as Private | undefined)?.sessionRules ?? {}),
    clinic: { name: h.name ?? "", address: h.address ?? "", phone: h.phone ?? "", hours: h.hours ?? "", template: h.template ?? null },
    status: {
      accepting: h.accepting !== false,
      load: h.load ?? "low",
      respondMinutes: h.respondMinutes ?? 15,
      acceptsNew: h.acceptsNew !== false,
      acceptsFollowUp: h.acceptsFollowUp !== false,
      departments: Array.isArray(h.departments) ? h.departments : [],
      consultationFee: typeof h.consultationFee === "number" ? h.consultationFee : null,
      razorpayPage: h.razorpayPage ?? null,
      charges: h.charges ?? [],
    },
    me: caller.uid,
  };
});

/** Adds or changes a seat. Everyone in it gets the new abilities at once. */
export const saveSeat = onCall(async (request) => {
  const caller = await requireManage(request);
  const seat = ((request.data as { seat?: unknown })?.seat ?? {}) as { id?: unknown; name?: unknown; abilities?: unknown };
  const name = requireString(seat.name, "Seat name", 40);
  const abilities = cleanAbilities(seat.abilities);
  const existing = typeof seat.id === "string" && seat.id ? seat.id : null;
  let id = existing ?? seatIdFrom(name);
  if (!existing) {
    // A new seat never takes over an old one's id.
    let n = 2;
    while ((await seatsOf(caller.hospitalId).doc(id).get()).exists) id = `${seatIdFrom(name)}-${n++}`;
  }
  if (!abilities.includes("manage")) {
    // A person's abilities are all their seats together, this one as it will be.
    const seatsNow = new Map((await seatsOf(caller.hospitalId).get()).docs.map((d) => [d.id, cleanAbilities((d.data() as StoredSeat).abilities)]));
    seatsNow.set(id, abilities);
    const left = await managersAfter(caller.hospitalId, (_uid, ab, ids) => (ids.includes(id) ? cleanAbilities(ids.flatMap((s) => seatsNow.get(s) ?? [])) : ab));
    if (left === 0) throw lockoutGuard();
  }
  const all = await seatsOf(caller.hospitalId).get();
  const order = existing ? ((await seatsOf(caller.hospitalId).doc(id).get()).data()?.order ?? all.size) : all.size;
  await seatsOf(caller.hospitalId).doc(id).set({ name, abilities, order });
  const team = await db().collection("accounts").where("hospitalId", "==", caller.hospitalId).get();
  const members = { docs: team.docs.filter((d) => seatIdsOf(d.data()).includes(id)), get size() { return this.docs.length; } };
  for (const m of members.docs) await seatPerson(m.id, caller.hospitalId, await loadSeats(caller.hospitalId, seatIdsOf(m.data())));
  await logActivity(
    caller,
    existing ? "manage.seat_changed" : "manage.seat_added",
    `${actorLabel(caller)} ${existing ? "changed" : "added"} the seat ${name}: it can ${abilityWords(abilities)}${members.size ? ` (${members.size} ${members.size === 1 ? "person" : "people"} in it)` : ""}.`,
    { request },
  );
  return { id };
});

/** Removes an empty seat. */
export const deleteSeat = onCall(async (request) => {
  const caller = await requireManage(request);
  const id = requireString((request.data as { id?: unknown })?.id, "Seat", 60);
  const team = await db().collection("accounts").where("hospitalId", "==", caller.hospitalId).get();
  if (team.docs.some((d) => seatIdsOf(d.data()).includes(id))) throw new HttpsError("failed-precondition", "Take this role away from everyone first.");
  const ref = seatsOf(caller.hospitalId).doc(id);
  const name = (await ref.get()).data()?.name ?? id;
  await ref.delete();
  await logActivity(caller, "manage.seat_removed", `${actorLabel(caller)} removed the seat ${name}.`, { request });
  return { ok: true };
});

/** Gives a person their roles: one, or several that add up. */
export const assignSeat = onCall(async (request) => {
  const caller = await requireManage(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = requireString(data.uid, "Person", 128);
  const seatIds = requireSeatIds(data);
  const person = await db().collection("accounts").doc(uid).get();
  if (!person.exists || person.data()?.hospitalId !== caller.hospitalId) throw new HttpsError("not-found", "That person is not on this team.");
  const seats = await loadSeats(caller.hospitalId, seatIds);
  const abilities = unionAbilities(seats);
  if (!abilities.includes("manage")) {
    const left = await managersAfter(caller.hospitalId, (u, ab) => (u === uid ? abilities : ab));
    if (left === 0) throw lockoutGuard();
  }
  await seatPerson(uid, caller.hospitalId, seats);
  const names = seats.map((s) => s.name);
  await logActivity(
    caller,
    "manage.seat_assigned",
    `${actorLabel(caller)} gave ${person.data()?.displayName} ${names.length === 1 ? "the role" : "the roles"} ${names.join(" and ")}.`,
    { request },
  );
  return { ok: true };
});

/** Deactivates (or brings back) a person. A deactivated person cannot sign in; their history stays. */
export const setMemberActive = onCall(async (request) => {
  const caller = await requireManage(request);
  const data = (request.data ?? {}) as { uid?: unknown; active?: unknown };
  const uid = requireString(data.uid, "Person", 128);
  const active = data.active === true;
  if (uid === caller.uid && !active) throw new HttpsError("failed-precondition", "You cannot deactivate yourself.");
  const ref = db().collection("accounts").doc(uid);
  const person = await ref.get();
  if (!person.exists || person.data()?.hospitalId !== caller.hospitalId) throw new HttpsError("not-found", "That person is not on this team.");
  if (!active) {
    const left = await managersAfter(caller.hospitalId, (u, ab) => (u === uid ? [] : ab));
    if (left === 0) throw lockoutGuard();
  }
  await getAuth().updateUser(uid, { disabled: !active });
  await ref.update({ active, onDuty: false });
  if (!active) {
    await getAuth().revokeRefreshTokens(uid);
    await db().collection("staffSessions").doc(uid).set({ active: false, endedAt: FieldValue.serverTimestamp(), endReason: "Your account was deactivated." }, { merge: true });
  }
  await logActivity(caller, active ? "manage.reactivated" : "manage.deactivated", `${actorLabel(caller)} ${active ? "brought back" : "deactivated"} ${person.data()?.displayName}.`, { request });
  return { ok: true };
});

/** The clinic's details and its session rules. */
export const saveSettings = onCall(async (request) => {
  const caller = await requireManage(request);
  const data = (request.data ?? {}) as { sessionRules?: unknown; clinic?: Record<string, unknown>; status?: Record<string, unknown> };
  // The screen sends every setting on each save; only what actually changed
  // is written and said in the log, so the doctor reads what was done.
  const hospitalRef = db().collection("hospitals").doc(caller.hospitalId);
  const [hSnap, pSnap] = await Promise.all([hospitalRef.get(), privateOf(caller.hospitalId).get()]);
  const h = hSnap.data() ?? {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changes: string[] = [];

  if (data.status) {
    // Whether the clinic takes requests, and which kinds, how busy it is, how
    // fast it promises to answer, its departments and its fee.
    const st = data.status;
    const next: Record<string, unknown> = {};
    if (typeof st.accepting === "boolean") next.accepting = st.accepting;
    if (typeof st.acceptsNew === "boolean") next.acceptsNew = st.acceptsNew;
    if (typeof st.acceptsFollowUp === "boolean") next.acceptsFollowUp = st.acceptsFollowUp;
    if (["low", "medium", "high"].includes(st.load as string)) next.load = st.load;
    const minutes = Number(st.respondMinutes);
    if ([10, 15, 20, 30, 45, 60].includes(minutes)) next.respondMinutes = minutes;
    if (Array.isArray(st.departments)) {
      next.departments = [...new Set(st.departments.map((x) => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
    }
    if (st.consultationFee === null || st.consultationFee === "") next.consultationFee = null;
    else if (Number.isFinite(Number(st.consultationFee)) && Number(st.consultationFee) >= 0 && Number(st.consultationFee) <= 100_000) {
      next.consultationFee = Math.round(Number(st.consultationFee));
    }
    if (Array.isArray(st.charges)) {
      // One line per charge, each name once, the consultation kept to its own fee above.
      const seen = new Set<string>();
      next.charges = cleanBillLines(st.charges).filter((c) => {
        const k = c.label.toLowerCase();
        if (k === "consultation" || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    if (st.razorpayPage === null || st.razorpayPage === "") next.razorpayPage = null;
    else if (st.razorpayPage !== undefined) {
      const page = cleanRazorpayPage(st.razorpayPage);
      if (!page) throw new HttpsError("invalid-argument", "That is not a Razorpay payment page. It looks like https://rzp.io/rzp/... or https://pages.razorpay.com/...");
      next.razorpayPage = page;
    }
    // Absent means on: a clinic takes requests of both kinds until it says otherwise.
    const current: Record<string, unknown> = {
      accepting: h.accepting !== false,
      acceptsNew: h.acceptsNew !== false,
      acceptsFollowUp: h.acceptsFollowUp !== false,
      load: h.load ?? "low",
      respondMinutes: h.respondMinutes ?? 15,
      departments: h.departments ?? [],
      consultationFee: typeof h.consultationFee === "number" ? h.consultationFee : null,
      razorpayPage: h.razorpayPage ?? null,
      charges: h.charges ?? [],
    };
    const update = Object.fromEntries(Object.entries(next).filter(([k, v]) => !same(v, current[k])));
    if (Object.keys(update).length) {
      await hospitalRef.set(update, { merge: true });
      const after = { ...current, ...update };
      const said: string[] = [];
      if ("accepting" in update) said.push(update.accepting ? "is taking requests from the app again" : "is not taking requests from the app (walk-ins only)");
      if ("acceptsNew" in update || "acceptsFollowUp" in update) {
        const kinds = [after.acceptsNew ? "new problems" : null, after.acceptsFollowUp ? "follow-ups" : null].filter(Boolean);
        said.push(kinds.length ? `takes ${kinds.join(" and ")} from the app` : "takes no requests from the app");
      }
      if ("load" in update) said.push(`is marked ${({ low: "Quiet", medium: "Busy", high: "Full" } as Record<string, string>)[update.load as string]}`);
      if ("respondMinutes" in update) said.push(`answers requests within ${update.respondMinutes} minutes`);
      if ("departments" in update) said.push(`has the departments ${(update.departments as string[]).join(", ") || "none"}`);
      if ("consultationFee" in update) said.push(update.consultationFee == null ? "has no set consultation fee" : `charges ₹${update.consultationFee} for a consultation`);
      if ("charges" in update) said.push(`charges ${(update.charges as { label: string; amount: number }[]).map((c) => `${c.label} ₹${c.amount}`).join(", ") || "nothing besides the consultation"}`);
      if ("razorpayPage" in update) said.push(update.razorpayPage ? `takes payments on its Razorpay page ${update.razorpayPage}` : "has no Razorpay page");
      changes.push(`the clinic now ${said.join(", ")}`);
    }
  }

  if (data.sessionRules !== undefined) {
    const rules = cleanSessionRules(data.sessionRules);
    if (!same(rules, cleanSessionRules((pSnap.data() as Private | undefined)?.sessionRules ?? {}))) {
      await privateOf(caller.hospitalId).set({ sessionRules: rules }, { merge: true });
      forgetSessionRules(caller.hospitalId);
      changes.push(`sessions now end when a device moves more than ${rules.moveLimitM} m${rules.endOnIpChange ? " or its internet address changes" : " (a change of internet address is logged but allowed)"}`);
    }
  }

  if (data.clinic) {
    const c = data.clinic;
    const pick = (k: string, max: number) => (typeof c[k] === "string" ? (c[k] as string).trim().slice(0, max) : undefined);
    const LABEL: Record<string, string> = { name: "name", address: "address", phone: "phone", hours: "opening hours" };
    const next = Object.fromEntries(
      [["name", pick("name", 80)], ["address", pick("address", 200)], ["phone", pick("phone", 20)], ["hours", pick("hours", 80)]].filter(([, v]) => v !== undefined && v !== ""),
    ) as Record<string, string>;
    const changed = Object.keys(next).filter((k) => next[k] !== (h[k] ?? ""));
    if (changed.length) {
      const update: Record<string, string> = Object.fromEntries(changed.map((k) => [k, next[k]]));
      if (update.name) update.shortName = update.name;
      await hospitalRef.set(update, { merge: true });
      changes.push(`the clinic's ${changed.map((k) => LABEL[k]).join(", ")} changed`);
    }
  }

  if (changes.length) await logActivity(caller, "manage.settings", `${actorLabel(caller)} changed the settings: ${changes.join("; ")}.`, { request });
  return { ok: true, changed: changes.length > 0 };
});

/** A new Manage PIN. Needs the person's password typed in the last five minutes too. */
export const changeManagePin = onCall(async (request) => {
  const caller = await requireManage(request);
  requireRecentSignIn(request);
  const pin = readPin(request.data);
  await privateOf(caller.hospitalId).set({ ...(await hashPin(pin)), failures: 0, lockedUntil: null }, { merge: true });
  await logActivity(caller, "manage.pin_changed", `${actorLabel(caller)} changed the Manage PIN.`, { request });
  return { ok: true };
});

/**
 * Adds a person to the team in a seat: a sign-in, the claims the rules and the
 * functions read, and the account the screens list. The first password is
 * handed back once, to pass on.
 */
export const createTeamMember = onCall(async (request) => {
  const caller = await requireManage(request);
  requireRecentSignIn(request);
  await rateLimit(`team:${caller.uid}`, 30, 3600);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const displayName = requireString(data.displayName, "Name", 80);
  const email = requireString(data.email, "Email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError("invalid-argument", "That does not look like an email address.");
  const seats = await loadSeats(caller.hospitalId, requireSeatIds(data));
  const department = typeof data.department === "string" && data.department.trim() ? data.department.trim().slice(0, 60) : null;

  const password = generateCode(10);
  let uid: string;
  try {
    uid = (await getAuth().createUser({ email, password, displayName })).uid;
  } catch (error) {
    if ((error as { code?: string }).code === "auth/email-already-exists") throw new HttpsError("already-exists", "Somebody already has that email address.");
    throw error;
  }
  await getAuth().setCustomUserClaims(uid, { name: displayName, hospitalId: caller.hospitalId });
  await db().collection("accounts").doc(uid).set({
    uid,
    displayName,
    hospitalId: caller.hospitalId,
    department,
    active: true,
    profileDone: false,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: caller.displayName,
  });
  await seatPerson(uid, caller.hospitalId, seats);
  await audit(caller, "team.create", { target: uid, seatIds: seats.map((s) => s.id) });
  await logActivity(caller, "team.created", `${actorLabel(caller)} added ${displayName} to the team as ${seats.map((s) => s.name).join(" and ")}.`, { request });
  return { uid, email, password };
});

/* ------------------------------------------------------------------ stats */

const msOf = (v: unknown): number | null => {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toMillis();
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};
const mins = (a: unknown, b: unknown) => {
  const x = msOf(a);
  const y = msOf(b);
  return x != null && y != null && y >= x ? (y - x) / 60_000 : null;
};
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null && x < 24 * 60);
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
};
const IST = 5.5 * 3_600_000;

/**
 * How the clinic is doing, for today, 7 or 30 days (India time): visits,
 * walk-ins and requests, waiting times, requests answered in time, each
 * doctor's patients, busy hours, and the pharmacy and billing desks if any.
 */
export const manageStats = onCall(async (request) => {
  const caller = await requireManage(request);
  const days = [1, 7, 30].includes(Number(request.data?.days)) ? Number(request.data?.days) : 7;
  const now = Date.now();
  const startToday = Math.floor((now + IST) / 86_400_000) * 86_400_000 - IST;
  const since = startToday - (days - 1) * 86_400_000;
  const from = Timestamp.fromMillis(since);

  const [seen, asked] = await Promise.all([
    db().collection("visits").where("hospitalId", "==", caller.hospitalId).where("registeredAt", ">=", from).orderBy("registeredAt", "desc").limit(3000).get(),
    db().collection("visits").where("candidateHospitalIds", "array-contains", caller.hospitalId).where("requestedAt", ">=", from).orderBy("requestedAt", "desc").limit(3000).get(),
  ]);
  const visits = seen.docs.map((d) => d.data());

  const byDoctor = new Map<string, { name: string; seen: number; consult: (number | null)[] }>();
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const v of visits) {
    const at = msOf(v.registeredAt);
    if (at != null) byHour[new Date(at + IST).getUTCHours()] += 1;
    if (v.stage === "prescribed" && v.assignedDoctorUid) {
      const d = byDoctor.get(v.assignedDoctorUid) ?? { name: v.assignedDoctorName ?? "Doctor", seen: 0, consult: [] as (number | null)[] };
      d.seen += 1;
      d.consult.push(mins(v.consultationStartedAt, v.prescribedAt));
      byDoctor.set(v.assignedDoctorUid, d);
    }
  }

  // Each request's attempt at this hospital: answered, timed out, declined, or still waiting.
  const outcomes = { answered: 0, timedOut: 0, declined: 0, waiting: 0 };
  for (const d of asked.docs) {
    const mine = ((d.data().attempts ?? []) as { hospitalId: string; outcome: keyof typeof outcomes | "timed_out" }[]).filter((a) => a.hospitalId === caller.hospitalId).at(-1);
    if (!mine) continue;
    if (mine.outcome === "timed_out") outcomes.timedOut += 1;
    else if (mine.outcome in outcomes) outcomes[mine.outcome as keyof typeof outcomes] += 1;
  }

  const billed = visits.filter((v) => typeof v.billTotal === "number");
  return {
    days,
    since: new Date(since).toISOString(),
    visits: {
      total: visits.length,
      walkIns: visits.filter((v) => v.source !== "pre_visit").length,
      fromRequests: visits.filter((v) => v.source === "pre_visit").length,
      prescribed: visits.filter((v) => v.stage === "prescribed").length,
      cancelled: visits.filter((v) => v.stage === "cancelled").length,
      waitingNow: visits.filter((v) => ["registered", "intake_complete", "in_consultation"].includes(v.stage)).length,
    },
    minutes: {
      waitForVitals: avg(visits.map((v) => mins(v.registeredAt, v.intakeCompletedAt))),
      waitForDoctor: avg(visits.map((v) => mins(v.intakeCompletedAt, v.consultationStartedAt))),
      consultation: avg(visits.map((v) => mins(v.consultationStartedAt, v.prescribedAt))),
      wholeVisit: avg(visits.map((v) => mins(v.registeredAt, v.prescribedAt))),
    },
    requests: { asked: asked.size, ...outcomes },
    doctors: [...byDoctor.values()].map((d) => ({ name: d.name, seen: d.seen, consultation: avg(d.consult) })).sort((a, b) => b.seen - a.seen),
    byHour,
    counters: {
      dispensed: visits.filter((v) => v.dispensedAt).length,
      billedTotal: billed.reduce((s, v) => s + (v.billTotal as number), 0),
      paid: billed.filter((v) => v.paid).length,
      unpaid: billed.filter((v) => !v.paid).length,
    },
  };
});
