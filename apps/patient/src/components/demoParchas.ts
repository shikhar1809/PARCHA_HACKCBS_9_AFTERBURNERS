/**
 * The demo family's Parchas, put on the demo phone the first time it opens.
 *
 * Everything a family holds lives in this phone's own encrypted store and
 * nowhere else — that is the whole arrangement — which means a freshly opened
 * demo has nothing in it at all, however much the clinic's seed put in the
 * database. Scanning three paper slips before every demo is not a thing
 * anybody will do, so this writes what those scans would have written.
 *
 * It is deliberately narrow:
 *
 *   - only for the demo handset, and only when that phone has no Parchas yet,
 *     so it never writes over something a real scan put there;
 *   - the same shape a scan produces (`parcha:<visit code>`), so every screen
 *     that reads them — the Parchas tab, Ask, the history a doctor is shown —
 *     reads these the same way it reads a real one;
 *   - no token on them. A scanned slip carries the signed token it came from;
 *     these carry none, because nothing signed them. They say what they are.
 *
 * The medicines match what the seeded doctors actually prescribed this family,
 * so the demo hangs together: the reminders on the Medicines tab, the lines in
 * a shared history and the answers in Ask are all the same three visits.
 */
import { markTouched, vaultKeys, vaultPut } from "@parcha/client";
import type { RxPayload } from "@parcha/core";

export const DEMO_PHONE = "9811044321";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/**
 * Three real consultations, one per person. Written the way a doctor writes
 * them: the form the medicine comes in, the schedule as a pattern, the days,
 * and when to take it against food.
 */
const PARCHAS: { person: string; payload: RxPayload }[] = [
  {
    person: "Prashant",
    payload: {
      v: 1,
      h: "Rohini City Hospital",
      d: ["Dr. R. Khan", "MBBS, MD (Medicine)", "DMC/R/12894"],
      t: daysAgo(12),
      c: "RCH7420",
      p: ["Prashant", 48, "male"],
      x: "Type 2 diabetes, with burning feet",
      m: [
        ["Metformin", "500 mg", "tablet", "1-0-1", 30, "after_food", 1, "With breakfast and dinner"],
        ["Glimepiride", "1 mg", "tablet", "1-0-0", 30, "before_food"],
        ["Amitriptyline", "10 mg", "tablet", "0-0-1", 30, "after_food", 1, "At bedtime, for the burning"],
      ],
      k: ["HbA1c", "Fasting sugar", "Serum creatinine"],
      a: "Walk twenty minutes a day. Check feet every night for cuts. Come back if sugar stays above 200.",
      f: 30,
    },
  },
  {
    person: "Priya",
    payload: {
      v: 1,
      h: "Rohini City Hospital",
      d: ["Dr. A. Mehra", "MBBS, MD", "DMC/R/10233"],
      t: daysAgo(26),
      c: "RCH7188",
      p: ["Priya", 42, "female"],
      x: "High blood pressure",
      m: [
        ["Amlodipine", "5 mg", "tablet", "1-0-0", 30, "after_food"],
        ["Calcium + D3", "500 mg", "tablet", "0-1-0", 60, "after_food"],
      ],
      k: ["Lipid profile", "Thyroid profile (TSH)"],
      a: "Less salt. Blood pressure to be checked every week at the clinic.",
      f: 30,
    },
  },
  {
    person: "Prabha Devi",
    payload: {
      v: 1,
      h: "Sector 9 Care Hospital",
      d: ["Dr. S. Iyer", "MBBS, DNB (Cardiology)", "DMC/R/11562"],
      t: daysAgo(40),
      c: "S9C3310",
      p: ["Prabha Devi", 71, "female"],
      x: "Atrial fibrillation, on blood thinner",
      m: [
        ["Warfarin", "2 mg", "tablet", "0-0-1", 90, "after_food", 1, "Same time every night. Do not miss."],
        ["Metoprolol", "25 mg", "tablet", "1-0-1", 90, "after_food"],
        ["Calcium + D3", "500 mg", "tablet", "0-1-0", 90, "after_food"],
      ],
      k: ["INR", "Complete blood count"],
      a: "INR to be tested every month. Tell any doctor or dentist about the warfarin before treatment.",
      f: 30,
    },
  },
];

/**
 * Puts them on the phone, once. Anything that goes wrong is swallowed: a demo
 * that cannot write its sample data is still a working app with an empty
 * Parchas tab, which is exactly what a real new phone looks like.
 */
export async function seedDemoParchas(phone: string | null): Promise<void> {
  if (phone !== DEMO_PHONE) return;
  try {
    const already = await vaultKeys("parcha:");
    if (already.length > 0) return;
    for (const { person, payload } of PARCHAS) {
      await vaultPut(`parcha:${payload.c}`, {
        payload,
        person,
        savedAt: payload.t,
        photo: null,
      });
    }
    await markTouched();
  } catch {
    /* no store on this device: the app works, the Parchas tab is simply empty */
  }
}
