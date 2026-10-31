/**
 * The rules a clinic session is held to. Pure, so the server and the tests
 * read the same numbers.
 *
 * A staff session is tied to where it started: the internet address the server
 * saw, and the place the device said it was. If either changes, the session
 * ends at once and the person signs in again.
 *
 * Two allowances keep it from ending sessions for nothing:
 *   - GPS wanders. A move only counts when it is larger than MOVE_LIMIT_M and
 *     larger than twice the reading's own stated accuracy.
 *   - A computer with both IPv4 and IPv6 may reach the server over either. In
 *     the first DUAL_STACK_GRACE_MS of a session, an address of the other
 *     family is learned as the same device rather than counted as a change.
 */

export const MOVE_LIMIT_M = 300;
export const DUAL_STACK_GRACE_MS = 2 * 60_000;
/** Within this distance of the hospital, a session is "at the clinic". */
export const AT_CLINIC_M = 300;

const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const isIpv6 = (ip: string) => ip.includes(":");

/** Whether a new reading is far enough from where the session started to count as moving. */
export function movedTooFar(
  start: { lat: number; lng: number },
  now: { lat: number; lng: number; accuracyM?: number | null },
  limitM: number = MOVE_LIMIT_M,
): boolean {
  const d = distanceMetres(start, now);
  return d > Math.max(limitM, 2 * (now.accuracyM ?? 0));
}

/**
 * What to do with an address the session has not seen: "same" (it has),
 * "learn" (the other family, early in the session), or "changed".
 */
export function judgeAddress(known: string[], ip: string, sessionAgeMs: number): "same" | "learn" | "changed" {
  if (known.includes(ip)) return "same";
  const otherFamily = known.length > 0 && known.every((k) => isIpv6(k) !== isIpv6(ip));
  if (otherFamily && sessionAgeMs <= DUAL_STACK_GRACE_MS) return "learn";
  return "changed";
}

/** "At the clinic", "2.4 km from the clinic", or "Location not shared". */
export function placeText(
  hospital: { lat: number; lng: number } | null,
  at: { lat: number | null; lng: number | null },
): string {
  if (at.lat == null || at.lng == null) return "Location not shared";
  if (!hospital) return `At ${at.lat.toFixed(4)}, ${at.lng.toFixed(4)}`;
  const d = distanceMetres(hospital, { lat: at.lat, lng: at.lng });
  if (d <= AT_CLINIC_M) return "At the clinic";
  return d < 1000 ? `${Math.round(d / 10) * 10} m from the clinic` : `${(d / 1000).toFixed(1)} km from the clinic`;
}

/** A short device name from a browser's user agent, for the activity log. */
export function deviceName(userAgent: string): string {
  const ua = userAgent || "";
  const app = /Electron\//.test(ua) ? "Parcha desktop program" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "a browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${app} on ${os}` : app;
}
