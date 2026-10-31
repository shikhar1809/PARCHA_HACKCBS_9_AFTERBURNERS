/**
 * A small load test against the local emulators.
 *
 *   node scripts/loadtest.mjs [requests] [concurrency]
 *
 * It signs in as the demo front desk and fires `requests` registerPatient calls,
 * `concurrency` at a time, then reports how many succeeded and how long they
 * took, and deletes what it made. registerPatient is a good probe because it is
 * a full authenticated write: token check, claims check, Firestore write.
 *
 * What this does NOT show: the emulator is one process on one machine, so the
 * numbers say whether the code holds up under a burst (no errors, no
 * contention, latency that does not climb), not how many requests a real
 * project absorbs. docs/ARCHITECTURE.md explains the real limits.
 */
const REQUESTS = Number(process.argv[2] ?? 200);
const CONCURRENCY = Number(process.argv[3] ?? 25);

const PROJECT = "parcha-dev";
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`;
const FN = `http://127.0.0.1:5001/${PROJECT}/asia-south1`;
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

async function signIn() {
  const res = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "staff@parcha.test", password: "parcha123", returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return (await res.json()).idToken;
}

async function register(token, i) {
  const t0 = performance.now();
  const res = await fetch(`${FN}/registerPatient`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      data: { fullName: `LOAD TEST ${i}`, phone: `9${String(100000000 + i).slice(-9)}` },
    }),
  });
  const ms = performance.now() - t0;
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, ms, id: body?.result?.patientId, status: res.status };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const token = await signIn();
await register(token, 0); // warm the function so the first request is not a cold start

const started = performance.now();
const results = [];
let next = 1;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next <= REQUESTS) {
      results.push(await register(token, next++));
    }
  }),
);
const seconds = (performance.now() - started) / 1000;

const good = results.filter((r) => r.ok);
const times = good.map((r) => r.ms).sort((a, b) => a - b);
const failures = {};
for (const r of results.filter((r) => !r.ok)) failures[r.status] = (failures[r.status] ?? 0) + 1;

console.log(`requests      ${results.length} at concurrency ${CONCURRENCY}`);
console.log(`succeeded     ${good.length}`);
console.log(`failed        ${results.length - good.length} ${JSON.stringify(failures)}`);
console.log(`throughput    ${(results.length / seconds).toFixed(1)} requests/second`);
if (times.length) {
  console.log(
    `latency ms    p50 ${pct(times, 50).toFixed(0)}  p95 ${pct(times, 95).toFixed(0)}  p99 ${pct(times, 99).toFixed(0)}  max ${times.at(-1).toFixed(0)}`,
  );
}

// Clean up what we made, so the demo data is as it was.
let removed = 0;
for (const r of good) {
  if (!r.id) continue;
  const del = await fetch(`${FS}/patients/${r.id}`, { method: "DELETE", headers: { authorization: "Bearer owner" } });
  if (del.ok) removed++;
}
console.log(`cleaned up    ${removed} test patients`);
process.exit(results.length - good.length > 0 ? 1 : 0);
