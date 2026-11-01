import {
  errorMessage,
  startConsultation,
  useAllergies,
  useHospitals,
  usePatient,
  usePrescriptions,
  useQueue,
  useTeam,
  useVisit,
  useVisitsForPatient,
} from "@parcha/client";
import { STAGE_META, type Visit } from "@parcha/core";
import { AppBar, PrescriptionSheet, cn, printPrescription } from "@parcha/ui";
import { ArrowRight, CheckCircle2, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useIdentity } from "../auth";
import { Btn, Card } from "../bits";
import { Dossier } from "./consultation/Dossier";
import { Pad } from "./consultation/Pad";
import { PrescriptionView } from "./consultation/PrescriptionView";

/**
 * The consultation, as the doctor's whole screen (no sidebar, no queue).
 *
 * It opens on the prescribing pad, the step a doctor does forty times a day,
 * with the dossier beside it where there is room, so the allergy and the sugar
 * reading are in view while the steroid is being typed. Where there is not,
 * a switch (or Alt+1 / Alt+2) moves between them.
 *
 * The visit's stage drives what the right side is. Before and during the
 * consultation it is the pad (writing the first thing calls the patient in);
 * once signed it is the prescription, read-only, because the signed one is
 * the record and a correction is a new document, with the next patient one
 * key away.
 */
export function Consultation() {
  const { visitId = null } = useParams();
  const { identity } = useIdentity();
  const visit = useVisit(visitId);
  const v = visit.data;
  // The desk sends each patient to one doctor. Anybody can read the dossier,
  // but only that doctor can start or sign: the server enforces the same.
  const mine = v?.assignedDoctorUid === identity?.uid;

  const patient = usePatient(v?.patientId ?? null);
  const allergies = useAllergies(v?.patientId ?? null);
  const history = useVisitsForPatient(v?.patientId ?? null);

  const [tab, setTab] = useState<"dossier" | "prescribe">("prescribe");
  // Alt+1 the dossier, Alt+2 the pad, on a screen too narrow for both.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === "1") setTab("dossier");
      if (e.key === "2") setTab("prescribe");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const who = v
    ? [
        v.patientAgeYears != null ? `${v.patientAgeYears} yrs` : null,
        v.patientSex,
        v.patientVillage,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <AppBar
        back="/doctor"
        title={v?.patientName ?? "Consultation"}
        subtitle={who}
        action={
          v ? (
            <span className="rounded-full border-2 border-[#232326] bg-[var(--brand-soft)] px-3 py-1 text-sm whitespace-nowrap">
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
      ) : (
        <>
          {/* Narrow panes switch between the two halves. */}
          <div className="flex shrink-0 gap-2 border-b-[3px] border-[#232326] p-2 @3xl:hidden">
            {(
              [
                ["prescribe", "Prescribe"],
                ["dossier", "Dossier"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={cn(
                  "flex-1 rounded-xl border-[3px] border-[#232326] py-2 text-base",
                  tab === id
                    ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]"
                    : "bg-card",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid min-h-0 flex-1 @3xl:grid-cols-[2fr_3fr]">
            <section
              className={cn(
                "min-h-0 overflow-y-auto overscroll-contain @3xl:border-r-[3px] @3xl:border-[#232326]",
                tab === "dossier" ? "block" : "hidden @3xl:block",
              )}
            >
              <Dossier
                visit={v}
                patient={patient.data}
                allergies={allergies.data}
                history={history.data}
              />
            </section>

            <section
              className={cn(
                "min-h-0 overflow-y-auto overscroll-contain",
                tab === "prescribe" ? "block" : "hidden @3xl:block",
              )}
            >
              <Right
                visit={v}
                mine={mine}
                onStarted={() => setTab("prescribe")}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/** The right half, by where the visit is in the chain. */
function Right({
  visit,
  mine,
  onStarted,
}: {
  visit: Visit;
  mine: boolean;
  onStarted: () => void;
}) {
  const open = visit.stage === "intake_complete" || visit.stage === "in_consultation";
  if (open && !mine) return <NotYours visit={visit} />;

  switch (visit.stage) {
    case "intake_complete":
    case "in_consultation":
      return (
        <Pad
          visitId={visit.id}
          started={visit.stage === "in_consultation"}
          onStart={async () => {
            await startConsultation(visit.id);
            onStarted();
          }}
        />
      );
    case "prescribed":
      return <Signed visit={visit} />;
    case "requested":
    case "proposed":
    case "scheduled":
      // Not in the building yet. Asked-for patients are answered, not seen.
      return (
        <div className="p-4">
          <Card>
            <p className="text-lg">This patient has not arrived yet.</p>
            <p className="text-muted-foreground mt-1 text-base">
              {visit.stage === "proposed" && mine
                ? "The desk has asked you to see them. Answer the request first."
                : "They will appear in your queue once the desk has checked them in."}
            </p>
            {visit.stage === "proposed" && mine ? (
              <Link
                to={`/doctor/requests/${visit.id}`}
                className="mt-3 inline-block rounded-xl border-[3px] border-[#232326] bg-card px-4 py-2 text-base shadow-[0_3px_0_#232326]"
              >
                Answer the request
              </Link>
            ) : null}
          </Card>
        </div>
      );
    case "registered":
      return (
        <div className="p-4">
          <Card>
            <p className="text-lg">Intake is not done yet.</p>
            <p className="text-muted-foreground mt-1 text-base">
              The desk is still taking vitals. This patient will appear in your
              queue as soon as they are sent through.
            </p>
          </Card>
        </div>
      );
    default:
      return (
        <div className="p-4">
          <Card>
            <p className="text-lg">This visit was cancelled.</p>
          </Card>
        </div>
      );
  }
}

/** Somebody else's patient: readable, but not yours to start or sign. */
function NotYours({ visit }: { visit: Visit }) {
  return (
    <div className="p-4">
      <Card tone="warn">
        <p className="text-xl leading-tight">
          This patient was sent to {visit.assignedDoctorName ?? "another doctor"}.
        </p>
        <p className="mt-1.5 text-base leading-relaxed">
          You can read the dossier, but only the doctor the desk chose can start
          the consultation and sign the prescription. If this was the wrong
          doctor, the desk needs to send them again.
        </p>
        <Link
          to="/doctor"
          className="mt-3 inline-block rounded-xl border-[3px] border-[#232326] bg-card px-4 py-2 text-base shadow-[0_3px_0_#232326]"
        >
          Back to my queue
        </Link>
      </Card>
    </div>
  );
}

/** What the doctor sees once it is signed. */
function Signed({ visit }: { visit: Visit }) {
  const rx = usePrescriptions(visit.id);
  const hospitals = useHospitals();
  const hospital = hospitals.data.find((h) => h.id === visit.hospitalId) ?? null;
  const latest = rx.data[0];
  const navigate = useNavigate();
  // Who is next: the longest-waiting patient the desk sent to this doctor.
  const queue = useQueue(["intake_complete", "in_consultation"], { doctorUid: visit.assignedDoctorUid ?? undefined }, !!visit.assignedDoctorUid);
  const next = queue.data.find((v) => v.id !== visit.id) ?? null;

  // N for the next patient, P to print, when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key.toLowerCase() === "n" && next) navigate(`/doctor/${next.id}`);
      if (e.key.toLowerCase() === "p" && latest) printPrescription();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, latest, navigate]);
  return (
    <div className="space-y-4 p-4">
      <Card tone="ok">
        <p className="flex items-center gap-2 text-xl leading-tight">
          <CheckCircle2 className="size-6" aria-hidden />
          Signed
        </p>
        <p className="mt-1 text-base">
          Print it (P) and hand it over: the patient's phone gets the medicines when they scan the code on the slip.
        </p>
        {latest ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn onClick={() => printPrescription()} className="h-12 flex-1 text-lg">
              <Printer className="size-5" aria-hidden />
              Print prescription
            </Btn>
            {/* Larger type for a patient who cannot see well. */}
            <Btn
              kind={visit.accessNeeds?.includes("low_vision") ? "primary" : "quiet"}
              onClick={() => printPrescription({ large: true })}
              className="h-12 text-lg"
            >
              <Printer className="size-5" aria-hidden />
              Large print
            </Btn>
          </div>
        ) : null}
        {next ? (
          <Link
            to={`/doctor/${next.id}`}
            className="mt-3 flex items-center gap-3 rounded-xl border-[3px] border-[#232326] bg-[var(--brand)] px-4 py-3 shadow-[0_3px_0_#232326]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-lg leading-tight font-bold">Next: {next.patientName}</span>
              <span className="block truncate text-sm">
                {[next.patientAgeYears != null ? `${next.patientAgeYears} yrs` : null, next.complaint].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="text-sm opacity-70">N</span>
            <ArrowRight className="size-6 shrink-0" aria-hidden />
          </Link>
        ) : (
          <Link
            to="/doctor"
            className="mt-3 inline-block rounded-xl border-[3px] border-[#232326] bg-card px-4 py-2 text-base shadow-[0_3px_0_#232326]"
          >
            Nobody waiting. Back to the queue
          </Link>
        )}
      </Card>

      <Card>
        {rx.loading ? (
          <p className="text-base">Loading…</p>
        ) : latest ? (
          <PrescriptionView rx={latest} />
        ) : (
          <p className="text-base">No prescription found.</p>
        )}
      </Card>

      {latest ? (
        <PrescriptionSheet
          rx={latest}
          hospital={hospital}
          visitCode={visit.visitCode}
          shareCode={visit.shareCode}
          patient={{
            name: visit.patientName,
            ageYears: visit.patientAgeYears,
            sex: visit.patientSex,
            phone: visit.patientPhone,
            area: visit.patientVillage,
          }}
          complaint={visit.complaint}
        />
      ) : null}
    </div>
  );
}
