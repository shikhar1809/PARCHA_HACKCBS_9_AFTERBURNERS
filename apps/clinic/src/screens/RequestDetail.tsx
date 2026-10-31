import {
  bookRequest,
  cancelVisitRequest,
  checkInVisit,
  errorMessage,
  proposeVisit,
  useAllergies,
  useVisit,
  useVisitsForPatient,
  withdrawProposal,
} from "@parcha/client";
import { formatDay, formatSlot, nextDays, STAGE_META, type Visit } from "@parcha/core";
import { AppBar } from "@parcha/ui";
import { AlertTriangle, CalendarCheck, Loader2, LogIn, Send, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { mayAct, useIdentity } from "../auth";
import { Btn, Card, FIELD, Label, shortDate } from "../bits";
import { DoctorPicker, type ChosenDoctor } from "./intake/DoctorPicker";
import { PassOn, SlaBanner } from "./Sla";
import { SlotPicker, type Slot } from "./SlotPicker";
import { VisitControl } from "./VisitControl";

/**
 * A request from a patient, at the desk.
 *
 * The patient asked from their own phone; the desk's job is to find a doctor
 * and either book a day and time with them straight away, or ask them to. What the desk sees here is what it needs to do that well: what
 * the patient said, which doctor (if any) they asked for, the day they want,
 * their allergies and last visit, and each doctor's availability and load.
 * Once a doctor has accepted and named a time, the same screen is where the
 * patient is checked in on arrival.
 */
export function RequestDetail() {
  const { visitId = null } = useParams();
  const { identity } = useIdentity();
  const visit = useVisit(visitId);
  const v = visit.data;
  const allergies = useAllergies(v?.patientId ?? null);
  const history = useVisitsForPatient(v?.patientId ?? null);

  const lastVisit = useMemo(
    () =>
      history.data.find(
        (h) => h.id !== v?.id && h.stage === "prescribed" && h.diagnosis,
      ) ?? null,
    [history.data, v?.id],
  );

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
        title={v?.patientName ?? "Request"}
        subtitle={who}
        action={
          v ? (
            <span className="rounded-full border-2 border-[#232326] bg-[var(--brand-soft)] px-3 py-1 text-sm whitespace-nowrap">
              {STAGE_META[v.stage].label}
            </span>
          ) : null
        }
      />

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {visit.error ? (
          <p role="alert" className="text-destructive text-base">
            You cannot open this request. {visit.error}
          </p>
        ) : !v ? (
          <p className="text-muted-foreground text-base">Loading…</p>
        ) : !mayAct(identity, "compounder") ? (
          <Card>
            <p className="text-lg">Requests are handled at the front desk.</p>
          </Card>
        ) : (
          <>
            {v.stage === "requested" || v.stage === "proposed" ? (
              <SlaBanner visit={v} />
            ) : null}

            <Asked visit={v} />

            {allergies.data.length > 0 ? (
              <Card tone="danger">
                <p className="mb-1 flex items-center gap-2 text-sm tracking-wide uppercase">
                  <AlertTriangle className="size-5" aria-hidden />
                  Allergies on record
                </p>
                <p className="text-lg leading-snug">
                  {allergies.data.map((a) => a.label).join(", ")}
                </p>
              </Card>
            ) : null}

            {lastVisit ? (
              <Card>
                <Label>Last visit</Label>
                <p className="text-base">
                  {shortDate(lastVisit.registeredAt)} · {lastVisit.diagnosis}
                  {lastVisit.assignedDoctorName ? ` · ${lastVisit.assignedDoctorName}` : ""}
                </p>
              </Card>
            ) : null}

            {(v.declines ?? []).length > 0 ? (
              <Card tone="warn">
                <Label>Doctors who said no</Label>
                <ul className="space-y-1 text-base">
                  {(v.declines ?? []).map((d, i) => (
                    <li key={i}>
                      <span className="font-bold">{d.doctorName}:</span> {d.reason}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {["requested", "proposed", "scheduled"].includes(v.stage) ? (
              <VisitControl visit={v} />
            ) : null}

            {v.stage === "requested" ? (
              <Triage visit={v} />
            ) : v.stage === "proposed" ? (
              <Waiting visit={v} />
            ) : v.stage === "scheduled" ? (
              <Booked visit={v} />
            ) : (
              <Card>
                <p className="text-lg">
                  {v.stage === "cancelled"
                    ? "This request was cancelled."
                    : `This visit has moved on: ${STAGE_META[v.stage].waitingFor.toLowerCase()}.`}
                </p>
                <Link
                  to="/desk"
                  className="mt-3 inline-block rounded-xl border-[3px] border-[#232326] bg-card px-4 py-2 text-base shadow-[0_3px_0_#232326]"
                >
                  Back to the desk
                </Link>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** What the patient asked for, in their words. */
function Asked({ visit }: { visit: Visit }) {
  return (
    <Card>
      <Label>
        {visit.requestMode === "existing_doctor"
          ? `Wants to see ${visit.requestedDoctorName ?? "their doctor"} again`
          : "A new problem"}
      </Label>
      <p className="text-lg leading-snug">{visit.complaint ?? "No details given."}</p>
      {visit.preferredDate ? (
        <p className="mt-2 text-base">
          <span className="text-muted-foreground">Would like to come: </span>
          {formatDay(visit.preferredDate)}
        </p>
      ) : null}
    </Card>
  );
}

/** Finding a doctor. */
function Triage({ visit }: { visit: Visit }) {
  const [doctor, setDoctor] = useState<ChosenDoctor | null>(null);
  const days = nextDays(7);
  const [slot, setSlot] = useState<Slot>({ day: visit.preferredDate && days.includes(visit.preferredDate) ? visit.preferredDate : days[0], time: null });
  const [busy, setBusy] = useState<null | "book" | "ask">(null);
  const [error, setError] = useState<string | null>(null);

  const declined = Object.fromEntries(
    (visit.declines ?? []).map((d) => [d.doctorUid, d.reason]),
  );

  /** The desk books the slot itself: the patient is told at once. */
  async function book() {
    if (!doctor || !slot.time) return;
    setError(null);
    setBusy("book");
    try {
      await bookRequest(visit.id, doctor.uid, slot.day, slot.time);
      // The visit moves to "booked" and the screen follows it.
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  /** Or leave the time to the doctor. */
  async function send() {
    if (!doctor) return;
    setError(null);
    setBusy("ask");
    try {
      await proposeVisit(visit.id, doctor.uid);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <>
      <DoctorPicker
        value={doctor}
        onChange={(d) => {
          setDoctor(d);
          setSlot((s) => ({ ...s, time: null }));
        }}
        preferUid={visit.requestedDoctorUid}
        preferNote="The patient asked for this doctor"
        declined={declined}
      />

      {doctor ? <SlotPicker doctorUid={doctor.uid} preferredDate={visit.preferredDate} value={slot} onChange={setSlot} /> : null}

      {error ? (
        <p role="alert" className="text-destructive text-base">
          {error}
        </p>
      ) : null}

      <Btn
        kind="primary"
        disabled={!doctor || !slot.time || busy !== null}
        onClick={() => void book()}
        className="h-14 w-full text-lg"
      >
        {busy === "book" ? <Loader2 className="size-5 animate-spin" /> : <CalendarCheck className="size-5" />}
        {!doctor ? "Choose a doctor" : slot.time ? `Book with ${doctor.name}, ${formatDay(slot.day)} at ${slot.time}` : "Choose a time to book"}
      </Btn>
      {doctor ? (
        <Btn disabled={busy !== null} onClick={() => void send()} className="w-full">
          {busy === "ask" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Or ask {doctor.name} to choose the time
        </Btn>
      ) : null}

      <PassOn visit={visit} />
      <CancelRequest visit={visit} />
    </>
  );
}

/** A doctor has been asked and has not answered. */
function Waiting({ visit }: { visit: Visit }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function takeBack() {
    setError(null);
    setBusy(true);
    try {
      await withdrawProposal(visit.id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Card tone="warn">
        <p className="text-xl leading-tight">
          Waiting for {visit.assignedDoctorName ?? "the doctor"} to accept.
        </p>
        <p className="mt-1.5 text-base leading-relaxed">
          They will name a time, or say why they cannot. You will see it here
          the moment they answer, and so will the patient.
        </p>
        <Btn className="mt-3" disabled={busy} onClick={() => void takeBack()}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Undo2 className="size-5" />}
          Take it back and choose another doctor
        </Btn>
      </Card>
      {error ? (
        <p role="alert" className="text-destructive text-base">
          {error}
        </p>
      ) : null}
      <PassOn visit={visit} />
      <CancelRequest visit={visit} />
    </>
  );
}

/** A doctor said yes. When the patient turns up, check them in. */
function Booked({ visit }: { visit: Visit }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkIn() {
    setError(null);
    setBusy(true);
    try {
      await checkInVisit(visit.id);
      navigate(`/intake/${visit.id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Card tone="ok">
        <p className="flex items-center gap-2 text-xl leading-tight">
          <CalendarCheck className="size-6" aria-hidden />
          Booked
        </p>
        <p className="mt-1 text-2xl leading-tight">
          {visit.scheduledFor ? formatSlot(visit.scheduledFor) : "Time to be confirmed"}
        </p>
        <p className="text-base">with {visit.assignedDoctorName}</p>
      </Card>

      {error ? (
        <p role="alert" className="text-destructive text-base">
          {error}
        </p>
      ) : null}

      <Btn
        kind="primary"
        disabled={busy}
        onClick={() => void checkIn()}
        className="h-14 w-full text-lg"
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : <LogIn className="size-5" />}
        {visit.patientName.split(" ")[0]} has arrived: check in
      </Btn>

      <CancelRequest visit={visit} label="They are not coming: cancel" />
    </>
  );
}

/** Letting a request go, with a reason the audit trail keeps. */
function CancelRequest({ visit, label = "Cancel this request" }: { visit: Visit; label?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setError(null);
    setBusy(true);
    try {
      await cancelVisitRequest(visit.id, reason.trim());
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground flex items-center gap-1.5 text-base underline"
      >
        <X className="size-4" /> {label}
      </button>
    );
  }

  return (
    <Card tone="danger">
      <Label>Why?</Label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="For example: no doctor free this week"
        className={FIELD}
      />
      {error ? (
        <p role="alert" className="text-destructive mt-2 text-base">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2.5">
        <Btn kind="danger" disabled={busy || reason.trim().length < 3} onClick={() => void cancel()}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : null}
          Cancel the request
        </Btn>
        <Btn onClick={() => setOpen(false)}>Keep it</Btn>
      </div>
    </Card>
  );
}
