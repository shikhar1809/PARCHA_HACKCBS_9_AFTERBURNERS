import { passOnRequest, errorMessage } from "@parcha/client";
import { clock, formatTime, secondsLeft, type Visit } from "@parcha/core";
import { cn } from "@parcha/ui";
import { Clock, Forward, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Btn, Card, FIELD, Label } from "../bits";

/** The current time, ticking once a second. */
export function useNow(everyMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** How urgent a request is, from the seconds the hospital has left. */
export function urgency(left: number): "calm" | "soon" | "late" {
  return left <= 120 ? "late" : left <= 300 ? "soon" : "calm";
}

/**
 * The clock on a request, small enough for a list row.
 *
 * Green-ish and quiet while there is time, amber under five minutes, red under
 * two, and "Overdue" once the promise is broken: the patient's phone is about
 * to move it to another hospital, so the desk should treat it as already gone.
 */
export function SlaBadge({ visit }: { visit: Visit }) {
  const now = useNow();
  if (!visit.respondBy) return null;
  const left = secondsLeft(visit.respondBy, now);
  const level = urgency(left);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border-2 border-[#232326] px-2 py-0.5 text-sm tabular-nums",
        left === 0
          ? "bg-[#232326] text-white"
          : level === "late"
            ? "bg-[oklch(0.85_0.12_25)]"
            : level === "soon"
              ? "bg-[var(--morning-soft)]"
              : "bg-[var(--brand-soft)]",
      )}
    >
      <Clock className="size-3.5" aria-hidden />
      {left === 0 ? "Overdue" : clock(left)}
    </span>
  );
}

/**
 * The promise, at the top of a request: how long this hospital has left to
 * answer, and where the request has already been.
 */
export function SlaBanner({ visit }: { visit: Visit }) {
  const now = useNow();
  if (!visit.respondBy) return null;
  const left = secondsLeft(visit.respondBy, now);
  const level = urgency(left);
  const before = (visit.attempts ?? []).filter(
    (a) => a.outcome === "timed_out" || a.outcome === "declined",
  );

  return (
    <Card tone={left === 0 || level === "late" ? "danger" : level === "soon" ? "warn" : "ok"}>
      <p className="flex items-center gap-2 text-xl leading-tight">
        <Clock className="size-6" aria-hidden />
        {left === 0 ? "Time is up" : `${clock(left)} left to answer`}
      </p>
      <p className="mt-1 text-base leading-relaxed">
        {left === 0
          ? "This is being tried at another hospital now."
          : `The patient was promised an answer by ${formatTime(visit.respondBy)}. After that it goes to the next hospital.`}
      </p>
      {before.length > 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          Already tried: {before.map((a) => a.hospitalName).join(", ")}.
        </p>
      ) : null}
    </Card>
  );
}

const REASONS = [
  "No doctor free today",
  "Outside our departments",
  "Beds full",
  "Cannot take it right now",
];

/**
 * "We can't take this one": pass it on at once instead of letting the clock run
 * out. The patient is told it is being tried elsewhere, so they lose seconds,
 * not fifteen minutes.
 */
export function PassOn({ visit }: { visit: Visit }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null);
    setBusy(true);
    try {
      await passOnRequest(visit.id, reason.trim());
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
        className="hover-orange flex items-center gap-2 rounded-xl border-[3px] border-[#232326] bg-card px-4 py-2.5 text-base"
      >
        <Forward className="size-5" /> We cannot take this: pass it to the next hospital
      </button>
    );
  }

  return (
    <Card tone="warn">
      <Label>Why can you not take it?</Label>
      <div className="mb-2.5 flex flex-wrap gap-2">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={cn(
              "hover-orange rounded-full border-2 border-[#232326] px-3 py-1 text-sm",
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
      {error ? (
        <p role="alert" className="text-destructive mt-2 text-base">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2.5">
        <Btn kind="primary" disabled={busy || reason.trim().length < 3} onClick={() => void go()}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Forward className="size-5" />}
          Pass it on
        </Btn>
        <Btn onClick={() => setOpen(false)}>Keep it</Btn>
      </div>
    </Card>
  );
}
