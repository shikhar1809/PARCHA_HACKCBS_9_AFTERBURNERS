/**
 * Live reads.
 *
 * Every list in both apps is a Firestore snapshot listener, so a queue
 * updates itself when a doctor signs somewhere else in the building. That
 * replaces the broadcast-and-refresh arrangement the Postgres build needed,
 * and it is the one place the move to Firebase is straightforwardly better.
 *
 * The listener still carries no authority of its own: what a given account
 * can see is decided by the security rules, so a queue left open overnight on
 * a counter device shows nothing a signed-out session could read.
 */
import { onIdTokenChanged } from "firebase/auth";
import { Timestamp } from "firebase/firestore";

import { vaultGet, vaultPut } from "./vault";
import {
  collection,
  doc,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Query,
  type QueryConstraint,
} from "firebase/firestore";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { getAuthClient, getDb } from "./firebase";

/**
 * The hospital the signed-in staff member works at, if any.
 *
 * Staff queries are confined to it: the security rules refuse a read that is
 * not, so a query that left it out would simply be denied. The staff app sets
 * it once at sign-in and every hook that reads hospital data picks it up, so no
 * screen can forget. The patient app never sets it: a patient's reads are
 * governed by their phone number, across hospitals.
 */
let hospitalScope: string | null = null;
const scopeListeners = new Set<() => void>();

export function setHospitalScope(id: string | null) {
  if (hospitalScope === id) return;
  hospitalScope = id;
  scopeListeners.forEach((l) => l());
}

/** The hospital this account works at, for code that is not a hook. */
export const getHospitalScope = (): string | null => hospitalScope;

export function useHospitalScope(): string | null {
  return useSyncExternalStore(
    (cb) => {
      scopeListeners.add(cb);
      return () => scopeListeners.delete(cb);
    },
    () => hospitalScope,
    () => null,
  );
}

/**
 * A number that changes whenever the signed-in identity does.
 *
 * A live listener is opened under whoever is signed in at that moment, and the
 * security rules judge it once, there. If it was opened just before a sign-in
 * finished, or just after a sign-out, the server closes it with a permission
 * error and Firestore does not retry on its own, so the screen would stay
 * broken even after the right person was signed in. Every subscription below
 * lists this as a dependency, so a change of identity closes it and opens a
 * fresh one under the new one.
 */
function useIdentityEpoch(): number {
  const [epoch, setEpoch] = useState(0);
  useEffect(
    () => onIdTokenChanged(getAuthClient(), () => setEpoch((n) => n + 1)),
    [],
  );
  return epoch;
}

/**
 * Firestore hands back Timestamps; the shared types say ISO strings.
 * Converting once at the boundary keeps date handling out of the screens.
 */
export function plain<T>(data: Record<string, unknown>, id: string): T {
  const out: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Timestamp) {
      out[key] = value.toDate().toISOString();
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = plainObject(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

function plainObject(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value instanceof Timestamp ? value.toDate().toISOString() : value;
  }
  return out;
}

/**
 * How a live read treats a permission error.
 *
 * Right after a sign-in (or a switch of account), Firestore can still be
 * holding the previous identity for a moment and refuses a read that the new
 * one is entitled to. That is a race, not a verdict, and giving up on the first
 * refusal leaves a screen empty for no reason. So a refusal is retried a few
 * times with growing pauses; only if it keeps being refused is it shown as an
 * error. A genuine refusal costs the user about seven seconds before it
 * appears; a race costs them one.
 */
const RETRY_DELAYS_MS = [700, 1500, 3000, 6000];

function isPermissionError(e: { code?: string }): boolean {
  return e.code === "permission-denied";
}

/**
 * What a person is told when a read fails.
 *
 * Firestore's own messages are written for the developer who wrote the rule
 * ("evaluation error at L176:22 for 'get'"), and showing one to a patient is
 * both useless and a small leak of how the system is built. The raw text goes
 * to the console, where a developer will look; the screen gets a sentence that
 * says what to do.
 */
function friendly(e: { code?: string; message: string }): string {
  console.warn("[parcha] read failed:", e.code, e.message);
  switch (e.code) {
    case "permission-denied":
      return "This is not available to your account. If you think it should be, sign out and sign in again.";
    case "unavailable":
    case "deadline-exceeded":
      return "We could not reach the server. Check your connection; this will try again by itself.";
    case "resource-exhausted":
      return "We are very busy right now. Please wait a moment; this will try again by itself.";
    case "failed-precondition":
      // Almost always a database index that is missing or still being built.
      return "This list is still being set up on the server. Try again in a few minutes.";
    default:
      return "Something went wrong loading this. Please try again.";
  }
}

export type Loadable<T> = {
  data: T;
  loading: boolean;
  error: string | null;
  /** What is shown came from this device's saved copy, not from the server. */
  fromDevice?: boolean;
};

/**
 * Subscribes to one document.
 *
 * `mirror` names a spot in the device vault. Whatever arrives is saved there, and
 * until the first answer comes (or if none can) the saved copy is shown, marked
 * `fromDevice`. Without it, nothing is kept.
 */
export function useDoc<T>(path: string | null, mirror?: string): Loadable<T | null> {
  const epoch = useIdentityEpoch();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Loadable<T | null>>({
    data: null,
    loading: path !== null,
    error: null,
  });

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = false;
    // The saved copy fills the screen while the first answer is on its way.
    if (mirror) {
      void vaultGet<{ v: T | null }>(mirror).then((saved) => {
        if (!live && saved) setState({ data: saved.v, loading: false, error: null, fromDevice: true });
      });
    }
    const stop = onSnapshot(
      doc(getDb(), path),
      (snap) => {
        live = true;
        setAttempt(0);
        const data = snap.exists() ? plain<T>(snap.data(), snap.id) : null;
        if (mirror) void vaultPut(mirror, { v: data });
        setState({ data, loading: false, error: null });
      },
      (error) => {
        if (isPermissionError(error) && attempt < RETRY_DELAYS_MS.length) {
          timer = setTimeout(() => setAttempt((a) => a + 1), RETRY_DELAYS_MS[attempt]);
          return;
        }
        const message = friendly(error);
        if (mirror) {
          // No answer from the server: show what this device has, if it has anything.
          void vaultGet<{ v: T | null }>(mirror).then((saved) =>
            setState(saved ? { data: saved.v, loading: false, error: null, fromDevice: true } : { data: null, loading: false, error: message }),
          );
        } else {
          setState({ data: null, loading: false, error: message });
        }
      },
    );
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [path, epoch, attempt]);

  // A new path or a new identity starts the count again.
  useEffect(() => setAttempt(0), [path, epoch]);

  return state;
}

/** Subscribes to a query. `mirror` works as it does for `useDoc`. */
export function useQuery<T>(build: (() => Query) | null, mirror?: string): Loadable<T[]> {
  const epoch = useIdentityEpoch();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Loadable<T[]>>({
    data: [],
    loading: build !== null,
    error: null,
  });

  useEffect(() => {
    if (!build) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = false;
    if (mirror) {
      void vaultGet<T[]>(mirror).then((saved) => {
        if (!live && saved) setState({ data: saved, loading: false, error: null, fromDevice: true });
      });
    }
    const stop = onSnapshot(
      build(),
      (snap) => {
        live = true;
        setAttempt(0);
        const data = snap.docs.map((d) => plain<T>(d.data(), d.id));
        if (mirror) void vaultPut(mirror, data);
        setState({ data, loading: false, error: null });
      },
      (error) => {
        if (isPermissionError(error) && attempt < RETRY_DELAYS_MS.length) {
          timer = setTimeout(() => setAttempt((a) => a + 1), RETRY_DELAYS_MS[attempt]);
          return;
        }
        const message = friendly(error);
        if (mirror) {
          void vaultGet<T[]>(mirror).then((saved) =>
            setState(saved ? { data: saved, loading: false, error: null, fromDevice: true } : { data: [], loading: false, error: message }),
          );
        } else {
          setState({ data: [], loading: false, error: message });
        }
      },
    );
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [build, epoch, attempt]);

  useEffect(() => setAttempt(0), [build, epoch]);

  return state;
}

/** Builds a stable query factory so the effect above does not resubscribe. */
export function useQueryFactory(
  path: string,
  constraints: QueryConstraint[],
  deps: unknown[],
): () => Query {
  return useMemo(
    () => () => query(collection(getDb(), path), ...constraints),
    // The constraints are rebuilt every render; the caller names what in them
    // actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
}

export { collection, doc, orderBy, where, fsLimit as limit, query };
