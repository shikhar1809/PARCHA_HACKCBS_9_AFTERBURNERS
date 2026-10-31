/**
 * Prescribing by voice: where each spoken line goes, and what is still missing.
 *
 * The doctor holds Space and talks; the transcript comes here. By plain rules,
 * never a model, each part is placed in the box it belongs to:
 *
 *   "diagnosis viral fever"                -> Diagnosis
 *   "paracetamol 650 TDS 3 days after food" -> a medicine line (dictation.ts)
 *   "CBC and dengue NS1"                    -> Tests (by name)
 *   "advice rest and plenty of fluids"      -> Advice
 *   "follow up in 5 days"                   -> Follow-up
 *   "remove paracetamol"                    -> takes that line off
 *
 * Then it says what a prescription still needs: no diagnosis, a medicine whose
 * duration or frequency was not said (and was only defaulted), no follow-up
 * for a long-term condition. Each is one question, asked one at a time; the
 * next thing said is taken as its answer. The doctor still reads every line
 * and signs: this only saves typing.
 */
import { spellMedicines } from "./soundsLike.js";
import { durationIn, frequencyIn, parseDictation, splitSegments, timingIn, type DrugLike, type Proposal } from "./dictation.js";
import { normaliseFrequency, suggestedQuantity, type PrescriptionItem, type Timing } from "./items.js";
import { COMMON_TESTS } from "./special.js";

/** What a spoken line did. */
export type VoiceAction =
  | { kind: "diagnosis"; value: string }
  | { kind: "advice"; value: string }
  | { kind: "followUp"; days: number }
  | { kind: "tests"; values: string[] }
  | { kind: "medicines"; proposals: Proposal[] }
  | { kind: "remove"; drugName: string }
  /** A medicine already on the prescription, said again: only what was said now changes. */
  | { kind: "change"; drugId: string; drugName: string; patch: Partial<PrescriptionItem> }
  | { kind: "answer"; question: Question; patch: Partial<PrescriptionItem> | { diagnosis: string } | { followUp: number } }
  | { kind: "unplaced"; words: string }
  /** "Undo", "cancel that": take back what the last thing said did. */
  | { kind: "undo" }
  /** "Read it back": say the prescription as it stands. */
  | { kind: "readBack" };

/** Something the prescription still needs, asked as one short question. */
export type Question =
  | { kind: "diagnosis"; ask: string }
  | { kind: "duration"; drugId: string; drugName: string; ask: string }
  | { kind: "frequency"; drugId: string; drugName: string; ask: string }
  | { kind: "followUp"; ask: string };

/** The parts of the pad the router reads. */
export type PadState = {
  diagnosis: string;
  followUp: string;
  items: PrescriptionItem[];
  /** Per drugId, what the voice parser only defaulted ("duration", "frequency"). */
  guessed: Record<string, string[]>;
  /** Questions the doctor said to skip. */
  skipped: string[];
  /** The medicines last talked about, most recent last: what "it", "that" and "both" mean. */
  focus?: string[];
};

const LEAD = {
  diagnosis: /^(?:the\s+)?(?:diagnosis|provisional diagnosis|impression|dx|diagnosed with|bimari|nidan|(?:the\s+)?patient (?:has|is having|is suffering from)|suffering from|known case of|case of)\b[\s:,-]*(?:is\s+)?/i,
  advice: /^(?:advice|advise|salah|instructions?|tell (?:him|her|them)(?: to)?)\b[\s:,-]*/i,
  remove: /^(?:remove|delete|cancel|hatao|hata do|drop|stop|discontinue|band karo|band kar do)\b[\s:,-]*(?:the\s+)?/i,
};
const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, ek: 1, two: 2, do: 2, three: 3, teen: 3, four: 4, char: 4, five: 5, paanch: 5, panch: 5, six: 6, chhe: 6,
  seven: 7, saat: 7, eight: 8, aath: 8, ten: 10, das: 10, fourteen: 14, fifteen: 15, pandrah: 15, twenty: 20, thirty: 30,
};
const NUM = `\\d{1,3}|${Object.keys(WORD_NUM).join("|")}`;
const PERIOD = new RegExp(`(${NUM})\\s*(days?|din|weeks?|hafte|hafta|months?|mahina|mahine)\\b`, "i");
const FOLLOW_UP = new RegExp(`\\b(?:follow[\\s-]?up|review|come back|come again|revisit|next visit|dobara|phir aana|phir dikhana|dikhana)\\b[^0-9a-z]*(?:in|after|on)?\\s*${PERIOD.source}(?:\\s*(?:baad|later))?`, "i");
const daysOf = (m: RegExpMatchArray) =>
  (Number(m[1]) || WORD_NUM[m[1].toLowerCase()]) * (/week|haft/i.test(m[2]) ? 7 : /month|mahin/i.test(m[2]) ? 30 : 1);
const LONG_TERM = /\b(diabetes|dm|hypertension|htn|high bp|thyroid|asthma|copd|epilep|heart|ckd|kidney)\b/i;

/** How a test is said, mapped to how it is written on the slip. */
const TEST_WORDS: [RegExp, string][] = [
  [/\bcbc\b|complete blood count|blood count/i, "CBC"],
  [/\b(fasting|pp|ppbs|fbs)\b.*sugar|blood sugar|sugar test/i, "Blood sugar (F/PP)"],
  [/\bhba\s?1\s?c\b|\ba1c\b|glycated/i, "HbA1c"],
  [/\blft\b|liver function/i, "LFT"],
  [/\bkft\b|\brft\b|kidney function|renal function/i, "KFT"],
  [/lipi[dt](?: profile)?/i, "Lipid profile"],
  [/\btsh\b|thyroid (test|profile)/i, "TSH"],
  [/urine (routine|test|r\/m)|\burine\b/i, "Urine routine"],
  [/chest x[\s-]?ray|\bcxr\b/i, "Chest X-ray"],
  [/\becg\b|\bekg\b/i, "ECG"],
  [/\busg\b|ultrasound/i, "USG abdomen"],
  [/dengue|ns1/i, "Dengue NS1"],
  [/malaria/i, "Malaria antigen"],
  [/widal|typhoid test/i, "Widal"],
];

function testsIn(words: string): string[] {
  const found = TEST_WORDS.filter(([re]) => re.test(words)).map(([, t]) => t);
  return [...new Set(found)].filter((t) => COMMON_TESTS.includes(t));
}

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "");
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The one question to ask now, or null when nothing critical is missing. */
export function nextQuestion(state: PadState): Question | null {
  const asked = (key: string) => state.skipped.includes(key);
  for (const it of state.items) {
    const g = state.guessed[it.drugId] ?? [];
    if (g.includes("frequency") && !asked(`frequency:${it.drugId}`)) {
      return { kind: "frequency", drugId: it.drugId, drugName: it.drugName, ask: `How often is ${it.drugName}? For example "twice a day".` };
    }
    if (g.includes("duration") && !asked(`duration:${it.drugId}`)) {
      return { kind: "duration", drugId: it.drugId, drugName: it.drugName, ask: `For how many days is ${it.drugName}?` };
    }
  }
  if (!state.diagnosis.trim() && (state.items.length > 0) && !asked("diagnosis")) {
    return { kind: "diagnosis", ask: "What is the diagnosis?" };
  }
  if (!state.followUp && LONG_TERM.test(state.diagnosis) && !asked("followUp")) {
    return { kind: "followUp", ask: "When should they come back? For example \"in 30 days\"." };
  }
  return null;
}

/** The key a question is skipped under. */
export const questionKey = (q: Question) => ("drugId" in q ? `${q.kind}:${q.drugId}` : q.kind);

/** An answer to the pending question, if the words are one. */
function answer(q: Question, words: string): VoiceAction | null {
  if (q.kind === "duration") {
    const n = durationIn(words) ?? (/^\s*(\d{1,3})\s*$/.test(words) ? Number(words.trim()) : null);
    return n ? { kind: "answer", question: q, patch: { durationDays: n } } : null;
  }
  if (q.kind === "frequency") {
    const f = frequencyIn(words);
    return f ? { kind: "answer", question: q, patch: { frequency: normaliseFrequency(f) } } : null;
  }
  if (q.kind === "followUp") {
    const m = words.match(PERIOD);
    return m ? { kind: "answer", question: q, patch: { followUp: daysOf(m) } } : null;
  }
  // A diagnosis is whatever was said, unless it is clearly something else.
  return { kind: "answer", question: q, patch: { diagnosis: cap(clean(words.replace(LEAD.diagnosis, ""))) } };
}

/** The words that start a box, wherever they fall in a run of speech. */
const KEYWORDS = /\b(?:diagnosis|provisional diagnosis|impression|(?:the )?patient has|suffering from|known case of|advice|advise|salah|follow[\s-]?up|review after|review in|come back|next visit|remove|stop|discontinue|give|start|add|continue|make|change|tests?|investigations?)\b/gi;

/** Words that only lead into a medicine ("give him", "start", "make"), dropped before it is read. */
const LEAD_IN = /^(?:(?:give|start|add|continue|prescribe|take|also|then|and|ok|okay|so|please|make|change|increase|reduce|put (?:him|her|them) on|tab|tablet|cap|capsule)\b[\s,]*)+(?:(?:him|her|them|the patient|patient)\b[\s,]*)?(?:on\b\s*)?/i;

/**
 * Cuts a run of speech into clauses, one per box. A doctor talks in one breath
 * ("diagnosis urinary tract infection nitrofurantoin 100 BD 5 days, CBC,
 * follow up in 5 days") and the recogniser often gives it back with no full
 * stops, so a clause also ends where a box's name starts, and a diagnosis or
 * advice ends where a medicine or a test is named.
 */
export function splitClauses(text: string, drugs: DrugLike[]): string[] {
  const names = new Set<string>();
  for (const d of drugs) for (const n of [d.genericName, ...d.commonBrands]) {
    const w = (n.toLowerCase().match(/[a-z]+/) ?? [""])[0];
    if (w.length >= 4) names.add(w);
  }
  const out: string[] = [];
  for (const sentence of text.split(/[.?!;\n]+/)) {
    // Break before each box's name.
    const starts = [0, ...[...sentence.matchAll(KEYWORDS)].map((m) => m.index ?? 0).filter((i) => i > 0)];
    starts.forEach((s, i) => {
      const clause = sentence.slice(s, starts[i + 1] ?? sentence.length).trim();
      if (!clause) return;
      const words = clause.split(/\s+/);
      const isName = (j: number) => names.has(words[j].toLowerCase().replace(/[^a-z]/g, ""));
      // A word followed by a strength ("nitrofurantoin 100") starts a medicine, unless it is "type 2", "stage 3".
      const dose = (j: number) => /^[a-z]{5,}$/i.test(words[j]) && !/^(type|stage|grade|class|level|since|about|after|before|every|within|review|inhaler|puffs?|drops?|tablets?|capsules?|syrup|spoons?|units?|times)$/i.test(words[j]) && /^\d/.test(words[j + 1] ?? "");
      if (LEAD.remove.test(clause)) return void out.push(clause);
      const lead = LEAD.diagnosis.test(clause) || LEAD.advice.test(clause);
      // A diagnosis or advice stops where a medicine or test begins; a run of medicines splits at each one.
      const cuts = words
        .map((_, j) => j)
        .filter((j) => j > (lead ? 1 : 0) && (isName(j) || dose(j) || (lead && testsIn(words[j]).length > 0)));
      let from = 0;
      for (const c of cuts) {
        if (c > from) out.push(words.slice(from, c).join(" "));
        from = c;
      }
      out.push(words.slice(from).join(" "));
    });
  }
  return out
    .flatMap((c) => {
      const pieces = c.split(",");
      const kept: string[] = [];
      for (const p of pieces) {
        if (kept.length && sharedPart(clean(p))) kept.push("\u0000" + p);
        else if (kept.length && !kept[kept.length - 1].startsWith("\u0000")) kept[kept.length - 1] += "," + p;
        else kept.push(p);
      }
      return kept.map((k) => k.replace("\u0000", ""));
    })
    .map(clean)
    .filter(Boolean);
}

/** Places a whole run of speech, clause by clause; a pending question takes the first clause that answers it. */
export function routeSpeech(said: string, drugs: DrugLike[], state: PadState, pending: Question | null): VoiceAction[] {
  const out: VoiceAction[] = [];
  let open = pending;
  // Medicine names as meant, not as speech spelled them (soundsLike.ts).
  for (const clause of splitClauses(spellMedicines(said, drugs).text, drugs)) {
    // "...pantoprazole 40 subah, paanch din": a length or a timing said on its own is for the medicines just said without one.
    const shared = sharedPart(clause);
    const earlier = out.flatMap((x) => (x.kind === "medicines" ? x.proposals : []));
    if (shared && !open && earlier.some((p) => shared.fields.some((f) => p.assumed.includes(f)))) {
      for (const p of earlier) {
        if (shared.durationDays && p.assumed.includes("duration")) {
          p.item = { ...p.item, durationDays: shared.durationDays };
          p.assumed = p.assumed.filter((f) => f !== "duration");
        }
        if (shared.timing && p.assumed.includes("timing")) {
          p.item = { ...p.item, timing: shared.timing };
          p.assumed = p.assumed.filter((f) => f !== "timing");
        }
      }
      continue;
    }
    const actions = routeUtterance(clause, drugs, state, open);
    if (actions.some((a) => a.kind === "answer")) open = null;
    out.push(...actions);
  }
  return out;
}

/** A clause that is only a length ("for five days", "paanch din") and/or a timing ("after food"). */
function sharedPart(clause: string): { durationDays: number | null; timing: Timing | null; fields: string[] } | null {
  const durationDays = durationIn(clause);
  const timing = timingIn(clause);
  if (!durationDays && !timing) return null;
  const rest = clause
    .replace(/(?:for\s+)?(?:\d{1,3}|[a-z]+)\s*(?:days?|din|d|weeks?|hafte|hafta|months?|mahina|mahine)\b/gi, " ")
    .replace(/\b(?:after|before|with|empty|khane|ke|se|baad|pehle|saath|khaa?li|pet|par|food|meals?|breakfast|lunch|dinner|stomach|both|all|each|for|and|tak)\b/gi, " ");
  if (/[a-z0-9]/i.test(rest)) return null;
  return { durationDays, timing, fields: [...(durationDays ? ["duration"] : []), ...(timing ? ["timing"] : [])] };
}

/**
 * Places one spoken line. A line that starts with a box's name goes to that
 * box; a line that names tests becomes tests; "follow up in N days" sets the
 * follow-up; a pending question takes the words that answer it; everything
 * else is read as medicines. What cannot be placed is said back, not guessed.
 */
export function routeUtterance(said: string, drugs: DrugLike[], state: PadState, pending: Question | null): VoiceAction[] {
  const words = clean(said);
  if (!words) return [];

  if (UNDO.test(words)) return [{ kind: "undo" }];
  if (READ_BACK.test(words)) return [{ kind: "readBack" }];

  if (LEAD.diagnosis.test(words)) return [{ kind: "diagnosis", value: cap(clean(words.replace(LEAD.diagnosis, ""))) }];
  if (LEAD.advice.test(words)) return [{ kind: "advice", value: cap(clean(words.replace(LEAD.advice, ""))) }];
  // "Make it 7 days", "remove that": the medicines last talked about.
  const meant = referred(words, drugs, state);
  if (meant) return meant;
  if (LEAD.remove.test(words)) {
    const name = clean(words.replace(LEAD.remove, ""));
    return name ? [{ kind: "remove", drugName: name }] : [];
  }

  const out: VoiceAction[] = [];
  let rest = words;

  const fu = rest.match(FOLLOW_UP);
  if (fu) {
    out.push({ kind: "followUp", days: daysOf(fu) });
    rest = clean(rest.replace(fu[0], " "));
  }
  // "give him", "start", "make": only the lead into a medicine.
  rest = clean(rest.replace(LEAD_IN, ""));
  if (!rest) return out;

  // A pending question is answered first by words that fit it.
  if (pending && rest) {
    const a = answer(pending, rest);
    // Words that name a medicine are about that medicine: "start metformin 500 twice a day" does not answer "how often is omeprazole?".
    const named = parseDictation(rest, drugs, { guess: false }).proposals.filter((p) => !("drugId" in pending) || p.item.drugId !== pending.drugId);
    if (a && !named.length) return [...out, a];
  }

  const tests = testsIn(rest);
  if (tests.length) {
    out.push({ kind: "tests", values: tests });
    // What is left once the test names are taken out may still be a medicine.
    for (const [re] of TEST_WORDS) rest = rest.replace(new RegExp(re.source, "gi"), " ");
    rest = clean(rest.replace(/\b(?:and|get|done|do|karwao|test|tests)\b/gi, " "));
    if (!/[a-z]{3,}/i.test(rest)) rest = "";
  }

  if (rest) {
    // A name only near what was said is taken only with a strength beside it; "warm saline gargles" is not Warfarin.
    const parsed = parseDictation(rest, drugs, { guess: /\d/.test(rest) });
    const fresh: Proposal[] = [];
    for (const p of parsed.proposals) {
      // Already on the prescription: what was said now changes it, nothing else does.
      const on = state.items.find((it) => it.drugId === p.item.drugId);
      if (!on) {
        fresh.push(p);
        continue;
      }
      const patch: Partial<PrescriptionItem> = {};
      if (!p.assumed.includes("frequency")) patch.frequency = p.item.frequency;
      if (!p.assumed.includes("duration")) patch.durationDays = p.item.durationDays;
      if (!p.assumed.includes("timing")) patch.timing = p.item.timing;
      if (!p.assumed.includes("strength")) patch.strength = p.item.strength;
      out.push({ kind: "change", drugId: on.drugId, drugName: on.drugName, patch });
    }
    if (fresh.length) out.push({ kind: "medicines", proposals: fresh });
    for (const u of parsed.unresolved) {
      if (testsIn(u.source).length) continue;
      const w = clean(u.source.replace(LEAD_IN, ""));
      if (!w) continue;
      // Words with no medicine and no number ("warm saline gargles", "avoid cold drinks") are what the patient is told to do.
      if (!/\d/.test(w) && w.split(/\s+/).length >= 2 && w.split(/\s+/).every((x) => /[aeiouy]/i.test(x))) out.push({ kind: "advice", value: cap(w) });
      else out.push({ kind: "unplaced", words: w });
    }
  }
  return out;
}

const UNDO = /^(?:undo|go back|cancel (?:that|it|the last(?: one)?)|that'?s wrong|wrong|galat|wapas)\b/i;
const READ_BACK = /^(?:read (?:it |that )?(?:back|out)|read the prescription|summary|summarise|summarize|what(?:'s| is| have i| did i)\b.*\b(?:on|written|prescribed|said)|repeat (?:it|that|the prescription)|kya likha)\b/i;
/** Words that point at medicines already talked about. */
const POINTER = /\b(it|that|this|same|both|them|these|those|all of them|the last one|isko|usko|ise|use|dono|sab)\b/i;
const ALL = /\b(both|them|these|those|all of them|dono|sab)\b/i;

/**
 * "Make it 7 days", "both after food", "remove that": words that name no
 * medicine but point at the ones last talked about (`state.focus`) change those.
 */
function referred(words: string, drugs: DrugLike[], state: PadState): VoiceAction[] | null {
  const focus = (state.focus ?? []).map((id) => state.items.find((it) => it.drugId === id)).filter((it): it is PrescriptionItem => !!it);
  if (!focus.length || !POINTER.test(words)) return null;
  // A medicine named outright is that medicine, not "it".
  if (parseDictation(words, drugs, { guess: false }).proposals.length) return null;
  const targets = ALL.test(words) ? focus : [focus[focus.length - 1]];
  if (LEAD.remove.test(words)) return targets.map((t) => ({ kind: "remove" as const, drugName: t.drugName }));
  const patch: Partial<PrescriptionItem> = {};
  const f = frequencyIn(words);
  const d = durationIn(words) ?? (words.match(/\b(\d{1,3})\s*(?:days?|din)\b/) ? Number(RegExp.$1) : null);
  const t = timingIn(words);
  if (f) patch.frequency = normaliseFrequency(f);
  if (d) patch.durationDays = d;
  if (t) patch.timing = t;
  // "Make it 1000": a strength the medicine comes in.
  const said = !d ? words.match(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|g)?\b/i) : null;
  // In milligrams, so "1000" finds "1 g".
  const mg = (v: string, unit = "mg") => Number(v) * (/^g$/i.test(unit) ? 1000 : /^mcg$/i.test(unit) ? 0.001 : 1);
  const n = said ? mg(said[1], said[2]) : null;
  const out = targets.flatMap((x) => {
    const p = { ...patch };
    const strength = n
      ? drugs.find((dr) => dr.id === x.drugId)?.strengths.find((st) => {
          const m = st.match(/^(\d+(?:\.\d+)?)\s*(mg|mcg|g)\b/i);
          return !!m && mg(m[1], m[2]) === n;
        })
      : undefined;
    if (strength) p.strength = strength;
    return Object.keys(p).length ? [{ kind: "change" as const, drugId: x.drugId, drugName: x.drugName, patch: p }] : [];
  });
  return out.length ? out : null;
}

/** How often, said plainly. */
export function sayFrequency(f: string): string {
  const plain: Record<string, string> = {
    "1-0-0": "once a day, morning", "0-1-0": "once a day, afternoon", "0-0-1": "once a day, night",
    "1-0-1": "twice a day", "1-1-1": "three times a day", "1-1-1-1": "four times a day", SOS: "when needed", STAT: "at once",
  };
  return plain[f] ?? f;
}

/** A medicine line, said plainly: "Azithromycin 500 mg, once a day, morning, for 3 days, after food". */
export function sayLine(it: Pick<PrescriptionItem, "drugName" | "strength" | "frequency" | "durationDays" | "timing">): string {
  const when: Record<string, string> = { after_food: "after food", before_food: "before food", with_food: "with food", empty_stomach: "on an empty stomach" };
  return [`${it.drugName}${it.strength ? ` ${it.strength}` : ""}`, sayFrequency(it.frequency), `for ${it.durationDays} day${it.durationDays === 1 ? "" : "s"}`, when[it.timing ?? ""] ?? ""].filter(Boolean).join(", ");
}

/** The prescription as it stands, said back. */
export function sayPrescription(p: { diagnosis: string; items: PrescriptionItem[]; tests: string[]; advice: string; followUp: string }): string {
  const parts: string[] = [];
  parts.push(p.diagnosis.trim() ? `Diagnosis: ${p.diagnosis.trim()}.` : "No diagnosis yet.");
  if (p.items.length) parts.push(...p.items.map((it, i) => `${i + 1}. ${sayLine(it)}.`));
  else parts.push("No medicines yet.");
  if (p.tests.length) parts.push(`Tests: ${p.tests.join(", ")}.`);
  if (p.advice.trim()) parts.push(`Advice: ${p.advice.trim().replace(/\n+/g, "; ")}.`);
  if (p.followUp) parts.push(`Follow-up in ${p.followUp} days.`);
  return parts.join(" ");
}

/** A medicine line as the voice made it, with its count worked out. */
export function lineFromProposal(p: Proposal): PrescriptionItem {
  const q = suggestedQuantity(p.item.frequency, p.item.durationDays, p.item.everyDays ?? 1);
  return q !== null ? { ...p.item, quantity: q } : p.item;
}

/** Whether a medicine line matches the words of a "remove" ("remove paracetamol", "remove the last one"). */
export function matchesRemoval(item: PrescriptionItem, words: string): boolean {
  const w = words.toLowerCase();
  return !!w && (item.drugName.toLowerCase().includes(w) || w.includes(item.drugName.toLowerCase().split(" ")[0]));
}

