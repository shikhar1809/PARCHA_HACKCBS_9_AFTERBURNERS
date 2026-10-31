/**
 * What a medicine's form means for the person taking it.
 *
 * A prescription line carries a form ("tablet", "eye drops", "inhaler"), and
 * until now only the spoken sentence used it: everything drawn or written for
 * the family counted in tablets. So an eye drop came out as "2, after food" —
 * a number with no unit, and a meal instruction that has nothing to do with an
 * eye. The family is the one person in the chain who cannot ask what it means.
 *
 * So the form decides three things, in one place:
 *
 *   - what one dose is called: a tablet, a spoon, a drop, a puff, a pinch of
 *     cream ("2 drops", "2 बूँद");
 *   - where it goes, when that is not the mouth: in the eye, in the ear, on
 *     the skin, breathed in;
 *   - whether food matters at all. Before or after food is an instruction about
 *     a stomach. An eye drop has no stomach, so the timing is dropped rather
 *     than printed as noise, and the reminder is not shifted half an hour
 *     earlier for a meal that is irrelevant to it.
 *
 * The strings a doctor can pick come from the formulary ("tablet", "syrup",
 * "eye drops", "inhaler", "respule", "cream", "gel", "sachet", "injection"),
 * but a form written by hand is normal too, so everything here reads the words
 * inside the string rather than matching a fixed list.
 */

/** The kinds that behave differently. Anything unrecognised is a tablet, which is the common case. */
export type DoseKind =
  | "tablet"
  | "capsule"
  | "syrup"
  | "drops"
  | "inhaler"
  | "topical"
  | "sachet"
  | "injection";

/** Where a dose goes, when it is not swallowed. */
export type DoseSite = "eye" | "ear" | "nose" | "skin" | "lungs" | "injected" | null;

export function doseKind(form: string | null | undefined): DoseKind {
  const f = (form ?? "").toLowerCase();
  if (f.includes("drop")) return "drops";
  if (f.includes("inhal") || f.includes("puff") || f.includes("respule") || f.includes("rotacap"))
    return "inhaler";
  if (f.includes("cream") || f.includes("oint") || f.includes("gel") || f.includes("lotion") || f.includes("balm"))
    return "topical";
  if (f.includes("syrup") || f.includes("liquid") || f.includes("susp") || f.includes("solution") || f.includes("tonic"))
    return "syrup";
  if (f.includes("sachet") || f.includes("powder") || f.includes("granule")) return "sachet";
  if (f.includes("inj") || f.includes("vial") || f.includes("ampoule")) return "injection";
  if (f.includes("capsule") || f.includes("cap.")) return "capsule";
  return "tablet";
}

/**
 * Which eye, ear or nose is not something the form says — "eye drops" names the
 * organ, nothing more — so the site is as far as this goes. Which side is the
 * doctor's instruction, written on the line.
 */
export function doseSite(form: string | null | undefined): DoseSite {
  const f = (form ?? "").toLowerCase();
  const kind = doseKind(form);
  if (kind === "drops") {
    if (f.includes("ear") || f.includes("otic")) return "ear";
    if (f.includes("nose") || f.includes("nasal")) return "nose";
    // Plain "drops" with no organ named are eye drops far more often than not
    // in an OPD, but saying so would be a guess. Left unnamed.
    return f.includes("eye") || f.includes("ophth") ? "eye" : null;
  }
  if (kind === "topical") return "skin";
  if (kind === "inhaler") return "lungs";
  if (kind === "injection") return "injected";
  return null;
}

/** Swallowed, so before or after food is a real instruction. */
export function isOral(form: string | null | undefined): boolean {
  const kind = doseKind(form);
  return kind === "tablet" || kind === "capsule" || kind === "syrup" || kind === "sachet";
}

/** The patient app's three languages, and the two the medicine words exist in. */
export type FormLang = "en" | "hi";

const UNIT: Record<DoseKind, { en: [string, string]; hi: string }> = {
  tablet: { en: ["tablet", "tablets"], hi: "गोली" },
  capsule: { en: ["capsule", "capsules"], hi: "कैप्सूल" },
  syrup: { en: ["spoon", "spoons"], hi: "चम्मच" },
  drops: { en: ["drop", "drops"], hi: "बूँद" },
  inhaler: { en: ["puff", "puffs"], hi: "पफ़" },
  topical: { en: ["time", "times"], hi: "बार" },
  sachet: { en: ["sachet", "sachets"], hi: "पुड़िया" },
  injection: { en: ["dose", "doses"], hi: "टीका" },
};

/** "tablet" / "tablets" / "गोली": what one of this medicine is called. */
export function unitWord(form: string | null | undefined, count: number, lang: FormLang = "en"): string {
  const u = UNIT[doseKind(form)];
  return lang === "hi" ? u.hi : count === 1 ? u.en[0] : u.en[1];
}

const SITE: Record<Exclude<DoseSite, null>, { en: string; hi: string }> = {
  eye: { en: "in the eye", hi: "आँख में" },
  ear: { en: "in the ear", hi: "कान में" },
  nose: { en: "in the nose", hi: "नाक में" },
  skin: { en: "on the skin", hi: "त्वचा पर" },
  lungs: { en: "breathed in", hi: "साँस के साथ" },
  injected: { en: "as an injection", hi: "टीके से" },
};

/** "in the eye" / "आँख में", or "" when it goes in the mouth and needs no saying. */
export function siteWords(form: string | null | undefined, lang: FormLang = "en"): string {
  const site = doseSite(form);
  return site ? SITE[site][lang] : "";
}

/**
 * One dose in the family's words: "2 drops in the eye", "2 बूँद आँख में", "1
 * tablet". The count and its unit, then where it goes if that is not obvious.
 */
export function doseWords(form: string | null | undefined, count: number, lang: FormLang = "en"): string {
  return [`${count} ${unitWord(form, count, lang)}`, siteWords(form, lang)].filter(Boolean).join(" ");
}

/**
 * The one line a tube of cream or a puffer needs in place of "after food": how
 * it is used. Null for anything swallowed, where food is the real instruction.
 */
export function howWords(form: string | null | undefined, lang: FormLang = "en"): string | null {
  if (isOral(form)) return null;
  const kind = doseKind(form);
  if (kind === "topical") return lang === "hi" ? "लगाना है, खाना नहीं" : "Apply it, do not swallow";
  if (kind === "inhaler") return lang === "hi" ? "साँस के साथ लेना है" : "Breathe it in";
  if (kind === "injection") return lang === "hi" ? "टीका, अस्पताल में" : "An injection, given at the clinic";
  const site = siteWords(form, lang);
  if (!site) return lang === "hi" ? "डालना है, पीना नहीं" : "Put it in, do not drink it";
  return lang === "hi" ? `${site} डालना है` : `Put it ${site}`;
}
