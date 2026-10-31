import { useTodaysVisits, usePrescriptions, type ManageState } from "@parcha/client";
import type { Ability, Visit } from "@parcha/core";
import { cn } from "@parcha/ui";
import { Loader2 } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import { Card } from "../../bits";
// Types only: a value imported from here would pull three.js into the clinic's
// main bundle and undo the lazy import below.
import type {
  FlowData,
  FlowPerson,
  FlowStationId,
} from "../../components/ui/hospital-flow-3d";

// three.js is a megabyte that only this page needs: it is fetched when a
// manager opens this tab, not when the clinic app starts.
const HospitalFlow3D = lazy(() => import("../../components/ui/hospital-flow-3d"));

/** How long a patient may wait at a counter before it is drawn as late. */
const PATIENCE_MINUTES = 30;

const COUNTER_NAMES: Record<FlowStationId, string> = {
  desk: "Front desk",
  vitals: "Vitals",
  doctor: "Doctor",
  pharmacy: "Pharmacy",
  billing: "Billing",
};

/** Which ability a counter needs somebody to hold for it to be open. */
const COUNTER_ABILITY: Record<FlowStationId, Ability> = {
  desk: "register",
  vitals: "vitals",
  doctor: "consult",
  pharmacy: "dispense",
  billing: "billing",
};

const ORDER: FlowStationId[] = ["desk", "vitals", "doctor", "pharmacy", "billing"];

/** The same words the machine uses, so the two never disagree. */
const wait = (m: number | null) =>
  m == null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;

/**
 * The clinic as a machine, built from today's own visits.
 *
 * The Stats tab answers "how was the week". This answers "where is the day
 * stuck, right now": five counters on a plate, every patient in the building
 * standing at one of them, each counter brighter and taller the more people
 * are waiting and red once somebody has waited longer than the clinic means
 * anyone to. Clicking a counter names who is standing there.
 *
 * It reads the same single listener the pharmacy and billing counters share
 * (`useTodaysVisits`), so opening this page costs the clinic one query, not
 * five, and the picture follows the day without a refresh.
 */
export function Running({ state }: { state: ManageState | null }) {
  const today = useTodaysVisits();
  // Waits are drawn in minutes, so the clock only has to move that often.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const [chosen, setChosen] = useState<FlowStationId>("doctor");

  const visits = today.data;
  // The last prescription signed, read in full so the pharmacy's board shows
  // the medicines by name rather than a count.
  const lastSigned = useMemo(
    () =>
      [...visits]
        .filter((v) => v.prescribedAt)
        .sort((a, b) => String(b.prescribedAt).localeCompare(String(a.prescribedAt)))[0] ?? null,
    [visits],
  );
  const lastRx = usePrescriptions(lastSigned?.id ?? null);

  const data = useMemo<FlowData>(() => {
    const mins = (iso: string | null | undefined) =>
      iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 60_000)) : 0;
    const line = (list: Visit[], since: (v: Visit) => string | null | undefined): FlowPerson[] =>
      list
        .map((v) => ({
          token: v.tokenNumber,
          name: v.patientName,
          waitedMinutes: mins(since(v)),
          flagged: v.hasAllergy,
        }))
        .sort((a, b) => b.waitedMinutes - a.waitedMinutes);

    const open = visits.filter((v) => v.stage !== "cancelled" && !v.closedAt);
    const atDesk = open.filter((v) => v.stage === "requested" || v.stage === "proposed");
    const atVitals = open.filter((v) => v.stage === "registered");
    const atDoctor = open.filter((v) => v.stage === "intake_complete");
    const consulting = open.filter((v) => v.stage === "in_consultation");
    const atPharmacy = open.filter((v) => v.stage === "prescribed" && !v.dispensedAt);
    const atBilling = open.filter(
      (v) => v.stage === "prescribed" && (typeof v.billTotal !== "number" || !v.paid),
    );

    // Which counters this clinic has is a question about its seats, not about
    // what one person is allowed to do: a manager usually holds every ability,
    // so asking the team would make a clinic with no pharmacist look like it
    // had a pharmacy. A counter exists when a seat carries its ability, and is
    // staffed when somebody active sits in such a seat. With no Manage state
    // (it is still loading) every counter is assumed open rather than drawn as
    // abandoned.
    // The management seat is a key to the whole building, not a counter
    // anybody stands at: Sector 9's manager may dispense, but that clinic has
    // no pharmacy. So it is left out — unless it is the only seat there is,
    // which is exactly the one-doctor clinic where that person is every
    // counter.
    const allSeats = state?.seats ?? [];
    const manned = allSeats.filter((seat) => !seat.abilities.includes("manage"));
    const counterSeats = manned.length ? manned : allSeats;
    const seatsFor = (id: FlowStationId) =>
      counterSeats.filter((seat) => seat.abilities.includes(COUNTER_ABILITY[id]));
    const exists = (id: FlowStationId) => !state || seatsFor(id).length > 0;
    const staffs = (id: FlowStationId) => {
      if (!state) return true;
      const ids = new Set(seatsFor(id).map((seat) => seat.id));
      return state.team.some(
        (m) => m.active !== false && (m.seatIds ?? []).some((seatId) => ids.has(seatId)),
      );
    };

    const queues: Record<FlowStationId, { list: Visit[]; since: (v: Visit) => string | null | undefined; note?: string }> = {
      desk: { list: atDesk, since: (v) => v.requestedAt ?? v.registeredAt },
      vitals: { list: atVitals, since: (v) => v.registeredAt },
      doctor: {
        list: atDoctor,
        since: (v) => v.intakeCompletedAt,
        note: consulting.length
          ? `${consulting.length} with the doctor now`
          : `${atDoctor.length} waiting`,
      },
      pharmacy: { list: atPharmacy, since: (v) => v.prescribedAt },
      billing: { list: atBilling, since: (v) => v.prescribedAt },
    };

    const stations = ORDER.map((id) => {
      const q = queues[id];
      const present = exists(id);
      // A counter the clinic does not have is not a queue: in a clinic that
      // ends at the doctor, a signed prescription is not somebody standing at
      // a pharmacy that is not there.
      const people = present ? line(q.list, q.since) : [];
      return {
        id,
        count: people.length,
        longestWait: people.length ? people[0].waitedMinutes : null,
        people,
        present,
        staffed: present && staffs(id),
        note: present ? (q.note ?? null) : null,
      };
    });

    // The one patient worth watching: whoever has been in the building
    // longest and is not finished with it.
    const inBuilding = open.filter((v) =>
      ["registered", "intake_complete", "in_consultation", "prescribed"].includes(v.stage),
    );
    const oldest = [...inBuilding].sort((a, b) =>
      String(a.registeredAt).localeCompare(String(b.registeredAt)),
    )[0];
    const stepOf = (v: Visit) =>
      v.stage === "registered"
        ? 1
        : v.stage === "intake_complete" || v.stage === "in_consultation"
          ? 2
          : v.dispensedAt
            ? 4
            : 3;
    const whatOf = (v: Visit) =>
      v.stage === "registered"
        ? "waiting for vitals"
        : v.stage === "intake_complete"
          ? "waiting for the doctor"
          : v.stage === "in_consultation"
            ? "with the doctor"
            : !v.dispensedAt
              ? "waiting for medicines"
              : "waiting to pay";

    const signed = visits.filter((v) => v.prescribedAt);
    const paid = visits.filter((v) => typeof v.billTotal === "number" && v.paid);
    const lastPaid = [...paid].sort((a, b) =>
      String(b.prescribedAt).localeCompare(String(a.prescribedAt)),
    )[0];
    const rx = lastRx.data[0];

    return {
      clinicName: state?.clinic.name || "Your clinic",
      stations,
      following: oldest
        ? {
            name: oldest.patientName,
            token: oldest.tokenNumber,
            step: stepOf(oldest),
            what: whatOf(oldest),
            inBuildingMinutes: mins(oldest.registeredAt),
          }
        : null,
      seenToday: signed.length,
      takings: paid.reduce((sum, v) => sum + (v.billTotal ?? 0), 0),
      lastParcha: lastSigned
        ? {
            patient: lastSigned.patientName,
            diagnosis: lastSigned.diagnosis,
            medicines: (rx?.items ?? []).map((i) => `${i.drugName} ${i.strength}`.trim()),
          }
        : null,
      lastBill: lastPaid
        ? {
            patient: lastPaid.patientName,
            total: lastPaid.billTotal ?? 0,
            mode: lastPaid.paidMode ?? null,
          }
        : null,
      patienceMinutes: PATIENCE_MINUTES,
    };
  }, [visits, state, now, lastSigned, lastRx.data]);

  const station = data.stations.find((s) => s.id === chosen) ?? data.stations[0];
  const inBuilding = data.stations.reduce((n, s) => n + s.count, 0);

  return (
    <div className="space-y-4">
      {today.error ? (
        <p role="alert" className="text-destructive text-base">
          {today.error}
        </p>
      ) : null}

      <Suspense
        fallback={
          <div className="flex h-[420px] items-center justify-center rounded-2xl border-[3px] border-[#232326] bg-[#0b0e12] text-[#8c8f95]">
            <Loader2 className="mr-2 size-5 animate-spin" aria-hidden /> Building the clinic…
          </div>
        }
      >
        <HospitalFlow3D data={data} height={560} onStation={setChosen} focus={chosen} />
      </Suspense>

      {/* The same five counters in writing: this is the page without 3D, and
          what a screen reader is given. */}
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-5" role="tablist" aria-label="Counters">
        {data.stations.map((s) => {
          const late = (s.longestWait ?? 0) >= data.patienceMinutes && s.present && s.staffed;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={chosen === s.id}
              onClick={() => setChosen(s.id)}
              className={cn(
                "rounded-2xl border-[3px] border-[#232326] p-3 text-left",
                chosen === s.id ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card hover:bg-[var(--hover-soft)]",
              )}
            >
              <span className="block text-sm tracking-wide uppercase">{COUNTER_NAMES[s.id]}</span>
              <span className="block text-3xl leading-tight font-bold tabular-nums">{s.count}</span>
              <span className={cn("block text-sm", late && "font-bold")}>
                {!s.present
                  ? "No counter here"
                  : !s.staffed
                    ? "Nobody on it"
                    : s.count === 0
                      ? "Clear"
                      : `Longest ${wait(s.longestWait)}`}
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <p className="mb-1 text-sm tracking-wide uppercase">
          At {COUNTER_NAMES[station.id].toLowerCase()}
          {!station.present
            ? " · this clinic has no such counter"
            : station.staffed
              ? ""
              : " · nobody is on this counter"}
        </p>
        {station.people.length === 0 ? (
          <p className="text-base">
            {!station.present
              ? "This clinic does not have this counter, so nobody ever waits at it."
              : `Nobody is waiting here. ${inBuilding === 0 ? "The clinic is empty right now." : `${inBuilding} people are in the building.`}`}
          </p>
        ) : (
          <ul className="divide-y">
            {station.people.map((p, i) => (
              <li key={`${p.name}-${p.token ?? i}`} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-base">
                  {p.token != null ? <b className="tabular-nums">{p.token}. </b> : null}
                  {p.name}
                  {p.flagged ? <span className="text-muted-foreground"> · allergy</span> : null}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-base tabular-nums",
                    p.waitedMinutes >= data.patienceMinutes && "font-bold",
                  )}
                >
                  {wait(p.waitedMinutes)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground mt-2 text-sm">
          {data.seenToday} seen today · ₹{data.takings.toLocaleString("en-IN")} taken · a counter turns
          red once somebody has waited {data.patienceMinutes} minutes at it.
        </p>
      </Card>
    </div>
  );
}
