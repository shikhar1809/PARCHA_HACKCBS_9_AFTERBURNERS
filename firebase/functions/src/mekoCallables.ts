/**
 * What the clinic app may ask of Meko, and nothing more.
 *
 * Each callable follows the house shape — check who is calling and at which
 * counter, then do the work — with one addition that matters more than the
 * rest: **every payload is de-identified again here**. The browser runs the
 * same gate before sending, but that copy only saves a round trip. This one
 * is the boundary, and it rejects rather than scrubs, in the same spirit as
 * signPrescription re-checking every line against the formulary "because the
 * list arrives from a browser".
 *
 * Nothing here is on the signing path. A Meko outage degrades learning and
 * can never block, delay or fail a prescription.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { deidentify } from "../../../packages/core/src/deidentify.js";
import { MEKO_AGENTS, scopeKeys, type MekoAgent, type MekoFact } from "../../../packages/core/src/mekoScope.js";
import { assertAbility, audit, db, once, rateLimit, requireRecentSignIn } from "./guards.js";
import { MEKO_API_KEY, MEKO_SCOPE_SALT, MekoError, rest, timed, tool } from "./meko.js";
import { liveCounter } from "./session.js";

const SECRETS = [MEKO_API_KEY, MEKO_SCOPE_SALT];

/** A hit as the Recall strip shows it. */
type Hit = { agent: MekoAgent; memoryId: string; text: string; score: number; rawScore: number };

const isAgent = (v: unknown): v is MekoAgent => typeof v === "string" && (MEKO_AGENTS as string[]).includes(v);

/** This clinic's datapack id for one agent, or null when the clinic was never bootstrapped. */
async function datapackFor(hospitalId: string, agent: MekoAgent): Promise<string | null> {
  const snap = await db().collection("hospitals").doc(hospitalId).get();
  const packs = snap.data()?.mekoDatapacks as Record<string, string> | undefined;
  return packs?.[agent] ?? null;
}

/**
 * The gate. Throws rather than cleaning up, and names only the category of
 * what it found — never the text, which would put the identifier in an error
 * message and then in a log.
 */
function gate(text: string): string {
  const r = deidentify(text);
  if (!r.ok) {
    throw new HttpsError("invalid-argument", `That could identify a patient, so it was not sent (${r.found.join(", ")}).`);
  }
  return r.text;
}

/**
 * Recall before reasoning. Called once per utterance, before the local model.
 *
 * `minInstances: 1` is the one exception to options.ts's no-warm-instances
 * rule. This is the only callable a person waits on mid-sentence; everything
 * else in Parcha is a write the doctor has already committed to. A cold
 * gcf_gen1 start is 2-5 s, which would blow the recall budget on the first
 * consultation of every morning — the exact moment a doctor decides whether
 * this feature works.
 */
export const mekoRecall = onCall({ secrets: SECRETS, minInstances: 1 }, async (request) => {
  const caller = await liveCounter(request, "doctor");
  assertAbility(caller, "consult");
  const data = request.data ?? {};

  // A warm-up touches auth and the MCP session and returns. No tool call, no
  // quota spent, no log row: it exists only to pay the cold start early.
  if (data.warm === true) {
    await tool("datapack_list", { limit: 1 }).catch(() => undefined);
    return { hits: [], degraded: false };
  }

  await rateLimit(`meko:recall:${caller.uid}`, 400, 3600);
  const query = gate(typeof data.query === "string" ? data.query.slice(0, 500) : "");
  const agents = (Array.isArray(data.agents) ? data.agents : []).filter(isAgent);
  if (!query || !agents.length) return { hits: [], degraded: false };

  const scope = scopeKeys(caller.hospitalId, caller.uid, MEKO_SCOPE_SALT.value());
  const hits: Hit[] = [];
  let degraded = false;

  for (const agent of agents) {
    const datapackId = await datapackFor(caller.hospitalId, agent);
    if (!datapackId) {
      degraded = true;
      continue;
    }
    try {
      const out = await timed(
        { hospitalId: caller.hospitalId, agent, tool: "memory_search", kind: "recall", summary: `recall for ${agent}` },
        () =>
          tool<{ results?: { id?: string; memory_id?: string; text?: string; memory?: string; score?: number; raw_similarity_score?: number; metadata?: Record<string, unknown> }[] }>(
            "memory_search",
            { query: `d:${scope.doctorKey} ${query}`, datapack_id: datapackId, agent_id: agent, limit: 5 },
          ),
      );
      for (const r of out?.results ?? []) {
        // Meko's search ranks, it does not filter. Scope is enforced here, on
        // our own metadata, and never trusted to the hybrid scorer.
        const m = r.metadata ?? {};
        const mine = m.doctorKey === scope.doctorKey;
        const canon = m.clinicKey === scope.clinicKey && m.promoted === true;
        if (!mine && !canon) continue;
        const text = r.text ?? r.memory ?? "";
        const memoryId = r.id ?? r.memory_id ?? "";
        if (!text || !memoryId) continue;
        hits.push({ agent, memoryId, text, score: r.score ?? 0, rawScore: r.raw_similarity_score ?? 0 });
      }
    } catch {
      // The pad falls back to its rules. A failed recall is never an error a
      // doctor has to read mid-consultation.
      degraded = true;
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, 8), degraded };
});

/** Learn. Called after a successful sign, and on an explicit correction. */
export const mekoRemember = onCall({ secrets: SECRETS }, async (request) =>
  once(request, async () => {
    const caller = await liveCounter(request, "doctor");
    assertAbility(caller, "consult");
    await rateLimit(`meko:remember:${caller.uid}`, 200, 3600);

    const raw = Array.isArray(request.data?.facts) ? (request.data.facts as MekoFact[]) : [];
    if (raw.length > 30) throw new HttpsError("invalid-argument", "Too many facts in one call.");

    const scope = scopeKeys(caller.hospitalId, caller.uid, MEKO_SCOPE_SALT.value());
    const memoryIds: string[] = [];

    for (const fact of raw) {
      if (!isAgent(fact?.agent) || typeof fact?.text !== "string") continue;
      const text = gate(fact.text.slice(0, 500));
      const datapackId = await datapackFor(caller.hospitalId, fact.agent);
      if (!datapackId) continue;
      try {
        const out = await timed(
          { hospitalId: caller.hospitalId, agent: fact.agent, tool: "memory_add", kind: "write", summary: `learned a ${fact.kind}` },
          () =>
            tool<{ memory_id?: string; id?: string }>("memory_add", {
              text,
              datapack_id: datapackId,
              agent_id: fact.agent,
              // Scope travels in metadata, which is what recall filters on.
              metadata: { ...fact.metadata, doctorKey: scope.doctorKey, clinicKey: scope.clinicKey },
            }),
        );
        const id = out?.memory_id ?? out?.id;
        if (id) memoryIds.push(id);
      } catch {
        // Learning is best-effort by design: the record is the signed
        // prescription, which has already been written.
      }
    }
    return { stored: memoryIds.length, memoryIds };
  }),
);

/** The doctor's "Forget" button on a recall chip. Their context, theirs to remove. */
export const mekoForget = onCall({ secrets: SECRETS }, async (request) => {
  const caller = await liveCounter(request, "doctor");
  assertAbility(caller, "consult");
  const memoryId = String(request.data?.memoryId ?? "");
  const agent = request.data?.agent;
  if (!memoryId || !isAgent(agent)) throw new HttpsError("invalid-argument", "Which memory?");
  const datapackId = await datapackFor(caller.hospitalId, agent);
  if (!datapackId) return { ok: true };
  await timed(
    { hospitalId: caller.hospitalId, agent, tool: "memory_delete_by_id", kind: "write", summary: "forgot a memory" },
    () => tool("memory_delete_by_id", { memory_id: memoryId, datapack_id: datapackId, agent_id: agent }),
  ).catch(() => undefined);
  return { ok: true };
});

/** The review queue, for a doctor who may promote. */
export const mekoReview = onCall({ secrets: SECRETS }, async (request) => {
  const caller = await liveCounter(request, "doctor");
  assertAbility(caller, "manage");
  const snap = await db()
    .collection("mekoNominations")
    .where("hospitalId", "==", caller.hospitalId)
    .where("state", "==", "pending")
    .limit(50)
    .get();
  return { nominations: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
});

/**
 * The human decision, and the only way anything becomes clinic canon.
 *
 * Promotion is irreversible in Meko, so it takes the same bar as a signature:
 * the Manage ability and a password typed in the last five minutes. Every
 * decision writes an audit row.
 */
export const mekoPromote = onCall({ secrets: SECRETS }, async (request) => {
  const caller = await liveCounter(request, "doctor");
  assertAbility(caller, "manage");
  requireRecentSignIn(request);

  const ids = Array.isArray(request.data?.memoryIds) ? (request.data.memoryIds as string[]).slice(0, 50) : [];
  const decision = request.data?.decision === "keep" ? "keep" : "promote";
  if (!ids.length) throw new HttpsError("invalid-argument", "Nothing to decide on.");

  const agent = isAgent(request.data?.agent) ? request.data.agent : "habit";
  const datapackId = await datapackFor(caller.hospitalId, agent);
  if (!datapackId) throw new HttpsError("failed-precondition", "This clinic is not set up for learning yet.");

  if (decision === "promote") {
    await timed(
      { hospitalId: caller.hospitalId, agent, tool: "memory_promote", kind: "promote", summary: `promoted ${ids.length} to clinic canon` },
      () => rest("POST", "/promote-memories", { datapack_id: datapackId, memory_ids: ids }),
    );
  } else {
    await rest("POST", "/keep-as-memory", { datapack_id: datapackId, memory_ids: ids }).catch(() => undefined);
  }

  const batch = db().batch();
  for (const id of ids) {
    const q = await db().collection("mekoNominations").where("memoryId", "==", id).limit(1).get();
    if (!q.empty) batch.update(q.docs[0].ref, { state: decision === "promote" ? "promoted" : "kept", decidedBy: caller.uid, decidedAt: new Date() });
  }
  await batch.commit();
  await audit(caller, "meko.promote", { decision, memoryIds: ids });
  return { ok: true, decision, count: ids.length };
});

/**
 * The Curator: a scheduled function, deliberately not an agent.
 *
 * Ranking memories by how often a pattern recurs is a query, not a
 * conversation — it has nothing to remember and nothing to learn, so it gets
 * no datapack and no node of its own on the board. It nominates; it never
 * promotes. Only a human does that.
 */
export const mekoCurate = onSchedule(
  { schedule: "0 2 * * *", timeZone: "Asia/Kolkata", secrets: SECRETS },
  async () => {
    const clinics = await db().collection("hospitals").where("mekoEnabled", "==", true).get();
    for (const clinic of clinics.docs) {
      const packs = clinic.data().mekoDatapacks as Record<string, string> | undefined;
      if (!packs) continue;
      for (const agent of MEKO_AGENTS) {
        const datapackId = packs[agent];
        if (!datapackId) continue;
        try {
          const out = await rest<{ memories?: { id: string; text?: string }[] }>(
            "GET",
            `/memories?scope=learnings&datapack_id=${encodeURIComponent(datapackId)}&page_size=20`,
          );
          for (const m of out?.memories ?? []) {
            const existing = await db().collection("mekoNominations").where("memoryId", "==", m.id).limit(1).get();
            if (!existing.empty) continue;
            await db().collection("mekoNominations").add({
              hospitalId: clinic.id,
              memoryId: m.id,
              agent,
              text: m.text ?? "",
              state: "pending",
              firstSeen: new Date(),
            });
          }
        } catch (e) {
          if (e instanceof MekoError) continue;
        }
      }
    }
  },
);
