import {
  errorMessage,
  startVisit,
  usePatientsByPhone,
  useQueue,
  useVisitsForPatient,
} from "@parcha/client";
import {
  AppBar,
  EmptyQueue,
  PatientRow,
  Screen,
  SectionLabel,
} from "@parcha/ui";
import { formatDay, formatTime, type Patient, type Visit } from "@parcha/core";
import { SlaBadge } from "./Sla";
import { Loader2, Search, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useIdentity } from "../auth";

/**
 * The front desk.
 *
 * Starts with the handset, because that is what the patient says first. The
 * number is not unique — shared family handsets are the norm in the target
 * population — so a lookup returns everybody on it and the desk picks the
 * person by name and age.
 */
export function Desk() {
  const { identity } = useIdentity();
  const navigate = useNavigate();

  const [typed, setTyped] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matches = usePatientsByPhone(phone);
  const deskQueue = useQueue(["registered"]);
  // People who asked before coming: waiting on a doctor, then booked.
  const requests = useQueue(["requested", "proposed"]);
  const booked = useQueue(["scheduled"]);
  // Most urgent first: the request whose hospital has the least time left.
  const requestsByUrgency = [...requests.data].sort((a, b) =>
    (a.respondBy ?? "9").localeCompare(b.respondBy ?? "9"),
  );
  const bookedByTime = [...booked.data].sort(
    (a, b) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""),
  );

  // Which of the matched patients already has a visit open, so the desk never
  // starts a second one by accident.
  const openVisits = useQueue([
    "requested",
    "proposed",
    "scheduled",
    "registered",
    "intake_complete",
    "in_consultation",
    "prescribed",
  ]);
  const openByPatient = new Map(
    openVisits.data.map((v) => [v.patientId, v]),
  );

  async function begin(patientId: string, patient?: Patient) {
    setError(null);
    setBusy(patientId);
    try {
      const { visitId } = await startVisit(patientId, patient);
      navigate(`/intake/${visitId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <>
      <AppBar
          title="Front desk"
          subtitle={identity?.displayName}
          action={
            // The waiting-room screen is opened from here and then left alone,
            // usually on a second monitor turned to face the room.
            <Link
              to="/kiosk"
              className="rounded-full border-2 border-[#232326] bg-[var(--brand-soft)] px-3 py-1 text-sm whitespace-nowrap"
            >
              Open kiosk
            </Link>
          }
        />
      <Screen>
        <form
          className="bg-background border-b p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const digits = typed.replace(/\D/g, "");
            setPhone(digits.length >= 4 ? digits : null);
          }}
        >
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                // A whole mobile number looks itself up: no Enter needed.
                const digits = e.target.value.replace(/\D/g, "");
                if (digits.length === 10) setPhone(digits);
              }}
              autoFocus
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Phone number"
              className="border-input bg-background focus:ring-ring h-12 w-full rounded-xl border pr-20 pl-9 text-base tabular-nums focus:ring-2 focus:outline-none"
            />
            <button
              type="submit"
              className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 h-9 rounded-lg px-3 text-sm font-medium"
            >
              Look up
            </button>
          </div>
          <p className="text-muted-foreground mt-2 text-[11px]">
            Try 9811044321 — one handset, three people in the household.
          </p>
        </form>

        {error ? (
          <p role="alert" className="text-destructive border-b p-3 text-[13px]">
            {error}
          </p>
        ) : null}

        {phone ? (
          <>
            <SectionLabel count={matches.data.length}>
              On {phone}
            </SectionLabel>

            {matches.loading ? (
              <p className="text-muted-foreground p-4 text-sm">Looking up…</p>
            ) : matches.data.length === 0 ? (
              <div className="p-4">
                <Link
                  to={`/desk/new?phone=${phone}`}
                  className="border-border flex items-center gap-3 rounded-xl border border-dashed p-4"
                >
                  <UserPlus className="size-5 shrink-0" />
                  <span className="text-sm font-medium">
                    Register a new patient on {phone}
                  </span>
                </Link>
              </div>
            ) : (
              <>
                {matches.data.map((patient) => {
                  const open = openByPatient.get(patient.id);
                  return (
                    <Returning
                      key={patient.id}
                      patient={patient}
                      trailing={
                        open ? (
                          <Link
                            to={
                              open.stage === "registered"
                                ? `/intake/${open.id}`
                                : ["requested", "proposed", "scheduled"].includes(open.stage)
                                  ? `/desk/requests/${open.id}`
                                  : "/desk"
                            }
                            className="bg-muted mt-0.5 shrink-0 rounded-lg px-3 py-2 text-xs font-medium"
                          >
                            {open.stage === "registered"
                              ? "Take vitals"
                              : ["requested", "proposed", "scheduled"].includes(open.stage)
                                ? "Open request"
                                : "Already in"}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void begin(patient.id, patient)}
                            disabled={busy !== null}
                            className="bg-primary text-primary-foreground mt-0.5 flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-60"
                          >
                            {busy === patient.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : null}
                            Start visit
                          </button>
                        )
                      }
                    />
                  );
                })}
                <div className="p-4">
                  <Link
                    to={`/desk/new?phone=${phone}`}
                    className="text-muted-foreground flex items-center gap-2 text-xs font-medium"
                  >
                    <UserPlus className="size-4" />
                    Somebody else on this number
                  </Link>
                </div>
              </>
            )}
          </>
        ) : null}

        {requests.data.length > 0 ? (
          <>
            <SectionLabel count={requests.data.length}>
              Requests from patients
            </SectionLabel>
            {requestsByUrgency.map((visit) => (
              <PatientRow
                key={visit.id}
                href={`/desk/requests/${visit.id}`}
                name={visit.patientName}
                ageYears={visit.patientAgeYears}
                sex={visit.patientSex}
                area={visit.patientVillage}
                complaint={visit.complaint}
                since={visit.requestedAt ?? visit.registeredAt}
                hasAllergy={visit.hasAllergy}
                accessNeeds={visit.accessNeeds}
                trailing={<RequestTag visit={visit} />}
              />
            ))}
          </>
        ) : null}

        {bookedByTime.length > 0 ? (
          <>
            <SectionLabel count={bookedByTime.length}>Expected</SectionLabel>
            {bookedByTime.map((visit) => (
              <PatientRow
                key={visit.id}
                href={`/desk/requests/${visit.id}`}
                name={visit.patientName}
                ageYears={visit.patientAgeYears}
                sex={visit.patientSex}
                area={visit.patientVillage}
                hasAllergy={visit.hasAllergy}
                accessNeeds={visit.accessNeeds}
                trailing={<RequestTag visit={visit} />}
              />
            ))}
          </>
        ) : null}

        <SectionLabel count={deskQueue.data.length}>
          Waiting at the desk
        </SectionLabel>
        {deskQueue.data.length === 0 ? (
          <EmptyQueue
            title="Nobody waiting"
            detail="Look up a phone number above to start a visit."
          />
        ) : (
          deskQueue.data.map((visit) => (
            <PatientRow
              key={visit.id}
              href={`/intake/${visit.id}`}
              name={visit.patientName}
              ageYears={visit.patientAgeYears}
              sex={visit.patientSex}
              area={visit.patientVillage}
              since={visit.registeredAt}
              token={visit.tokenNumber}
              hasAllergy={visit.hasAllergy}
              accessNeeds={visit.accessNeeds}
            />
          ))
        )}
      </Screen>
    </>
  );
}

/** The right-hand side of a request row: what it needs, or when it is due. */
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "";

/**
 * Someone already on the register, with their last visit under the name, so
 * the desk knows at a glance who this is and why they came before.
 */
function Returning({ patient, trailing }: { patient: Patient; trailing: React.ReactNode }) {
  const history = useVisitsForPatient(patient.id);
  const last = history.data.find((v) => v.stage === "prescribed" || v.closedAt) ?? null;
  const visits = history.data.filter((v) => v.stage === "prescribed").length;
  const summary = last
    ? `Last visit ${shortDate(last.prescribedAt ?? last.registeredAt)}${last.diagnosis ? ` · ${last.diagnosis}` : ""}${last.assignedDoctorName ? ` · ${last.assignedDoctorName}` : ""}${visits > 1 ? ` · ${visits} visits` : ""}`
    : "No visits yet";
  return (
    <PatientRow
      name={patient.fullName}
      ageYears={patient.statedAgeYears}
      sex={patient.sex}
      area={patient.villageOrArea}
      complaint={summary}
      trailing={trailing}
    />
  );
}

function RequestTag({ visit }: { visit: Visit }) {
  const line =
    visit.stage === "scheduled" && visit.scheduledFor
      ? [formatDay(visit.scheduledFor.slice(0, 10)), formatTime(visit.scheduledFor)]
      : visit.stage === "proposed"
        ? ["Asked", visit.assignedDoctorName ?? "a doctor"]
        : [
            "Needs a doctor",
            visit.preferredDate ? formatDay(visit.preferredDate) : "",
          ];
  const clocked = visit.stage === "requested" || visit.stage === "proposed";
  return (
    <div className="mt-0.5 w-28 shrink-0 text-right text-sm leading-tight">
      {clocked ? (
        <p className="mb-1">
          <SlaBadge visit={visit} />
        </p>
      ) : null}
      <p>{line[0]}</p>
      <p className="text-muted-foreground truncate">{line[1]}</p>
      {visit.stage === "scheduled" && visit.assignedDoctorName ? (
        <p className="text-muted-foreground truncate">{visit.assignedDoctorName}</p>
      ) : null}
    </div>
  );
}
