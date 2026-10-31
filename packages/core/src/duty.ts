/**
 * Who is on duty right now.
 *
 * Nobody ticks a box to be "on duty": a person is on duty while a device of
 * theirs is open, unlocked and checking in. The app sends a heartbeat every
 * minute; this reads how recent the last one is. Signing out, locking the
 * device or going quiet lets it age out, and a doctor who has set themselves
 * to "off" is off whatever the heartbeat says.
 */
import type { Account } from "./types.js";

/** A heartbeat is sent every minute; two missed ones and the person is off. */
export const DUTY_FRESH_MS = 150_000;

export function isOnDuty(account: Account, nowMs: number = Date.now()): boolean {
  if (account.active === false) return false;
  if (account.onDuty === false) return false;
  if (account.accountType === "doctor" && account.availability === "off") return false;
  if (!account.lastSeenAt) return false;
  return nowMs - new Date(account.lastSeenAt).getTime() < DUTY_FRESH_MS;
}
