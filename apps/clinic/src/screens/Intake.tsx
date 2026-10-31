import { useAllergies, useHospital, useVisit } from "@parcha/client";
import { STAGE_META, type Visit } from "@parcha/core";
import { AppBar, TokenSlip, printPrescription } from "@parcha/ui";
import { CheckCircle2, Printer } from "lucide-react";
import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { mayAct, useIdentity } from "../auth";
import { Btn, Card, Label } from "../bits";
import { Vitals } from "./consultation/Dossier";
import { IntakeForm } from "./intake/IntakeForm";

/**
 * Intake: the desk's half of the handoff.
 *
 * What the desk writes here is the first thing the doctor reads, so the form
 * is built around getting it right rather than getting it fast: the
 * complaint in the patient's words, the readings that could be taken, and a
 * refusal of readings that cannot be real.
 *
 * Only the front desk can do this. The function enforces it; the screen says
 * so plainly instead of showing a form that would fail on send.
 */
export function Intake() {
  const { visitId = null } = useParams();
  const { identity } = useIdentity();
  const visit = useVisit(visitId);
  const v = visit.data;
  const allergies = useAllergies(v?.patientId ?? null);

  const who = v
    ? [
        v.patientAgeYears != null ? `${v.patientAgeYears} yrs` : null,
        v.patientSex,
        v.patientVillage,
        v.patientPhone,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppBar
        back="/desk"
        title={v?.patientName ?? "Intake"}
        subtitle={who}
        action={
          v ? (
            <span className="rounded-full border-2 border-[#232326] bg-[var(--brand-soft)] px-3 py-1 text-sm whitespace-nowrap">
              {v.tokenNumber != null ? `Token ${v.tokenNumber} · ` : ""}
              {STAGE_META[v.stage].label}
            </span>
          ) : null
        }
      />

      {visit.error ? (
        <p role="alert" className="text-destructive p-4 text-base">
          You cannot open this visit. {visit.error}
        </p>
      ) : !v ? (
        <p className="text-muted-foreground p-4 text-base">Loading…</p>
      ) : !mayAct(identity, "compounder") ? (
        <div className="p-4">
          <Card>
            <p className="text-lg">Intake is done at the front desk.</p>
            <p className="text-muted-foreground mt-1 text-base">
              This account is a {identity?.accountType} account and cannot take
              vitals. Open the patient from your queue instead.
            </p>
          </Card>
        </div>
      ) : ["requested", "proposed", "scheduled"].includes(v.stage) ? (
        // Not here yet: a request is handled on its own screen.
        <Navigate to={`/desk/requests/${v.id}`} replace />
      ) : v.stage === "registered" ? (
        <IntakeForm visit={v} allergies={allergies.data} />
      ) : v.stage === "cancelled" ? (
        <div className="p-4">
          <Card>
            <p className="text-lg">This visit was cancelled.</p>
          </Card>
        </div>
      ) : (
        <Done visit={v} />
      )}
    </div>
  );
}

/**
 * Once intake is saved, the desk sees what was sent, hands over the token (on
 * screen, or printed with its QR, which opens the visit when the doctor scans
 * it), and moves on. P prints the token.
 */
function Done({ visit }: { visit: Visit }) {
  const sent = visit.stage === "intake_complete";
  const hospital = useHospital(visit.hospitalId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key.toLowerCase() === "p") printPrescription();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      {sent ? (
        <Card className="flex items-center gap-4">
          <div className="shrink-0 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] px-5 py-3 text-center">
            <p className="text-xs font-bold tracking-widest uppercase">Token</p>
            <p className="text-5xl leading-none font-bold tabular-nums">{visit.tokenNumber ?? "–"}</p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg leading-tight font-bold">{visit.patientName}</p>
            <p className="text-base">{visit.assignedDoctorName ?? "Doctor"} · code {visit.visitCode}</p>
            <Btn onClick={() => printPrescription()} className="mt-2 h-11">
              <Printer className="size-5" aria-hidden /> Print token <span className="text-sm font-normal opacity-70">P</span>
            </Btn>
          </div>
        </Card>
      ) : null}
      <TokenSlip
        hospital={hospital.data?.name}
        token={visit.tokenNumber}
        patientName={visit.patientName}
        doctorName={visit.assignedDoctorName}
        visitCode={visit.visitCode}
        at={visit.intakeCompletedAt}
      />
      <Card tone="ok">
        <p className="flex items-center gap-2 text-xl leading-tight">
          <CheckCircle2 className="size-6" aria-hidden />
          {sent ? "Sent to the doctor" : "Intake is done"}
        </p>
        <p className="mt-1 text-base">
          {sent
            ? `${visit.patientName} is in ${visit.assignedDoctorName ?? "the doctor"}'s queue now.`
            : `This visit has moved on: ${STAGE_META[visit.stage].waitingFor.toLowerCase()}.`}
        </p>
        <Link
          to="/desk"
          className="mt-3 inline-block rounded-xl border-[3px] border-[#232326] bg-card px-4 py-2 text-base shadow-[0_3px_0_#232326]"
        >
          Next patient
        </Link>
      </Card>

      <Card>
        <Label>What was recorded</Label>
        <p className="text-lg leading-snug">
          {visit.complaint ?? "No complaint recorded."}
        </p>
        <Vitals vitals={visit.vitals} />
      </Card>
    </div>
  );
}
