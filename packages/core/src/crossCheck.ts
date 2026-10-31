/**
 * Checking medicines when there is no printed Parcha (the RapidRX idea).
 *
 * Two sources are lined up: the medicines on the pharmacy bill (printed, so
 * the names are reliable) and what the doctor or chemist said (the authority
 * on when to take them), typed or spoken in Hindi, Hinglish or English. Each
 * medicine comes out:
 *
 *   green   named in what was said, at the same times
 *   yellow  on the bill, but what was said does not say when (or at all)
 *   red     what was said gives different times: a person must choose
 *
 * It never picks between disagreeing sources on its own, and never invents a
 * time nobody gave.
 */
import { frequencySlots } from "./items.js";
import type { Timing } from "./types.js";

export type CheckStatus = "green" | "yellow" | "red";

export type Heard = { frequency: string | null; timing: Timing | null };

export type CheckedMedicine = {
  name: string;
  status: CheckStatus;
  /** What the words said about this medicine, when anything. */
  heard: Heard | null;
  /** In plain words, for the screen. */
  reason: "agree" | "not-mentioned" | "no-times" | "times-differ" | "timing-differs";
};

/** Whole words, Hindi included: \b only knows Latin letters. */
const word = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{M}])(${alternatives})(?![\\p{L}\\p{M}])`, "iu");

const SLOT_WORDS: [RegExp, number][] = [
  [word("subah|subha|savere|morning|सुबह|सवेरे"), 0],
  [word("dopahar|dopehar|afternoon|lunch|दोपहर"), 1],
  [word("shaam|sham|evening|raat|rat|night|bedtime|sone|शाम|रात|सोने"), 2],
];

const COUNT_WORDS: [RegExp, string][] = [
  [word("teen baar|3 baar|thrice|three times|tds|tid|तीन बार"), "1-1-1"],
  [word("do baar|2 baar|twice|two times|bd|bid|दो बार"), "1-0-1"],
  [word("char baar|4 baar|four times|qid|चार बार"), "1-1-1-1"],
  [word("ek baar|1 baar|once|od|एक बार"), "1-0-0"],
  [word("hs"), "0-0-1"],
  [word("sos|zarurat|zaroorat|when needed|if needed|ज़रूरत|जरूरत"), "SOS"],
];

const TIMING_WORDS: [RegExp, Timing][] = [
  [/(khane ke baad|khana khane ke baad|after food|after meals?|p\.?c\.?|खाने के बाद)/i, "after_food"],
  [/(khane se pehle|khane ke pehle|before food|before meals?|a\.?c\.?|खाने से पहले)/i, "before_food"],
  [/(khali pet|khaali pet|empty stomach|खाली पेट)/i, "empty_stomach"],
  [/(khane ke saath|with food|खाने के साथ)/i, "with_food"],
];

/** The times a piece of speech gives: "1-0-1", "subah shaam", "din mein do baar"... */
export function heardIn(text: string): Heard {
  let frequency: string | null = null;
  const pattern = text.match(/\b(\d)\s*-\s*(\d)\s*-\s*(\d)(?:\s*-\s*(\d))?\b/);
  if (pattern) frequency = pattern.slice(1).filter((x) => x !== undefined).join("-");
  if (!frequency) {
    const slots = [0, 0, 0];
    let any = false;
    for (const [re, i] of SLOT_WORDS) if (re.test(text)) (slots[i] = 1), (any = true);
    if (any) frequency = slots.join("-");
  }
  if (!frequency) for (const [re, f] of COUNT_WORDS) if (re.test(text)) { frequency = f; break; }
  let timing: Timing | null = null;
  for (const [re, t] of TIMING_WORDS) if (re.test(text)) { timing = t; break; }
  return { frequency, timing };
}

/** The part of what was said that is about one medicine: its sentence, from its name on. */
function aboutMedicine(said: string, names: string[]): string | null {
  const parts = said.split(/[.\n;|।]+/);
  const keys = names.map((n) => n.toLowerCase().split(/[\s(]/)[0]).filter((k) => k.length >= 4);
  for (const part of parts) {
    const low = part.toLowerCase();
    for (const k of keys) {
      const at = low.indexOf(k.slice(0, Math.max(4, k.length - 2)));
      if (at >= 0) return part.slice(at);
    }
  }
  return null;
}

const sameFrequency = (a: string, b: string) => {
  if (a.toUpperCase() === b.toUpperCase()) return true;
  const x = frequencySlots(a);
  const y = frequencySlots(b);
  if (!x || !y) return false;
  // "Subah shaam" (1-0-1) and the three-slot 1-0-1 are the same; compare by which slots are on.
  const on = (s: number[]) => (s.length === 4 ? [s[0], s[1], s[2] || s[3]] : s).map((n) => (n > 0 ? 1 : 0)).join("");
  return on(x) === on(y);
};

export function crossCheck(
  medicines: { name: string; aliases?: string[]; frequency: string; timing: Timing }[],
  said: string,
): CheckedMedicine[] {
  return medicines.map((m) => {
    const part = aboutMedicine(said, [m.name, ...(m.aliases ?? [])]);
    if (part === null) return { name: m.name, status: "yellow", heard: null, reason: "not-mentioned" };
    const heard = heardIn(part);
    if (!heard.frequency && !heard.timing) return { name: m.name, status: "yellow", heard, reason: "no-times" };
    if (heard.frequency && !sameFrequency(heard.frequency, m.frequency)) return { name: m.name, status: "red", heard, reason: "times-differ" };
    if (heard.timing && m.timing !== "any" && heard.timing !== m.timing) return { name: m.name, status: "red", heard, reason: "timing-differs" };
    if (!heard.frequency) return { name: m.name, status: "yellow", heard, reason: "no-times" };
    return { name: m.name, status: "green", heard, reason: "agree" };
  });
}
