/**
 * The voice agent's loop, and its floor.
 *
 * Every utterance goes through the deterministic parser in @parcha/core
 * (voice.ts) first, exactly as it does today. Only what that parser could not
 * place — plus a request to recall what this doctor usually does — ever
 * reaches the model or Meko, and whatever comes back must survive the
 * closed-world gate in voiceAgent.ts before it can touch the pad.
 *
 * That ordering is the whole safety argument:
 *   - the rules win every conflict, so a model cannot overwrite a placement
 *   - nothing ungrounded survives the merge, so a model cannot invent
 *   - every failure path returns the rules' own actions, so the pad can never
 *     be worse than it is today
 *
 * This is Phase 0: the shape, the switch and the fallback, with recall and the
 * model not yet wired. `runAgent` is already the single call site Pad.tsx
 * uses, so later phases light up the middle without touching the pad again.
 */
import { mergeAgentActions, routeSpeech, type DrugLike, type PadState, type Question, type VoiceAction } from "@parcha/core";

/** Why the agent is not doing its full job, for the strip above the mic. */
export type Degraded = null | "off" | "no-meko" | "no-model" | "both";

/** A memory the agent recalled, as the Recall strip shows it. */
export type Recalled = {
  memoryId: string;
  agent: "habit" | "formulary" | "scribe";
  text: string;
  score: number;
};

export type AgentContext = {
  drugs: DrugLike[];
  padState: PadState;
  question: Question | null;
  /** False when the clinic has not turned learning on, or ?meko=off. */
  mekoEnabled: boolean;
  /** The patient's name and phone, so the privacy gate can catch an exact match. */
  known?: { patientName?: string | null; phone?: string | null };
};

export type AgentResult = {
  actions: VoiceAction[];
  recalled: Recalled[];
  degraded: Degraded;
  /** What the gate threw away. Shown on the swarm board, never on the pad. */
  rejected: { action: VoiceAction; reason: string }[];
};

/**
 * Places one utterance.
 *
 * Phases 1-3 add recall and the model between the two steps below. Until then
 * this returns precisely what the pad does today, which is what makes Phase 0
 * shippable on its own and the honest control arm for the Meko-on comparison.
 */
export async function runAgent(words: string, ctx: AgentContext): Promise<AgentResult> {
  const rules = routeSpeech(words, ctx.drugs, ctx.padState, ctx.question);

  if (!ctx.mekoEnabled) {
    return { actions: rules, recalled: [], degraded: "off", rejected: [] };
  }

  // Phase 1 puts mekoRecall here, Phase 3 the local model. Both are allowed to
  // fail: the merge below is the identity when the model returns nothing, so
  // the pad falls back to the rules without a branch.
  const model: VoiceAction[] = [];
  const recalled: Recalled[] = [];

  const merged = mergeAgentActions(rules, model, ctx.drugs as never, words, recalled.map((r) => r.memoryId));
  return {
    actions: merged.actions,
    recalled,
    degraded: "both",
    rejected: merged.rejected,
  };
}

/**
 * Warms the slow paths while the doctor is still reading the patient's file.
 *
 * A cold Cloud Function costs 2-5 s before our code runs, which would blow the
 * recall budget on the first consultation of every morning — the exact moment
 * a doctor decides whether this feature works. Fire-and-forget: it never
 * blocks render and its failure is never shown.
 */
export function warmUp(_ctx: { mekoEnabled: boolean }): void {
  // Phase 1: void mekoRecall("", [], { warm: true }).catch(() => {});
  // Phase 3: void llm.available();
}
