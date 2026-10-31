import { useSyncExternalStore } from "react";

/**
 * A helper's way past the simple screen.
 *
 * A person on the simple screen ("needs help") normally sees only that. A
 * helper can open the full app for them (their visits, schedule, papers),
 * for this launch of the app only: switching person, or opening the app
 * again, puts them back on the simple screen, which is where they are safe.
 */
const KEY = "parcha.fullAppFor";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return memory;
  }
}
let memory: string | null = null;

/** Whose full app is open, if a helper opened one. */
export function useFullAppFor(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    read,
    () => null,
  );
}

export function setFullAppFor(name: string | null) {
  memory = name;
  try {
    if (name) sessionStorage.setItem(KEY, name);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode: kept in memory for this page */
  }
  listeners.forEach((l) => l());
}
