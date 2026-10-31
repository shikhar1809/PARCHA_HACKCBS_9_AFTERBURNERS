/**
 * Loads the demo data into a live project (it REPLACES what is there).
 *
 *   node scripts/seed-live.mjs [project]
 *
 * The key comes from firebase/functions/.env.<project> (never committed); the
 * function refuses without it. Demo accounts afterwards: docs/DEMO.md.
 */
import fs from "node:fs";
import path from "node:path";

const project = process.argv[2] ?? "parcha-101";
const root = path.resolve(import.meta.dirname, "..");
const env = fs.readFileSync(path.join(root, "firebase", "functions", `.env.${project}`), "utf8");
const seedKey = env.match(/^BOOTSTRAP_KEY=(.+)$/m)?.[1]?.trim();
if (!seedKey) throw new Error(`No BOOTSTRAP_KEY in firebase/functions/.env.${project}`);

const r = await fetch(`https://asia-south1-${project}.cloudfunctions.net/seedDemoData`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ data: { seedKey } }),
  signal: AbortSignal.timeout(560_000),
});
const body = await r.json().catch(() => ({}));
if (!r.ok || body.error) {
  console.error(`Seed refused (${r.status}): ${body.error?.message ?? JSON.stringify(body)}`);
  process.exit(1);
}
console.log("Demo data loaded:", JSON.stringify(body.result).slice(0, 400));
