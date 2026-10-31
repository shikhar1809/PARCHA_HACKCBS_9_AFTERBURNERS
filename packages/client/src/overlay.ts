/**
 * What the clinic's screens should show while its actions are still waiting to be
 * sent.
 *
 * A desk registers a patient with no connection; the patient must appear in the
 * list at once. An intake is saved; the patient must move to the doctor's queue
 * on this computer. A prescription is signed; the visit must read "Prescribed"
 * and be printable. Each queued action carries a small description of itself
 * (see mutations.ts), and these functions lay those over what the server last
 * said. When the server later confirms, the action leaves the queue and the real
 * record takes its place. An action the server refused is not laid over anything.
 */
import type { Patient, Prescription, Visit, VitalsSummary } from "@parcha/core";

import type { QueuedCall } from "./outbox";

export type LocalOp =
  | { kind: "patient"; patient: Patient }
  | { kind: "visit"; visit: Visit }
  | { kind: "intake"; visitId: string; vitals: VitalsSummary | null; complaint: string; doctorUid: string; doctorName: string }
  | { kind: "consult"; visitId: string }
  | { kind: "rx"; visitId: string; prescription: Prescription };

/** The actions still waiting, oldest first, as descriptions. */
export function pendingOps(queued: QueuedCall[]): LocalOp[] {
  return queued.filter((q) => q.status !== "failed" && q.local).map((q) => q.local as LocalOp);
}

const now = () => new Date().toISOString();

/** One visit with every waiting action that concerns it applied, in order. */
function applyOps(v: Visit, ops: LocalOp[]): Visit {
  let out = v;
  for (const op of ops) {
    if (op.kind === "intake" && op.visitId === out.id) {
      out = {
        ...out,
        stage: "intake_complete",
        complaint: op.complaint,
        vitals: op.vitals ?? out.vitals,
        assignedDoctorUid: op.doctorUid,
        assignedDoctorName: op.doctorName,
        intakeCompletedAt: now(),
        unsent: true,
      };
    } else if (op.kind === "consult" && op.visitId === out.id) {
      out = { ...out, stage: "in_consultation", consultationStartedAt: now(), unsent: true };
    } else if (op.kind === "rx" && op.visitId === out.id) {
      out = {
        ...out,
        stage: "prescribed",
        diagnosis: op.prescription.diagnosisText,
        itemCount: op.prescription.items.length,
        prescribedAt: now(),
        closedAt: now(),
        unsent: true,
      };
    }
  }
  return out;
}

/**
 * A list of visits, with waiting actions applied and new visits made offline
 * added, then narrowed to what the list is for (`keep`). Visits the server
 * returned are never removed unless an action moved them out of `keep`.
 */
export function visitsWithOps(list: Visit[], queued: QueuedCall[], keep: (v: Visit) => boolean): Visit[] {
  const ops = pendingOps(queued);
  if (ops.length === 0) return list;
  const known = new Set(list.map((v) => v.id));
  const added = ops.flatMap((o) => (o.kind === "visit" && !known.has(o.visit.id) ? [{ ...o.visit, unsent: true }] : []));
  return [...list, ...added].map((v) => applyOps(v, ops)).filter(keep);
}

/** One visit by id, including one made offline that the server has never heard of. */
export function visitWithOps(visit: Visit | null, id: string | null, queued: QueuedCall[]): Visit | null {
  const ops = pendingOps(queued);
  if (ops.length === 0 || !id) return visit;
  const base = visit ?? ops.flatMap((o) => (o.kind === "visit" && o.visit.id === id ? [o.visit] : []))[0] ?? null;
  return base ? applyOps(base, ops) : null;
}

/** Prescriptions for a visit, with ones signed offline added at the front. */
export function prescriptionsWithOps(list: Prescription[], visitId: string | null, queued: QueuedCall[]): Prescription[] {
  if (!visitId) return list;
  const mine = pendingOps(queued).flatMap((o) => (o.kind === "rx" && o.visitId === visitId ? [o.prescription] : []));
  return mine.length === 0 ? list : [...mine, ...list];
}

/** Patients registered offline, added to a list (filtered by the caller's own match). */
export function patientsWithOps(list: Patient[], queued: QueuedCall[], match: (p: Patient) => boolean): Patient[] {
  const extra = pendingOps(queued).flatMap((o) => (o.kind === "patient" && match(o.patient) && !list.some((p) => p.id === o.patient.id) ? [o.patient] : []));
  return extra.length === 0 ? list : [...list, ...extra].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function patientWithOps(patient: Patient | null, id: string | null, queued: QueuedCall[]): Patient | null {
  if (patient || !id) return patient;
  return pendingOps(queued).flatMap((o) => (o.kind === "patient" && o.patient.id === id ? [o.patient] : []))[0] ?? null;
}
