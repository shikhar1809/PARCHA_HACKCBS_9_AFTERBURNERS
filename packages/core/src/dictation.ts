/**
 * Turning a dictated line into structured prescription items.
 *
 * This is the half of "press record, get back points to tick" that actually
 * matters. Transcribing speech to text is a solved problem you buy; resolving
 * "Augmentin 625 twice daily after food" to a row carrying a real `drug_id`,
 * a frequency the patient pictogram can draw, and a quantity the pharmacy can
 * count out is the part that decides whether the feature is usable.
 *
 * It is deliberately deterministic and model-free:
 *
 *   - the conflict rules key on `drug_id`, so a line that cannot be resolved
 *     to the formulary must fail loudly into a manual pick rather than
 *     quietly becoming free text that no rule can read.
 *   - the same dictation gives the same lines every time, which is what makes
 *     the output reviewable.
 *
 * Nothing here is authoritative. Every line it produces is a *proposal* that
 * the doctor ticks. The tick is the signature.
 */

import {
  TIMINGS,
  normaliseFrequency,
  suggestedQuantity,
  type PrescriptionItem,
  type Timing,
} from "./items.js";
import { searchDrugs } from "./fuzzy.js";
import type { Drug } from "./types.js";

export type DrugLike = {
  id: string;
  genericName: string;
  commonBrands: string[];
  defaultForm: string | null;
  defaultStrength: string | null;
  strengths: string[];
  forms: string[];
};

/** A line the parser resolved, with what it keyed on, for the UI to show. */
export type Proposal = {
  /** Stable within one parse, so the UI can key a checkbox on it. */
  key: string;
  item: PrescriptionItem;
  /** The words this line came from. */
  source: string;
  /** Which token matched the formulary, so "why this drug" is answerable. */
  matchedOn: string;
  /** Fields the parser filled from a default rather than from the dictation. */
  assumed: string[];
};

/** A line that mentioned something, but nothing the formulary knows. */
export type Unresolved = {
  key: string;
  source: string;
  reason: string;
};

export type DictationResult = {
  proposals: Proposal[];
  unresolved: Unresolved[];
};

/* ------------------------------------------------------------------------ *
 * Tokens
 * ------------------------------------------------------------------------ */

const FREQUENCY_WORDS: Record<string, string> = {
  od: "OD",
  once: "OD",
  daily: "OD",
  "once daily": "OD",
  bd: "BD",
  bid: "BD",
  twice: "BD",
  "twice daily": "BD",
  tds: "TDS",
  tid: "TDS",
  thrice: "TDS",
  "three times": "TDS",
  qid: "QID",
  "four times": "QID",
  hs: "HS",
  night: "HS",
  "at night": "HS",
  sos: "SOS",
  "if needed": "SOS",
  stat: "STAT",
  // How it is said aloud, in English and in Hindi.
  "once a day": "OD",
  "one time a day": "OD",
  "twice a day": "BD",
  "two times a day": "BD",
  "thrice a day": "TDS",
  "three times a day": "TDS",
  "four times a day": "QID",
  "every 24 hours": "OD",
  "every 12 hours": "BD",
  "every 8 hours": "TDS",
  "every 6 hours": "QID",
  morning: "OD",
  "in the morning": "OD",
  "morning and night": "BD",
  "morning and evening": "BD",
  "morning evening": "BD",
  bedtime: "HS",
  "bed time": "HS",
  "at bedtime": "HS",
  "before sleep": "HS",
  "when needed": "SOS",
  "as needed": "SOS",
  "when required": "SOS",
  "as required": "SOS",
  "if required": "SOS",
  "in case of": "SOS",
  subah: "OD",
  raat: "HS",
  "raat ko": "HS",
  "subah shaam": "BD",
  "subah raat": "BD",
  "ek baar": "OD",
  "do baar": "BD",
  "teen baar": "TDS",
  zarurat: "SOS",
  "zarurat pe": "SOS",
  "zarurat padne par": "SOS",
  "after every loose stool": "SOS",
  "after each loose stool": "SOS",
  "after every loose motion": "SOS",
  "after each loose motion": "SOS",
};

const TIMING_WORDS: { pattern: RegExp; timing: Timing }[] = [
  { pattern: /\b(empty stomach|nil by mouth|khaa?li pet|khaa?li pet par)\b/i, timing: "empty_stomach" },
  { pattern: /\b(after food|after meals?|after (?:breakfast|lunch|dinner)|pc|khane ke baad|khana khane ke baad)\b/i, timing: "after_food" },
  { pattern: /\b(before food|before meals?|before (?:breakfast|lunch|dinner)|ac|khane se pehle|khane ke pehle)\b/i, timing: "before_food" },
  { pattern: /\b(with food|with meals?|khane ke saath)\b/i, timing: "with_food" },
];

/**
 * Splits a dictation into one segment per medicine.
 *
 * Newlines first, because a doctor dictating a list pauses between items and
 * a transcriber turns pauses into lines. Commas and "and" are the fallback
 * for a single run-on sentence.
 */
export function splitSegments(text: string): string[] {
  return text
    .split(/\n+|[;,]|\band\b/gi)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/** A parsed value, plus the exact words it came from. */
type Found<T> = { value: T; text: string } | null;

/**
 * Number words, because a dictation says "three days" as often as "3 days",
 * and a doctor in a North Indian OPD says "do din" about as often as either.
 */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, ek: 1,
  two: 2, do: 2,
  three: 3, teen: 3,
  four: 4, char: 4,
  five: 5, paanch: 5, panch: 5,
  six: 6, chhe: 6, che: 6,
  seven: 7, saat: 7,
  eight: 8, aath: 8,
  nine: 9, nau: 9,
  ten: 10, das: 10,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
};

function findFrequency(segment: string): Found<string> {
  // A literal n-n-n pattern wins: it is unambiguous and it is what the
  // pictogram draws.
  const slots = segment.match(/\b\d(?:\s*-\s*\d){1,3}\b/);
  if (slots) return { value: slots[0].replace(/\s+/g, ""), text: slots[0] };

  // Longest key first, so "twice daily" beats "twice" and "once daily" is
  // not read as "once".
  const keys = Object.keys(FREQUENCY_WORDS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const pattern = new RegExp(`\\b${key.replace(/ /g, "\\s+")}\\b`, "i");
    const hit = segment.match(pattern);
    if (hit) return { value: FREQUENCY_WORDS[key], text: hit[0] };
  }
  return null;
}

const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).join("|");

function findDuration(segment: string): Found<number> {
  // "for 5 days", "5 days", "5 din", "5d"
  const explicit = segment.match(
    new RegExp(
      `(?:for\\s+)?(\\d{1,3}|${NUMBER_WORD_PATTERN})\\s*(days?|din|d)\\b`,
      "i",
    ),
  );
  if (explicit) {
    const n = Number(explicit[1]) || NUMBER_WORDS[explicit[1].toLowerCase()];
    if (n) return { value: n, text: explicit[0] };
  }

  // "x 5" — the shorthand, where the unit is left implied.
  const crossed = segment.match(/\bx\s*(\d{1,3})\b/i);
  if (crossed) return { value: Number(crossed[1]), text: crossed[0] };

  // "2 weeks", "a week", "do hafte"; "a month", "teen mahine".
  const longer = segment.match(
    new RegExp(`(?:for\\s+)?(\\d{1,2}|an?|${NUMBER_WORD_PATTERN})\\s*(weeks?|wks?|hafta|hafte|months?|mahina|mahine)\\b`, "i"),
  );
  if (longer) {
    const n = Number(longer[1]) || NUMBER_WORDS[longer[1].toLowerCase()] || (/^an?$/i.test(longer[1]) ? 1 : 0);
    if (n) return { value: n * (/^(months?|mahin[ae])$/i.test(longer[2]) ? 30 : 7), text: longer[0] };
  }
  return null;
}

function findTiming(segment: string): Found<Timing> {
  for (const { pattern, timing } of TIMING_WORDS) {
    const hit = segment.match(pattern);
    if (hit) return { value: timing, text: hit[0] };
  }
  return null;
}

const UNIT_PATTERN = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|%)\b/gi;

/**
 * Finds the strength mentioned, preferring one the formulary actually lists.
 *
 * A bare number in a dictation is ambiguous. "Prednisolone 10 mg OD x 5 days"
 * contains 10 and 5, and prednisolone is stocked at both — so reading numbers
 * straight out of the whole line picks the wrong dose. The caller therefore
 * strips the frequency and duration it already matched, and a number carrying
 * an explicit unit always beats a bare one.
 */
function findStrength(residue: string, drug: DrugLike): string | null {
  const listed = drug.strengths
    .map((strength) => {
      const parsed = strength.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|%)?/i);
      return parsed
        ? { strength, digits: parsed[1], unit: (parsed[2] ?? "").toLowerCase() }
        : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // 1. A number with a unit attached, matched on both number and unit.
  for (const hit of residue.matchAll(UNIT_PATTERN)) {
    const [, digits, unit] = hit;
    const exact = listed.find(
      (s) => s.digits === digits && s.unit === unit.toLowerCase(),
    );
    if (exact) return exact.strength;
  }

  // 2. A number with a unit, matched on the number alone — covers "500" for
  //    a formulary entry written "500 mg/5 ml".
  for (const hit of residue.matchAll(UNIT_PATTERN)) {
    const match = listed.find((s) => s.digits === hit[1]);
    if (match) return match.strength;
  }

  // 3. A bare number, only if the formulary stocks that strength. Longest
  //    first so "625" is not shadowed by "6".
  const bare = [...listed].sort((a, b) => b.digits.length - a.digits.length);
  for (const candidate of bare) {
    if (new RegExp(`\\b${candidate.digits}\\b`).test(residue)) {
      return candidate.strength;
    }
  }
  return null;
}

/** Normalises for matching: lowercase, collapse spaces, drop punctuation. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Match = { drug: DrugLike; matchedOn: string; fuzzy?: boolean };

/** Words that start a line but are never a medicine. */
const NOT_A_MEDICINE = new Set(["tab", "tablet", "cap", "capsule", "syp", "syrup", "inj", "give", "start", "take", "and", "then", "also"]);

/**
 * Resolves a segment to one formulary drug.
 *
 * Generic names and brand names both match, because a doctor says whichever
 * comes to hand. The longest match wins, so "amoxicillin clavulanate" is not
 * resolved to plain "amoxicillin" when both are stocked.
 */
function findDrug(segment: string, drugs: DrugLike[], guess = true): Match | null {
  const haystack = normalise(segment);
  let best: Match | null = null;
  let bestLength = 0;

  for (const drug of drugs) {
    const candidates = [drug.genericName, ...drug.commonBrands];
    for (const candidate of candidates) {
      const needle = normalise(candidate);
      if (needle.length < 4) continue;
      if (!haystack.includes(needle)) continue;
      if (needle.length > bestLength) {
        best = { drug, matchedOn: candidate };
        bestLength = needle.length;
      }
    }
  }
  if (best) return best;
  if (!guess) return null;

  // Nothing said exactly: the search the doctor uses by hand, on the first
  // words of the line, which knows short forms ("ORS", "PCM") and typos. The
  // medicine is then a guess the doctor confirms, like any other.
  const words = haystack.split(" ").filter((w) => /^[a-z]{2,}$/.test(w) && !NOT_A_MEDICINE.has(w)).slice(0, 2);
  const asDrugs = drugs.map((d) => ({ drugClass: "", ...d })) as unknown as Drug[];
  for (const word of words) {
    const hit = searchDrugs(asDrugs, word, 1)[0];
    if (hit && hit.score >= 45) {
      const drug = drugs.find((d) => d.id === hit.drug.id)!;
      return { drug, matchedOn: `${word} → ${hit.name}`, fuzzy: true };
    }
  }
  return null;
}

/* ------------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------------ */

/**
 * Parses a dictation into proposals to tick and lines that need a manual
 * pick.
 *
 * Defaults are applied where a dictation leaves something out — OD for
 * frequency, five days for duration, "any" for timing — and every default is
 * named in `assumed`, so the screen can show which parts of a line the doctor
 * is being asked to confirm rather than merely read.
 */
export function parseDictation(
  text: string,
  drugs: DrugLike[],
  /** Whether a name only near what was said may still be taken as a guess the doctor confirms. */
  { guess = true }: { guess?: boolean } = {},
): DictationResult {
  const proposals: Proposal[] = [];
  const unresolved: Unresolved[] = [];

  splitSegments(text).forEach((segment, index) => {
    const key = `line-${index}`;
    const match = findDrug(segment, drugs, guess);

    if (!match) {
      unresolved.push({
        key,
        source: segment,
        reason: "No medicine in the formulary matched this line.",
      });
      return;
    }

    const { drug, matchedOn } = match;
    const assumed: string[] = match.fuzzy ? ["medicine"] : [];

    const dictatedFrequency = findFrequency(segment);
    if (!dictatedFrequency) assumed.push("frequency");
    const frequency = normaliseFrequency(dictatedFrequency?.value ?? "OD");

    const dictatedDuration = findDuration(segment);
    if (!dictatedDuration) assumed.push("duration");
    const durationDays = dictatedDuration?.value ?? 5;

    const dictatedTiming = findTiming(segment);
    if (!dictatedTiming) assumed.push("timing");
    const timing: Timing = dictatedTiming?.value ?? "any";

    // Strength is read from what is left after the frequency and duration
    // have been taken out, so "x 5 days" can never be read as a 5 mg dose.
    let residue = segment;
    for (const found of [dictatedFrequency, dictatedDuration, dictatedTiming]) {
      if (found) residue = residue.replace(found.text, " ");
    }

    const dictatedStrength = findStrength(residue, drug);
    if (!dictatedStrength) assumed.push("strength");
    const strength =
      dictatedStrength ?? drug.defaultStrength ?? drug.strengths[0] ?? "";

    const form = drug.defaultForm ?? drug.forms[0] ?? "tablet";

    proposals.push({
      key,
      source: segment,
      matchedOn,
      assumed,
      item: {
        drugId: drug.id,
        drugName: drug.genericName,
        form,
        strength,
        frequency,
        durationDays,
        timing: TIMINGS.includes(timing) ? timing : "any",
        quantity: suggestedQuantity(frequency, durationDays) ?? durationDays,
      },
    });
  });

  return { proposals, unresolved };
}

/** The frequency, duration and timing said in a few words ("5 days", "twice daily", "after food"), for answering a question. */
export const frequencyIn = (words: string) => findFrequency(words)?.value ?? null;
export const durationIn = (words: string) => findDuration(words)?.value ?? null;
export const timingIn = (words: string) => findTiming(words)?.value ?? null;
