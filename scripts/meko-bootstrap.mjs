/**
 * Creates this clinic's three Meko datapacks, once.
 *
 * One datapack per agent, because a datapack is the only hard isolation Meko
 * offers: `agent_id` is trace attribution and does not filter a search. The
 * ids it prints go on the hospital document as `mekoDatapacks`, which is what
 * the callables read.
 *
 * It refuses to touch anything whose name ends in `-build`. The team's build
 * datapack and the product's datapacks must never mix — that is the one rule
 * the hackathon brief sets for both tracks, and a script that could write to
 * the wrong one is how it gets broken at 2 a.m.
 *
 *   node scripts/meko-bootstrap.mjs --api-key mko_tkn_... --clinic rohini
 *   node scripts/meko-bootstrap.mjs --stub            (against scripts/meko-stub.mjs)
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") === false ? all[i + 1] : true]);
    return acc;
  }, []),
);

const AGENTS = ["habit", "formulary", "scribe"];
const UA = "parcha-bootstrap/1.0";
const key = args["api-key"] ?? process.env.MEKO_API_KEY ?? (args.stub ? "mko_tkn_stub" : null);
const base = args.stub
  ? `http://127.0.0.1:${process.env.MEKO_STUB_PORT ?? 4500}/api/v1`
  : (process.env.MEKO_REST_URL ?? "https://api.mekodata.ai/api/v1");
const clinic = args.clinic ?? "parcha";

if (!key) {
  console.error("Need a key: --api-key mko_tkn_... (or MEKO_API_KEY, or --stub)");
  process.exit(1);
}

async function createDatapack(name) {
  if (name.endsWith("-build")) throw new Error(`refusing to touch a build datapack: ${name}`);
  const res = await fetch(`${base}/datapacks`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "user-agent": UA, "content-type": "application/json" },
    body: JSON.stringify({ name, description: `Parcha ${name.split("-").pop()} agent — prescribing patterns only, never patient data` }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${name}: ${res.status} ${JSON.stringify(json)}`);
  return json.data?.datapack_id ?? json.datapack_id;
}

/**
 * Conversations in these datapacks must never surface in Meko's
 * cross-datapack conversation search. Best-effort: a failure here is worth
 * knowing about but not worth failing the bootstrap over, since the datapack
 * already exists by then.
 */
async function optOut(id) {
  const res = await fetch(`${base}/datapacks/${id}/conversation-search-opt-out`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${key}`, "user-agent": UA, "content-type": "application/json" },
    body: JSON.stringify({ opted_out: true }),
  }).catch(() => null);
  return res?.ok ?? false;
}

const out = {};
for (const agent of AGENTS) {
  const name = `${clinic}-${agent}`;
  try {
    const id = await createDatapack(name);
    const opted = await optOut(id);
    out[agent] = id;
    console.log(`  ${name.padEnd(20)} ${id}${opted ? "" : "   (could not set conversation-search opt-out — do it in the portal)"}`);
  } catch (e) {
    console.error(`  ${name.padEnd(20)} FAILED: ${e.message}`);
    process.exitCode = 1;
  }
}

if (Object.keys(out).length === AGENTS.length) {
  console.log("\nPut this on the hospital document (Manage > settings, or the emulator UI):\n");
  console.log(`  mekoEnabled: true`);
  console.log(`  mekoDatapacks: ${JSON.stringify(out)}\n`);
}
