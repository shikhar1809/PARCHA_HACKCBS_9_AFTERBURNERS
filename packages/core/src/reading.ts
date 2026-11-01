/**
 * What text read off a photo says about medicines, by plain rules.
 *
 * The phone reads the printed words on a pharmacy bill or a medicine strip (see
 * the patient app's readText); this decides which of those words are names of
 * medicines in the list, and says why for each one. It never suggests a
 * medicine that is not written there, never guesses at a dose, and keeps
 * nothing: it is a function of the words and the medicine list.
 *
 * A word counts when it is a medicine's generic name, one of its brands or one
 * of its ingredients:
 *
 *   - spelt exactly, and read clearly: "sure" (green), still ticked by the person;
 *   - a letter or two off (smudged print, a reading slip), or read unclearly:
 *     "check" (yellow), with the difference spelt out.
 *
 * Words that are part of every bill (TAB, MRP, BATCH, TOTAL...) are skipped.
 * A three-letter name (PAN, ORS) matches too much by chance, so it counts only
 * spelt exactly and with proof on the same line: a strength the medicine comes
 * in ("PAN 40") or the word for its form ("ORS SACHET").
 */
import type { Drug, Timing } from "./types.js";

/** A word or line as the reader returned it, with where it sits on the photo (in pixels). */
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type ReadWord = { text: string; confidence: number; box: Box };
export type ReadLine = { text: string; words: ReadWord[]; box: Box };

export type Finding = {
  drug: Drug;
  /** The name it matched: the generic, a brand or an ingredient, as the medicine list spells it. */
  name: string;
  via: "generic" | "brand" | "ingredient";
  /** Exactly as read off the photo. */
  word: string;
  line: string;
  /** Where the word is on the photo, to draw a box round it. */
  box: Box;
  /** A strength on the same line that the medicine comes in ("650 mg"), if any. */
  strength: string | null;
  sure: boolean;
  /** Why, in a sentence a person can check against the photo. */
  why: string;
};

/** Words on every bill or strip that are not medicines. */
const NOT_MEDICINES = new Set(
  "tab tabs tablet tablets cap caps capsule capsules syp syrup susp suspension inj injection drops cream gel oint ointment strip strips mrp rate amount amt total gross net discount disc batch exp expiry mfg mfd date qty quantity pack packing invoice bill cash memo gst cgst sgst igst hsn sale paid round free name patient doctor prescribed chemist pharmacy medical medicals store stores road nagar delhi phone mobile licence license each only keep store below temperature dosage directions warning schedule prescription retail price incl taxes manufactured marketed limited ltd pvt india".split(
    " ",
  ),
);

const plain = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** How a bill or strip says what form a medicine is: proof that a short word is a medicine. */
const FORMS = /\b(tab|tabs|tablets?|cap|caps|capsules?|syp|syrup|susp|inj|injection|sachets?|drops|cream|gel|inhaler)\b/i;

/** Edit distance with a swap of neighbouring letters counting as one edit. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Below this the reader itself was unsure of the letters (Tesseract's 0-100). */
const CLEAR = 70;

type Name = { key: string; name: string; via: Finding["via"]; drug: Drug };

/** Each medicine's names as single words to look for: "Dolo 650" -> "dolo", "Pan-D" -> "pand". */
function namesOf(drugs: Drug[]): Name[] {
  const out: Name[] = [];
  for (const drug of drugs) {
    const ingredients = drug.genericName.includes("+") ? drug.genericName.split(/\s*\+\s*/) : [];
    const all: [string, Finding["via"]][] = [[drug.genericName, "generic"], ...drug.commonBrands.map((b) => [b, "brand"] as [string, Finding["via"]]), ...ingredients.map((i) => [i, "ingredient"] as [string, Finding["via"]])];
    for (const [name, via] of all) {
      // A brand's first word is how it is printed ("DOLO 650", "PAN 40", "ORS-L"); a generic is matched on its first word too.
      const first = plain(name.split(/[\s-]+/)[0] ?? "");
      if (first.length >= 3) out.push({ key: first, name, via, drug });
    }
  }
  return out;
}

/** The medicines named in what was read, best reading first, each medicine once. */
export function medicinesIn(lines: ReadLine[], drugs: Drug[]): Finding[] {
  const names = namesOf(drugs);
  const best = new Map<string, Finding & { rank: number }>();
  for (const line of lines) {
    const numbers = (line.text.match(/\d+(?:\.\d+)?/g) ?? []).map(String);
    const formed = FORMS.test(line.text);
    for (const w of line.words) {
      // "PAN-D" is read as PAN.
      const word = plain(w.text.split("-")[0] ?? "");
      if (word.length < 3 || NOT_MEDICINES.has(word)) continue;
      for (const n of names) {
        const strength = n.drug.strengths.find((s) => numbers.includes(s.replace(/[^\d.]/g, ""))) ?? null;
        if ((word.length === 3 || n.key.length === 3) && !(n.key === word && (strength || formed))) continue;
        let off = n.key === word ? 0 : Infinity;
        if (off !== 0 && word.length >= 5 && Math.abs(word.length - n.key.length) <= 2) {
          const d = distance(word, n.key);
          if (d <= (word.length >= 8 ? 2 : 1)) off = d;
        }
        if (off === Infinity) continue;
        const clear = w.confidence >= CLEAR;
        const sure = off === 0 && clear;
        const what = n.via === "brand" ? `a brand of ${n.drug.genericName}` : n.via === "ingredient" ? `in ${n.drug.genericName}` : "the medicine's own name";
        const why =
          off === 0
            ? `"${w.text.trim()}" is ${n.via === "generic" ? n.name : `${n.name}, ${what}`}${clear ? "" : ", but the letters were hard to read"}.`
            : `"${w.text.trim()}" is ${off} letter${off === 1 ? "" : "s"} away from ${n.name} (${what}). Check the photo.`;
        // Exact beats near; a clear reading beats an unclear one; a strength on the line, then the generic, settle the rest.
        const rank = off * 10 + (clear ? 0 : 5) + (strength ? 0 : 2) + (n.via === "generic" ? 0 : 1);
        const had = best.get(n.drug.id);
        if (!had || rank < had.rank) best.set(n.drug.id, { drug: n.drug, name: n.name, via: n.via, word: w.text.trim(), line: line.text, box: w.box, strength, sure, why, rank });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.rank - b.rank || a.box.y0 - b.box.y0).map(({ rank: _rank, ...f }) => f);
}

/**
 * Whether a strip's photo shows this medicine's name: the words that say so,
 * or null. Used to check the photo is of the right strip, never to choose one.
 */
export function stripShows(lines: ReadLine[], drug: Drug): Finding | null {
  return medicinesIn(lines, [drug])[0] ?? null;
}

/** What a printed prescription line says about taking the medicine, where it says it. */
export type DoseOnLine = {
  /** "1-0-1", "0-0-1", "SOS"; null when the line does not say. */
  frequency: string | null;
  timing: Timing | null;
  days: number | null;
};

const SLOTS = /\b([0-2])\s*[-–]\s*([0-2])\s*[-–]\s*([0-2])\b/;
const SAID: [RegExp, string][] = [
  [/\b(?:OD|once\s+(?:a\s+)?daily)\b/i, "1-0-0"],
  [/\b(?:BD|BID|twice\s+(?:a\s+)?daily)\b/i, "1-0-1"],
  [/\b(?:TDS|TID|thrice\s+(?:a\s+)?daily)\b/i, "1-1-1"],
  [/\bHS\b|\bat\s+bed\s*time\b/i, "0-0-1"],
  [/\bSOS\b|\bwhen\s+needed\b/i, "SOS"],
];

/**
 * Reads the times, food and days off one printed line ("Dolo 650  1-0-1  after
 * food  x 5 days"), and only what is printed there.
 *
 * A printed Parcha puts the dose on the same line as the name, so the line the
 * name was found on is the place to look. Anything not written is left null for
 * the person to fill in: a printed slip that does not say "after food" is not
 * read as saying it. The person still confirms every medicine afterwards.
 */
export function doseOnLine(text: string): DoseOnLine {
  const slots = text.match(SLOTS);
  const frequency = slots ? `${slots[1]}-${slots[2]}-${slots[3]}` : (SAID.find(([re]) => re.test(text))?.[1] ?? null);
  const timing: Timing | null = /\b(?:after\s+(?:food|meals?)|A\/?F|PC)\b|खाने\s*के\s*बाद/i.test(text)
    ? "after_food"
    : /\b(?:before\s+(?:food|meals?)|B\/?F|AC)\b|खाने\s*से\s*पहले/i.test(text)
      ? "before_food"
      : /\bempty\s+stomach\b|खाली\s*पेट/i.test(text)
        ? "empty_stomach"
        : null;
  const d = text.match(/(?:x|for|×)?\s*(\d{1,3})\s*(?:days?|din|दिन)\b/i);
  const days = d && Number(d[1]) > 0 && Number(d[1]) <= 180 ? Number(d[1]) : null;
  return { frequency, timing, days };
}
