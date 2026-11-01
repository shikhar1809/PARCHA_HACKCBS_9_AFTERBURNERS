/**
 * A fake Meko, so the whole learning path can be built and tested without an
 * account, without a network and without burning the free tier's 1,000
 * conversation calls a month.
 *
 * It speaks the slice of MCP and REST that firebase/functions/src/meko.ts
 * uses, over Node's own http module: no dependency, nothing to install.
 * Memories live in a Map and die with the process, which is what you want for
 * a test — every run starts from nothing.
 *
 * It can also be told to misbehave, because the degradation table in
 * docs/plans/MEKO-VOICE-AGENT.md is a promise that needs testing:
 *
 *   MEKO_STUB_FAIL=401     an expired or revoked key
 *   MEKO_STUB_FAIL=429     the free tier's quota, used up
 *   MEKO_STUB_FAIL=500     Meko having a bad day
 *   MEKO_STUB_FAIL=hang    a request that never answers, to prove the timeout
 *
 * Run: node scripts/meko-stub.mjs [port]
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.argv[2] ?? process.env.MEKO_STUB_PORT ?? 4500);
const FAIL = process.env.MEKO_STUB_FAIL ?? "";

/** datapackId -> memoryId -> row */
const packs = new Map();
const pack = (id) => {
  if (!packs.has(id)) packs.set(id, new Map());
  return packs.get(id);
};

const read = (req) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch {
        resolve(null);
      }
    });
  });

const send = (res, status, json, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(json));
};

/** An MCP tool result: JSON inside a text content part, as the real server does. */
const toolResult = (id, value) =>
  ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value) }] } });

/** The same hybrid-ish ranking shape the real thing returns: a score plus a raw similarity. */
function search(rows, query) {
  const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return rows
    .map((r) => {
      const text = r.text.toLowerCase();
      const hits = terms.filter((t) => text.includes(t)).length;
      return { ...r, score: terms.length ? hits / terms.length : 0, raw_similarity_score: hits ? 0.5 + hits / 20 : 0 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

function call(name, args) {
  const dp = args.datapack_id ?? "default";
  switch (name) {
    case "memory_add": {
      const id = randomUUID();
      pack(dp).set(id, { id, text: String(args.text ?? ""), metadata: args.metadata ?? {}, agent_id: args.agent_id });
      return { memory_id: id };
    }
    case "memory_search":
      return { results: search([...pack(dp).values()], String(args.query ?? "")).slice(0, args.limit ?? 5) };
    case "context_search":
      return { results: search([...pack(dp).values()], String(args.query ?? "")).slice(0, args.limit ?? 5) };
    case "memory_get_by_id":
      return pack(dp).get(args.memory_id) ?? { error: "not found" };
    case "memory_delete_by_id":
      pack(dp).delete(args.memory_id);
      return { deleted: true };
    case "memory_promote":
      for (const id of args.memory_ids ?? []) {
        const row = pack(dp).get(id);
        if (row) row.metadata = { ...row.metadata, promoted: true };
      }
      return { inserted_ids: args.memory_ids ?? [] };
    case "datapack_list":
      return { datapacks: [...packs.keys()].map((id) => ({ datapack_id: id })) };
    case "knowledgebase_search":
      return { results: [] };
    case "conversation_create":
      return { conversation_id: randomUUID() };
    case "conversation_add_message":
    case "track_token_usage":
      return { ok: true };
    default:
      return { error: `unknown tool ${name}` };
  }
}

const server = createServer(async (req, res) => {
  if (FAIL === "hang") return; // never answers: proves the client's timeout
  if (FAIL === "401") return send(res, 401, { error: "invalid_token" });
  if (FAIL === "429") return send(res, 429, { error: "quota" });
  if (FAIL === "500") return send(res, 500, { error: "server" });

  // The WAF rejects anything with no User-Agent, so the stub does too: that
  // is a real failure mode and it should fail here, not in production.
  if (!req.headers["user-agent"]) return send(res, 400, { error: "user-agent required" });
  if (!String(req.headers.authorization ?? "").startsWith("Bearer ")) {
    return send(res, 401, { error: "invalid_token" });
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/mcp") {
    const body = await read(req);
    if (!body) return send(res, 400, { error: "bad json" });
    if (body.method === "initialize") {
      return send(res, 200, { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }, { "mcp-session-id": randomUUID() });
    }
    if (body.method === "notifications/initialized") {
      res.writeHead(202);
      return res.end();
    }
    if (body.method === "tools/call") {
      const out = call(body.params?.name, body.params?.arguments ?? {});
      return send(res, 200, toolResult(body.id, out));
    }
    return send(res, 200, { jsonrpc: "2.0", id: body.id, error: { message: "unknown method" } });
  }

  // The REST side: promotion, learnings and health.
  if (url.pathname === "/api/v1/health") return send(res, 200, { data: { ok: true } });
  if (url.pathname === "/api/v1/promote-memories" && req.method === "POST") {
    const body = (await read(req)) ?? {};
    call("memory_promote", body);
    return send(res, 200, { data: { inserted_ids: body.memory_ids ?? [] } });
  }
  if (url.pathname === "/api/v1/keep-as-memory") return send(res, 200, { data: { updated: 0 } });
  if (url.pathname.endsWith("/conversation-search-opt-out") && req.method === "PATCH") {
    const body = (await read(req)) ?? {};
    return send(res, 200, { data: { conversation_search_opt_out: body.opted_out === true } });
  }
  if (url.pathname === "/api/v1/memories") {
    const dp = url.searchParams.get("datapack_id") ?? "default";
    return send(res, 200, { data: { memories: [...pack(dp).values()].slice(0, 20) } });
  }
  if (url.pathname === "/api/v1/datapacks" && req.method === "POST") {
    const body = (await read(req)) ?? {};
    const id = `dp_${randomUUID().slice(0, 8)}`;
    pack(id);
    return send(res, 201, { data: { datapack_id: id, name: body.name } });
  }
  return send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  const mode = FAIL ? ` (failing with ${FAIL})` : "";
  console.log(`meko stub on http://127.0.0.1:${PORT}${mode}`);
  console.log(`  MEKO_MCP_URL=http://127.0.0.1:${PORT}/mcp`);
  console.log(`  MEKO_REST_URL=http://127.0.0.1:${PORT}/api/v1`);
});

export { server };
