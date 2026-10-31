/**
 * Starts the Firebase emulators with a longer function timeout.
 *
 *   npm run emulators
 *
 * The emulator cuts a function off at about 30 seconds unless told otherwise,
 * and loading the demo data (`seedDemoData`) takes longer than that once there is
 * a day's worth of records to clear first. In production a function's own
 * timeout applies instead; this only changes the local emulator.
 */
import { spawn } from "node:child_process";

const child = spawn(
  "firebase",
  ["emulators:start", "--only", "auth,firestore,functions", "--project", "parcha-dev"],
  {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, FUNCTIONS_EMULATOR_TIMEOUT_SECONDS: "300" },
  },
);
child.on("exit", (code) => process.exit(code ?? 0));
