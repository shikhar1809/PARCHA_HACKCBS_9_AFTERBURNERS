/**
 * Whether this clinic has turned learning on.
 *
 * Three things have to agree, and the strictest wins:
 *   1. `?meko=off` in the address bar — the demo switch, and the escape hatch
 *      if anything about recall ever looks wrong during a consultation
 *   2. `mekoEnabled` on the hospital, which a clinic sets in Manage and which
 *      defaults to OFF for a new clinic: learning is opted into, never out of
 *   3. the doctor being signed in at all
 *
 * With it off, no Meko code path runs and the pad is today's app exactly.
 */
import { useHospital } from "@parcha/client";

import { useIdentity } from "../../../auth";

/** `?meko=off` beats everything, so a demo or a worried doctor can always turn it off. */
function urlOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("meko");
  if (v === "off" || v === "0" || v === "false") return false;
  if (v === "on" || v === "1" || v === "true") return true;
  return null;
}

export function useMekoEnabled(): boolean {
  const { identity } = useIdentity();
  const hospital = useHospital(identity?.hospitalId ?? null);
  const override = urlOverride();
  if (override !== null) return override;
  // Absent means off: a clinic that has never been asked has not consented.
  return hospital.data?.mekoEnabled === true;
}
