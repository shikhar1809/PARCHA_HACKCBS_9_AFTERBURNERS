/**
 * The closed world: nothing new is ever suggested.
 *
 * A model asked about medicines will produce a plausible drug this clinic does
 * not stock, at a strength that does not exist. In an OPD signing sixty
 * prescriptions before lunch that is the most dangerous thing this feature
 * could do, so it is forbidden structurally rather than by prompting.
 *
 * Everything offered must already exist: in the clinic's formulary, in
 * COMMON_TESTS, in the frequency vocabulary, or in the doctor's own words.
 * The agent recalls and re-applies. It never invents.
 *
 * This file is two of the four layers that enforce that (the others are the
 * enum-only tool schemas built here, and the formulary re-check that
 * signPrescription already does on the server):
 *
 *   agentTools(drugs)   the menu the model picks from — no free-text field
 *   grounded(a, drugs)  every identifier must resolve, or the action is dropped
 *
 * And one rule above both: the deterministic parser in voice.ts wins every
 * conflict. The model may only fill a box the rules left empty.
 */

import { normaliseFrequency } from "./items.js";
import { COMMON_TESTS, UNLISTED_PREFIX } from "./special.js";
import { TIMINGS, type Drug } from "./types.js";
import type { VoiceAction } from "./voice.js";

/** A tool as an OpenAI-compatible function definition (Ollama, vLLM and llama.cpp all take this). */
export type Tool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

/** The longest course the model may propose. Anything longer is a human decision. */
export const MAX_DURATION_DAYS = 90;
/** The longest follow-up the model may propose. */
export const MAX_FOLLOW_UP_DAYS = 180;

/** The frequencies a model may choose. Everything the pad can draw, and nothing else. */
export const FREQUENCIES = ["1-0-0", "0-1-0", "0-0-1", "1-0-1", "1-1-1", "1-1-1-1", "SOS", "STAT"];

/**
 * The menu, built fresh from the drugs this clinic actually has.
 *
 * There is no field anywhere in these schemas that takes prose. A drug is an
 * index into the formulary; a test is one of COMMON_TESTS; diagnosis and
 * advice are a *quote from the transcript*, never words the model composes.
 * A hallucinated medicine has nowhere to go.
 */
export function agentTools(drugs: Drug[]): Tool[] {
  const ids = drugs.map((d) => d.id);
  const strengths = [...new Set(drugs.flatMap((d) => d.strengths))];
  return [
    {
      type: "function",
      function: {
        name: "place_medicine",
        description:
          "Record a medicine the doctor asked for. Only use a drugId from the enum: if what the doctor said is not in the list, do not call this tool.",
        parameters: {
          type: "object",
          properties: {
            drugId: { type: "string", enum: ids },
            strength: { type: "string", enum: strengths },
            frequency: { type: "string", enum: FREQUENCIES },
            durationDays: { type: "integer", minimum: 1, maximum: MAX_DURATION_DAYS },
            timing: { type: "string", enum: [...TIMINGS] },
          },
          required: ["drugId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "place_test",
        description: "Record a test the doctor asked for.",
        parameters: {
          type: "object",
          properties: { test: { type: "string", enum: [...COMMON_TESTS] } },
          required: ["test"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "place_text",
        description:
          "Say which box a phrase the doctor SAID belongs in. `quote` must be copied word for word from the transcript. Never write your own words.",
        parameters: {
          type: "object",
          properties: {
            box: { type: "string", enum: ["diagnosis", "advice"] },
            quote: { type: "string" },
          },
          required: ["box", "quote"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_follow_up",
        description: "Record when the patient should come back.",
        parameters: {
          type: "object",
          properties: { days: { type: "integer", minimum: 1, maximum: MAX_FOLLOW_UP_DAYS } },
          required: ["days"],
        },
      },
    },
  ];
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/**
 * Whether every identifier in this action already exists in the clinic's data.
 *
 * Anything that fails is dropped and the clause falls back to "unplaced",
 * which the doctor hears said back — exactly as today when the rules cannot
 * place something. Silence is never an option; a wrong medicine is.
 */
export function grounded(a: VoiceAction, drugs: Drug[]): boolean {
  switch (a.kind) {
    case "medicines":
      return a.proposals.every((p) => {
        const item = p.item;
        // A medicine written by hand is a human-only act; a model may never create one.
        if (!item.drugId || item.drugId.startsWith(UNLISTED_PREFIX)) return false;
        const drug = drugs.find((d) => d.id === item.drugId);
        if (!drug) return false;
        if (item.strength && !drug.strengths.includes(item.strength)) return false;
        if (item.frequency && !FREQUENCIES.includes(normaliseFrequency(item.frequency))) return false;
        if (!isInt(item.durationDays) || item.durationDays < 1 || item.durationDays > MAX_DURATION_DAYS) return false;
        if (item.timing && !TIMINGS.includes(item.timing)) return false;
        return true;
      });
    case "change": {
      const drug = drugs.find((d) => d.id === a.drugId);
      if (!drug) return false;
      const p = a.patch;
      if (p.strength !== undefined && !drug.strengths.includes(p.strength)) return false;
      if (p.frequency !== undefined && !FREQUENCIES.includes(normaliseFrequency(p.frequency))) return false;
      if (p.durationDays !== undefined && (!isInt(p.durationDays) || p.durationDays < 1 || p.durationDays > MAX_DURATION_DAYS)) return false;
      if (p.timing !== undefined && !TIMINGS.includes(p.timing)) return false;
      return true;
    }
    case "tests":
      return a.values.length > 0 && a.values.every((t) => COMMON_TESTS.includes(t));
    case "followUp":
      return isInt(a.days) && a.days >= 1 && a.days <= MAX_FOLLOW_UP_DAYS;
    case "diagnosis":
    case "advice":
      // Checked against the transcript by `quoted()`; a bare value is not groundable here.
      return typeof a.value === "string" && a.value.trim().length > 0;
    case "remove":
      return typeof a.drugName === "string" && a.drugName.trim().length > 0;
    // The model is never allowed to produce these: they are the doctor's own controls.
    case "undo":
    case "readBack":
    case "answer":
      return false;
    case "unplaced":
      return true;
    default:
      return false;
  }
}

/**
 * Whether a phrase really was said.
 *
 * Small models are poor at character offsets, so the model returns the words
 * and we find them here rather than trusting an index. Matching is done on
 * letters and digits only, so punctuation and spacing the model normalised
 * away do not cause a false refusal — but the words themselves must be the
 * doctor's.
 */
export function quoted(quote: string, transcript: string): boolean {
  const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const q = bare(quote);
  return q.length >= 3 && bare(transcript).includes(q);
}

/** What the merge threw away, for the log and the swarm board. */
export type Rejected = { action: VoiceAction; reason: string };

export type Merged = {
  actions: VoiceAction[];
  /** Per index into `actions`: where it came from, and on what recall. */
  provenance: Record<number, { from: "rules" | "agent"; memoryIds: string[] }>;
  rejected: Rejected[];
};

/** Which box an action fills, for deciding whether the rules already filled it. */
function slot(a: VoiceAction): string | null {
  switch (a.kind) {
    case "diagnosis":
      return "diagnosis";
    case "advice":
      return "advice";
    case "followUp":
      return "followUp";
    case "tests":
      return "tests";
    case "medicines":
      return "medicines";
    default:
      return null;
  }
}

/**
 * Merges the model's actions into the rules', under three laws:
 *
 *   1. the rules win every conflict — the model may only fill an empty box
 *   2. every model action must pass `grounded()`, or it is dropped
 *   3. diagnosis and advice must be words the doctor actually said
 *
 * `rules` is passed through untouched, so with no model (or a failing one)
 * this function is the identity and the pad behaves exactly as it does today.
 */
export function mergeAgentActions(
  rules: VoiceAction[],
  model: VoiceAction[],
  drugs: Drug[],
  transcript = "",
  memoryIds: string[] = [],
): Merged {
  const actions: VoiceAction[] = [...rules];
  const provenance: Record<number, { from: "rules" | "agent"; memoryIds: string[] }> = {};
  rules.forEach((_, i) => (provenance[i] = { from: "rules", memoryIds: [] }));
  const rejected: Rejected[] = [];

  // A box the rules filled is settled; the model does not get a second opinion on it.
  const taken = new Set(rules.map(slot).filter((s): s is string => s !== null));

  for (const a of model) {
    if (!grounded(a, drugs)) {
      rejected.push({ action: a, reason: `ungrounded: ${a.kind}` });
      continue;
    }
    if ((a.kind === "diagnosis" || a.kind === "advice") && !quoted(a.value, transcript)) {
      rejected.push({ action: a, reason: "not said by the doctor" });
      continue;
    }
    const s = slot(a);
    if (s && taken.has(s)) {
      rejected.push({ action: a, reason: `the rules already placed ${s}` });
      continue;
    }
    if (s) taken.add(s);
    provenance[actions.length] = { from: "agent", memoryIds };
    actions.push(a);
  }

  return { actions, provenance, rejected };
}
