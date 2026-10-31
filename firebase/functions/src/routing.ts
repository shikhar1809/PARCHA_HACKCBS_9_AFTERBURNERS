/**
 * Choosing a hospital, and moving a request from one to the next.
 *
 * A patient asks one hospital. That hospital has a promise to keep (by default
 * fifteen minutes to confirm or decline). If it does not, or says it cannot, the
 * request is not left to rot: it moves to the next-nearest hospital that is
 * taking requests, with a fresh clock, and the patient is told who is being
 * tried. The order is fixed when the patient asks, so it cannot be gamed by
 * timing and is the same however many times anything retries.
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

import {
  DEFAULT_CENTRE,
  RESPONSE_MINUTES,
  distanceKm,
  respondBy,
  type LatLng,
} from "../../../packages/core/src/hospitals.js";
import type { Hospital, Visit } from "../../../packages/core/src/types.js";
import { db } from "./guards.js";

/** How many hospitals a single request may be tried at. */
export const MAX_ATTEMPTS = 4;

export async function loadHospital(id: string): Promise<Hospital | null> {
  const snap = await db().collection("hospitals").doc(id).get();
  return snap.exists ? ({ id: snap.id, ...snap.data() } as Hospital) : null;
}

export async function loadHospitals(): Promise<Hospital[]> {
  const snap = await db().collection("hospitals").limit(100).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Hospital);
}

/**
 * The order hospitals will be tried in: the one the patient chose first, then
 * the rest of those taking requests, nearest to the patient first. If the
 * patient did not share where they are, "nearest" is measured from the one
 * they chose, which is still a sensible neighbourhood.
 */
export function candidateOrder(
  chosen: Hospital,
  all: Hospital[],
  from?: LatLng,
): string[] {
  const origin = from ?? { lat: chosen.lat, lng: chosen.lng };
  const rest = all
    .filter((h) => h.id !== chosen.id && h.accepting)
    .sort((a, b) => distanceKm(origin, a) - distanceKm(origin, b));
  return [chosen.id, ...rest.map((h) => h.id)].slice(0, MAX_ATTEMPTS);
}

/** A latitude and longitude from a request, or undefined if it is not one. */
export function readLocation(value: unknown): LatLng | undefined {
  const v = value as { lat?: unknown; lng?: unknown } | undefined;
  if (
    v &&
    typeof v.lat === "number" &&
    typeof v.lng === "number" &&
    Math.abs(v.lat) <= 90 &&
    Math.abs(v.lng) <= 180
  ) {
    return { lat: v.lat, lng: v.lng };
  }
  return undefined;
}

export { DEFAULT_CENTRE };

type PersonRecord = {
  fullName: string;
  phone: string;
  sex?: string | null;
  statedAgeYears?: number | null;
  villageOrArea?: string | null;
  preferredLanguage?: string;
};

/**
 * This person's record at a given hospital: found if they have been there,
 * created if not. Each hospital keeps its own records, so a request to a new
 * hospital opens a fresh file there. What is carried over is who they are (name,
 * phone, age), never their clinical history, which belongs to the hospital that
 * made it.
 */
export async function ensurePatientAt(
  hospitalId: string,
  person: PersonRecord,
): Promise<{ id: string; hasAllergy: boolean }> {
  const found = await db()
    .collection("patients")
    .where("hospitalId", "==", hospitalId)
    .where("phone", "==", person.phone)
    .where("fullName", "==", person.fullName)
    .limit(1)
    .get();
  if (!found.empty) {
    const id = found.docs[0].id;
    return { id, hasAllergy: await hasLiveAllergyAt(id) };
  }
  const ref = db().collection("patients").doc();
  await ref.set({
    hospitalId,
    fullName: person.fullName,
    phone: person.phone,
    sex: person.sex ?? null,
    dateOfBirth: null,
    statedAgeYears: person.statedAgeYears ?? null,
    ageStatedOn:
      person.statedAgeYears == null ? null : FieldValue.serverTimestamp(),
    villageOrArea: person.villageOrArea ?? null,
    district: null,
    state: null,
    bloodGroup: null,
    preferredLanguage: person.preferredLanguage ?? "hi",
    notes: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    registeredBy: "Patient app",
  });
  return { id: ref.id, hasAllergy: false };
}

async function hasLiveAllergyAt(patientId: string): Promise<boolean> {
  const all = await db()
    .collection("patients")
    .doc(patientId)
    .collection("allergies")
    .get();
  const retracted = new Set(
    all.docs
      .map((d) => d.data().retractsAllergyId)
      .filter((id): id is string => Boolean(id)),
  );
  return all.docs.some((d) => !d.data().retractsAllergyId && !retracted.has(d.id));
}

/**
 * Starts the clock at a hospital: when it must answer by, and who has been
 * tried. Used when a request is first made and each time it moves on.
 */
export function startAttempt(
  hospital: Hospital,
  previous: NonNullable<Visit["attempts"]>,
  now: Date = new Date(),
) {
  const minutes = hospital.respondMinutes || RESPONSE_MINUTES;
  return {
    respondBy: Timestamp.fromDate(respondBy(now, minutes)),
    attempts: [
      ...previous,
      {
        hospitalId: hospital.id,
        hospitalName: hospital.name,
        at: now.toISOString(),
        outcome: "waiting" as const,
      },
    ],
  };
}

/** The next hospital in the order that has not been tried yet, if any. */
export function nextCandidate(visit: Visit, all: Hospital[]): Hospital | null {
  const tried = new Set((visit.attempts ?? []).map((a) => a.hospitalId));
  for (const id of visit.candidateHospitalIds ?? []) {
    if (tried.has(id)) continue;
    const h = all.find((x) => x.id === id);
    if (h && h.accepting) return h;
  }
  return null;
}

export function requireHospital(h: Hospital | null): Hospital {
  if (!h) throw new HttpsError("not-found", "That hospital is not available.");
  if (!h.accepting) {
    throw new HttpsError(
      "failed-precondition",
      `${h.name} is not taking requests from the app right now.`,
    );
  }
  return h;
}

/**
 * Whether a doctor can be sent patients now. "Off" (their own Today I am:
 * Off) always stops it. Being off duty (signed out, or switched off) stops it
 * at a real clinic; in the example set-ups one person switches between seats,
 * which signs the doctor out, so there it does not.
 */
export async function doctorUnavailable(doctor: { availability?: string; onDuty?: boolean }, hospitalId: string): Promise<boolean> {
  if (doctor.availability === "off") return true;
  if (doctor.onDuty !== false) return false;
  return (await loadHospital(hospitalId))?.example !== true;
}
