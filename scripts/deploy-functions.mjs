/**
 * Deploys the Cloud Functions a few at a time, retrying the ones that fail.
 *
 *   node scripts/deploy-functions.mjs [project] [--batch 4] [--only a,b,c]
 *
 * A new project's regional CPU quota is small, and deploying ~50 functions at
 * once makes Cloud Run start them together and refuse the rest ("Quota exceeded
 * for total allowable CPU"). Small batches with a pause between them get through.
 * Pass `--account you@example.com` through FIREBASE_ACCOUNT if the CLI has more
 * than one sign-in. Build first: `npm run functions:build`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const project = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true) ?? "live";
const batchSize = Number(flag("--batch", "4"));
const account = process.env.FIREBASE_ACCOUNT;

const src = path.resolve(import.meta.dirname, "..", "firebase", "functions", "src");
const all = fs
  .readdirSync(src)
  .filter((f) => f.endsWith(".ts"))
  .flatMap((f) => [...fs.readFileSync(path.join(src, f), "utf8").matchAll(/^export const (\w+) = on\w+\(/gm)].map((m) => m[1]));
// Only what index.ts actually exports (a commented-out export is not deployed).
const index = fs
  .readFileSync(path.join(src, "index.ts"), "utf8")
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");
const exported = all.filter((n) => new RegExp(`\\b${n}\\b`).test(index));
let todo = flag("--only", "") ? flag("--only", "").split(",") : exported;

// `--list` prints what would be deployed, and stops.
if (args.includes("--list")) {
  console.log(todo.join("\n"));
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let round = 1; round <= 4 && todo.length; round++) {
  console.log(`\nRound ${round}: ${todo.length} function(s)`);
  const failed = [];
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const r = spawnSync(
      "npx",
      ["firebase", "deploy", "--only", batch.map((f) => `functions:${f}`).join(","), "--project", project, "--non-interactive", "--force", ...(account ? ["--account", account] : [])],
      // Loading the code to see what to deploy can take longer than the 10 s default.
      { encoding: "utf8", shell: process.platform === "win32", env: { FUNCTIONS_DISCOVERY_TIMEOUT: "60", ...process.env } },
    );
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    const bad = batch.filter((f) => new RegExp(`(Failed to (create|update) function ${f}\\b|functions\\[${f}\\([^)]*\\)\\] Failed)`).test(out));
    // A deploy that died before naming anything counts as all of it failing.
    const lost = r.status !== 0 && bad.length === 0 ? batch : bad;
    failed.push(...lost);
    console.log(`  ${batch.join(", ")}: ${lost.length ? `failed ${lost.join(", ")}` : "ok"}`);
    await sleep(15_000);
  }
  todo = failed;
  if (todo.length) await sleep(60_000);
}

if (todo.length) {
  console.error(`\nStill failing after 4 rounds: ${todo.join(", ")}`);
  process.exit(1);
}
console.log("\nAll functions deployed.");
