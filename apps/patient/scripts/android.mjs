/**
 * Builds the Android app: web build, copy into the native project, Gradle.
 *
 *   node scripts/android.mjs [emulatorHost]
 *
 * `emulatorHost` is where the Firebase emulators are reachable from the phone:
 *   10.0.2.2        an Android emulator on the same computer (the default)
 *   192.168.x.y     a real phone on the same wifi (the computer's address)
 *   live            the live project (parcha-101); writes parcha.apk
 * Run the emulators with their hosts open to the network for a real phone
 * (firebase.json "host": "0.0.0.0").
 *
 * The result is apps/patient/android/app/build/outputs/apk/debug/app-debug.apk,
 * copied to apps/patient/parcha-debug.apk. It is a DEBUG build, signed with the
 * debug key: fine for a demo, not for the Play Store.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const host = process.argv[2] ?? "10.0.2.2";
const root = path.resolve(import.meta.dirname, "..");
const win = process.platform === "win32";

function run(cmd, args, env = {}, cwd = root) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: win, env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

// Gradle needs a JDK (17 or newer) and the Android SDK.
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
const props = path.join(root, "android", "local.properties");
if (!fs.existsSync(props)) fs.writeFileSync(props, `sdk.dir=${sdk.replaceAll("\\", "\\\\")}\n`);

// `live` builds against the live project (parcha-101) instead of the emulators.
const live = host === "live";
run("npx", ["vite", "build", ...(live ? ["--mode", "parcha-101"] : [])], live ? {} : { VITE_EMULATOR_HOST: host });
run("npx", ["cap", "sync", "android"]);
const androidDir = path.join(root, "android");
run(win ? `"${path.join(androidDir, "gradlew.bat")}"` : "./gradlew", ["assembleDebug"], {}, androidDir);

const apk = path.join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const out = path.join(root, live ? "parcha.apk" : "parcha-debug.apk");
fs.copyFileSync(apk, out);
console.log(`\nDone: ${out} (backend ${live ? "parcha-101" : `host ${host}`})`);
