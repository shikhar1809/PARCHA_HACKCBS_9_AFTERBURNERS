import { ABILITIES } from "@parcha/core";
import { setForcedOffline, useOffline, usingEmulators } from "@parcha/client";
import { AppBar, Screen } from "@parcha/ui";
import { LogOut, WifiOff } from "lucide-react";

import { signOutOfClinic, useIdentity, demoMode } from "../auth";

const COUNTER_LABEL: Record<string, string> = {
  compounder: "Front desk",
  doctor: "Consultation",
};

/** Who is signed in on this device, and the way out. */
export function Me() {
  const { identity } = useIdentity();
  const offline = useOffline();

  return (
    <>
      <AppBar title="Me" subtitle={identity?.displayName} />
      <Screen className="space-y-5 p-4">
        <div className="bg-card rounded-2xl border-[3px] border-[#232326] p-4 shadow-[4px_4px_0_#232326]">
          <p className="text-xl leading-tight">{identity?.displayName}</p>
          <p className="text-muted-foreground text-base">
            {identity?.seatName ? `Seat: ${identity.seatName}` : `${identity?.accountType} account`}
          </p>
          <p className="mt-4 text-sm tracking-wide uppercase">Can do</p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {(identity?.abilities ?? []).map((c) => (
              <li
                key={c}
                className="rounded-full border-2 border-[#232326] bg-[var(--brand-soft)] px-3 py-1 text-sm"
              >
                {ABILITIES.find((a) => a.id === c)?.label ?? COUNTER_LABEL[c] ?? c}
              </li>
            ))}
          </ul>
        </div>

        {/* The example set-ups can show working with no connection, on the live site too. */}
        {usingEmulators || demoMode ? (
          <button
            type="button"
            role="switch"
            aria-checked={offline}
            onClick={() => void setForcedOffline(!offline)}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-dashed border-[#232326] text-base ${offline ? "bg-[var(--morning-soft)]" : ""}`}
          >
            <WifiOff className="size-5" aria-hidden />
            {offline ? "No connection (test) is on. Tap to go back online" : "Try it with no connection"}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => void signOutOfClinic()}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-lg shadow-[0_4px_0_#232326] active:translate-y-0.5 active:shadow-[0_2px_0_#232326]"
        >
          <LogOut className="size-5" />
          Sign out
        </button>
      </Screen>
    </>
  );
}
