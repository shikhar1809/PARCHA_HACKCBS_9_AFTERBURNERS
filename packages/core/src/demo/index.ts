/**
 * The demo dataset.
 *
 * Fifteen patients with two years of OPD history, and a hand-written
 * formulary of the drugs a North Indian general OPD actually hands out.
 * Specific things are true on purpose and the seeder asserts them:
 *
 *   - 9811044321 is one handset shared by three people in a household
 *     (Priya, her husband Prashant, his mother Prabha). That is the case the
 *     desk disambiguation exists for, and the reason an account is a
 *     household rather than a person.
 *   - Priya has a recorded penicillin allergy; Prabha Devi takes
 *     warfarin; Babulal Meena takes theophylline. Each sets up one of the
 *     drug<->allergy or drug<->drug rules.
 *   - Savitri Bai is the drug<->vitals case: mid-consultation with an intake
 *     random sugar of 312 mg/dL and a knee flare that invites prednisolone.
 *     Nothing on a paper slip would connect those two facts.
 *
 * It is a demo formulary. It is not clinical decision support and nothing in
 * this repository should be used to treat anybody.
 */
export * from "./formulary.js";
export * from "./patients.js";
