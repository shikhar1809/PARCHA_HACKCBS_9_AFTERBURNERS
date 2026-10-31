/**
 * The handoff chain.
 *
 * `visit.stage` is the only thing any queue filters on, so the definition of
 * "whose counter is this patient at" lives here and nowhere else. Adding a
 * counter to the product means adding a stage here and a queue that reads it.
 *
 * This module is pure and shared: the two apps import it for their screens,
 * and the Cloud Functions import the same file to guard the write. The guard
 * running client-side is a courtesy that keeps the UI honest; the guard
 * running in the function is the one that counts.
 */

import type { AccountType, Stage, StaffRole } from "./types.js";

export const STAGES: Stage[] = [
  "requested",
  "proposed",
  "scheduled",
  "registered",
  "intake_complete",
  "in_consultation",
  "prescribed",
];

type StageMeta = {
  label: string;
  /** What the patient is physically doing at this point. */
  waitingFor: string;
  /** The counter that acts next. */
  owner: StaffRole | null;
  tone: "waiting" | "active" | "done" | "stopped";
};

export const STAGE_META: Record<Stage, StageMeta> = {
  requested: {
    label: "Requested",
    waitingFor: "Waiting for the front desk to find a doctor",
    owner: "compounder",
    tone: "waiting",
  },
  proposed: {
    label: "Waiting for the doctor",
    waitingFor: "Waiting for the doctor to accept",
    owner: "doctor",
    tone: "waiting",
  },
  scheduled: {
    label: "Booked",
    waitingFor: "Booked, due to arrive",
    owner: "compounder",
    tone: "waiting",
  },
  registered: {
    label: "Registered",
    waitingFor: "Waiting at the intake desk",
    owner: "compounder",
    tone: "waiting",
  },
  intake_complete: {
    label: "Intake done",
    waitingFor: "Waiting to see the doctor",
    owner: "doctor",
    tone: "waiting",
  },
  in_consultation: {
    label: "With the doctor",
    waitingFor: "In the consultation room",
    owner: "doctor",
    tone: "active",
  },
  prescribed: {
    label: "Prescribed",
    waitingFor: "Visit complete",
    owner: null,
    tone: "done",
  },
  cancelled: {
    label: "Cancelled",
    waitingFor: "Patient left before being seen",
    owner: null,
    tone: "stopped",
  },
};

/**
 * Which stages each counter's queue reads.
 *
 * The doctor's queue covers two: patients waiting after intake, and patients
 * whose dossier is already open. A half-finished consultation has to stay
 * visible, or a doctor interrupted by an emergency loses the patient.
 */
export const QUEUE_STAGES: Record<StaffRole, Stage[]> = {
  compounder: ["registered"],
  doctor: ["intake_complete", "in_consultation"],
};

/** The transitions each counter is allowed to make. */
const ALLOWED: Record<StaffRole, Partial<Record<Stage, Stage[]>>> = {
  compounder: {
    // The desk's half of a pre-visit request: find a doctor, or book a doctor's
    // slot itself; take it back if they cannot; check the patient in on
    // arrival, or let the request go.
    requested: ["proposed", "scheduled", "cancelled"],
    proposed: ["requested", "scheduled", "cancelled"],
    scheduled: ["registered", "cancelled"],
    registered: ["intake_complete"],
  },
  doctor: {
    // Accepting books the slot; declining sends it back to the desk.
    proposed: ["scheduled", "requested"],
    intake_complete: ["in_consultation"],
    in_consultation: ["prescribed"],
  },
};

/** Every stage this counter may move a patient to from `current`. */
export function allowedNext(role: StaffRole, current: Stage): Stage[] {
  return ALLOWED[role][current] ?? [];
}

export function nextStageFor(role: StaffRole, current: Stage): Stage | null {
  return allowedNext(role, current)[0] ?? null;
}

/**
 * Guards a transition before it is written.
 *
 * Returns null when the move is fine, or a sentence explaining why not. The
 * common real-world case is two staff acting on one patient at once: the
 * second write arrives when the stage has already moved on, and the person
 * needs to be told that rather than silently overwriting it.
 */
export function describeTransitionProblem(
  role: StaffRole,
  from: Stage,
  to: Stage,
): string | null {
  if (from === to) {
    return `This patient is already at "${STAGE_META[to].label}".`;
  }
  if (from === "cancelled") return "This visit was cancelled.";
  if (from === "prescribed") return "This visit is already complete.";

  const allowed = allowedNext(role, from);
  if (allowed.length === 0) {
    return `A ${role} cannot move a patient on from "${STAGE_META[from].label}". Somebody else may have already handled this one.`;
  }
  if (!allowed.includes(to)) {
    const options = allowed.map((s) => `"${STAGE_META[s].label}"`).join(" or ");
    return `From "${STAGE_META[from].label}" the next step is ${options}, not "${STAGE_META[to].label}".`;
  }
  return null;
}

/** Index in the chain, for progress rendering. Cancelled sorts last. */
export function stageIndex(stage: Stage): number {
  const i = STAGES.indexOf(stage);
  return i === -1 ? STAGES.length : i;
}

/**
 * Which counters an account type may act at.
 *
 * One counter each. A hospital has people dedicated to the desk and to the
 * consulting room, and "the desk passed this patient on" has to name a desk
 * account, not whoever happened to be logged in. None of them holds `doctor`: `in_consultation -> prescribed` is the one
 * transition that must never be delegable, which is what stops a visit
 * completing without a doctor having signed for it.
 */
export const COUNTERS_FOR: Record<AccountType, StaffRole[]> = {
  staff: ["compounder"],
  doctor: ["doctor"],
};

/** How long someone has been waiting, in words. */
export function waitingFor(since: string, now = Date.now()): string {
  const minutes = Math.max(
    0,
    Math.round((now - new Date(since).getTime()) / 60000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}
