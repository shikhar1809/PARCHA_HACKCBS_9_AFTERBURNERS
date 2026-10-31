/**
 * Hospitals, and how far away they are.
 *
 * Parcha is one product for many hospitals. Each hospital is its own world: its
 * own team, its own patients' records, its own queues, and none of it visible
 * to another hospital. What is shared is the thing a patient sees: a map of
 * hospitals, and a promise from each one about how fast it will answer.
 */

import type { Hospital } from "./types.js";

/**
 * How long a hospital has to answer a request before it is tried elsewhere.
 * It is each hospital's own promise (`respondMinutes`), and this is what a
 * hospital promises unless it says otherwise.
 */
export const RESPONSE_MINUTES = 15;

export type LatLng = { lat: number; lng: number };

/**
 * Where the patient is, for the demo: Shaheed Sukhdev College of Business
 * Studies, Sector 16, Rohini, where Parcha is shown. The map and the distances
 * start here instead of asking the phone, so the demo is the same on any device.
 * (OpenStreetMap's position for the college.)
 */
export const DEMO_PLACE = { lat: 28.7327, lng: 77.119, label: "Shaheed Sukhdev College, Sector 16, Rohini" } as const;

/** Where the map opens: the demo place. */
export const DEFAULT_CENTRE: LatLng = { lat: DEMO_PLACE.lat, lng: DEMO_PLACE.lng };

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. Accurate enough to rank hospitals. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** Hospitals nearest first, each with its distance. */
export function rankByDistance(
  from: LatLng,
  hospitals: Hospital[],
): (Hospital & { km: number })[] {
  return hospitals
    .map((h) => ({ ...h, km: distanceKm(from, h) }))
    .sort((a, b) => a.km - b.km);
}

/** When a request made at `from` must have been answered by. */
export function respondBy(from: Date, minutes: number = RESPONSE_MINUTES): Date {
  return new Date(from.getTime() + minutes * 60_000);
}

/** Whole seconds left until a deadline, never below zero. */
export function secondsLeft(deadline: string | Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now.getTime()) / 1000));
}

/** "14:32" style countdown for a number of seconds. */
export function clock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "2.4 km" or "850 m". */
export function formatDistance(km: number): string {
  // Under a kilometre, to the nearest 50 m: precise enough to walk by.
  return km < 1 ? `${Math.round((km * 1000) / 50) * 50} m` : `${km.toFixed(1)} km`;
}
