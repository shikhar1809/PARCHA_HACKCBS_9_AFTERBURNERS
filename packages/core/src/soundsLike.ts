/**
 * Medicine names as they were meant, not as speech spelled them.
 *
 * A speech engine writes what it hears in ordinary English: "Syprophloxysin
 * 500", "Parasetamal 650", "M load a bin 5". Each medicine on the clinic's list
 * is compared with the words by how they sound (letters that sound alike made
 * the same: ph and f, c and s or k, x and ks, y and i, b and p, d and t), and a
 * run of up to four words that sounds like one medicine is replaced by its
 * name. Nothing else is touched, and only names on the list are ever written,
 * so the pad still shows exactly which medicine it took the words to be.
 */
import type { DrugLike } from "./dictation.js";

/** Words that are part of how a line is said, never a piece of a medicine's name. */
const KEEP = new Set(
  "diagnosis advice follow review after before food meal meals empty stomach days day weeks week months month twice thrice once daily when needed morning night evening afternoon tablet tablets capsule syrup injection drops cream ointment and for with then also give start stop continue take test tests routine profile blood urine infection fever pain".split(" "),
);

/** A number said as a word, for "make paracetamol five days". */
const NUMBER = /^(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|fifteen|twenty|thirty|ek|do|teen|char|paanch|panch|saat|das)$/i;

/** How a word sounds, written so that sound-alike spellings come out the same. */
export function soundKey(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/[gk]h/g, "k")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/[cq]/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/y/g, "i")
    .replace(/(.)\1+/g, "$1");
}

/** Its consonants only, with voiced and unvoiced pairs made one (b/p, d/t, g/k, v/f). */
const skeleton = (key: string) => key.replace(/[aeiouh]/g, "").replace(/b/g, "p").replace(/d/g, "t").replace(/g/g, "k").replace(/v/g, "f").replace(/(.)\1+/g, "$1");

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/** The same, with two letters heard the wrong way round counted as one slip ("overstat" for "orvastat"). */
function slips(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

type Name = { name: string; key: string; bones: string };

function namesOf(drugs: DrugLike[]): Name[] {
  const out: Name[] = [];
  const seen = new Set<string>();
  for (const d of drugs) {
    // Each ingredient of a combination, and each brand, is a name a doctor says.
    for (const raw of [...d.genericName.split(/\s*\+\s*|\s*\(/), ...d.commonBrands]) {
      const name = raw.replace(/\)/g, "").trim().split(/\s+/)[0];
      const key = soundKey(name);
      if (key.length < 5 || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, key, bones: skeleton(key) });
    }
  }
  return out;
}

/** How near words sound to a name, 0 the same, lower is nearer; null if not near enough. */
function nearness(said: string, n: Name): number | null {
  const key = soundKey(said);
  if (key.length < 4) return null;
  const d = Math.min(distance(key, n.key), slips(key, n.key)) / n.key.length;
  if (d <= 0.34) return d;
  // Vowels heard wrong but the consonants right ("loadapine" for amlodipine).
  const b = skeleton(key);
  if (n.bones.length >= 4 && b === n.bones && d <= 0.6) return d + 0.2;
  if (n.bones.length >= 4 && distance(b, n.bones) <= 1 && d <= 0.45) return d + 0.3;
  return null;
}

/**
 * Rewrites the medicine names in what was said. Returns the new words and
 * each change made, as [what was heard, the name it became].
 */
export function spellMedicines(said: string, drugs: DrugLike[]): { text: string; changed: [string, string][] } {
  const names = namesOf(drugs);
  const exact = new Set(names.map((n) => n.key));
  // Strengths on the list, to unstick "650 3 times" heard as "653 times".
  const strengths = new Set(drugs.flatMap((d) => d.strengths.map((st) => (st.match(/^\d+(?:\.\d+)?/) ?? [""])[0])).filter(Boolean));
  // "5OD" is "5 OD"; "Load-A-Bin" is three words.
  const tokens = said
    .replace(/(\d)(od|bd|tds|tid|qid|hs|sos)\b/gi, "$1 $2")
    // "650 three times" heard as "653 times" (or "6503 times").
    .replace(/\b(\d{1,4})([2-4])\s+times\b/gi, (all, n: string, k: string) =>
      strengths.has(n + k) ? all : strengths.has(n) ? `${n} ${k} times` : strengths.has(`${n}0`) ? `${n}0 ${k} times` : all,
    )
    .replace(/(?<=[a-z])-(?=[a-z])/gi, " ")
    .split(/\s+/)
    .filter(Boolean);

  hindi(tokens);
  const out: string[] = [];
  const changed: [string, string][] = [];
  for (let i = 0; i < tokens.length; ) {
    let best: { n: Name; len: number; score: number } | null = null;
    for (let len = 1; len <= 4 && i + len <= tokens.length; len++) {
      const run = tokens.slice(i, i + len);
      const words = run.map((t) => t.replace(/[^a-z]/gi, ""));
      // Only letters, and none of the words that carry the rest of the line.
      if (words.some((w, k) => !w || w.length !== run[k].replace(/[.,;:!?]$/, "").length || KEEP.has(w.toLowerCase()))) break;
      if (exact.has(soundKey(words[len - 1])) || /^(od|bd|tds|tid|qid|hs|sos|stat|mg|ml)$/i.test(words[len - 1])) break;
      // Never across a full stop or comma.
      if (len > 1 && /[.,;:!?]$/.test(run[len - 2])) break;
      // A medicine is said with its strength, or after "stop", "remove", "make": only such words ("Syprophloxysin 500",
      // "as it throw mice in 500", "stop the IB profin") are read as one, so "saline gargles" or "has viral fever" stay as said.
      const led = /^(?:stop|remove|discontinue|delete|make|change|continue|hatao)$/i.test(tokens[i - 1] ?? "") || (/^the$/i.test(tokens[i - 1] ?? "") && /^(?:stop|remove|discontinue|delete|make|change|continue)$/i.test(tokens[i - 2] ?? ""));
      if (/[.,;:!?]$/.test(run[len - 1]) && !led) continue;
      const ahead: string[] = [];
      for (const t of tokens.slice(i + len, i + len + 2)) {
        ahead.push(t);
        if (/[.,;:!?]$/.test(t)) break;
      }
      const counted = ahead.some((t) => /^\d/.test(t) || NUMBER.test(t.replace(/[.,;:!?]$/, "")));
      if (!counted && !led) continue;
      for (const n of names) {
        const s = nearness(words.join(""), n);
        if (s !== null && (!best || s < best.score - 0.001 || (Math.abs(s - best.score) < 0.001 && len > best.len))) best = { n, len, score: s };
      }
    }
    if (best) {
      const heard = tokens.slice(i, i + best.len).join(" ");
      const trail = /[.,;:!?]$/.exec(heard)?.[0] ?? "";
      out.push(best.n.name + trail);
      if (soundKey(heard) !== best.n.key) changed.push([heard.replace(/[.,;:!?]$/, ""), best.n.name]);
      i += best.len;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  return { text: out.join(" "), changed };
}

/** How the Hindi parts of a line are said; English speech engines write them as English ("rathko", "kali bet"). */
const HINDI = ["raat ko", "subah", "shaam", "khaali pet", "khane ke baad", "khane se pehle", "do din", "teen din", "chaar din", "paanch din", "saat din", "das din", "pandrah din"].map((p) => ({ p, key: soundKey(p) }));

/** Puts the Hindi words back in place, in `tokens`. */
function hindi(tokens: string[]): void {
  for (let i = 0; i < tokens.length; i++) {
    for (let len = 3; len >= 1; len--) {
      if (i + len > tokens.length) continue;
      const run = tokens.slice(i, i + len);
      if (run.slice(0, -1).some((t) => /[.,;:!?]$/.test(t)) || run.some((t) => /\d/.test(t))) continue;
      const key = soundKey(run.join(""));
      if (key.length < 5) continue;
      const hit = HINDI.find((h) => Math.min(distance(key, h.key), slips(key, h.key)) / h.key.length <= 0.2);
      if (!hit) continue;
      const trail = /[.,;:!?]$/.exec(run[len - 1])?.[0] ?? "";
      tokens.splice(i, len, ...(hit.p + trail).split(" "));
      i += hit.p.split(" ").length - 1;
      break;
    }
  }
}
