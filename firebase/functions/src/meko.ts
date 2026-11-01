/**
 * The only place in Parcha that holds the Meko key, and the only place that
 * talks to Meko.
 *
 * Why the key never reaches a browser: a Meko key is account-scoped. There is
 * no per-datapack key, so one leaked key reaches every memory we hold, for
 * every clinic. It lives in a Secret Manager secret read by these functions
 * and nowhere else.
 *
 * Why this speaks JSON-RPC by hand rather than using an MCP SDK: Meko
 * publishes no SDK and no server-side code sample (the npm package under its
 * name is an installer for coding agents, not a client library). The endpoint
 * is a single POST that answers with plain JSON — verified against the live
 * service — so a small client is less risk than adding a dependency to the
 * deploy path, and it is the one piece of this design we could not copy from
 * documentation. If Meko later ships a real SDK, this file is what it
 * replaces.
 *
 * Every call made here lands in `mekoCalls`, which is what the swarm board
 * draws. Nothing is logged that a de-identification gate has not already
 * passed, twice.
 */
import { FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";

import { db } from "./guards.js";

export const MEKO_API_KEY = defineSecret("MEKO_API_KEY");
export const MEKO_SCOPE_SALT = defineSecret("MEKO_SCOPE_SALT");

/** Overridable so the emulator and CI talk to scripts/meko-stub.mjs instead of the real thing. */
const MCP_URL = () => process.env.MEKO_MCP_URL ?? "https://mcp.mekodata.ai/mcp";
const REST_URL = () => process.env.MEKO_REST_URL ?? "https://api.mekodata.ai/api/v1";

/** Meko's WAF rejects a request with no User-Agent, whatever the key says. */
const UA = "parcha-clinic/1.0 (+https://github.com/shikhar1809/PARCHA_HACKCBS_9_AFTERBURNERS)";

/**
 * The tools this server may call, and the complete list of them.
 *
 * An allowlist rather than a pass-through: the callables take an agent and a
 * query from a browser, and nothing a browser sends should be able to name a
 * tool. `datapack_delete` and `memory_delete_all` are not here on purpose.
 */
export const ALLOWED_TOOLS = [
  "context_search",
  "memory_search",
  "memory_add",
  "memory_get_by_id",
  "memory_delete_by_id",
  "memory_promote",
  "knowledgebase_search",
  "conversation_create",
  "conversation_add_message",
  "track_token_usage",
  "datapack_list",
] as const;
export type MekoTool = (typeof ALLOWED_TOOLS)[number];

export type MekoCallLog = {
  hospitalId: string;
  agent: string;
  tool: string;
  kind: "write" | "recall" | "share" | "promote";
  ok: boolean;
  ms: number;
  summary: string;
};

/** How long we wait on Meko before giving up and letting the pad fall back to its rules. */
const TIMEOUT_MS = Number(process.env.MEKO_TIMEOUT_MS ?? 1200);

type Rpc = { jsonrpc: "2.0"; id?: number; method: string; params?: unknown };

/**
 * One MCP session per warm instance.
 *
 * The protocol wants initialize -> notifications/initialized before any tool
 * call, and hands back a session id to carry on later requests. Holding it on
 * the instance means that handshake happens once per cold start rather than
 * once per consultation. A 401 or a 404 clears it and the next call starts a
 * fresh one, which is how an expired key or a restarted server recovers
 * without a deploy.
 */
let session: { id: string | null; ready: Promise<void> } | null = null;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${MEKO_API_KEY.value()}`,
    "user-agent": UA,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extra,
  };
}

async function post(body: Rpc, sessionId: string | null, signal: AbortSignal): Promise<Response> {
  return fetch(MCP_URL(), {
    method: "POST",
    headers: headers(sessionId ? { "mcp-session-id": sessionId } : {}),
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * The response body, whether it came back as JSON or as a one-event SSE
 * stream. Streamable HTTP lets the server pick, and Meko picks per endpoint,
 * so both are handled rather than assumed.
 */
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  if (text.startsWith("event:") || text.startsWith("data:")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return line ? JSON.parse(line.slice(5).trim()) : null;
  }
  return JSON.parse(text);
}

async function handshake(signal: AbortSignal): Promise<string | null> {
  const res = await post(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "parcha-clinic", version: "1.0" },
      },
    },
    null,
    signal,
  );
  if (!res.ok) throw new Error(`meko initialize ${res.status}`);
  const id = res.headers.get("mcp-session-id");
  await readBody(res);
  // The spec wants this notification before tool calls; it answers 202 with no body.
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, id, signal).catch(() => undefined);
  return id;
}

function ensureSession(signal: AbortSignal): Promise<void> {
  if (session) return session.ready;
  const holder: { id: string | null; ready: Promise<void> } = { id: null, ready: Promise.resolve() };
  holder.ready = handshake(signal)
    .then((id) => void (holder.id = id))
    .catch((e) => {
      session = null;
      throw e;
    });
  session = holder;
  return holder.ready;
}

/** Drops the session so the next call re-handshakes. Used on 401/404. */
export const forgetSession = () => void (session = null);

export class MekoError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/**
 * Calls one Meko tool.
 *
 * Throws on failure rather than returning a degraded value: the callers above
 * decide what a failure means, and for recall it means "use the rules", which
 * is not this function's judgement to make.
 */
export async function tool<T>(name: MekoTool, args: Record<string, unknown>, timeoutMs = TIMEOUT_MS): Promise<T> {
  if (!ALLOWED_TOOLS.includes(name)) throw new MekoError(`tool not allowed: ${name}`, null);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    await ensureSession(ctl.signal);
    const res = await post(
      { jsonrpc: "2.0", id: Date.now() % 100000, method: "tools/call", params: { name, arguments: args } },
      session?.id ?? null,
      ctl.signal,
    );
    if (res.status === 401 || res.status === 404) {
      forgetSession();
      throw new MekoError(`meko ${res.status}`, res.status);
    }
    if (!res.ok) throw new MekoError(`meko ${res.status}`, res.status);
    const body = (await readBody(res)) as { result?: { content?: { text?: string }[] }; error?: { message?: string } } | null;
    if (body?.error) throw new MekoError(body.error.message ?? "meko error", null);
    // MCP returns tool output as content parts; ours are JSON in a text part.
    const text = body?.result?.content?.[0]?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text) as T;
      } catch {
        // Meko answers a bad argument with a 200 and the validation message as
        // text. That is a failure, and is thrown as one rather than returned as
        // if it were a result.
        if (/validation error|missing_argument|Input should be/i.test(text)) throw new MekoError(text.slice(0, 200), null);
        return text as unknown as T;
      }
    }
    return (body?.result ?? null) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** The REST side: promotion, learnings and health, which have no MCP tool. */
export async function rest<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS * 3);
  try {
    const res = await fetch(`${REST_URL()}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) throw new MekoError(`meko rest ${res.status}`, res.status);
    const json = (await res.json()) as { data?: T; error?: { message?: string } };
    if (json.error) throw new MekoError(json.error.message ?? "meko rest error", res.status);
    return (json.data ?? json) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One row per Meko call, which is what the swarm board draws.
 *
 * Never awaited by a caller on the hot path and never allowed to throw: a
 * failure to log must not fail a consultation.
 */
export function logCall(row: MekoCallLog): void {
  void db()
    .collection("mekoCalls")
    .add({ ...row, at: FieldValue.serverTimestamp() })
    .catch(() => undefined);
}

/** Times a Meko call, logs it, and passes its result or error straight through. */
export async function timed<T>(row: Omit<MekoCallLog, "ok" | "ms">, work: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const out = await work();
    logCall({ ...row, ok: true, ms: Date.now() - start });
    return out;
  } catch (e) {
    logCall({ ...row, ok: false, ms: Date.now() - start, summary: `${row.summary} — failed` });
    throw e;
  }
}
