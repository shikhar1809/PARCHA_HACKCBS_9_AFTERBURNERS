/**
 * Vitals: what is plausible, and what is worth a second look.
 *
 * Two different questions, kept apart on purpose:
 *
 *   - `validateVitals` catches typing slips. A pulse of 720 or a temperature
 *     of 98 (a Fahrenheit reading in a Celsius box) is not a patient, it is a
 *     keystroke, and it is refused at the desk instead of being copied onto
 *     the doctor's queue where it would read as a real emergency.
 *   - `vitalAlarms` marks readings that are real but notable, so they survive
 *     being glanced at. It is an aid to reading, never a diagnosis, and it
 *     never blocks anything.
 *
 * Pure and shared, so the Cloud Function can enforce the same limits later.
 */

import type { SugarReading, VitalsSummary } from "./types.js";

export type VitalKey = Exclude<keyof VitalsSummary, "bloodSugarType">;

/** The widest range a living patient could show. Outside it, it is a typo. */
export const VITAL_LIMITS: Record<
  VitalKey,
  { label: string; unit: string; min: number; max: number }
> = {
  systolicMmhg: { label: "Systolic", unit: "mmHg", min: 50, max: 260 },
  diastolicMmhg: { label: "Diastolic", unit: "mmHg", min: 30, max: 160 },
  pulseBpm: { label: "Pulse", unit: "per min", min: 30, max: 220 },
  temperatureC: { label: "Temperature", unit: "°C", min: 30, max: 43 },
  respiratoryRate: { label: "Breathing", unit: "per min", min: 6, max: 60 },
  spo2Pct: { label: "SpO₂", unit: "%", min: 50, max: 100 },
  weightKg: { label: "Weight", unit: "kg", min: 1, max: 250 },
  heightCm: { label: "Height", unit: "cm", min: 30, max: 220 },
  bloodSugarMgdl: { label: "Blood sugar", unit: "mg/dL", min: 20, max: 800 },
};

export const SUGAR_TYPES: { value: SugarReading; label: string }[] = [
  { value: "fasting", label: "Fasting" },
  { value: "random", label: "Random" },
  { value: "post_prandial", label: "After food" },
];

export type VitalsInput = Partial<Record<VitalKey, number | null>> & {
  bloodSugarType?: SugarReading | null;
};

/**
 * The readings every intake must have: blood pressure and weight. Everything
 * else (sugar, temperature, pulse, oxygen...) is taken when it is needed.
 * A sentence per missing reading, keyed by field; empty when all are there.
 */
export function missingRequiredVitals(v: VitalsInput): Partial<Record<string, string>> {
  const missing: Partial<Record<string, string>> = {};
  if (v.systolicMmhg == null || v.diastolicMmhg == null) missing.systolicMmhg = "Take the blood pressure: both numbers.";
  if (v.weightKg == null) missing.weightKg = "Weigh them.";
  return missing;
}

/**
 * Returns a sentence per problem, keyed by field. Empty means nothing is
 * wrong. A missing optional reading is never a problem here (see
 * missingRequiredVitals for the two that every intake needs).
 */
export function validateVitals(v: VitalsInput): Partial<Record<string, string>> {
  const problems: Partial<Record<string, string>> = {};

  (Object.keys(VITAL_LIMITS) as VitalKey[]).forEach((key) => {
    const value = v[key];
    if (value === null || value === undefined) return;
    const { label, unit, min, max } = VITAL_LIMITS[key];
    if (!Number.isFinite(value)) {
      problems[key] = `${label} must be a number.`;
    } else if (key === "temperatureC" && value >= 90 && value < 115) {
      // A body temperature in °F (98.6) typed into the °C box.
      problems[key] = "That looks like °F. Enter the temperature in °C.";
    } else if (value < min || value > max) {
      problems[key] = `${label} should be between ${min} and ${max} ${unit}.`;
    }
  });

  const { systolicMmhg: sys, diastolicMmhg: dia } = v;
  if ((sys == null) !== (dia == null)) {
    problems[sys == null ? "systolicMmhg" : "diastolicMmhg"] =
      "Blood pressure needs both numbers.";
  } else if (sys != null && dia != null && dia >= sys && !problems.systolicMmhg) {
    problems.diastolicMmhg = "The lower number must be less than the upper.";
  }

  if (v.bloodSugarMgdl != null && !v.bloodSugarType) {
    problems.bloodSugarType =
      "Say whether this sugar was fasting, random or after food.";
  }

  return problems;
}

export type VitalAlarms = {
  bp: boolean;
  temperatureC: boolean;
  spo2Pct: boolean;
  bloodSugarMgdl: boolean;
};

/** Readings worth a second look. Never blocks, never diagnoses. */
export function vitalAlarms(v: VitalsInput): VitalAlarms {
  return {
    bp:
      (v.systolicMmhg != null && v.systolicMmhg >= 160) ||
      (v.diastolicMmhg != null && v.diastolicMmhg >= 100),
    temperatureC: v.temperatureC != null && v.temperatureC >= 38.5,
    spo2Pct: v.spo2Pct != null && v.spo2Pct < 92,
    bloodSugarMgdl: v.bloodSugarMgdl != null && v.bloodSugarMgdl >= 200,
  };
}
