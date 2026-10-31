/**
 * "Something is happening": a thin bar across the top of the app whenever a
 * person is waiting on the server, so no button ever seems to do nothing.
 *
 * Every call to a Cloud Function counts (see `call`), except the ones the app
 * makes by itself in the background (the duty heartbeat, the push token),
 * which nobody is waiting for. The bar appears only after a short moment, so a
 * quick answer does not flash it, and says "Working…" if the wait goes on.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

/** Calls nobody pressed a button for. */
const BACKGROUND = new Set(["sessionBeat", "setDuty", "registerPushToken", "startStaffSession", "markRead"]);

let pending = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Counts a call while it runs, unless it is one the app makes by itself. */
export async function tracked<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (BACKGROUND.has(name)) return run();
  pending++;
  notify();
  try {
    return await run();
  } finally {
    pending--;
    notify();
  }
}

export function usePending(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
  );
}

/** The bar, and after a while a small "Working…" note. Mount once, at the top of an app. */
export function PendingBar() {
  const n = usePending();
  const [shown, setShown] = useState<"no" | "bar" | "note">("no");
  useEffect(() => {
    if (n === 0) {
      setShown("no");
      return;
    }
    const a = setTimeout(() => setShown("bar"), 250);
    const b = setTimeout(() => setShown("note"), 1500);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [n]);
  if (shown === "no") return null;
  return (
    <>
      <div role="progressbar" aria-label="Working" className="pending-bar fixed inset-x-0 top-0 z-[95] h-1 overflow-hidden bg-[#232326]/15">
        <span className="pending-bar-run block h-full w-1/3 bg-[#ff7f5a]" />
      </div>
      {shown === "note" ? (
        <p role="status" className="fixed top-2 left-1/2 z-[95] -translate-x-1/2 rounded-full border-[3px] border-[#232326] bg-white px-3 py-1 text-sm font-bold shadow-[0_3px_0_#232326]">
          Working…
        </p>
      ) : null}
    </>
  );
}
