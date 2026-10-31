import { TIMING_LABELS, everyText, type Prescription } from "@parcha/core";
import { DosePictogram } from "@parcha/ui";

import { shortDate } from "../../bits";

/**
 * A signed prescription, read-only.
 *
 * Used twice: for the one the doctor just signed, and for the ones in the
 * history. Drawn with the same dose pictogram the patient sees, so the
 * doctor reads it the way the patient will.
 */
export function PrescriptionView({ rx }: { rx: Prescription }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {rx.items.map((item, i) => (
          <li
            key={`${item.drugId}-${i}`}
            className="border-b-2 border-[#232326]/15 pb-3 last:border-b-0 last:pb-0"
          >
            <p className="text-lg leading-tight">{item.drugName}</p>
            <p className="text-muted-foreground text-sm">
              <span className="capitalize">{item.form}</span> · {item.strength}{" "}
              · {item.frequency}{(item.everyDays ?? 1) > 1 ? ` · ${everyText(item.everyDays).toLowerCase()}` : ""} · {item.durationDays} days ·{" "}
              {TIMING_LABELS[item.timing]} · qty {item.quantity}
            </p>
            <DosePictogram frequency={item.frequency} form={item.form} className="mt-2" />
            {item.instructions ? (
              <p className="mt-1 text-sm">{item.instructions}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {rx.tests?.length ? (
        <p className="text-base">
          <span className="text-muted-foreground">Tests: </span>
          {rx.tests.join(", ")}
        </p>
      ) : null}
      {rx.advice ? (
        <p className="text-base">
          <span className="text-muted-foreground">Advice: </span>
          {rx.advice}
        </p>
      ) : null}
      {rx.followUpDays ? (
        <p className="text-base">
          <span className="text-muted-foreground">Follow up: </span>in{" "}
          {rx.followUpDays} days
        </p>
      ) : null}
      <p className="text-muted-foreground text-sm">
        {rx.prescriberName}
        {rx.signedAt ? ` · signed ${shortDate(rx.signedAt)}` : ""}
      </p>
    </div>
  );
}
