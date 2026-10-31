/**
 * The staff session gate.
 *
 * Opens a session before the clinic app shows anything, and keeps it honest:
 * the device's location is watched, and it checks in every minute and whenever
 * it moves more than 100 m. The server decides whether the session stands
 * (same internet address, not moved away, location still shared). If it does
 * not, this device signs out at once and the sign-in screen says why.
 *
 * With no connection the app still opens (offline work is the point of the
 * outbox); the session starts as soon as the connection is back.
 */
import { distanceMetres } from "@parcha/core";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { call, setSessionEndedHandler } from "./firebase";
import { forcedOffline, useOffline } from "./outbox";
import { endedByServer, getStaffSessionId, setStaffSessionId, signOutUser } from "./session";

type Spot = { lat: number; lng: number; accuracy: number };
type GateState =
  | { phase: "locating" }
  | { phase: "starting" }
  | { phase: "open" }
  | { phase: "denied" }
  | { phase: "failed"; message: string };

/** A check-in moves the session along when the device has moved this far since the last one. */
const RECHECK_M = 100;

const isNetworkError = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? "";
  return (
    code === "functions/unavailable" ||
    code === "functions/deadline-exceeded" ||
    /network|failed to fetch|offline/i.test(String((e as Error)?.message ?? ""))
  );
};

const plain = (e: unknown) =>
  String((e as Error)?.message ?? "Could not open a session.")
    .replace(/^(FirebaseError:\s*)?/, "")
    .replace(/^[A-Z][A-Z_]{3,}:\s*/, "");

export function StaffSessionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ phase: "locating" });
  const [attempt, setAttempt] = useState(0);
  const offline = useOffline();
  const spot = useRef<Spot | null>(null);
  const sentFrom = useRef<Spot | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    setSessionEndedHandler(endedByServer);
    return () => setSessionEndedHandler(null);
  }, []);

  /** Starts the session if there is none yet, otherwise checks in. */
  const checkIn = useCallback(async () => {
    if (busy.current || forcedOffline() || navigator.onLine === false) return;
    busy.current = true;
    const here = spot.current;
    try {
      const open = getStaffSessionId();
      if (!open) {
        if (!here) return;
        const r = await call<object, { sessionId: string }>("startStaffSession", {
          lat: here.lat,
          lng: here.lng,
          accuracy: here.accuracy,
        });
        setStaffSessionId(r.sessionId);
      } else {
        const r = await call<object, { ended: boolean; reason?: string }>("sessionBeat", {
          sessionId: open,
          ...(here ? { lat: here.lat, lng: here.lng, accuracy: here.accuracy } : {}),
        });
        if (r.ended) {
          endedByServer(r.reason ?? "Your session has ended. Sign in again.");
          return;
        }
      }
      if (here) sentFrom.current = here;
      setState((s) => (s.phase === "open" ? s : { phase: "open" }));
    } catch (e) {
      // SESSION_ENDED is dealt with inside `call` (it signs out).
      if (isNetworkError(e)) {
        // No connection: let the person work; the session starts when it returns.
        setState((s) => (s.phase === "open" ? s : { phase: "open" }));
      } else if (!getStaffSessionId()) {
        setState({ phase: "failed", message: plain(e) });
      }
    } finally {
      busy.current = false;
    }
  }, []);

  /**
   * No location to be had. An example set-up opens anyway (the server says
   * whether this hospital allows it); a real clinic shows why it cannot open.
   */
  const withoutLocation = useCallback(async (otherwise: GateState) => {
    try {
      const r = await call<object, { sessionId: string }>("startStaffSession", {});
      setStaffSessionId(r.sessionId);
      setState({ phase: "open" });
    } catch {
      setState(otherwise);
    }
  }, []);

  // In the desktop program, ask the operating system (Electron's own location
  // needs a Google key it does not have). Polled every 30 s; a single failed
  // reading mid-session is ignored, three in a row count as location off.
  useEffect(() => {
    const desktop = (window as { parchaDesktop?: { getLocation?: () => Promise<Spot | null> } }).parchaDesktop?.getLocation;
    if (!desktop) return;
    setState({ phase: "locating" });
    let first = true;
    let misses = 0;
    let stopped = false;
    const tick = async () => {
      const v = await desktop().catch(() => null);
      if (stopped) return;
      if (!v) {
        if (first) {
          void withoutLocation({
            phase: "failed",
            message: "Windows could not say where this computer is. Turn on Location in Windows Settings (Privacy & security, Location), then try again.",
          });
          stopped = true;
        } else if (++misses >= 3) {
          spot.current = null;
          void checkIn();
        }
        return;
      }
      misses = 0;
      spot.current = { lat: v.lat, lng: v.lng, accuracy: Math.round(v.accuracy) };
      if (first) {
        first = false;
        setState({ phase: "starting" });
        void checkIn();
        return;
      }
      const from = sentFrom.current;
      if (from && distanceMetres(from, spot.current) > RECHECK_M) void checkIn();
    };
    void tick();
    const t = setInterval(() => void tick(), 30_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [attempt, checkIn, withoutLocation]);

  useEffect(() => {
    if ((window as { parchaDesktop?: { getLocation?: unknown } }).parchaDesktop?.getLocation) return;
    if (!("geolocation" in navigator)) {
      void withoutLocation({ phase: "failed", message: "This browser cannot share a location, and Parcha needs one before it opens." });
      return;
    }
    setState({ phase: "locating" });
    let first = true;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        spot.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        if (first) {
          first = false;
          setState({ phase: "starting" });
          void checkIn();
          return;
        }
        const from = sentFrom.current;
        if (from && distanceMetres(from, spot.current) > RECHECK_M) void checkIn();
      },
      (err) => {
        if (first) {
          first = false;
          void withoutLocation(
            err.code === err.PERMISSION_DENIED
              ? { phase: "denied" }
              : { phase: "failed", message: "Could not find this device's location. Check that location is turned on, then try again." },
          );
        } else if (err.code === err.PERMISSION_DENIED) {
          // Location switched off mid-session: say so to the server, which ends it.
          spot.current = null;
          void checkIn();
        }
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [attempt, checkIn, withoutLocation]);

  // The minute check-in, and one straight away when the connection comes back.
  useEffect(() => {
    if (state.phase !== "open") return;
    const t = setInterval(() => void checkIn(), 60_000);
    return () => clearInterval(t);
  }, [state.phase, checkIn]);
  useEffect(() => {
    if (!offline && state.phase === "open") void checkIn();
  }, [offline, state.phase, checkIn]);

  if (state.phase === "open") return <>{children}</>;

  return (
    <div className="grid h-full w-full place-items-center bg-[#ff7f5a] p-4">
      <div
        role="status"
        className="bg-background w-full max-w-md rounded-[2rem] border-[3px] border-[#232326] p-6 text-center shadow-[8px_8px_0_#232326]"
      >
        {state.phase === "locating" || state.phase === "starting" ? (
          <>
            <p className="text-xl font-bold">
              {state.phase === "locating" ? "Checking where this computer is" : "Opening your session"}
            </p>
            <p className="mt-2 text-base leading-snug">
              Parcha records this device's location and internet address when it opens, and signs out if either changes.
              Allow location if the browser asks.
            </p>
          </>
        ) : state.phase === "denied" ? (
          <>
            <p className="text-xl font-bold">Parcha needs this device's location</p>
            <p className="mt-2 text-base leading-snug">
              Location is blocked, so Parcha cannot open. Allow it for this site (the icon at the left of the address
              bar, or the computer's location settings), then try again.
            </p>
          </>
        ) : (
          <>
            <p className="text-xl font-bold">Parcha could not open</p>
            <p className="mt-2 text-base leading-snug">{state.message}</p>
          </>
        )}
        {state.phase === "denied" || state.phase === "failed" ? (
          <div className="mt-5 grid gap-2">
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="h-12 rounded-2xl border-[3px] border-[#232326] bg-[#ff7f5a] text-lg font-bold shadow-[0_4px_0_#232326]"
            >
              Try again
            </button>
            <button type="button" onClick={() => void signOutUser()} className="text-base font-bold underline">
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
