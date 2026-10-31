/**
 * Builds the web app that goes inside the desktop program.
 *
 *   node scripts/build-web.mjs [clinic|patient] [emulatorHost]
 *
 * It builds the chosen app with Vite, copies the result into `web/`, and writes
 * `web/app.json` so the program knows which app it carries. The host is where
 * the Firebase emulators are (default 127.0.0.1, the same computer), or `live`
 * for the live project (parcha-101).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const which = process.argv[2] === "patient" ? "patient" : "clinic";
const host = process.argv[3] ?? "127.0.0.1";
const root = path.resolve(import.meta.dirname, "..");
const appDir = path.resolve(root, "..", which);

console.log(`Building the ${which} app (backend host ${host})…`);
// `live` builds against the live project (parcha-101) instead of the emulators.
const live = host === "live";
const r = spawnSync("npx", ["vite", "build", ...(live ? ["--mode", "parcha-101"] : [])], {
  cwd: appDir,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: live ? process.env : { ...process.env, VITE_EMULATOR_HOST: host },
});
if (r.status !== 0) process.exit(r.status ?? 1);

const web = path.join(root, "web");
fs.rmSync(web, { recursive: true, force: true });
fs.cpSync(path.join(appDir, "dist"), web, { recursive: true });
fs.writeFileSync(path.join(web, "app.json"), JSON.stringify({ app: which, host, builtAt: new Date().toISOString() }));

// The program's icon, from the patient app's artwork.
fs.mkdirSync(path.join(root, "build"), { recursive: true });
const icon = path.resolve(root, "..", "patient", "assets", "icon-only.png");
if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(root, "build", "icon.png"));
console.log(`Done: ${web}`);
