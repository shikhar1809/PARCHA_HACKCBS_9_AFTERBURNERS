/**
 * The hand-rolled MCP client, driven against the stub.
 *
 * This is the one piece of the Meko integration that could not be copied from
 * documentation — Meko publishes no server-side SDK or sample — so it is the
 * piece most worth testing. The stub speaks the same shapes the live service
 * does (verified against it: single POST, Bearer, User-Agent required, JSON
 * or one-event SSE back), so a pass here means the protocol handling is right
 * even though no account was involved.
 *
 * Run: node --test scripts/meko-client.test.mjs
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";

const PORT = 4577;
const MCP = `http://127.0.0.1:${PORT}/mcp`;
const REST = `http://127.0.0.1:${PORT}/api/v1`;
const UA = "parcha-clinic/1.0 (test)";
const KEY = "mko_tkn_test";

let stub;

/** The same handshake-then-call sequence meko.ts performs. */
async function rpc(method, params, sessionId) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "user-agent": UA,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : null };
}

async function callTool(name, args, sessionId) {
  const { body } = await rpc("tools/call", { name, arguments: args }, sessionId);
  const part = body?.result?.content?.[0]?.text;
  return part ? JSON.parse(part) : body?.result;
}

before(async () => {
  stub = spawn(process.execPath, ["scripts/meko-stub.mjs", String(PORT)], { stdio: "ignore" });
  // Wait for the port rather than sleeping a fixed amount.
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${REST}/health`, { headers: { "user-agent": UA, authorization: `Bearer ${KEY}` } });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error("stub did not start");
});

after(() => void stub?.kill());

test("the handshake returns a session id, as streamable HTTP requires", async () => {
  const { res, body } = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "parcha-clinic", version: "1.0" },
  });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("mcp-session-id"), "a session id comes back on the header");
  assert.equal(body.result.protocolVersion, "2025-06-18");
});

test("a request with no User-Agent is refused, as Meko's WAF refuses it", async () => {
  // A real and easily-missed failure mode: the key alone is not enough.
  // Raw http, because fetch always supplies a User-Agent of its own and so
  // could never reproduce the condition this is asserting.
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: PORT, path: "/mcp", method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));
  });
  assert.equal(status, 400);
});

test("a request with no Bearer key is refused", async () => {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  assert.equal(res.status, 401);
});

test("a memory written is a memory found", async () => {
  const { res } = await rpc("initialize", {});
  const sid = res.headers.get("mcp-session-id");
  const dp = "dp_habit";
  const add = await callTool(
    "memory_add",
    {
      text: "d:abc123 writes paracetamol-650mg 1-0-1 for 3 days after-food for viral-fever",
      datapack_id: dp,
      agent_id: "habit",
      metadata: { doctorKey: "abc123", clinicKey: "clinic1", kind: "habit" },
    },
    sid,
  );
  assert.ok(add.memory_id, "an id comes back");

  const found = await callTool("memory_search", { query: "paracetamol viral fever", datapack_id: dp, limit: 5 }, sid);
  assert.equal(found.results.length, 1);
  assert.match(found.results[0].text, /paracetamol-650mg/);
  // Both score fields the Recall strip shows must be present.
  assert.equal(typeof found.results[0].score, "number");
  assert.equal(typeof found.results[0].raw_similarity_score, "number");
  // Scope travels in metadata, which is what the server filters on.
  assert.equal(found.results[0].metadata.doctorKey, "abc123");
});

test("a search that matches nothing returns an empty list, not an error", async () => {
  // The distinction the docs are explicit about: empty results != failure.
  const { res } = await rpc("initialize", {});
  const sid = res.headers.get("mcp-session-id");
  const out = await callTool("memory_search", { query: "zzzz nonexistent", datapack_id: "dp_habit" }, sid);
  assert.deepEqual(out.results, []);
});

test("forgetting a memory really removes it", async () => {
  const { res } = await rpc("initialize", {});
  const sid = res.headers.get("mcp-session-id");
  const dp = "dp_forget";
  const add = await callTool("memory_add", { text: "d:x writes amlodipine-5mg 1-0-0 for 30 days", datapack_id: dp }, sid);
  await callTool("memory_delete_by_id", { memory_id: add.memory_id, datapack_id: dp }, sid);
  const after = await callTool("memory_search", { query: "amlodipine", datapack_id: dp }, sid);
  assert.deepEqual(after.results, []);
});

test("promotion marks a memory as clinic canon", async () => {
  const dp = "dp_promote";
  const { res } = await rpc("initialize", {});
  const sid = res.headers.get("mcp-session-id");
  const add = await callTool("memory_add", { text: "c:clinic1 says 'dolo' for paracetamol-650mg", datapack_id: dp }, sid);
  const promoted = await fetch(`${REST}/promote-memories`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "user-agent": UA, "content-type": "application/json" },
    body: JSON.stringify({ datapack_id: dp, memory_ids: [add.memory_id] }),
  }).then((r) => r.json());
  assert.deepEqual(promoted.data.inserted_ids, [add.memory_id]);
  const found = await callTool("memory_search", { query: "dolo paracetamol", datapack_id: dp }, sid);
  assert.equal(found.results[0].metadata.promoted, true, "canon is what recall lets other doctors see");
});
