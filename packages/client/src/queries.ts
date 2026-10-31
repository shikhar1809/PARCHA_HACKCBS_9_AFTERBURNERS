/**
 * The reads both apps make, as named hooks.
 *
 * Firestore has no joins, so these lean on the fields denormalised onto the
 * visit document: a queue is one query, and the patient's name, age, allergy
 * flag, complaint and latest reading are already on the row. The
 * sub-collections remain the record; these are the copies the counters read.
 */
import {
  limit,
  orderBy,
  where,
  type QueryConstraint,
} from "firebase/firestore";

import {
  COL,
  VISIT_SUB,
  type Account,
  type Allergy,
  type Drug,
  type DrugInteraction,
  type VitalCaution,
  type Hospital,
  type Patient,
  type Prescription,
  type Route,
  type Stage,
  type Visit,
  type ActivityEntry,
} from "@parcha/core";
import { useOutbox } from "./outbox";
import { patientWithOps, patientsWithOps, prescriptionsWithOps, visitWithOps, visitsWithOps } from "./overlay";
import {
  useDoc,
  useHospitalScope,
  useQuery,
  useQueryFactory,
  type Loadable,
} from "./hooks";

/**
 * No list is unbounded. A listener that reads "everything" is fine at a clinic
 * and a bill at a hospital group, so every one carries a ceiling well above
 * anything a single counter or household needs.
 */
const QUEUE_LIMIT = 200;
const HISTORY_LIMIT = 60;
const TEAM_LIMIT = 500;

/**
 * Whose queue it is. A doctor's queue is the patients sent to them. Without an
 * owner it is the whole counter, which is what the front desk reads.
 */
export type QueueOwner = { doctorUid?: string };

/**
 * The visits sitting at the given stages, longest wait first.
 *
 * `enabled` is for hooks that have to be called every render but only apply to
 * some accounts: a desk has no doctor's queue, and subscribing anyway would
 * cost a listener for nothing.
 */
export function useQueue(
  stages: Stage[],
  owner?: QueueOwner,
  enabled = true,
): Loadable<Visit[]> {
  const scope = useHospitalScope();
  const key = [stages.join(","), owner?.doctorUid, scope].join("|");
  const constraints: QueryConstraint[] = [
    where("stage", "in", stages),
    where("closedAt", "==", null),
  ];
  if (scope) constraints.push(where("hospitalId", "==", scope));
  if (owner?.doctorUid) {
    constraints.push(where("assignedDoctorUid", "==", owner.doctorUid));
  }
  constraints.push(orderBy("registeredAt", "asc"), limit(QUEUE_LIMIT));

  const build = useQueryFactory(COL.visits, constraints, [key]);
  const live = useQuery<Visit>(enabled ? build : null, enabled ? `queue:${key}` : undefined);
  const queued = useOutbox();
  // Actions this computer has saved but not yet sent move patients between queues here.
  const data = visitsWithOps(
    live.data,
    queued,
    (v) =>
      stages.includes(v.stage) &&
      v.closedAt == null &&
      (!scope || !v.hospitalId || v.hospitalId === scope) &&
      (!owner?.doctorUid || v.assignedDoctorUid === owner.doctorUid),
  );
  return data === live.data ? live : { ...live, data };
}

export function useVisit(visitId: string | null): Loadable<Visit | null> {
  const live = useDoc<Visit>(visitId ? `${COL.visits}/${visitId}` : null, visitId ? `visit:${visitId}` : undefined);
  const queued = useOutbox();
  const data = visitWithOps(live.data, visitId, queued);
  // A visit made on this computer with no connection is not an error: the server has not heard of it yet.
  return data === live.data ? live : { ...live, data, loading: false, error: null };
}

export function usePatient(patientId: string | null): Loadable<Patient | null> {
  const live = useDoc<Patient>(patientId ? `${COL.patients}/${patientId}` : null, patientId ? `patient:${patientId}` : undefined);
  const queued = useOutbox();
  const data = patientWithOps(live.data, patientId, queued);
  return data === live.data ? live : { ...live, data, loading: false, error: null };
}

/**
 * Every patient on one handset.
 *
 * The number is deliberately not unique — shared family handsets are the
 * norm — so this returns a household and the caller picks the person.
 */
export function usePatientsByPhone(phone: string | null): Loadable<Patient[]> {
  const scope = useHospitalScope();
  const build = useQueryFactory(
    COL.patients,
    [
      where("phone", "==", phone ?? "__none__"),
      ...(scope ? [where("hospitalId", "==", scope)] : []),
      orderBy("fullName"),
      limit(50),
    ],
    [phone, scope],
  );
  const live = useQuery<Patient>(phone ? build : null, phone ? `patients:${scope ?? ""}:${phone}` : undefined);
  const queued = useOutbox();
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10);
  const data = patientsWithOps(live.data, queued, (p) => p.phone === digits && (!scope || !p.hospitalId || p.hospitalId === scope));
  return data === live.data ? live : { ...live, data };
}

/** Live allergies: tombstoned documents filtered out by the caller. */
export function useAllergies(patientId: string | null): Loadable<Allergy[]> {
  const build = useQueryFactory(
    `${COL.patients}/${patientId}/allergies`,
    [],
    [patientId],
  );
  const result = useQuery<Allergy>(patientId ? build : null, patientId ? `allergies:${patientId}` : undefined);
  const retracted = new Set(
    result.data.map((a) => a.retractsAllergyId).filter(Boolean) as string[],
  );
  return {
    ...result,
    data: result.data.filter(
      (a) => !a.retractsAllergyId && !retracted.has(a.id),
    ),
  };
}

/** A patient's visits, newest first. */
export function useVisitsForPatient(
  patientId: string | null,
): Loadable<Visit[]> {
  const scope = useHospitalScope();
  const build = useQueryFactory(
    COL.visits,
    [
      where("patientId", "==", patientId ?? "__none__"),
      ...(scope ? [where("hospitalId", "==", scope)] : []),
      orderBy("registeredAt", "desc"),
      limit(HISTORY_LIMIT),
    ],
    [patientId, scope],
  );
  const live = useQuery<Visit>(patientId ? build : null, patientId ? `history:${patientId}` : undefined);
  const queued = useOutbox();
  const data = visitsWithOps(live.data, queued, (v) => v.patientId === patientId);
  return data === live.data ? live : { ...live, data };
}

/** Everything reachable from one handset, for the patient app. */
export function useVisitsForPhone(phone: string | null): Loadable<Visit[]> {
  const build = useQueryFactory(
    COL.visits,
    [
      where("patientPhone", "==", phone ?? "__none__"),
      orderBy("registeredAt", "desc"),
      limit(HISTORY_LIMIT),
    ],
    [phone],
  );
  return useQuery<Visit>(phone ? build : null, phone ? "visits" : undefined);
}

export function usePrescriptions(
  visitId: string | null,
): Loadable<Prescription[]> {
  const build = useQueryFactory(
    `${COL.visits}/${visitId}/${VISIT_SUB.prescriptions}`,
    [orderBy("createdAt", "desc"), limit(5)],
    [visitId],
  );
  const live = useQuery<Prescription>(visitId ? build : null, visitId ? `rx:${visitId}` : undefined);
  const queued = useOutbox();
  const data = prescriptionsWithOps(live.data, visitId, queued);
  return data === live.data ? live : { ...live, data };
}

/** Everyone on the team, by name. Feeds the team page and the desk's pickers. */
export function useTeam(): Loadable<Account[]> {
  const scope = useHospitalScope();
  const build = useQueryFactory(
    COL.accounts,
    [
      ...(scope ? [where("hospitalId", "==", scope)] : []),
      orderBy("displayName"),
      limit(TEAM_LIMIT),
    ],
    [scope],
  );
  return useQuery<Account>(scope ? build : null, scope ? `team:${scope}` : undefined);
}

/** Every wire between two people on the team. */
export function useRoutes(): Loadable<Route[]> {
  const scope = useHospitalScope();
  const build = useQueryFactory(
    COL.routes,
    [...(scope ? [where("hospitalId", "==", scope)] : []), limit(TEAM_LIMIT)],
    [scope],
  );
  return useQuery<Route>(scope ? build : null, scope ? `routes:${scope}` : undefined);
}

/** The hospitals a patient can choose from, by name. Readable by anyone signed in. */
export function useHospitals(): Loadable<Hospital[]> {
  const build = useQueryFactory(COL.hospitals, [orderBy("name"), limit(100)], []);
  return useQuery<Hospital>(build, "hospitals");
}

/**
 * The hospitals a patient sees on the map and in the list: the clinics on
 * Parcha that are set up, and the real hospitals around them that are not on
 * Parcha (shown, never bookable). A clinic still being set up, or a "Custom"
 * one made for one visitor, is not shown.
 */
export function usePatientHospitals(): Loadable<Hospital[]> {
  const all = useHospitals();
  const data = all.data.filter((h) => !h.sandbox && (h.onParcha === false || h.setupDone !== false));
  return data.length === all.data.length ? all : { ...all, data };
}

/** The formulary. Read once per app start; it does not change during a shift. */
export function useFormulary(): Loadable<Drug[]> {
  const build = useQueryFactory(COL.drugs, [orderBy("genericName")], []);
  return useQuery<Drug>(build, "drugs");
}

/**
 * The interaction and vital-caution tables the safety engine reads, kept on this
 * device like the formulary so a prescription can be checked with no connection.
 */
export function useSafetyData(): { interactions: DrugInteraction[]; vitalCautions: VitalCaution[]; ready: boolean } {
  const bi = useQueryFactory(COL.interactions, [], []);
  const bc = useQueryFactory(COL.vitalCautions, [], []);
  const interactions = useQuery<DrugInteraction>(bi, "drugInteractions");
  const cautions = useQuery<VitalCaution>(bc, "drugVitalCautions");
  return {
    interactions: interactions.data,
    vitalCautions: cautions.data,
    ready: !interactions.loading && !cautions.loading,
  };
}

/**
 * Who did what at this hospital, newest first: the last day by default, or
 * everything about one patient. Doctors and admins can read it.
 */
export function useActivity(opts: { patientId?: string | null; max?: number } = {}): Loadable<ActivityEntry[]> {
  const scope = useHospitalScope();
  const patientId = opts.patientId ?? null;
  const max = opts.max ?? 200;
  const build = useQueryFactory(
    COL.activity,
    [
      ...(scope ? [where("hospitalId", "==", scope)] : []),
      ...(patientId ? [where("patientId", "==", patientId)] : []),
      orderBy("at", "desc"),
      limit(max),
    ],
    [scope, patientId, max],
  );
  return useQuery<ActivityEntry>(scope ? build : null, scope ? `activity:${scope}:${patientId ?? "all"}` : undefined);
}

/** One account, live: a person's own seat, profile and status. */
export function useAccount(uid: string | null): Loadable<Account | null> {
  return useDoc<Account>(uid ? `${COL.accounts}/${uid}` : null, uid ? `account:${uid}` : undefined);
}

/** One hospital, live: its details and whether it has been set up. */
export function useHospital(hospitalId: string | null): Loadable<Hospital | null> {
  return useDoc<Hospital>(hospitalId ? `${COL.hospitals}/${hospitalId}` : null, hospitalId ? `hospital:${hospitalId}` : undefined);
}

/** This hospital's seats, in their order. */
export function useSeats(): Loadable<import("@parcha/core").Seat[]> {
  const scope = useHospitalScope();
  const build = useQueryFactory(`${COL.hospitals}/${scope}/seats`, [orderBy("order")], [scope]);
  return useQuery<import("@parcha/core").Seat>(scope ? build : null, scope ? `seats:${scope}` : undefined);
}

/** Midnight today, India time. */
export function startOfTodayIST(now = Date.now()): Date {
  const ist = 5.5 * 3_600_000;
  return new Date(Math.floor((now + ist) / 86_400_000) * 86_400_000 - ist);
}

/**
 * The working day's visits at this clinic, newest first: what the pharmacy and
 * the billing desk work from. Each picks its own out of the list, so the two
 * counters share one listener. "The working day" is since midnight, or the
 * last 12 hours if that reaches further back, so a patient seen at 10 pm is
 * still on the list at 1 am. Rounded to the hour, so the listener is stable.
 */
export function useTodaysVisits(enabled = true): Loadable<Visit[]> {
  const scope = useHospitalScope();
  const hour = 3_600_000;
  const since = new Date(Math.min(startOfTodayIST().getTime(), Math.floor((Date.now() - 12 * hour) / hour) * hour));
  const key = [scope, since.getTime()].join("|");
  const build = useQueryFactory(
    COL.visits,
    [
      ...(scope ? [where("hospitalId", "==", scope)] : []),
      where("registeredAt", ">=", since),
      orderBy("registeredAt", "desc"),
      limit(QUEUE_LIMIT),
    ],
    [key],
  );
  return useQuery<Visit>(enabled && scope ? build : null, enabled && scope ? `today:${key}` : undefined);
}
