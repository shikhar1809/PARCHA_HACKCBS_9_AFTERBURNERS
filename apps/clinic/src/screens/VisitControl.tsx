import { controlVisit, errorMessage, useQueue, useRoutes, useTeam } from "@parcha/client";
import {
  BRING_ITEMS,
  SLOT_TIMES,
  dayOf,
  formatDay,
  nextDays,
  slotInstant,
  timeOf,
  todayInClinic,
  type Visit,
} from "@parcha/core";
import { BringIcon, cn } from "@parcha/ui";
import { CalendarClock, Check, Loader2, Repeat, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useIdentity } from "../auth";
import { Btn, Card, FIELD, Label } from "../bits";

/**
 * Full control of a visit that has not happened yet.
 *
 * Three things a front desk needs to do before a patient arrives: tell them
 * what to bring, move the time, and hand the booking to another doctor. Each
 * is saved the moment it is confirmed and the patient sees it straight away,
 * so the plan the hospital holds and the plan the patient holds are never two
 * different plans.
 */
export function VisitControl({ visit }: { visit: Visit }) {
  return (
    <div className="space-y-5">
      <Bring visit={visit} />
      {visit.stage === "scheduled" ? (
        <>
          <Reschedule visit={visit} />
          <Reassign visit={visit} />
        </>
      ) : null}
    </div>
  );
}

/** Pick what to bring from pictures; add a line only for anything else. */
function Bring({ visit }: { visit: Visit }) {
  const saved = visit.bring ?? [];
  const [picked, setPicked] = useState<string[]>(saved);
  const [note, setNote] = useState(visit.bringNote ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow the saved plan if somebody else changes it.
  const key = saved.join(",") + "|" + (visit.bringNote ?? "");
  useEffect(() => {
    setPicked(saved);
    setNote(visit.bringNote ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const dirty = picked.join(",") !== saved.join(",") || note.trim() !== (visit.bringNote ?? "");
  const ready = (visit.bringReady ?? []).length;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await controlVisit({ visitId: visit.id, action: "bring", bring: picked, bringNote: note });
      setDone(true);
      setTimeout(() => setDone(false), 2200);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Label>Ask the patient to bring</Label>
      <div className="grid grid-cols-2 gap-2.5 @lg:grid-cols-4" role="group" aria-label="Things to bring">
        {BRING_ITEMS.map((item) => {
          const on = picked.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setPicked((p) => (p.includes(item.id) ? p.filter((x) => x !== item.id) : [...p, item.id]))
              }
              className={cn(
                "hover-orange flex flex-col items-center gap-1.5 rounded-xl border-[3px] border-[#232326] px-2 py-3 text-center",
                on ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card",
              )}
            >
              <BringIcon name={item.icon} className="size-7" />
              <span className="text-sm leading-tight">{item.label}</span>
            </button>
          );
        })}
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={300}
        placeholder="Anything else? For example: come to Gate 2"
        className={`${FIELD} mt-3`}
      />

      {saved.length > 0 ? (
        <p className="mt-2 text-sm">
          The patient has {ready} of {saved.length} ready.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive mt-2 text-base">
          {error}
        </p>
      ) : null}

      <Btn kind="primary" className="mt-3" disabled={!dirty || busy} onClick={() => void save()}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : done ? <Check className="size-5" /> : <Save className="size-5" />}
        {done ? "Patient has been told" : "Tell the patient"}
      </Btn>
    </Card>
  );
}

/** Move the booked time, with what the doctor already has taken struck through. */
function Reschedule({ visit }: { visit: Visit }) {
  const { identity } = useIdentity();
  const today = todayInClinic();
  const days = nextDays(7);
  const current = visit.scheduledFor ? dayOf(visit.scheduledFor) : days[0];
  const [day, setDay] = useState(days.includes(current) ? current : days[0]);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const booked = useQueue(["scheduled"], { doctorUid: visit.assignedDoctorUid ?? undefined }, identity !== null && open);
  const taken = new Set(
    booked.data
      .filter((b) => b.id !== visit.id && b.scheduledFor && dayOf(b.scheduledFor) === day)
      .map((b) => timeOf(b.scheduledFor!)),
  );

  async function go() {
    if (!time) return;
    setError(null);
    setBusy(true);
    try {
      await controlVisit({ visitId: visit.id, action: "reschedule", day, time });
      setOpen(false);
      setTime(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Btn onClick={() => setOpen(true)}>
        <CalendarClock className="size-5" /> Change the time
      </Btn>
    );
  }

  return (
    <Card>
      <Label>Move it to</Label>
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
              "hover-orange rounded-xl border-[3px] border-[#232326] px-3 py-1.5 text-base",
              day === d ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card",
            )}
          >
            {formatDay(d)}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 @lg:grid-cols-7" role="radiogroup" aria-label="Time">
        {SLOT_TIMES.map((t) => {
          const gone = taken.has(t) || (day === today && slotInstant(day, t).getTime() <= Date.now());
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={time === t}
              disabled={gone}
              onClick={() => setTime(t)}
              className={cn(
                "hover-orange rounded-lg border-[3px] border-[#232326] py-1.5 text-sm tabular-nums",
                time === t ? "bg-[var(--brand)]" : "bg-card",
                gone && "opacity-35 line-through",
              )}
            >
              {t}
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-destructive mt-2 text-base">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2.5">
        <Btn kind="primary" disabled={!time || busy} onClick={() => void go()}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
          Move it
        </Btn>
        <Btn onClick={() => setOpen(false)}>Leave it</Btn>
      </div>
    </Card>
  );
}

/** Hand the booking to another doctor this desk is connected to, at the same time. */
function Reassign({ visit }: { visit: Visit }) {
  const { identity } = useIdentity();
  const team = useTeam();
  const routes = useRoutes();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doctors = useMemo(() => {
    const mine = new Set(
      routes.data.filter((r) => r.kind === "desk_doctor" && r.fromUid === identity?.uid).map((r) => r.toUid),
    );
    return team.data.filter(
      (p) => p.accountType === "doctor" && p.active !== false && mine.has(p.uid) && p.uid !== visit.assignedDoctorUid,
    );
  }, [team.data, routes.data, identity?.uid, visit.assignedDoctorUid]);

  async function go(uid: string) {
    setError(null);
    setBusy(uid);
    try {
      await controlVisit({ visitId: visit.id, action: "reassign", doctorUid: uid });
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <Btn onClick={() => setOpen(true)}>
        <Repeat className="size-5" /> Hand it to another doctor
      </Btn>
    );
  }

  return (
    <Card>
      <Label>Hand it to</Label>
      {doctors.length === 0 ? (
        <p className="text-base">There is no other doctor this desk is connected to.</p>
      ) : (
        <div className="space-y-2">
          {doctors.map((d) => (
            <button
              key={d.uid}
              type="button"
              disabled={busy !== null}
              onClick={() => void go(d.uid)}
              className="hover-orange flex w-full items-center justify-between gap-3 rounded-xl border-[3px] border-[#232326] bg-card px-3 py-2.5 text-left"
            >
              <span>
                <span className="block text-lg leading-tight">{d.displayName}</span>
                <span className="text-sm">{d.department ?? "Doctor"}</span>
              </span>
              {busy === d.uid ? <Loader2 className="size-5 animate-spin" /> : null}
            </button>
          ))}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-destructive mt-2 text-base">
          {error}
        </p>
      ) : null}
      <Btn className="mt-3" onClick={() => setOpen(false)}>
        Leave it
      </Btn>
    </Card>
  );
}
