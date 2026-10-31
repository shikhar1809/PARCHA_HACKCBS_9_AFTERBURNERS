/**
 * Loads the demo clinic into the running emulator.
 *
 *   npm run seed
 *
 * Calls the `seedDemoData` Cloud Function, which refuses to run anywhere but
 * the emulator. Safe to re-run: it deletes what it owns first.
 */
const URL_ = "http://127.0.0.1:5001/parcha-dev/asia-south1/seedDemoData";

const response = await fetch(URL_, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data: {} }),
}).catch(() => null);

if (!response) {
  console.error("Could not reach the functions emulator. Run `npm run emulators` first.");
  process.exit(1);
}

const body = await response.json();
if (!response.ok || body.error) {
  console.error("Seeding failed:", body.error?.message ?? response.statusText);
  process.exit(1);
}

const r = body.result;
console.log("");
console.log(`  patients      ${r.patients}`);
console.log(`  visits        ${r.visits}`);
console.log(`  drugs         ${r.drugs}`);
console.log(`  interactions  ${r.interactions}`);
console.log(`  shared phones ${r.sharedHandsets.join(", ")}`);
console.log(`  staff         ${r.staff.join(", ")}  (password parcha123)`);
console.log(`  live code     ${r.liveCode}`);
if (r.problems.length > 0) {
  console.log("");
  for (const p of r.problems) console.log(`  PROBLEM: ${p}`);
  process.exit(1);
}
console.log("");
console.log("  Demo clinic loaded.");
