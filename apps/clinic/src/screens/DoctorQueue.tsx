import { errorMessage, setAvailability, useQueue, useTeam } from "@parcha/client";
import { formatDay, type Availability, type Visit } from "@parcha/core";
import {
  AppBar,
  EmptyQueue,
  PatientRow,
  Screen,
  SectionLabel,
  cn,
} from "@parcha/ui";
import { useEffect, useState } from "react";

import { useIdentity } from "../auth";

/**
 * The doctor's queue.
 *
 * Each row already carries what the desk recorded minutes ago, so the first
 * thing read is the patient rather than a name that then has to be looked up.
 * It is a live snapshot listener: a patient sent through from the desk
 * appears here without a refresh.
 */
export function DoctorQueue() {
  const { identity } = useIdentity();
  // Only the patients the desk sent to this doctor.
  const { data, loading, error } = useQueue(
    ["intake_complete", "in_consultation"],
    { doctorUid: identity?.uid },
    identity !== null,
  );

  // Patients the desk has asked this doctor to see, awaiting an answer.
  const asks = useQueue(["proposed"], { doctorUid: identity?.uid }, identity !== null);
  const open = data.filter((v) => v.stage === "in_consultation");
  const waiting = data.filter((v) => v.stage === "intake_complete");

  return (
    <>
      <AppBar title="Queue" subtitle={identity?.displayName} />
      <Screen>
        <AvailabilityStrip />

        {asks.data.length > 0 ? (
          <>
            <SectionLabel count={asks.data.length}>Asked to see you</SectionLabel>
            {asks.data.map((visit) => (
              <PatientRow
                key={visit.id}
                href={`/doctor/requests/${visit.id}`}
                name={visit.patientName}
                ageYears={visit.patientAgeYears}
                sex={visit.patientSex}
                area={visit.patientVillage}
                complaint={visit.complaint}
                since={visit.requestedAt ?? visit.registeredAt}
                hasAllergy={visit.hasAllergy}
                accessNeeds={visit.accessNeeds}
                tone="active"
                trailing={
                  <div className="mt-0.5 w-24 shrink-0 text-right text-sm leading-tight">
                    <p>Answer</p>
                    <p className="text-muted-foreground">
                      {visit.preferredDate ? formatDay(visit.preferredDate) : ""}
                    </p>
                  </div>
                }
              />
            ))}
          </>
        ) : null}

        {error ? (
          <p className="text-destructive p-4 text-sm">{error}</p>
        ) : null}

        {open.length > 0 ? (
          <>
            <SectionLabel count={open.length}>In the room</SectionLabel>
            {open.map((visit) => (
              <Row key={visit.id} visit={visit} active />
            ))}
          </>
        ) : null}

        <SectionLabel count={waiting.length}>Waiting</SectionLabel>
        {loading ? (
          <p className="text-muted-foreground p-4 text-sm">Loading…</p>
        ) : waiting.length === 0 && open.length === 0 ? (
          <EmptyQueue
            title="Nobody waiting"
            detail="Patients appear here the moment a desk sends them to you."
          />
        ) : null}
        {waiting.map((visit) => (
          <Row key={visit.id} visit={visit} />
        ))}
      </Screen>
    </>
  );
}

function Row({ visit, active }: { visit: Visit; active?: boolean }) {
  return (
    <PatientRow
      href={`/doctor/${visit.id}`}
      name={visit.patientName}
      ageYears={visit.patientAgeYears}
      sex={visit.patientSex}
      area={visit.patientVillage}
      complaint={visit.complaint}
      since={visit.intakeCompletedAt ?? visit.registeredAt}
      token={visit.tokenNumber}
      hasAllergy={visit.hasAllergy}
      accessNeeds={visit.accessNeeds}
      tone={active ? "active" : "default"}
      trailing={<Readings visit={visit} />}
    />
  );
}

/**
 * The intake reading, beside the complaint.
 *
 * A sugar above 200 is drawn in red — not as a diagnosis, but because it is
 * the number most likely to matter to what gets prescribed two minutes later,
 * and it has no equivalent anywhere on a paper slip.
 */
function Readings({ visit }: { visit: Visit }) {
  const v = visit.vitals;
  if (!v) {
    return (
      <span className="text-muted-foreground mt-0.5 shrink-0 text-[10px]">
        no vitals
      </span>
    );
  }

  const items: { label: string; value: string; alarm?: boolean }[] = [];
  if (v.systolicMmhg && v.diastolicMmhg) {
    items.push({
      label: "BP",
      value: `${v.systolicMmhg}/${v.diastolicMmhg}`,
      alarm: v.systolicMmhg >= 160 || v.diastolicMmhg >= 100,
    });
  }
  if (v.pulseBpm) items.push({ label: "P", value: String(v.pulseBpm) });
  if (v.temperatureC) {
    items.push({
      label: "T",
      value: `${v.temperatureC}°`,
      alarm: v.temperatureC >= 38.5,
    });
  }
  if (v.bloodSugarMgdl) {
    items.push({
      label: v.bloodSugarType === "fasting" ? "FBS" : "RBS",
      value: String(v.bloodSugarMgdl),
      alarm: v.bloodSugarMgdl >= 200,
    });
  }

  if (items.length === 0) {
    return (
      <span className="text-muted-foreground mt-0.5 shrink-0 text-[10px]">
        no vitals
      </span>
    );
  }

  return (
    <div className="mt-0.5 w-16 shrink-0 space-y-0.5 text-right">
      {items.map((i) => (
        <p key={i.label} className="text-[11px] leading-tight tabular-nums">
          <span className="text-muted-foreground">{i.label} </span>
          <span
            className={i.alarm ? "text-destructive font-medium" : "font-medium"}
          >
            {i.value}
          </span>
        </p>
      ))}
    </div>
  );
}

const STATES: { value: Availability; label: string; hint: string }[] = [
  { value: "available", label: "Available", hint: "The desk can send you patients" },
  { value: "busy", label: "Busy", hint: "The desk can still ask, but knows" },
  { value: "off", label: "Off", hint: "The desk cannot send you anyone today" },
];

/**
 * A doctor's own word on whether the desk can send them people.
 *
 * It is the one thing the desk cannot know without asking, so it is one tap
 * here and shows on every doctor card at the desk. "Off" is enforced: the
 * server will not let the desk ask an off doctor.
 */
function AvailabilityStrip() {
  const { identity } = useIdentity();
  const team = useTeam();
  const [error, setError] = useState<string | null>(null);
  const saved: Availability =
    team.data.find((p) => p.uid === identity?.uid)?.availability ?? "available";
  // Shown the moment it is tapped; the server's answer catches up behind it,
  // and a refusal puts the button back.
  const [picked, setPicked] = useState<Availability | null>(null);
  const current = picked ?? saved;
  useEffect(() => {
    if (picked !== null && saved === picked) setPicked(null);
  }, [saved, picked]);

  async function choose(status: Availability) {
    setError(null);
    setPicked(status);
    try {
      await setAvailability(status);
    } catch (e) {
      setPicked(null);
      setError(errorMessage(e));
    }
  }

  return (
    <div className="border-b-[3px] border-[#232326] p-3">
      <p className="text-muted-foreground mb-2 text-sm tracking-wide uppercase">
        Today I am
      </p>
      <div className="flex gap-2" role="radiogroup" aria-label="Availability">
        {STATES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={current === s.value}
            title={s.hint}
            onClick={() => void choose(s.value)}
            className={cn(
              "flex-1 rounded-xl border-[3px] border-[#232326] py-2 text-base",
              current === s.value
                ? s.value === "off"
                  ? "bg-[oklch(0.94_0.05_25)] shadow-[0_3px_0_#232326]"
                  : "bg-[var(--brand-soft)] shadow-[0_3px_0_#232326]"
                : "bg-card",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
