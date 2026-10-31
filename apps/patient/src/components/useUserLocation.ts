import type { LatLng } from "@parcha/core";
import { useCallback, useState } from "react";

export type LocationState = "idle" | "asking" | "on" | "denied" | "unavailable";

/**
 * Where the patient is, if they choose to say.
 *
 * It asks only when told to (a tap on "Use my location"), never on page load:
 * a permission prompt nobody expected is a prompt people refuse. Without it
 * the app works from a default centre and the hospitals are ordered from there,
 * so declining costs nothing but a little accuracy.
 */
export function useUserLocation() {
  const [me, setMe] = useState<LatLng | null>(null);
  const [state, setState] = useState<LocationState>("idle");

  const ask = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      return;
    }
    setState("asking");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude });
        setState("on");
      },
      (e) => setState(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"),
      { timeout: 8000, maximumAge: 5 * 60_000 },
    );
  }, []);

  return { me, state, ask };
}
