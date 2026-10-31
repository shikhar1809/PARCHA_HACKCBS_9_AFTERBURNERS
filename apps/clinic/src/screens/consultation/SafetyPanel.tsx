import {
  checkLocally,
  checkPrescription,
  useAllergies,
  useFormulary,
  useOffline,
  useSafetyData,
  useVisit,
  type SafetyFlag,
} from "@parcha/client";
import type { Pregnancy, PrescriptionItem, Severity } from "@parcha/core";
import { Check, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Card } from "../../bits";

type CheckState = { flags: SafetyFlag[]; checking: boolean; failed: boolean; checkedFor: string; local?: boolean };

/**
 * Runs the server's safety check whenever the medicines change, after a short
 * pause so a doctor adding three lines does not make three calls. It is the
 * same engine and context signing uses, so what is shown here is what the
 * signature will be held to.
 */
export function useSafetyCheck(visitId: string, items: PrescriptionItem[], pregnancy: Pregnancy | null): CheckState {
  // Which medicines, and their doses (the dose rules read them), and pregnancy.
  const signature = `${items.map((i) => `${i.drugId}|${i.form}|${i.strength}|${i.frequency}`).sort().join(",")}#${pregnancy ?? ""}`;
  const [state, setState] = useState<CheckState>({ flags: [], checking: false, failed: false, checkedFor: "" });
  const latest = useRef(items);
  latest.current = items;
  // What the check needs, kept on this computer, so it can still run with no connection.
  const visit = useVisit(visitId);
  const allergies = useAllergies(visit.data?.patientId ?? null);
  const formulary = useFormulary();
  const data = useSafetyData();
  const offline = useOffline();
  const facts = useRef({ visit, allergies, formulary, data });
  facts.current = { visit, allergies, formulary, data };

  const runLocally = (): CheckState | null => {
    const f = facts.current;
    if (!f.visit.data || f.formulary.data.length === 0) return null;
    const flags = checkLocally({
      visitId,
      patientId: f.visit.data.patientId,
      items: latest.current,
      vitals: f.visit.data.vitals ?? null,
      allergies: f.allergies.data,
      drugs: f.formulary.data,
      interactions: f.data.interactions,
      vitalCautions: f.data.vitalCautions,
      patient: { ageYears: f.visit.data.patientAgeYears ?? null, sex: f.visit.data.patientSex ?? null, pregnancy },
    });
    return { flags, checking: false, failed: false, checkedFor: signature, local: true };
  };

  useEffect(() => {
    if (items.length === 0) {
      setState({ flags: [], checking: false, failed: false, checkedFor: "" });
      return;
    }
    setState((s) => ({ ...s, checking: true }));
    let live = true;
    const t = setTimeout(() => {
      const fallback = () => {
        const local = runLocally();
        if (live) setState(local ?? ((s) => ({ ...s, checking: false, failed: true })));
      };
      if (offline) return fallback();
      checkPrescription(visitId, latest.current, pregnancy)
        .then((r) => live && setState({ flags: r.flags, checking: false, failed: false, checkedFor: signature }))
        .catch(fallback);
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // The signature holds everything the check reads from the pad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId, signature, offline]);

  return state;
}

const TONE: Record<Severity, { label: string; fill: string }> = {
  high: { label: "High", fill: "bg-[oklch(0.88_0.1_25)]" },
  caution: { label: "Caution", fill: "bg-[var(--morning-soft)]" },
  info: { label: "Note", fill: "bg-card" },
};

const RULE: Record<string, string> = {
  drug_allergy: "Allergy",
  drug_drug: "Two medicines together",
  drug_vitals: "Today's reading",
  drug_age: "Age",
  drug_dose: "Dose",
  drug_pregnancy: "Pregnancy",
  unlisted: "Written by hand",
};

/**
 * What the safety check found. A clear result says what was checked and what
 * was not, so a quiet panel never reads as "safe". Each high-severity flag has
 * to be ticked as read before signing.
 */
export function SafetyPanel({
  state,
  hasItems,
  acknowledged,
  onToggle,
}: {
  state: CheckState;
  hasItems: boolean;
  acknowledged: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (!hasItems) {
    return (
      <Card>
        <p className="flex items-start gap-3 text-base leading-snug">
          <ShieldCheck className="mt-0.5 size-6 shrink-0" aria-hidden />
          <span>
            Medicines you add are checked against the allergies on record, the other medicines in this prescription and in the last month, today's
            vitals, the patient's age and weight, the most a day, and pregnancy.
          </span>
        </p>
      </Card>
    );
  }
  if (state.failed && state.flags.length === 0) {
    return (
      <Card tone="warn">
        <p className="flex items-start gap-3 text-base leading-snug">
          <ShieldAlert className="mt-0.5 size-6 shrink-0" aria-hidden />
          <span>The safety check could not run just now. It will run again when you sign.</span>
        </p>
      </Card>
    );
  }
  if (state.checking && state.flags.length === 0) {
    return (
      <Card>
        <p className="flex items-center gap-3 text-base">
          <Loader2 className="size-5 animate-spin" aria-hidden /> Checking…
        </p>
      </Card>
    );
  }
  if (state.flags.length === 0) {
    return (
      <Card tone="ok">
        {state.local ? <LocalNote /> : null}
        <p className="flex items-start gap-3 text-base leading-snug">
          <ShieldCheck className="mt-0.5 size-6 shrink-0" aria-hidden />
          <span>
            Nothing found. Checked allergies, other medicines, today's vitals, age, dose and pregnancy against this formulary. It does not know
            every drug, so it is not a clearance.
          </span>
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-2.5" aria-live="polite">
      {state.local ? <LocalNote /> : null}
      <p className="flex items-center gap-2 text-lg font-bold">
        <ShieldAlert className="size-6" aria-hidden />
        {state.flags.length} thing{state.flags.length === 1 ? "" : "s"} to look at
        {state.checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      </p>
      <ul className="space-y-2.5">
        {state.flags.map((f) => {
          const tone = TONE[f.severity];
          const ack = acknowledged.has(f.key);
          return (
            <li key={f.key} className={`rounded-xl border-[3px] border-[#232326] p-3 ${tone.fill}`}>
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                <span className="rounded-full border-2 border-[#232326] bg-white px-2 py-0.5">{tone.label}</span>
                <span>{RULE[f.rule] ?? f.rule}</span>
              </p>
              <p className="mt-1 text-lg leading-tight font-bold">
                {f.subjectDrugName} · {f.counterpartLabel}
              </p>
              <p className="mt-0.5 text-base leading-snug">{f.message}</p>
              {f.severity === "high" ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={ack}
                  onClick={() => onToggle(f.key)}
                  className={`mt-2.5 flex min-h-11 w-full items-center gap-3 rounded-xl border-[3px] border-[#232326] px-3 text-left text-base font-bold ${
                    ack ? "bg-[var(--brand-soft)]" : "bg-white"
                  }`}
                >
                  <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md border-[3px] border-[#232326] bg-white">
                    {ack ? <Check className="size-4" strokeWidth={3.4} /> : null}
                  </span>
                  I have read this
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Said whenever the check ran on this computer instead of the server. */
function LocalNote() {
  return (
    <p className="text-sm leading-snug font-semibold">
      Checked on this computer, with no connection. It does not know what was prescribed on other visits this month. The
      server checks again when this is sent.
    </p>
  );
}
