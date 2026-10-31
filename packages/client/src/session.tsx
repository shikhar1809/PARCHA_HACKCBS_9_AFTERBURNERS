/**
 * Looking after a session: who is signed in, how long they have been away, and
 * what happens when something goes wrong.
 *
 * These devices live on shared counters and in pockets. A clinic tablet is
 * walked away from; a phone is lent to a relative. So:
 *
 *   - A staff device LOCKS after a few idle minutes and asks for the password
 *     again. The screen is covered, not just hidden, and the lock survives a
 *     page reload, so refreshing is not a way round it. Too many wrong
 *     passwords signs the account out.
 *   - A patient's phone is SIGNED OUT after a longer idle spell, with a warning
 *     and a chance to stay.
 *   - A session that ends underneath the person (a revoked account, an expired
 *     token) is NOTICED: the sign-in screen says why, instead of just appearing.
 *   - Losing the network is SAID, so nobody wonders why a button does nothing.
 *   - A crash in a screen is CAUGHT, with a way back, instead of a white page.
 */
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut,
} from "firebase/auth";
import { Component, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { call, getAuthClient, setReauthHandler } from "./firebase";
import { useOffline, useOutbox } from "./outbox";

const LOCK_KEY = "parcha.locked";
const ENDED_KEY = "parcha.sessionEnded";
const MY_SIGN_OUT_KEY = "parcha.userSignedOut";

const safe = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* storage blocked: the guard still works, it just cannot survive a reload */
    }
  },
  del: (k: string) => {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* as above */
    }
  },
};

/** True once this device has told the server its person is on duty. */
let reportingDuty = false;

const DUTY_OFF_KEY = "parcha.dutyOff";
const dutyListeners = new Set<() => void>();

/** True when this person has switched themselves off duty by hand (a break, a meeting). */
export function dutySwitchedOff(): boolean {
  try {
    return localStorage.getItem(DUTY_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

/** The duty switch on the team page: off stays off, through the heartbeat, until it is switched on. */
export function setMyDuty(on: boolean): Promise<unknown> {
  try {
    if (on) localStorage.removeItem(DUTY_OFF_KEY);
    else localStorage.setItem(DUTY_OFF_KEY, "1");
  } catch {
    /* it holds for this page load */
  }
  dutyListeners.forEach((l) => l());
  return reportDuty(on);
}

export function useMyDutySwitch(): boolean {
  return useSyncExternalStore(
    (l) => {
      dutyListeners.add(l);
      return () => void dutyListeners.delete(l);
    },
    () => !dutySwitchedOff(),
    () => true,
  );
}

/** Says "on duty" or "off duty" for the team page; never lets a failure matter. */
function reportDuty(onDuty: boolean) {
  // A person who switched themselves off is not put back on by the heartbeat.
  const say = onDuty && !dutySwitchedOff();
  reportingDuty = say;
  return call("setDuty", { onDuty: say }).catch(() => undefined);
}

/** The open staff session on this device, once the server has agreed to one (see staff-session.tsx). */
let staffSessionId: string | null = null;
export const getStaffSessionId = () => staffSessionId;
export const setStaffSessionId = (id: string | null) => {
  staffSessionId = id;
};

/** Signs this device out because the server ended its session, leaving the reason for the sign-in screen. */
export function endedByServer(reason: string) {
  staffSessionId = null;
  safe.set(ENDED_KEY, reason);
  safe.set(MY_SIGN_OUT_KEY, "1");
  void signOut(getAuthClient());
}

/** Signs out on the person's own say-so, so it is not mistaken for a session ending. */
export async function signOutUser() {
  safe.set(MY_SIGN_OUT_KEY, "1");
  safe.del(LOCK_KEY);
  if (staffSessionId) {
    // Close the session so the activity log shows this person left.
    staffSessionId = null;
    await Promise.race([call("endStaffSession", {}).catch(() => undefined), new Promise((r) => setTimeout(r, 1500))]);
  }
  if (reportingDuty) {
    // Tell the team this person has left, but never hold the sign-out up for it.
    await Promise.race([reportDuty(false), new Promise((r) => setTimeout(r, 1500))]);
  }
  return signOut(getAuthClient());
}

/**
 * Why the last session ended, if it was not the person's own doing; read once.
 * The sign-in screen shows it so a sign-out never arrives without a reason.
 */
export function takeSessionEndedNotice(): string | null {
  const why = safe.get(ENDED_KEY);
  if (why) safe.del(ENDED_KEY);
  return why;
}

/** Watches for a session that ends by itself, and leaves a note for the sign-in screen. */
function useNoticeUnexpectedSignOut() {
  useEffect(() => {
    let was = false;
    return onAuthStateChanged(getAuthClient(), (user) => {
      if (user) {
        was = true;
        safe.del(MY_SIGN_OUT_KEY);
        return;
      }
      if (was && !safe.get(MY_SIGN_OUT_KEY)) {
        safe.set(ENDED_KEY, "Your session ended, so we signed you out for safety. Please sign in again.");
      }
      was = false;
    });
  }, []);
}

/** True while the browser says it has no network. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

/**
 * A strip at the top when there is no connection, or changes are still waiting
 * to be sent. It says the data is safe on this device: that is what lets
 * someone carry on without worrying.
 */
export function OnlineBanner() {
  const online = useOnline();
  const offline = useOffline();
  const waiting = useOutbox().filter((i) => i.status !== "failed").length;
  if (online && !offline && waiting === 0) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[70] border-b-[3px] border-[#232326] bg-[var(--morning-soft)] px-4 py-2 text-center text-base font-bold"
    >
      {online && !offline
        ? `Sending ${waiting} saved change${waiting === 1 ? "" : "s"}…`
        : waiting > 0
          ? `No connection. Your data is saved on this device. ${waiting} change${waiting === 1 ? "" : "s"} will be sent when you are back online.`
          : "No connection. Your data is saved on this device, and what you have already opened still works."}
    </div>
  );
}

const ACTIVITY = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

/**
 * Locks (staff) or signs out (patient) after the device has sat idle.
 *
 * `idleMinutes` is how long. In development a smaller number can be set from the
 * console with `sessionStorage.setItem("parcha.idleSeconds", "10")`, so the lock
 * can be seen without waiting ten minutes.
 */
export function SessionGuard({
  kind,
  idleMinutes,
  children,
}: {
  kind: "staff" | "patient";
  idleMinutes: number;
  children: ReactNode;
}) {
  useNoticeUnexpectedSignOut();
  const [locked, setLocked] = useState(() => kind === "staff" && safe.get(LOCK_KEY) === "1");
  const [warning, setWarning] = useState<number | null>(null);
  const [reauth, setReauth] = useState<((ok: boolean) => void) | null>(null);
  const last = useRef(Date.now());

  // On duty means a device is open, unlocked and checking in. A locked or
  // closed device stops, and the team page lets that person go white.
  useEffect(() => {
    if (kind !== "staff") return;
    if (locked) {
      if (reportingDuty) void reportDuty(false);
      return;
    }
    void reportDuty(true);
    const beat = setInterval(() => void reportDuty(true), 60_000);
    const back = () => document.visibilityState === "visible" && void reportDuty(true);
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", back);
    };
  }, [kind, locked]);

  // Lets `call` ask for the password in the middle of a sensitive action.
  useEffect(() => {
    if (kind !== "staff") return;
    setReauthHandler(() => new Promise<boolean>((resolve) => setReauth(() => resolve)));
    return () => setReauthHandler(null);
  }, [kind]);

  const override = Number(safe.get("parcha.idleSeconds"));
  const idleMs = (Number.isFinite(override) && override > 0 ? override : idleMinutes * 60) * 1000;

  useEffect(() => {
    const touch = () => {
      if (Date.now() - last.current > 500) last.current = Date.now();
      setWarning(null);
    };
    ACTIVITY.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const tick = setInterval(() => {
      const idle = Date.now() - last.current;
      if (kind === "staff") {
        if (!locked && idle >= idleMs) {
          safe.set(LOCK_KEY, "1");
          setLocked(true);
        }
      } else if (idle >= idleMs) {
        // A patient gets a minute's warning, and any tap cancels it.
        const left = Math.max(0, 60 - Math.floor((idle - idleMs) / 1000));
        setWarning(left);
        if (left === 0) void signOutUser();
      }
    }, 1000);
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(tick);
    };
  }, [kind, locked, idleMs]);

  return (
    <>
      {children}
      <OnlineBanner />
      {locked ? (
        <LockScreen
          onUnlock={() => {
            safe.del(LOCK_KEY);
            last.current = Date.now();
            setLocked(false);
          }}
        />
      ) : null}
      {reauth ? (
        <LockScreen
          title="Confirm it is you"
          blurb="This action is permanent and carries your name, so please type your password again."
          action="Confirm"
          onUnlock={() => {
            reauth(true);
            setReauth(null);
          }}
          onCancel={() => {
            reauth(false);
            setReauth(null);
          }}
        />
      ) : null}
      {warning !== null ? (
        <div
          role="alertdialog"
          aria-label="Still there?"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-6"
        >
          <div className="w-full max-w-sm rounded-3xl border-[3px] border-[#232326] bg-[#faf5ea] p-6 text-center shadow-[6px_6px_0_#232326]">
            <p className="text-2xl font-bold">Are you still there?</p>
            <p className="mt-2 text-lg">
              We will sign you out in {warning} second{warning === 1 ? "" : "s"} to keep your
              records private.
            </p>
            <button
              type="button"
              onClick={() => {
                last.current = Date.now();
                setWarning(null);
              }}
              className="mt-5 h-14 w-full rounded-2xl border-[3px] border-[#232326] bg-[#ff7f5a] text-xl font-bold shadow-[0_4px_0_#232326] hover:bg-[#ff9a7c]"
            >
              Yes, stay signed in
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

const MAX_TRIES = 5;

/** Covers the whole app until the password is entered again. */
function LockScreen({
  onUnlock,
  onCancel,
  title = "Locked",
  blurb = "This device was left alone for a while, so it locked to keep patients' records private.",
  action = "Unlock",
}: {
  onUnlock: () => void;
  onCancel?: () => void;
  title?: string;
  blurb?: string;
  action?: string;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const user = getAuthClient().currentUser;

  const submit = useCallback(async () => {
    if (!user?.email || !password) return;
    setBusy(true);
    setError(null);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      onUnlock();
    } catch {
      const n = tries + 1;
      setTries(n);
      setPassword("");
      if (n >= MAX_TRIES) {
        safe.set(ENDED_KEY, "Too many wrong passwords, so you were signed out.");
        await signOutUser();
        return;
      }
      setError(`That is not the right password. ${MAX_TRIES - n} tries left.`);
    } finally {
      setBusy(false);
    }
  }, [user, password, tries, onUnlock]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[#ff7f5a] p-4"
    >
      <form
        className="w-full max-w-sm space-y-4 rounded-3xl border-[3px] border-[#232326] bg-[#faf5ea] p-6 shadow-[6px_6px_0_#232326]"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-3xl font-bold">{title}</p>
        <p className="text-lg leading-snug">{blurb}</p>
        {user?.email ? <p className="text-base font-bold">{user.email}</p> : null}
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          aria-label="Password"
          className="h-14 w-full rounded-2xl border-[3px] border-[#232326] bg-white px-4 text-lg outline-none focus:bg-[#ffe9e0]"
        />
        {error ? (
          <p role="alert" className="text-base font-bold text-[#b3261e]">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !password}
          className="h-14 w-full rounded-2xl border-[3px] border-[#232326] bg-[#ff7f5a] text-xl font-bold shadow-[0_4px_0_#232326] hover:bg-[#ff9a7c] disabled:opacity-50"
        >
          {busy ? "Checking…" : action}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="w-full text-base font-bold underline">
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void signOutUser()}
            className="w-full text-base font-bold underline"
          >
            Sign out instead
          </button>
        )}
      </form>
    </div>
  );
}

/**
 * Catches a crash in any screen below it and offers a way back, instead of
 * leaving a white page. The detail is kept for the console; the person gets
 * three buttons, not a stack trace.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; id: number }
> {
  state = { failed: false, id: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error("[parcha] a screen crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) {
      // Changing the key remounts the tree afresh after "Try again".
      return <div key={this.state.id} className="contents">{this.props.children}</div>;
    }
    return (
      <div
        role="alert"
        className="flex min-h-dvh items-center justify-center bg-[#ff7f5a] p-4"
      >
        <div className="w-full max-w-sm space-y-4 rounded-3xl border-[3px] border-[#232326] bg-[#faf5ea] p-6 shadow-[6px_6px_0_#232326]">
          <p className="text-3xl font-bold">Something went wrong</p>
          <p className="text-lg leading-snug">
            Nothing you did caused this, and nothing has been lost. Try again, and if it
            keeps happening, reload the page.
          </p>
          <button
            type="button"
            onClick={() => this.setState((s) => ({ failed: false, id: s.id + 1 }))}
            className="h-14 w-full rounded-2xl border-[3px] border-[#232326] bg-[#ff7f5a] text-xl font-bold shadow-[0_4px_0_#232326] hover:bg-[#ff9a7c]"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-12 w-full rounded-2xl border-[3px] border-[#232326] bg-white text-lg font-bold hover:bg-[#ffe9e0]"
          >
            Reload the page
          </button>
          <button type="button" onClick={() => void signOutUser()} className="w-full text-base font-bold underline">
            Sign out
          </button>
        </div>
      </div>
    );
  }
}
