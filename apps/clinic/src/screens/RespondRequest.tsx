import {
  errorMessage,
  respondToRequest,
  useAllergies,
  useQueue,
  useVisit,
  useVisitsForPatient,
} from "@parcha/client";
import {
  SLOT_TIMES,
  dayOf,
  formatDay,
  formatSlot,
  nextDays,
  slotInstant,
  timeOf,
  todayInClinic,
  type Visit,
} from "@parcha/core";
import { AppBar, cn } from "@parcha/ui";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useIdentity } from "../auth";
import { Btn, Card, FIELD, Label, shortDate } from "../bits";

const QUICK_REASONS = [
  "Fully booked that day",
  "Not my department",
  "Away that day",
  "Please send to another doctor",
];

/**
 * Answering a request: accept and name a time, or decline and say why.
 *
 * The desk asked this doctor because the patient needs seeing, so the screen
 * gives the doctor what they would want to know to decide: what the patient
 * said, their allergies, their last visit, and the day they asked for. The
 * time grid shows what is already taken, so a slot cannot be offered twice
 * (the server refuses a double booking too).
 */
export function RespondRequest() {
  const { visitId = null } = useParams();
  const { identity } = useIdentity();
  const visit = useVisit(visitId);
  const v = visit.data;
  const allergies = useAllergies(v?.patientId ?? null);
  const history = useVisitsForPatient(v?.patientId ?? null);
  const mine = v?.assignedDoctorUid === identity?.uid;

  const last = useMemo(
    () =>
      history.data.find((h) => h.id !== v?.id && h.stage === "prescribed" && h.diagnosis) ??
      null,
    [history.data, v?.id],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppBar
        back="/doctor"
        title={v?.patientName ?? "Request"}
        subtitle={
          v
            ? [
                v.patientAgeYears != null ? `${v.patientAgeYears} yrs` : null,
                v.patientSex,
                v.patientVillage,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
      />

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {visit.error ? (
          <p role="alert" className="text-destructive text-base">
            You cannot open this request. {visit.error}
          </p>
        ) : !v ? (
          <p className="text-muted-foreground text-base">Loading…</p>
        ) : (
          <>
            <Card>
              <Label>
                {v.requestMode === "existing_doctor"
                  ? "Wants to see you again"
                  : "A new problem"}
              </Label>
              <p className="text-lg leading-snug">{v.complaint ?? "No details given."}</p>
              {v.preferredDate ? (
                <p className="mt-2 text-base">
                  <span className="text-muted-foreground">Would like to come: </span>
                  {formatDay(v.preferredDate)}
                </p>
              ) : null}
            </Card>

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

            {last ? (
              <Card>
                <Label>Last visit</Label>
                <p className="text-base">
                  {shortDate(last.registeredAt)} · {last.diagnosis}
                  {last.assignedDoctorName ? ` · ${last.assignedDoctorName}` : ""}
                </p>
              </Card>
            ) : null}

            {v.stage === "proposed" && mine ? (
              <Answer visit={v} />
            ) : v.stage === "proposed" ? (
              <Card tone="warn">
                <p className="text-lg">
                  This was sent to {v.assignedDoctorName ?? "another doctor"}.
                </p>
              </Card>
            ) : v.stage === "scheduled" ? (
              <Card tone="ok">
                <p className="flex items-center gap-2 text-xl leading-tight">
                  <Check className="size-6" aria-hidden />
                  Booked
                </p>
                <p className="mt-1 text-2xl leading-tight">
                  {v.scheduledFor ? formatSlot(v.scheduledFor) : ""}
                </p>
                <p className="mt-1 text-base">
                  The patient has been told. You will see them in your queue once
                  the desk has checked them in.
                </p>
                <Link
                  to="/doctor"
                  className="mt-3 inline-block rounded-xl border-[3px] border-[#232326] bg-card px-4 py-2 text-base shadow-[0_3px_0_#232326]"
                >
                  Back to the queue
                </Link>
              </Card>
            ) : (
              <Card>
                <p className="text-lg">
                  {v.stage === "requested"
                    ? "You declined this one. It is back with the desk."
                    : "This request is not waiting on you."}
                </p>
                <Link
                  to="/doctor"
                  className="mt-3 inline-block rounded-xl border-[3px] border-[#232326] bg-card px-4 py-2 text-base shadow-[0_3px_0_#232326]"
                >
                  Back to the queue
                </Link>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Answer({ visit }: { visit: Visit }) {
  const { identity } = useIdentity();
  const today = todayInClinic();
  const days = nextDays(7);
  const [day, setDay] = useState(
    visit.preferredDate && days.includes(visit.preferredDate) ? visit.preferredDate : days[0],
  );
  const [time, setTime] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What this doctor already has booked, so a slot is never offered twice.
  const booked = useQueue(["scheduled"], { doctorUid: identity?.uid }, identity !== null);
  const taken = new Set(
    booked.data
      .filter((b) => b.scheduledFor && dayOf(b.scheduledFor) === day)
      .map((b) => timeOf(b.scheduledFor!)),
  );
  const passed = (t: string) => slotInstant(day, t).getTime() <= Date.now();

  async function accept() {
    if (!time) return;
    setError(null);
    setBusy(true);
    try {
      await respondToRequest({ visitId: visit.id, accept: true, day, time });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function decline() {
    setError(null);
    setBusy(true);
    try {
      await respondToRequest({ visitId: visit.id, accept: false, reason: reason.trim() });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <Label>Which day?</Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Day">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={day === d}
              onClick={() => {
                setDay(d);
                setTime(null);
              }}
              className={cn(
                "rounded-xl border-[3px] border-[#232326] px-3.5 py-2 text-base",
                day === d
                  ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]"
                  : "bg-card hover:bg-[var(--hover-soft)]",
              )}
            >
              {formatDay(d)}
              {d === visit.preferredDate ? " ★" : ""}
            </button>
          ))}
        </div>
        {visit.preferredDate && !days.includes(visit.preferredDate) ? null : (
          <p className="text-muted-foreground mt-1.5 text-sm">★ is the day they asked for.</p>
        )}
      </div>

      <div>
        <Label>What time?</Label>
        <div className="grid grid-cols-3 gap-2 @lg:grid-cols-5" role="radiogroup" aria-label="Time">
          {SLOT_TIMES.map((t) => {
            const gone = taken.has(t) || (day === today && passed(t));
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={time === t}
                disabled={gone}
                onClick={() => setTime(t)}
                className={cn(
                  "rounded-xl border-[3px] border-[#232326] py-2 text-base tabular-nums",
                  time === t
                    ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]"
                    : "bg-card hover:bg-[var(--hover-soft)]",
                  gone && "opacity-35 line-through hover:bg-card",
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Struck-through times are taken or already past.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-base">
          {error}
        </p>
      ) : null}

      <Btn
        kind="primary"
        disabled={!time || busy}
        onClick={() => void accept()}
        className="h-14 w-full text-lg"
      >
        {busy && !declining ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Check className="size-5" />
        )}
        {time ? `Accept for ${formatDay(day)} at ${time}` : "Choose a time to accept"}
      </Btn>

      {!declining ? (
        <button
          type="button"
          onClick={() => setDeclining(true)}
          className="text-muted-foreground flex items-center gap-1.5 text-base underline"
        >
          <X className="size-4" /> I cannot see this patient
        </button>
      ) : (
        <Card tone="danger">
          <Label>Why not?</Label>
          <div className="mb-2.5 flex flex-wrap gap-2">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={cn(
                  "rounded-full border-2 border-[#232326] px-3 py-1 text-sm",
                  reason === r ? "bg-[var(--brand)]" : "bg-card",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Or write your own"
            className={FIELD}
          />
          <div className="mt-3 flex gap-2.5">
            <Btn
              kind="danger"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void decline()}
            >
              {busy && declining ? <Loader2 className="size-5 animate-spin" /> : null}
              Decline and send back to the desk
            </Btn>
            <Btn onClick={() => setDeclining(false)}>Keep it</Btn>
          </div>
        </Card>
      )}
    </>
  );
}
