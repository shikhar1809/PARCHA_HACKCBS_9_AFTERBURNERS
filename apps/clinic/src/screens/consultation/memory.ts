import { scheduleOf, type PrescriptionItem, type Schedule } from "@parcha/core";

/**
 * What the pad learns from one doctor's own signed prescriptions, kept on this
 * computer: how they write each medicine, the medicines they reach for most,
 * the diagnoses they write most, and the sets they saved ("Viral fever": the
 * diagnosis, the medicines, the advice and the follow-up in one tap).
 *
 * It is a convenience, not a record: the record is the signed prescription.
 * It lives in this browser only, per doctor, and an empty or blocked storage
 * just means the pad starts from the usual schedules.
 */
export type RxSet = {
  name: string;
  diagnosis: string;
  advice: string;
  followUp: string;
  items: PrescriptionItem[];
};

type Memory = {
  lines: Record<string, Schedule & { strength: string }>;
  counts: Record<string, number>;
  diagnoses: Record<string, number>;
  sets: RxSet[];
};

const empty = (): Memory => ({ lines: {}, counts: {}, diagnoses: {}, sets: [] });
const key = (uid: string) => `parcha.pad.${uid}`;

export function loadMemory(uid: string | undefined): Memory {
  if (!uid) return empty();
  try {
    const raw = localStorage.getItem(key(uid));
    return raw ? { ...empty(), ...(JSON.parse(raw) as Partial<Memory>) } : empty();
  } catch {
    return empty();
  }
}

function save(uid: string, m: Memory) {
  try {
    localStorage.setItem(key(uid), JSON.stringify(m));
  } catch {
    /* full or blocked: the pad still works, it just does not learn */
  }
}

/** After signing: remember how each medicine was written, and what was written. */
export function learn(uid: string, rx: { diagnosis: string; items: PrescriptionItem[] }) {
  const m = loadMemory(uid);
  for (const item of rx.items) {
    m.lines[item.drugId] = scheduleOf(item);
    m.counts[item.drugId] = (m.counts[item.drugId] ?? 0) + 1;
  }
  const d = rx.diagnosis.trim();
  if (d) m.diagnoses[d] = (m.diagnoses[d] ?? 0) + 1;
  save(uid, m);
}

export function saveSet(uid: string, set: RxSet) {
  const m = loadMemory(uid);
  m.sets = [set, ...m.sets.filter((s) => s.name.toLowerCase() !== set.name.toLowerCase())].slice(0, 24);
  save(uid, m);
}

export function deleteSet(uid: string, name: string) {
  const m = loadMemory(uid);
  m.sets = m.sets.filter((s) => s.name !== name);
  save(uid, m);
}

/** The most used, most first. */
export const top = (counts: Record<string, number>, n: number) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
