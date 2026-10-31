import { dispensePrescription, errorMessage, useFormulary, usePrescriptions, useTodaysVisits } from "@parcha/client";
import { alternativesFor, everyText, type PrescriptionItem, type Visit } from "@parcha/core";
import { AppBar, cn, Screen } from "@parcha/ui";
import { Check, ChevronDown, Loader2, PackageCheck, Pill } from "lucide-react";
import { useMemo, useState } from "react";

import { Btn, Card } from "../bits";

const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";

/**
 * The pharmacy counter: today's signed prescriptions, oldest waiting first.
 * The pharmacist ticks what they gave, swaps in a brand with the same formula
 * when the prescribed one is out of stock, and marks it done. The doctor reads
 * what was given in the activity log.
 */
export function Pharmacy() {
  const today = useTodaysVisits();
  const [showDone, setShowDone] = useState(false);
  // Longest waiting first: in the order the doctors signed.
  const waiting = today.data.filter((v) => v.stage === "prescribed" && !v.dispensedAt).sort((a, b) => String(a.prescribedAt).localeCompare(String(b.prescribedAt)));
  const done = today.data.filter((v) => v.dispensedAt);

  return (
    <>
      <AppBar title="Pharmacy" subtitle={waiting.length ? `${waiting.length} to give out` : "Nobody waiting"} />
      <Screen className="space-y-4 p-4">
        {today.error ? (
          <p role="alert" className="text-destructive text-base">
            Could not load today's prescriptions. {today.error}
          </p>
        ) : today.loading && today.data.length === 0 ? (
          <p className="flex items-center gap-2 text-base">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        ) : waiting.length === 0 ? (
          <Card tone="ok" className="flex items-center gap-3">
            <PackageCheck className="size-7 shrink-0" aria-hidden />
            <p className="text-base">Every prescription signed today has been given out. New ones appear here the moment the doctor signs.</p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {waiting.map((v) => (
              <li key={v.id}>
                <ToGive visit={v} />
              </li>
            ))}
          </ul>
        )}

        {done.length ? (
          <div className="space-y-2">
            <button type="button" onClick={() => setShowDone(!showDone)} className="flex items-center gap-2 text-base font-bold" aria-expanded={showDone}>
              <ChevronDown className={cn("size-5 transition", showDone && "rotate-180")} aria-hidden />
              Given out today ({done.length})
            </button>
            {showDone ? (
              <ul className="space-y-2">
                {done.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-[#232326] bg-white px-3 py-2">
                    <span className="text-base font-bold">{v.patientName}</span>
                    <span className="text-sm">
                      {time(v.dispensedAt)} by {v.dispensedBy ?? "the pharmacy"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Screen>
    </>
  );
}

type Line = { given: boolean; substitute: string };

function ToGive({ visit }: { visit: Visit }) {
  const rx = usePrescriptions(visit.id);
  const drugs = useFormulary();
  const items = rx.data[0]?.items ?? [];
  const [lines, setLines] = useState<Line[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown: Line[] = lines ?? items.map(() => ({ given: true, substitute: "" }));
  const set = (i: number, l: Partial<Line>) => setLines(shown.map((x, j) => (j === i ? { ...x, ...l } : x)));

  async function give() {
    setBusy(true);
    setError(null);
    try {
      await dispensePrescription(
        visit.id,
        shown.map((l) => ({ given: l.given, substitute: l.given && l.substitute ? l.substitute : null })),
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-xl font-bold">
          {visit.tokenNumber ? <span className="mr-2 rounded-lg bg-[#232326] px-2 py-0.5 text-white tabular-nums">#{visit.tokenNumber}</span> : null}
          {visit.patientName}
          {visit.patientAgeYears != null ? <span className="font-normal">, {visit.patientAgeYears}</span> : null}
        </p>
        <p className="text-sm">
          {visit.assignedDoctorName ?? "Doctor"} · signed {time(visit.prescribedAt)}
        </p>
      </div>
      {rx.loading && items.length === 0 ? (
        <p className="flex items-center gap-2 text-base">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Reading the prescription…
        </p>
      ) : items.length === 0 ? (
        <p className="text-base">No medicines on this prescription: advice only. Mark it done.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <Medicine key={i} item={item} line={shown[i]} onChange={(l) => set(i, l)} sameFormula={sameFormulaFor(item, drugs.data)} />
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-destructive text-base">
          {error}
        </p>
      ) : null}
      <Btn kind="primary" disabled={busy || rx.loading} onClick={() => void give()}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
        {shown.every((l) => l.given) ? "Given out" : `Given ${shown.filter((l) => l.given).length} of ${shown.length}`}
      </Btn>
    </Card>
  );
}

function sameFormulaFor(item: PrescriptionItem, drugs: import("@parcha/core").Drug[]): string[] {
  const drug = drugs.find((d) => d.id === item.drugId);
  if (!drug) return [];
  return alternativesFor(drug, drugs).sameFormula.filter((n) => n.toLowerCase() !== item.drugName.toLowerCase());
}

function Medicine({ item, line, onChange, sameFormula }: { item: PrescriptionItem; line: Line; onChange: (l: Partial<Line>) => void; sameFormula: string[] }) {
  const often = (item.everyDays ?? 1) > 1 ? `, ${everyText(item.everyDays).toLowerCase()}` : "";
  return (
    <li className={cn("rounded-xl border-[3px] border-[#232326] p-3", line.given ? "bg-white" : "bg-[var(--morning-soft)]")}>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={line.given} onChange={(e) => onChange({ given: e.target.checked })} className="mt-1 size-6 shrink-0 accent-[#232326]" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-lg leading-tight font-bold">
            <Pill className="size-4 shrink-0" aria-hidden />
            {item.drugName} {item.strength}
          </span>
          <span className="block text-sm">
            {item.frequency}
            {often} · {item.durationDays} days · give <b>{item.quantity}</b> {item.form}
            {item.quantity === 1 ? "" : "s"}
          </span>
        </span>
      </label>
      {line.given && sameFormula.length ? (
        <label className="mt-2 flex flex-wrap items-center gap-2 pl-9 text-sm">
          <span>Out of stock? Give instead</span>
          <select
            value={line.substitute}
            onChange={(e) => onChange({ substitute: e.target.value })}
            className="rounded-lg border-2 border-[#232326] bg-white px-2 py-1 text-sm"
            aria-label={`Same-formula swap for ${item.drugName}`}
          >
            <option value="">{item.drugName}, as prescribed</option>
            {sameFormula.map((n) => (
              <option key={n} value={n}>
                {n} (same formula)
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {!line.given ? <p className="mt-1 pl-9 text-sm font-bold">Not given. The doctor will see this in the activity log.</p> : null}
    </li>
  );
}
