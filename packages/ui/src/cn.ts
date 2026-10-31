/**
 * Joins class names, dropping falsy ones.
 *
 * Deliberately not tailwind-merge: nothing here relies on a later class
 * beating an earlier one, and a 10kB dependency for that would be the wrong
 * trade in an app meant to load on a cheap phone over patchy data.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
