/**
 * Gathering what the safety check needs, on the server.
 *
 * The engine itself is pure (core/conflicts.ts). This reads the formulary, the
 * patient's live allergies and what they were prescribed recently, so the run
 * that counts, inside `signPrescription`, never depends on anything a browser
 * sent except the medicines themselves.
 */
import type {
  Allergy,
  Drug,
  DrugInteraction,
  VitalCaution,
} from "../../../packages/core/src/types.js";
import { db } from "./guards.js";

export type SafetyContext = {
  drugs: Drug[];
  interactions: DrugInteraction[];
  vitalCautions: VitalCaution[];
  allergies: Allergy[];
  currentDrugIds: string[];
};

const RECENT_DAYS = 30;

type Formulary = Pick<SafetyContext, "drugs" | "interactions" | "vitalCautions">;

/**
 * The formulary changes when somebody reseeds it, not during a shift, so it is
 * kept in memory for a few minutes. That turns a safety check from about a
 * hundred and fifty reads into a handful, which is what lets the screen run it
 * as the doctor types.
 */
let cached: { at: number; value: Formulary } | null = null;
const FORMULARY_TTL_MS = 5 * 60_000;

async function formulary(): Promise<Formulary> {
  if (cached && Date.now() - cached.at < FORMULARY_TTL_MS) return cached.value;
  const [drugs, interactions, cautions] = await Promise.all([
    db().collection("drugs").get(),
    db().collection("drugInteractions").get(),
    db().collection("drugVitalCautions").get(),
  ]);
  const value: Formulary = {
    drugs: drugs.docs.map((d) => ({ ...(d.data() as Omit<Drug, "id">), id: d.id })),
    interactions: interactions.docs.map((d) => ({ ...(d.data() as Omit<DrugInteraction, "id">), id: d.id })),
    vitalCautions: cautions.docs.map((d) => ({ ...(d.data() as Omit<VitalCaution, "id">), id: d.id })),
  };
  cached = { at: Date.now(), value };
  return value;
}

export async function loadSafetyContext(
  patientId: string,
  hospitalId: string,
  excludeVisitId: string,
): Promise<SafetyContext> {
  const [base, allergySnap, visits] = await Promise.all([
    formulary(),
    db().collection("patients").doc(patientId).collection("allergies").get(),
    db()
      .collection("visits")
      .where("patientId", "==", patientId)
      .where("hospitalId", "==", hospitalId)
      .orderBy("registeredAt", "desc")
      .limit(6)
      .get(),
  ]);

  // An allergy is live unless a later document retracts it.
  const all = allergySnap.docs.map((d) => ({ ...(d.data() as Omit<Allergy, "id">), id: d.id }));
  const retracted = new Set(all.map((a) => a.retractsAllergyId).filter(Boolean) as string[]);
  const allergies = all.filter((a) => !a.retractsAllergyId && !retracted.has(a.id));

  // What they are already taking: lines signed in the last month, on other visits.
  const since = Date.now() - RECENT_DAYS * 86400_000;
  const current = new Set<string>();
  for (const v of visits.docs) {
    if (v.id === excludeVisitId) continue;
    const rx = await v.ref.collection("prescriptions").orderBy("createdAt", "desc").limit(1).get();
    for (const p of rx.docs) {
      const signed = p.data().signedAt?.toMillis?.() ?? 0;
      if (signed < since) continue;
      for (const item of (p.data().items ?? []) as { drugId: string }[]) current.add(item.drugId);
    }
  }

  return { ...base, allergies, currentDrugIds: [...current] };
}
