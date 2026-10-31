/**
 * The safety check, run on this computer. Used only when the server cannot be
 * reached; it is the same engine, so the flags are the ones the server would
 * raise from the same facts. What it cannot know offline is what the patient took
 * in the last month on other visits, and it says so.
 */
import {
  conflictKey,
  runConflictEngine,
  type Allergy,
  type Drug,
  type DrugInteraction,
  type Pregnancy,
  type PrescriptionItem,
  type Sex,
  type VitalCaution,
  type VitalsSummary,
} from "@parcha/core";

import type { SafetyFlag } from "./mutations";

export function checkLocally(input: {
  visitId: string;
  patientId: string;
  items: PrescriptionItem[];
  vitals: VitalsSummary | null;
  allergies: Allergy[];
  drugs: Drug[];
  interactions: DrugInteraction[];
  vitalCautions: VitalCaution[];
  patient?: { ageYears: number | null; sex: Sex | null; pregnancy: Pregnancy | null };
}): SafetyFlag[] {
  const flags = runConflictEngine({
    visitId: input.visitId,
    patientId: input.patientId,
    prescriptionId: "local",
    items: input.items,
    vitals: input.vitals,
    allergies: input.allergies,
    currentDrugIds: [],
    patient: input.patient,
    formulary: { drugs: input.drugs, interactions: input.interactions, vitalCautions: input.vitalCautions },
  });
  return flags.map((f) => ({ ...f, key: conflictKey(f) }));
}
