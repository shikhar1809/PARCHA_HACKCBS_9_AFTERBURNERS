import { doseKind, frequencySlots, isOral, siteWords, slotNames, unitWord } from "@parcha/core";
import { cn } from "./cn";

/**
 * When to take a medicine, drawn rather than written.
 *
 * The target patient may not read comfortably in any language, which makes
 * "1-0-1, after food" useless to them even though it is perfectly clear to a
 * pharmacist. So the three Indian OPD dosing slots are drawn as sunrise, sun
 * and moon, filled when a dose is due and hollow when it is not, with the
 * count printed on top for the doses that are more than one.
 *
 * Deliberately not emoji: emoji render differently on every cheap Android
 * build, and some of them do not render at all.
 */


export function DosePictogram({
  frequency,
  form,
  className,
}: {
  frequency: string;
  /** What one dose is: a tablet, a spoon, a drop, a puff. Printed under the count. */
  form?: string;
  className?: string;
}) {
  const slots = frequencySlots(frequency);

  // SOS and STAT are not a pattern. Saying so plainly beats drawing something
  // that implies a schedule the patient does not have.
  if (!slots) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <span className="border-foreground/30 text-foreground/80 rounded-full border border-dashed px-3 py-1 text-sm font-medium">
          {frequency.toUpperCase() === "SOS" ? "Only when needed" : frequency}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-end gap-3", className)}>
      {slots.map((count, index) => (
        <div key={index} className="flex flex-col items-center gap-1">
          <SlotIcon index={index} active={count > 0} count={count} />
          <span
            className={cn(
              "text-[0.7rem]",
              count > 0 ? "text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            {slotNames(slots.length)[index]?.en ?? `Dose ${index + 1}`}
          </span>
          {count > 0 && form ? (
            <span className="text-muted-foreground text-[0.65rem]">{unitWord(form, count)}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SlotIcon({
  index,
  active,
  count,
}: {
  index: number;
  active: boolean;
  count: number;
}) {
  const stroke = active ? "currentColor" : "currentColor";
  return (
    <div
      className={cn(
        "relative flex size-12 items-center justify-center rounded-xl border-2",
        active
          ? "border-foreground bg-foreground/5 text-foreground"
          : "border-muted text-muted-foreground/40",
      )}
      // The icon is decorative; the text label underneath carries the meaning.
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke={stroke}>
        {index === 0 ? (
          // Sunrise: sun on the horizon.
          <>
            <circle cx="12" cy="13" r="4" strokeWidth="1.8" />
            <path d="M12 5v2M5 13H3M21 13h-2M6.5 7.5 5 6M17.5 7.5 19 6" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M2 19h20" strokeWidth="2" strokeLinecap="round" />
          </>
        ) : index === 1 ? (
          // Midday sun, high and full.
          <>
            <circle cx="12" cy="12" r="4.5" strokeWidth="1.8" />
            <path
              d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </>
        ) : (
          // Crescent moon.
          <path
            d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {count > 1 ? (
        <span className="bg-foreground text-background absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full text-xs font-bold tabular-nums">
          {count}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Food timing, also drawn.
 *
 * "Before food" and "after food" are the two instructions patients most
 * often get wrong, and getting them wrong matters - on an empty stomach an
 * NSAID bites, and levothyroxine with breakfast simply does not work.
 */
export function TimingPictogram({
  timing,
  form,
  className,
}: {
  timing: string;
  /** Food is only said for what is swallowed; anything else is told where it goes. */
  form?: string;
  className?: string;
}) {
  const copy: Record<string, { label: string; order: "food-first" | "pill-first" | "together" | "none" }> =
    {
      before_food: { label: "Medicine first, then food", order: "pill-first" },
      after_food: { label: "Food first, then medicine", order: "food-first" },
      with_food: { label: "With food", order: "together" },
      empty_stomach: { label: "Empty stomach, before food", order: "pill-first" },
      any: { label: "Any time", order: "none" },
    };

  // An eye drop has no stomach: "after food" on it is noise, so the row says
  // where it goes instead.
  const entry =
    form && !isOral(form)
      ? { label: siteWords(form) || "Not to be swallowed", order: "none" as const }
      : copy[timing] ?? { label: timing, order: "none" as const };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {entry.order !== "none" ? (
        <span className="text-muted-foreground flex items-center gap-1.5">
          {entry.order === "food-first" ? (
            <>
              <PlateIcon />
              <Arrow />
              <PillIcon />
            </>
          ) : entry.order === "pill-first" ? (
            <>
              <PillIcon />
              <Arrow />
              <PlateIcon />
            </>
          ) : (
            <>
              <PlateIcon />
              <PillIcon />
            </>
          )}
        </span>
      ) : null}
      <span className="text-sm font-medium">{entry.label}</span>
    </div>
  );
}

function PlateIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" strokeWidth="1.5" />
    </svg>
  );
}

function PillIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="2.5" y="8" width="19" height="8" rx="4" strokeWidth="1.8" />
      <path d="M12 8v8" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * One dose drawn as the thing itself: a capsule, a bottle and spoon, a
 * dropper, a puffer, a tube. The picture is what a patient who does not read
 * goes by, so drawing a tablet for an eye drop is the one mistake worth never
 * making.
 */
export function FormIcon({ form, className }: { form: string; className?: string }) {
  const kind = doseKind(form);
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6", className)} fill="none" stroke="currentColor" aria-hidden="true">
      {kind === "drops" ? (
        <>
          <path d="M12 3s5 6 5 9.2A5 5 0 0 1 7 12.2C7 9 12 3 12 3Z" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M7.5 20.5h9" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : kind === "syrup" ? (
        <>
          <path d="M9 3h6v3l2 3v12H7V9l2-3V3Z" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M7 13h10" strokeWidth="1.8" />
        </>
      ) : kind === "inhaler" ? (
        <>
          <rect x="7" y="7" width="8" height="14" rx="2" strokeWidth="1.8" />
          <path d="M11 7V3h3v4M15 11h4" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : kind === "topical" ? (
        <>
          <path d="M8 7h8v13a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V7Z" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M10 7V4h4v3M10 11h4" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : kind === "sachet" ? (
        <>
          <path d="M5 5h14v14H5z" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M5 9h14M9 5v14" strokeWidth="1.5" />
        </>
      ) : kind === "injection" ? (
        <path d="M3 21l5-5M8.5 15.5 15 9M11 7l6 6M14 4l6 6M16.5 6.5 19 9" strokeWidth="1.8" strokeLinecap="round" />
      ) : kind === "capsule" ? (
        <>
          <rect x="2.5" y="8" width="19" height="8" rx="4" strokeWidth="1.8" />
          <path d="M12 8v8" strokeWidth="1.8" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="8.5" strokeWidth="1.8" />
          <path d="M6.5 12h11" strokeWidth="1.8" />
        </>
      )}
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M4 12h14M13 7l5 5-5 5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
