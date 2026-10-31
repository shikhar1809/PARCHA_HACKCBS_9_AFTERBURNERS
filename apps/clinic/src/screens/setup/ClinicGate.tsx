import { getAuthClient, useAccount, useHospital } from "@parcha/client";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { can, useIdentity } from "../../auth";
import { ClinicSetup } from "./ClinicSetup";
import { Profile } from "./Profile";
import { SetupFrame } from "./SetupFrame";

/**
 * What a signed-in person sees before the app: the clinic set-up (if the
 * clinic has not been set up and they can manage it), a "not set up yet" note
 * (if they cannot), or their first-sign-in profile. After that, the app.
 *
 * It also keeps the person's seat current: when the Manage page moves them to
 * another seat, their account changes, and the token (which carries the
 * abilities) is refreshed so the app follows straight away.
 */
export function ClinicGate({ children }: { children: ReactNode }) {
  const { identity } = useIdentity();
  const hospital = useHospital(identity?.hospitalId ?? null);
  const account = useAccount(identity?.uid ?? null);

  const stamp = (account.data as { claimsUpdatedAt?: string } | null)?.claimsUpdatedAt ?? null;
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (seen.current !== undefined && stamp && stamp !== seen.current) {
      void getAuthClient().currentUser?.getIdToken(true);
    }
    seen.current = stamp;
  }, [stamp]);

  if ((hospital.loading && !hospital.data) || (account.loading && !account.data)) {
    return (
      <div className="grid h-full w-full place-items-center bg-[#ff7f5a]">
        <Loader2 className="size-8 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  // Offline with nothing saved yet: let the app open rather than block on it.
  if (!hospital.data && hospital.error) return <>{children}</>;

  if (hospital.data && hospital.data.setupDone !== true) {
    if (can(identity, "manage")) return <ClinicSetup />;
    return (
      <SetupFrame>
        <h1 className="text-2xl leading-tight font-bold">Your clinic is not set up yet</h1>
        <p className="mt-2 text-base">
          Someone who manages the clinic needs to sign in and set it up first. Once they have, sign in again and Parcha opens in your seat.
        </p>
      </SetupFrame>
    );
  }

  const a = account.data;
  const needsProfile = a ? a.profileDone === false || (can(identity, "consult") && a.profileDone !== true) : false;
  if (needsProfile) return <Profile account={a} />;

  return <>{children}</>;
}
