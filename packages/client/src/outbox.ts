/**
 * Changes made with no connection.
 *
 * Someone ticks off a dose on a bus with no signal; a front desk registers a
 * patient while the clinic's internet is down. The change must not be lost, and
 * must not make anyone wait. So the action is saved on the device first, shown at
 * once, and sent the moment a connection is back, in the order it was made.
 *
 * Two kinds of action are kept:
 *
 *   - A patient's (tick a dose, save a reminder): safe to repeat, so if the
 *     server ever refuses one it is dropped, because waiting will not change it.
 *   - A clinic's (register, intake, start a consultation, sign): these depend on
 *     what the server says is true. If it refuses one on arrival (the patient has
 *     already moved on, a new safety warning appeared), the action is NOT thrown
 *     away. It is kept, marked as needing attention, with the server's own words,
 *     so a person decides. Each carries a name (opId) the server remembers, so
 *     sending one twice never does it twice.
 *
 * What it cannot do: two computers that are both offline do not see each other's
 * work. The desk's intake reaches the doctor's screen only when the desk is back
 * online.
 */
import { onAuthStateChanged } from "firebase/auth";
import { disableNetwork, enableNetwork } from "firebase/firestore";
import { useEffect, useSyncExternalStore } from "react";

import { call, getAuthClient, getDb } from "./firebase";
import { vaultGet, vaultPut } from "./vault";

export type QueuedCall = {
  id: string;
  name: string;
  args: unknown;
  at: number;
  /** "waiting" (or absent) until it is sent; "failed" if the server refused it on arrival. */
  status?: "waiting" | "failed";
  /** The server's words, when it refused. */
  error?: string;
  /** What the screens need to show this action as already done. Opaque here. */
  local?: unknown;
  /** Clinic actions are kept when refused; a patient's are dropped. */
  durable?: boolean;
};

let items: QueuedCall[] = [];
let loaded: Promise<void> | null = null;
let flushing = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let loadedFor: string | null = null;

/**
 * The saved queue belongs to whoever is signed in, so it can only be read once
 * sign-in has settled, and is read again if a different person signs in.
 */
function load(): Promise<void> {
  const auth = getAuthClient();
  const next = async () => {
    await auth.authStateReady();
    const uid = auth.currentUser?.uid ?? null;
    if (uid === loadedFor && loaded) return;
    // A different person: what was on screen for the last one does not carry over.
    if (loadedFor !== null && uid !== loadedFor) items = [];
    const saved = uid ? await vaultGet<QueuedCall[]>("outbox") : undefined;
    // Anything queued before the vault answered is kept, after what was saved.
    items = [...(saved ?? []), ...items];
    loadedFor = uid;
    emit();
  };
  const running = (loaded ?? Promise.resolve()).then(next);
  loaded = running;
  return running;
}

const persist = () => vaultPut("outbox", items);

const FORCE = "parcha.forceOffline";

/** True when the person (or a developer testing) has switched the app to act offline. */
export function forcedOffline(): boolean {
  try {
    return localStorage.getItem(FORCE) === "1";
  } catch {
    return false;
  }
}

/**
 * For testing on a laptop: act as though there is no connection, both for
 * changes (they queue) and for reads (Firestore serves its saved copy).
 */
export async function setForcedOffline(on: boolean): Promise<void> {
  try {
    if (on) localStorage.setItem(FORCE, "1");
    else localStorage.removeItem(FORCE);
  } catch {
    /* it works for this page load */
  }
  try {
    if (on) await disableNetwork(getDb());
    else await enableNetwork(getDb());
  } catch {
    /* no Firestore yet */
  }
  emit();
  if (!on) void flushOutbox();
}

const offline = () => forcedOffline() || (typeof navigator !== "undefined" && navigator.onLine === false);

const isNetworkError = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? "";
  const msg = String((e as { message?: string })?.message ?? "");
  return code === "functions/unavailable" || code === "functions/deadline-exceeded" || /network|failed to fetch|offline|load failed/i.test(msg);
};

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The server's sentence, without the SDK's decoration. */
const plainMessage = (e: unknown) =>
  String((e as { message?: string })?.message ?? "It was refused.")
    .replace(/^(FirebaseError:\s*)?/, "")
    .replace(/\s*\[\d{3}\]\s*$/, "")
    .replace(/^[A-Z][A-Z_]{3,}:\s*/, "");

/**
 * Calls a function; if there is no connection, keeps the call on the device to
 * send later and answers with the fallback, which says what the call would have
 * returned. opts.local describes the action for the screens that must show it as
 * already done. Errors that are not about the network (a refusal, a bad request)
 * are thrown as usual when online, because queueing them would only delay the bad
 * news.
 */
export async function callQueued<A, R>(
  name: string,
  args: A,
  fallback: (a: A) => R,
  opts: { local?: unknown; durable?: boolean } = {},
): Promise<R> {
  await load();
  const id = newId();
  // The server remembers this name, so a second send of the same action does nothing.
  const named = opts.durable ? ({ ...(args as object), opId: id } as A) : args;
  if (!offline()) {
    try {
      return await call<A, R>(name, named);
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  // The server is told when the action was really done, which matters for a signature.
  const stamped = opts.durable ? ({ ...(named as object), queuedAt: new Date().toISOString() } as A) : named;
  items = [...items, { id, name, args: stamped, at: Date.now(), local: opts.local, durable: opts.durable }];
  emit();
  await persist();
  return fallback(args);
}

/** Sends what is waiting, oldest first. Stops at the first sign the network is still down. */
export async function flushOutbox(): Promise<void> {
  await load();
  if (flushing || offline()) return;
  flushing = true;
  try {
    // Look again each time round: new items may have joined while one was being sent.
    for (;;) {
      const next = items.find((i) => i.status !== "failed");
      if (!next || offline()) break;
      try {
        await call(next.name, next.args);
        items = items.filter((i) => i.id !== next.id);
      } catch (e) {
        if (isNetworkError(e)) break;
        if (next.durable) {
          // A clinic action the server refused: keep it, and say why.
          items = items.map((i) => (i.id === next.id ? { ...i, status: "failed" as const, error: plainMessage(e) } : i));
        } else {
          // A patient's refusal will not change by waiting; drop it rather than block everything behind it.
          console.warn("[parcha] dropped a queued change the server refused:", next.name, e);
          items = items.filter((i) => i.id !== next.id);
        }
      }
      emit();
      await persist();
    }
  } finally {
    flushing = false;
  }
}

/** Removes an action that was refused, once somebody has read why. */
export async function dismissQueued(id: string): Promise<void> {
  items = items.filter((i) => i.id !== id);
  emit();
  await persist();
}

/** Everything queued, including what was refused. */
export function useOutbox(): QueuedCall[] {
  useEffect(() => void load(), []);
  return useSyncExternalStore(subscribe, () => items, () => items);
}

/** Whether the app is acting offline right now (no connection, or switched to it). */
export function useOffline(): boolean {
  return useSyncExternalStore(
    (l) => {
      subscribe(l);
      window.addEventListener("online", l);
      window.addEventListener("offline", l);
      return () => {
        listeners.delete(l);
        window.removeEventListener("online", l);
        window.removeEventListener("offline", l);
      };
    },
    offline,
    () => false,
  );
}

/** Sends the waiting changes when a connection returns, on start, and every so often. Mount once. */
export function useOutboxSync() {
  useEffect(() => {
    void flushOutbox();
    const back = () => void flushOutbox();
    window.addEventListener("online", back);
    const timer = setInterval(() => void flushOutbox(), 20_000);
    // Honour a developer's "pretend to be offline" across a reload.
    if (forcedOffline()) void disableNetwork(getDb()).catch(() => undefined);
    // Whoever signs in has their own saved queue to pick up and send.
    const unwatch = onAuthStateChanged(getAuthClient(), () => void flushOutbox());
    return () => {
      window.removeEventListener("online", back);
      clearInterval(timer);
      unwatch();
    };
  }, []);
}

export const newClientId = () => `c_${newId()}`;
