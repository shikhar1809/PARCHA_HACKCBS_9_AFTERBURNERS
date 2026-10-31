/**
 * Starts everything: the emulator suite, then both apps.
 *
 *   npm run dev
 *
 *   clinic    http://localhost:3000   staff + doctor
 *   patient   http://localhost:3001   the patient's own app
 *   emulators http://127.0.0.1:4000   Firestore, Auth and Functions
 *
 * The emulators hold the data, so both apps see the same clinic — a doctor
 * signing a prescription on 3000 shows up on 3001 without a refresh.
 */
import { spawn } from "node:child_process";

const procs = [];
const run = (label, command, args) => {
  console.log(`[parcha] starting ${label}`);
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  procs.push(child);
  return child;
};

const shutdown = () => {
  for (const p of procs) p.kill();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run("emulators", "npx", [
  "firebase",
  "emulators:start",
  "--only",
  "auth,firestore,functions",
  "--project",
  "parcha-dev",
]);

// Wait for the functions emulator to answer before starting the apps, so the
// first screen does not load against a database that is not up yet.
const ready = async () => {
  for (let i = 0; i < 90; i += 1) {
    try {
      const res = await fetch("http://127.0.0.1:4400/emulators");
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};

if (!(await ready())) {
  console.error("[parcha] emulators did not come up; starting the apps anyway");
} else {
  console.log("[parcha] emulators ready");
}

run("clinic  :3000", "npm", ["run", "dev", "--workspace", "@parcha/clinic"]);
run("patient :3001", "npm", ["run", "dev", "--workspace", "@parcha/patient"]);
