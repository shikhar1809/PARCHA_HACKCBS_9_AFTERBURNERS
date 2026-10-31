import { AccessGuidance, ShowToPatient } from "../access";
import { usePrescriptions } from "@parcha/client";
import type { Allergy, Patient, Visit, VitalsSummary } from "@parcha/core";
import { cn } from "@parcha/ui";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import { Card, Label, shortDate } from "../../bits";
import { PrescriptionView } from "./PrescriptionView";

/**
 * Everything the doctor should read before writing: who this is, what they
 * are allergic to, what the desk found minutes ago, and what happened the
 * last times they were here.
 */
export function Dossier({
  visit,
  patient,
  allergies,
  history,
}: {
  visit: Visit;
  patient: Patient | null;
  allergies: Allergy[];
  history: Visit[];
}) {
  const past = history.filter((h) => h.id !== visit.id);
  const [showing, setShowing] = useState(false);

  return (
    <div className="space-y-5 p-4">
      {/* Before anything else: how to talk with this patient. */}
      <AccessGuidance needs={visit.accessNeeds} onShowToPatient={() => setShowing(true)} />
      {showing ? <ShowToPatient onClose={() => setShowing(false)} /> : null}
      <Allergies allergies={allergies} />

      <Card>
        <Label>Today</Label>
        <p className="text-lg leading-snug">
          {visit.complaint ?? "No complaint recorded."}
        </p>
        <Vitals vitals={visit.vitals} />
      </Card>

      {patient ? <About patient={patient} /> : null}

      <div>
        <Label>Earlier visits ({past.length})</Label>
        {past.length === 0 ? (
          <Card>
            <p className="text-base">No earlier visits on record.</p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {past.map((h) => (
              <HistoryRow key={h.id} visit={h} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Allergies come first and are red when there are any. "None recorded" is
 * said in those words, never as "no allergies": an empty list means nobody
 * wrote one down, which is not the same as there being none.
 */
function Allergies({ allergies }: { allergies: Allergy[] }) {
  if (allergies.length === 0) {
    return (
      <Card>
        <Label>Allergies</Label>
        <p className="text-base">None recorded. Ask before prescribing.</p>
      </Card>
    );
  }
  return (
    <Card tone="danger">
      <p className="mb-2 flex items-center gap-2 text-sm tracking-wide uppercase">
        <AlertTriangle className="size-5" aria-hidden />
        Allergies
      </p>
      <ul className="space-y-2">
        {allergies.map((a) => (
          <li key={a.id}>
            <p className="text-lg leading-tight">{a.label}</p>
            <p className="text-sm">
              {[a.reaction, a.severity !== "info" ? a.severity : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function About({ patient }: { patient: Patient }) {
  const bits = [
    patient.bloodGroup ? `Blood group ${patient.bloodGroup}` : null,
    patient.preferredLanguage ? `Speaks ${patient.preferredLanguage}` : null,
    patient.villageOrArea,
  ].filter(Boolean);
  if (bits.length === 0 && !patient.notes) return null;
  return (
    <Card>
      <Label>About</Label>
      {bits.length > 0 ? <p className="text-base">{bits.join(" · ")}</p> : null}
      {patient.notes ? (
        <p className="mt-2 text-base">{patient.notes}</p>
      ) : null}
    </Card>
  );
}

/**
 * The intake reading. A figure is drawn red past the point where it is most
 * likely to change what gets prescribed; that is an aid to reading, not a
 * diagnosis.
 */
export function Vitals({ vitals }: { vitals: VitalsSummary | null }) {
  if (!vitals) {
    return (
      <p className="text-muted-foreground mt-3 text-base">
        No vitals were taken at intake.
      </p>
    );
  }
  const cells: { label: string; value: string; alarm?: boolean }[] = [];
  if (vitals.systolicMmhg && vitals.diastolicMmhg) {
    cells.push({
      label: "BP",
      value: `${vitals.systolicMmhg}/${vitals.diastolicMmhg}`,
      alarm: vitals.systolicMmhg >= 160 || vitals.diastolicMmhg >= 100,
    });
  }
  if (vitals.pulseBpm) cells.push({ label: "Pulse", value: `${vitals.pulseBpm}` });
  if (vitals.temperatureC) {
    cells.push({
      label: "Temp",
      value: `${vitals.temperatureC}°C`,
      alarm: vitals.temperatureC >= 38.5,
    });
  }
  if (vitals.spo2Pct) {
    cells.push({
      label: "SpO₂",
      value: `${vitals.spo2Pct}%`,
      alarm: vitals.spo2Pct < 92,
    });
  }
  if (vitals.bloodSugarMgdl) {
    cells.push({
      label: vitals.bloodSugarType === "fasting" ? "Sugar (fasting)" : "Sugar (random)",
      value: `${vitals.bloodSugarMgdl}`,
      alarm: vitals.bloodSugarMgdl >= 200,
    });
  }
  if (vitals.respiratoryRate) {
    cells.push({ label: "Resp", value: `${vitals.respiratoryRate}` });
  }
  if (vitals.weightKg) cells.push({ label: "Weight", value: `${vitals.weightKg} kg` });
  if (vitals.heightCm) cells.push({ label: "Height", value: `${vitals.heightCm} cm` });

  if (cells.length === 0) {
    return (
      <p className="text-muted-foreground mt-3 text-base">
        No vitals were taken at intake.
      </p>
    );
  }

  return (
    <dl className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {cells.map((c) => (
        <div
          key={c.label}
          className={cn(
            "rounded-xl border-2 border-[#232326] px-3 py-2",
            c.alarm ? "bg-[oklch(0.94_0.05_25)]" : "bg-background",
          )}
        >
          <dt className="text-muted-foreground text-xs">{c.label}</dt>
          <dd className="text-xl leading-tight tabular-nums">
            {c.value}
            {c.alarm ? <span className="sr-only"> (high)</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One earlier visit. Its prescription is fetched only when it is opened. */
function HistoryRow({ visit }: { visit: Visit }) {
  const [open, setOpen] = useState(false);
  const canOpen = visit.itemCount > 0;

  return (
    <li>
      <Card className="!p-0">
        <button
          type="button"
          disabled={!canOpen}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 p-4 text-left disabled:cursor-default"
        >
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-sm">
              {shortDate(visit.registeredAt)}
            </p>
            <p className="text-lg leading-tight">
              {visit.diagnosis ?? visit.complaint ?? "Visit"}
            </p>
            {canOpen ? (
              <p className="text-muted-foreground text-sm">
                {visit.itemCount} medicine{visit.itemCount === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          {canOpen ? (
            open ? (
              <ChevronUp className="size-6 shrink-0" />
            ) : (
              <ChevronDown className="size-6 shrink-0" />
            )
          ) : null}
        </button>
        {open ? (
          <div className="border-t-[3px] border-[#232326] p-4">
            <HistoryRx visitId={visit.id} />
          </div>
        ) : null}
      </Card>
    </li>
  );
}

function HistoryRx({ visitId }: { visitId: string }) {
  const rx = usePrescriptions(visitId);
  const latest = rx.data[0];
  if (rx.loading) return <p className="text-base">Loading…</p>;
  if (!latest) return <p className="text-base">No prescription on record.</p>;
  return <PrescriptionView rx={latest} />;
}
