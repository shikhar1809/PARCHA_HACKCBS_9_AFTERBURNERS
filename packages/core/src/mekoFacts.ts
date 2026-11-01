/**
 * Turning what happened on the pad into something Meko can remember.
 *
 * Three kinds of fact, and all three are patterns rather than events:
 *
 *   habit     "d:7a3f writes paracetamol-650 1-0-1 for 3 days after-food for viral fever"
 *   naming    "c:91ab says 'dolo' for paracetamol-650"
 *   placement "'patient has' at the start of a line is a diagnosis"
 *
 * None of them carries a patient, a date or a visit. That is checked again by
 * deidentify.ts before anything is sent, and a third time on the server.
 *
 * The text is deliberately stable: the same habit written twice produces the
 * same sentence, so Meko accumulates one memory rather than a pile of
 * near-duplicates that dilute the search.
 */

import { deidentify } from "./deidentify.js";
import { clinicTag, doctorTag, type MekoFact, type MekoScope } from "./mekoScope.js";
import type { PrescriptionItem } from "./types.js";

/** Bumped when the sentence format changes, so old and new rows stay tellable apart. */
export const FACT_VERSION = "1";

const slug = (s: string) =>
  s
    .toLowerCase()
    // Underscores and spaces both become dashes: "after_food" reads as "after-food",
    // not "afterfood", so a human skimming Meko's portal can still read the row.
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

/** A medicine as a fact names it: generic plus strength, no brand, no form. */
const drugToken = (item: Pick<PrescriptionItem, "drugName" | "strength">) =>
  slug(`${item.drugName}${item.strength ? `-${item.strength.replace(/\s+/g, "")}` : ""}`);

const meta = (kind: MekoFact["kind"], scope: MekoScope): MekoFact["metadata"] => ({
  doctorKey: scope.doctorKey,
  clinicKey: scope.clinicKey,
  kind,
  parchaVersion: FACT_VERSION,
});

/**
 * One fact per signed line: how this doctor writes this medicine, and for what.
 *
 * The diagnosis is included because a habit is conditional — the same doctor
 * writes paracetamol differently for fever than for pain — but it is slugged
 * to a short phrase, never the free text as typed.
 */
export function habitFacts(
  rx: { diagnosis: string; items: PrescriptionItem[] },
  scope: MekoScope,
): MekoFact[] {
  const dx = slug(rx.diagnosis).slice(0, 40);
  return rx.items
    .filter((it) => it.drugId && !it.drugId.startsWith("unlisted:"))
    .map((it) => {
      const when = it.timing ? ` ${slug(it.timing)}` : "";
      const forDx = dx ? ` for ${dx}` : "";
      return {
        kind: "habit" as const,
        agent: "habit" as const,
        text: `${doctorTag(scope.doctorKey)} writes ${drugToken(it)} ${it.frequency} for ${it.durationDays} days${when}${forDx}`,
        metadata: meta("habit", scope),
      };
    });
}

/** What this clinic calls a medicine: "dolo" heard, paracetamol-650 meant. */
export function namingFact(
  heard: string,
  item: Pick<PrescriptionItem, "drugName" | "strength">,
  scope: MekoScope,
): MekoFact | null {
  const said = slug(heard);
  if (!said || said.length < 2) return null;
  return {
    kind: "naming",
    agent: "formulary",
    text: `${clinicTag(scope.clinicKey)} says '${said}' for ${drugToken(item)}`,
    metadata: meta("naming", scope),
  };
}

/** Where a turn of phrase belongs, learned from a correction the doctor made. */
export function placementFact(words: string, box: string, scope: MekoScope): MekoFact | null {
  const phrase = words.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
  if (!phrase || !/[a-z]/.test(phrase)) return null;
  return {
    kind: "placement",
    agent: "scribe",
    text: `${clinicTag(scope.clinicKey)} '${phrase}' is ${slug(box)}`,
    metadata: meta("placement", scope),
  };
}

/**
 * The last gate before anything leaves: every fact must survive deidentify().
 *
 * Facts are built from structured fields, so a hit here means something
 * upstream leaked free text into one — which is exactly the bug worth
 * catching. The offending fact is dropped, the rest go.
 */
export function sendableFacts(facts: MekoFact[], known: Parameters<typeof deidentify>[1] = {}): {
  send: MekoFact[];
  refused: { fact: MekoFact; reason: string }[];
} {
  const send: MekoFact[] = [];
  const refused: { fact: MekoFact; reason: string }[] = [];
  for (const fact of facts) {
    const r = deidentify(fact.text, known);
    if (r.ok) send.push(fact);
    else refused.push({ fact, reason: r.reason });
  }
  return { send, refused };
}
