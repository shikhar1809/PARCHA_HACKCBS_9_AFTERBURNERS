/**
 * The expiry printed on a strip, and what it means today.
 *
 * Strips print it a dozen ways — "EXP 07/2028", "Exp.07/28", "EXP: JUL 2028",
 * "Expiry 07-2028" — and always as a month, never a day. A medicine is good to
 * the end of that month. This reads only those forms; anything else is
 * "could not read", never a guess, because a wrong "still good" is the one
 * answer that must not be given.
 */
export type Expiry = { year: number; month: number };
export type ExpiryStatus = "expired" | "soon" | "ok";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const year4 = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** The expiry in a piece of printed text, or null if it does not say one plainly. */
export function parseExpiry(text: string): Expiry | null {
  const t = text.toUpperCase().replace(/\s+/g, " ");
  // Only after the word for expiry, so a manufacture date is never taken for it.
  const after = t.match(/\b(?:EXP(?:IRY)?|EXPIRES|USE BEFORE|BEST BEFORE)\b\.?\s*(?:DATE)?\s*[:.]?\s*(.{0,16})/);
  if (!after) return null;
  const s = after[1];
  const numeric = s.match(/^(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})\b/);
  if (numeric) {
    const month = Number(numeric[1]);
    const year = year4(numeric[2]);
    return month >= 1 && month <= 12 && year >= 2000 && year <= 2099 ? { year, month } : null;
  }
  const named = s.match(/^([A-Z]{3})[A-Z]*\.?\s*[/.-]?\s*(\d{4}|\d{2})\b/);
  if (named && MONTHS.includes(named[1])) {
    const year = year4(named[2]);
    return year >= 2000 && year <= 2099 ? { year, month: MONTHS.indexOf(named[1]) + 1 } : null;
  }
  return null;
}

/** Good to the last day of the printed month; "soon" inside the last `soonDays`. */
export function expiryStatus(exp: Expiry, today: Date, soonDays = 60): { status: ExpiryStatus; lastDay: string; daysLeft: number } {
  const last = new Date(Date.UTC(exp.year, exp.month, 0));
  const day = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const daysLeft = Math.round((last.getTime() - day) / 86_400_000);
  const lastDay = last.toISOString().slice(0, 10);
  return { status: daysLeft < 0 ? "expired" : daysLeft <= soonDays ? "soon" : "ok", lastDay, daysLeft };
}
