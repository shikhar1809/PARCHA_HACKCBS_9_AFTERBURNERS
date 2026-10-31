import { useQueue } from "@parcha/client";
import { SLOT_TIMES, dayOf, formatDay, nextDays, slotInstant, timeOf, todayInClinic } from "@parcha/core";
import { cn } from "@parcha/ui";

import { Label } from "../bits";

export type Slot = { day: string; time: string | null };

/**
 * A day and a time with one doctor: the next seven days, and the slots on the
 * chosen day with that doctor's bookings and the past struck through, so the
 * desk can never book a time twice.
 */
export function SlotPicker({ doctorUid, preferredDate, value, onChange }: { doctorUid: string; preferredDate?: string | null; value: Slot; onChange: (s: Slot) => void }) {
  const today = todayInClinic();
  const days = nextDays(7);
  const booked = useQueue(["scheduled"], { doctorUid }, true);
  const taken = new Set(booked.data.filter((b) => b.scheduledFor && dayOf(b.scheduledFor) === value.day).map((b) => timeOf(b.scheduledFor!)));
  const passed = (t: string) => slotInstant(value.day, t).getTime() <= Date.now();

  return (
    <div className="space-y-4">
      <div>
        <Label>Which day?</Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Day">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={value.day === d}
              onClick={() => onChange({ day: d, time: null })}
              className={cn(
                "rounded-xl border-[3px] border-[#232326] px-3.5 py-2 text-base",
                value.day === d ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card hover:bg-[var(--hover-soft)]",
              )}
            >
              {formatDay(d)}
              {d === preferredDate ? " ★" : ""}
            </button>
          ))}
        </div>
        {preferredDate && days.includes(preferredDate) ? <p className="text-muted-foreground mt-1.5 text-sm">★ is the day they asked for.</p> : null}
      </div>
      <div>
        <Label>What time?</Label>
        <div className="grid grid-cols-3 gap-2 @lg:grid-cols-5" role="radiogroup" aria-label="Time">
          {SLOT_TIMES.map((t) => {
            const gone = taken.has(t) || (value.day === today && passed(t));
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={value.time === t}
                disabled={gone}
                onClick={() => onChange({ ...value, time: t })}
                className={cn(
                  "rounded-xl border-[3px] border-[#232326] py-2 text-base tabular-nums",
                  value.time === t ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card hover:bg-[var(--hover-soft)]",
                  gone && "opacity-35 line-through hover:bg-card",
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-1.5 text-sm">Struck-through times are taken or already past.</p>
      </div>
    </div>
  );
}
