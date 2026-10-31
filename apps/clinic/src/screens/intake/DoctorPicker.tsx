import { useHospital, useHospitalScope, useQueue, useRoutes, useTeam } from "@parcha/client";
import { cn } from "@parcha/ui";
import { Check, Network } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";

import { useIdentity } from "../../auth";
import { Card, Label } from "../../bits";

export type ChosenDoctor = { uid: string; name: string };

const AVAILABILITY_LABEL = {
  available: "Available",
  busy: "Busy",
  off: "Off today",
} as const;

/**
 * Which doctor this patient goes to.
 *
 * Only the doctors this desk is wired to are offered: the choice is the
 * wiring made visible, and the server refuses any other. Each card shows the
 * doctor's own word on whether they are taking patients, and how many people
 * they already have waiting, live, so the desk can spread patients rather than
 * pile them on one doctor. The least busy one is selected to begin with, and
 * the order of the cards stays put while the counts change, so a card never
 * moves under the finger.
 *
 * A doctor who is off today, or who has already turned this patient down, is
 * shown but cannot be chosen: the desk should see them, and see why not.
 */
export function DoctorPicker({
  value,
  onChange,
  invalid,
  preferUid,
  preferNote,
  declined,
}: {
  value: ChosenDoctor | null;
  /** Called with null when the chosen doctor stops being available. */
  onChange: (doctor: ChosenDoctor | null) => void;
  invalid?: boolean;
  /** A doctor to select first if they can be chosen, such as the one asked for. */
  preferUid?: string | null;
  /** What to say on that doctor's card, for example "Asked for by the patient". */
  preferNote?: string;
  /** Doctors who said no to this patient, with their reasons. */
  declined?: Record<string, string>;
}) {
  const { identity } = useIdentity();
  const team = useTeam();
  const routes = useRoutes();
  // Everyone's load, not just mine: a doctor wired to two desks is as busy as
  // both desks have made them.
  const load = useQueue(["intake_complete", "in_consultation"]);

  const doctors = useMemo(() => {
    const mine = new Set(
      routes.data
        .filter((r) => r.kind === "desk_doctor" && r.fromUid === identity?.uid)
        .map((r) => r.toUid),
    );
    // A doctor who also takes vitals (a solo practice) can send patients to themselves.
    const self = identity?.counters.includes("doctor") ? identity.uid : null;
    return team.data.filter(
      (p) => p.accountType === "doctor" && p.active !== false && (mine.has(p.uid) || p.uid === self),
    );
  }, [team.data, routes.data, identity?.uid]);

  const counts = useMemo(() => {
    const out = new Map<string, { waiting: number; inRoom: number }>();
    for (const d of doctors) out.set(d.uid, { waiting: 0, inRoom: 0 });
    for (const v of load.data) {
      const c = v.assignedDoctorUid ? out.get(v.assignedDoctorUid) : undefined;
      if (!c) continue;
      if (v.stage === "intake_complete") c.waiting += 1;
      else c.inRoom += 1;
    }
    return out;
  }, [doctors, load.data]);

  // Off today, or off duty at a real clinic (in the example set-ups switching
  // seats signs a doctor out), or already said no to this patient: cannot be chosen.
  const example = useHospital(useHospitalScope()).data?.example === true;
  const offDuty = (uid: string) => !example && team.data.find((a) => a.uid === uid)?.onDuty === false;
  const blocked = (uid: string, availability?: string) =>
    availability === "off" || offDuty(uid) || declined?.[uid] !== undefined;

  const leastBusy = useMemo(() => {
    let best: string | null = null;
    let bestN = Infinity;
    for (const d of doctors) {
      if (blocked(d.uid, d.availability)) continue;
      const c = counts.get(d.uid);
      const n = (c?.waiting ?? 0) + (c?.inRoom ?? 0);
      if (n < bestN) {
        best = d.uid;
        bestN = n;
      }
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctors, counts, declined]);

  // Select a doctor once, when the options first arrive: the one asked for if
  // they can be chosen, otherwise the least busy.
  useEffect(() => {
    if (value !== null || load.loading) return;
    const wanted = preferUid
      ? doctors.find((d) => d.uid === preferUid && !blocked(d.uid, d.availability))
      : undefined;
    const pick = wanted ?? doctors.find((d) => d.uid === leastBusy);
    if (pick) onChange({ uid: pick.uid, name: pick.displayName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, load.loading, leastBusy, doctors, preferUid, onChange]);

  // A doctor can go off, or be rewired away, while the desk has them selected.
  // A selection that can no longer be sent is dropped, and the next best
  // doctor is offered in its place, so the desk is never left holding a choice
  // that would only fail on send.
  useEffect(() => {
    if (value === null || load.loading || team.loading || routes.loading) return;
    const chosen = doctors.find((d) => d.uid === value.uid);
    if (chosen && !blocked(chosen.uid, chosen.availability)) return;
    const next = doctors.find((d) => d.uid === leastBusy);
    onChange(next ? { uid: next.uid, name: next.displayName } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, doctors, leastBusy, load.loading, team.loading, routes.loading, declined]);

  if (team.loading || routes.loading) {
    return <p className="text-muted-foreground text-base">Loading doctors…</p>;
  }

  if (doctors.length === 0) {
    return (
      <Card tone="danger">
        <p className="flex items-center gap-2 text-lg">
          <Network className="size-5 shrink-0" aria-hidden />
          This desk is not connected to any doctor.
        </p>
        <p className="mt-1 text-base">
          Nobody can be sent through until a team admin wires this desk to a
          doctor on the{" "}
          <Link to="/team" className="underline">
            Team page
          </Link>
          .
        </p>
      </Card>
    );
  }

  return (
    <div>
      <Label>Send to which doctor?</Label>
      <div
        role="radiogroup"
        aria-label="Doctor"
        className={cn(
          "grid gap-2.5 @lg:grid-cols-2",
          invalid && "rounded-2xl outline-[3px] outline-offset-4 outline-[#232326] outline-dashed",
        )}
      >
        {doctors.map((d) => {
          const c = counts.get(d.uid) ?? { waiting: 0, inRoom: 0 };
          const on = value?.uid === d.uid;
          const availability = d.availability ?? "available";
          const no = declined?.[d.uid];
          const stuck = blocked(d.uid, d.availability);
          return (
            <button
              key={d.uid}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={stuck}
              disabled={stuck}
              onClick={() => onChange({ uid: d.uid, name: d.displayName })}
              className={cn(
                "flex items-start gap-3 rounded-xl border-[3px] border-[#232326] p-3 text-left",
                on
                  ? "bg-[var(--brand-soft)] shadow-[0_3px_0_#232326]"
                  : "bg-card hover:bg-[var(--hover-soft)]",
                stuck && "opacity-55 hover:bg-card",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-[3px] border-[#232326]",
                  on ? "bg-[#232326] text-white" : "bg-white",
                )}
              >
                {on ? <Check className="size-4" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-lg leading-tight">{d.displayName}</span>
                <span className="block text-sm">{d.department ?? "Doctor"}</span>
                <span className="mt-1 block text-sm">
                  <span
                    className={cn(
                      "mr-1.5 rounded-full border-2 border-[#232326] px-2 py-0.5",
                      availability === "available" && "bg-[var(--brand-soft)]",
                      availability === "busy" && "bg-[var(--morning-soft)]",
                      availability === "off" && "bg-[oklch(0.94_0.05_25)]",
                    )}
                  >
                    {offDuty(d.uid) ? "Off duty" : AVAILABILITY_LABEL[availability]}
                  </span>
                  {c.waiting === 0 ? "Nobody waiting" : `${c.waiting} waiting`}
                  {c.inRoom > 0 ? " · with a patient" : ""}
                  {d.uid === leastBusy && doctors.length > 1 ? " · least busy" : ""}
                </span>
                {preferUid === d.uid && preferNote ? (
                  <span className="mt-1 block text-sm">{preferNote}</span>
                ) : null}
                {no ? (
                  <span className="mt-1 block text-sm">Declined: {no}</span>
                ) : null}
                {on && availability === "busy" && !stuck ? (
                  <span className="mt-1 block text-sm font-bold">Busy right now: the patient may wait longer.</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
