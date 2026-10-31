/**
 * Finding a medicine from a few letters, typos included.
 *
 * A doctor writing by hand types "para" and wants Paracetamol, types "augmentn"
 * and still wants Augmentin, types a brand and wants the generic it stands for.
 * So a medicine is matched on its generic name and every brand, and the best
 * match across those names is its score.
 *
 * In order of how good a match is: the exact name; a name that starts with
 * what was typed; a word inside a name that starts with it; the letters
 * appearing inside a name; a name that is a typo or two away from what was
 * typed (a transposed or missing letter); the letters appearing in order.
 *
 * Beyond names, a medicine is found by its FORMULA (each ingredient of a
 * combination: "clav" finds Amoxicillin + Clavulanic acid) and, more weakly, by
 * its CLASS ("statin", "NSAID"). Several words must all match ("amox clav"), and
 * a number in the query ("para 650") prefers the medicine that comes in that
 * strength. The short forms doctors write ("PCM", "PPI", "CCB") are read as what
 * they stand for. Two medicines typed together that no single entry has
 * ("metformin glimepiride") show each of them, so neither is a dead end. Once
 * something matches well, the long-shot matches (letters merely in order) are
 * dropped rather than listed under it.
 *
 * Each hit says how it was found and what else has the same formula
 * (its brands, and any other entry with the same ingredients), so a doctor can
 * switch to whatever the chemist stocks.
 */
import type { Drug } from "./types.js";

export type DrugHit = {
  drug: Drug;
  /** Which of the medicine's names matched: the generic, one brand, an ingredient or the class. */
  name: string;
  /** Where the typed letters sit inside `name`, for highlighting; null if they do not sit together. */
  at: number | null;
  score: number;
  /** How it was found. */
  via: "generic" | "brand" | "ingredient" | "class";
  /** The formula (the generic composition), e.g. "Amoxicillin + Clavulanic acid". */
  formula: string;
  /** Other names with exactly this formula: its brands, and other entries with the same ingredients. */
  sameFormula: string[];
  /** The strength the query asked for, if the medicine comes in it ("650 mg"). */
  strength: string | null;
};

/** The ingredients of a formula, in a stable order: "Amoxicillin + Clavulanic acid" -> ["amoxicillin", "clavulanic acid"]. */
export function ingredientsOf(drug: Pick<Drug, "genericName">): string[] {
  return drug.genericName
    .split(/\s*\+\s*|\s*\/\s*(?=[a-z])/i)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

/**
 * What can stand in for a medicine: the same formula under other names (its
 * brands, and other entries with identical ingredients), and similar medicines
 * from the same class (a different formula, for the doctor to judge).
 */
export function alternativesFor(drug: Drug, drugs: Drug[]): { sameFormula: string[]; sameClass: Drug[] } {
  const key = ingredientsOf(drug).join("+");
  const twins = drugs.filter((d) => d.id !== drug.id && ingredientsOf(d).join("+") === key);
  const sameFormula = [...new Set([...drug.commonBrands, ...twins.flatMap((d) => [d.genericName, ...d.commonBrands])])];
  const sameClass = drugs.filter((d) => d.id !== drug.id && d.drugClass === drug.drugClass && !twins.includes(d)).slice(0, 5);
  return { sameFormula, sameClass };
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Short forms on Indian prescriptions and what they stand for, as names or
 * classes in the formulary (in the same squashed form `plain` makes).
 */
const SHORT: Record<string, string[]> = {
  pcm: ["paracetamol"],
  apap: ["paracetamol"],
  ppi: ["protonpumpinhibitor"],
  arb: ["angiotensinreceptorblocker"],
  acei: ["aceinhibitor"],
  ccb: ["calciumchannelblocker"],
  ors: ["rehydration", "oralrehydrationsalts"],
  hcq: ["hydroxychloroquine"],
  cpm: ["chlorpheniramine"],
  ics: ["inhaledcorticosteroid"],
  saba: ["shortactingbetaagonist"],
  ltra: ["leukotrienereceptorantagonist"],
  tca: ["tricyclicantidepressant"],
  mtx: ["methotrexate"],
  inh: ["isoniazid"],
  iron: ["ferrous", "haematinic"],
  steroid: ["corticosteroid"],
  antibiotic: ["aminopenicillin", "macrolide", "fluoroquinolone", "cephalosporin", "tetracycline", "nitroimidazole"],
};

/** Edit distance with a swap of neighbouring letters counting as one edit. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function inOrder(q: string, n: string): boolean {
  let i = 0;
  for (const ch of n) if (ch === q[i]) i++;
  return i === q.length;
}

/** How well one name matches what was typed, 0 for not at all. */
function scoreName(rawName: string, q: string): { score: number; at: number | null } {
  const n = plain(rawName);
  if (!n) return { score: 0, at: null };
  if (n === q) return { score: 100, at: 0 };
  if (n.startsWith(q)) return { score: 90 - (n.length - q.length) * 0.3, at: 0 };

  // A later word of a multi-word name ("calcium carbonate" for "carb").
  const words = rawName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let offset = 0;
  for (const w of words) {
    if (w.startsWith(q)) return { score: 78, at: rawName.toLowerCase().indexOf(w, offset) };
    offset = rawName.toLowerCase().indexOf(w, offset) + w.length;
  }

  const at = n.indexOf(q);
  if (at >= 0 && q.length >= 3) return { score: 62, at };

  // Typos: compare with the front of the name, allowing it to be a letter
  // longer or shorter, and tolerate more as the word gets longer.
  if (q.length >= 4) {
    const allowed = q.length >= 7 ? 2 : 1;
    let best = Infinity;
    for (const len of [q.length - 1, q.length, q.length + 1]) {
      if (len > 0) best = Math.min(best, distance(q, n.slice(0, len)));
    }
    best = Math.min(best, distance(q, n));
    if (best <= allowed) return { score: 55 - best * 8, at: null };
  }

  if (q.length >= 5 && inOrder(q, n)) return { score: 25, at: null };
  return { score: 0, at: null };
}

/** The medicines that best match what was typed, best first. */
export function searchDrugs(drugs: Drug[], query: string, limit = 6): DrugHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  // A number ("650", "650mg", "0.5") is a strength to prefer, not a name to match.
  const numbers = words.filter((w) => /^\d/.test(w)).map((w) => w.replace(/[^\d.]/g, ""));
  const terms = words.filter((w) => !/^\d/.test(w)).map(plain).filter(Boolean);
  if (terms.length === 0 || terms.join("").length < 2) return [];

  const hits: DrugHit[] = [];
  for (const drug of drugs) {
    const ingredients = drug.genericName.includes("+") ? drug.genericName.split(/\s*\+\s*/) : [];
    const names: { name: string; via: DrugHit["via"]; weight: number }[] = [
      { name: drug.genericName, via: "generic", weight: 1.005 },
      ...drug.commonBrands.map((b) => ({ name: b, via: "brand" as const, weight: 1 })),
      ...ingredients.map((i) => ({ name: i, via: "ingredient" as const, weight: 0.95 })),
      { name: drug.drugClass, via: "class", weight: 0.6 },
    ];

    // Every typed word must match one of the names; the first word decides which name is shown.
    let total = 0;
    let shown: { name: string; via: DrugHit["via"]; at: number | null; score: number } | null = null;
    let ok = true;
    for (const [i, term] of terms.entries()) {
      let best: { name: string; via: DrugHit["via"]; at: number | null; score: number } | null = null;
      for (const n of names) {
        for (const t of SHORT[term] ?? [term]) {
          const { score, at } = scoreName(n.name, t);
          const weighted = score * n.weight;
          if (score > 0 && (!best || weighted > best.score)) best = { name: n.name, via: n.via, at, score: weighted };
        }
      }
      if (!best) {
        ok = false;
        break;
      }
      total += best.score;
      if (i === 0) shown = best;
    }
    if (!ok || !shown) continue;

    const strength = numbers.length ? (drug.strengths.find((st) => numbers.some((n) => n && st.replace(/[^\d.]/g, "") === n)) ?? null) : null;
    const score = total / terms.length + (strength ? 6 : 0);
    hits.push({
      drug,
      name: shown.name,
      at: shown.at,
      score,
      via: shown.via,
      formula: drug.genericName,
      sameFormula: alternativesFor(drug, drugs).sameFormula,
      strength,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.drug.genericName.localeCompare(b.drug.genericName));

  // Two medicines typed together that no one entry has: each of them.
  if (hits.length === 0 && terms.length > 1) {
    const seen = new Set<string>();
    const each = terms.map((t) => searchDrugs(drugs, [t, ...numbers].join(" "), 3));
    const out: DrugHit[] = [];
    for (let i = 0; out.length < limit && each.some((e) => e[i]); i++) {
      for (const e of each) {
        const h = e[i];
        if (h && !seen.has(h.drug.id) && out.length < limit) {
          seen.add(h.drug.id);
          out.push(h);
        }
      }
    }
    return out;
  }

  // A good match makes the long shots noise.
  const top = hits[0]?.score ?? 0;
  const floor = top >= 50 ? top / 2 : 0;
  return hits.filter((h) => h.score >= floor).slice(0, limit);
}
