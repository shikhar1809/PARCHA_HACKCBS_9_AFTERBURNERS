/**
 * Runs the one-time set-up of a live project (see firebase/functions/src/bootstrap.ts):
 * the medicine list, a hospital, a front desk admin and a doctor.
 *
 *   node scripts/bootstrap-live.mjs [project] [deskEmail] [doctorEmail]
 *
 * The key comes from firebase/functions/.env.<project> (never committed). The
 * two new passwords are written to live-accounts.local.txt (git-ignored), not
 * printed. Afterwards delete the function:
 *   npx firebase functions:delete bootstrapLive --project <project> --force
 */
import fs from "node:fs";
import path from "node:path";

const [project = "parcha-101", deskEmail, doctorEmail] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, "..");
const env = fs.readFileSync(path.join(root, "firebase", "functions", `.env.${project}`), "utf8");
const key = env.match(/^BOOTSTRAP_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error(`No BOOTSTRAP_KEY in firebase/functions/.env.${project}`);

const r = await fetch(`https://asia-south1-${project}.cloudfunctions.net/bootstrapLive`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-key": key },
  body: JSON.stringify({ ...(deskEmail ? { deskEmail } : {}), ...(doctorEmail ? { doctorEmail } : {}) }),
});
const body = await r.json().catch(() => ({}));
if (!r.ok) {
  console.error(`Set-up refused (${r.status}): ${body.error ?? JSON.stringify(body)}`);
  process.exit(1);
}

const out = path.join(root, "live-accounts.local.txt");
const lines = [
  `Parcha live accounts for ${project} (${body.hospital}), made ${new Date().toISOString()}.`,
  "Change these passwords after the first sign-in. Do not commit this file.",
  "",
  ...body.accounts.map((a) => `${a.role}: ${a.email}  password: ${a.password}`),
  "",
];
fs.writeFileSync(out, lines.join("\n"), { mode: 0o600 });
console.log(`Loaded the medicine list and ${body.hospital}.`);
for (const a of body.accounts) console.log(`  ${a.role}: ${a.email}`);
console.log(`Passwords are in ${out}`);
