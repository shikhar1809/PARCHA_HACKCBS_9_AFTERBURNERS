/**
 * Local stand-in for Cloud Scheduler: runs the reminder-call dispatcher every
 * 30 seconds against the emulator.
 *
 *   node scripts/dispatch-calls.mjs
 *
 * In production `dispatchReminderCalls` runs every minute by itself; the
 * emulator does not fire schedules, so this does it by hand.
 */
const URL_ = "http://127.0.0.1:5001/parcha-dev/asia-south1/runCallDispatcher";
const KEY = process.env.SWEEP_KEY ?? "dev-sweep-key";

async function tick() {
  try {
    const res = await fetch(URL_, { headers: { "x-sweep-key": KEY } });
    const body = await res.json();
    const when = new Date().toLocaleTimeString("en-IN");
    if (body.placed || body.retried || body.expired) console.log(when, JSON.stringify(body));
  } catch (e) {
    console.error("dispatcher not reachable:", e.message);
  }
}

console.log("Dispatching reminder calls every 30 s. Ctrl+C to stop.");
await tick();
setInterval(tick, 30_000);
