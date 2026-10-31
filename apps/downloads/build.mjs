/**
 * Builds the download sites: one page each, a QR code to the installer and a
 * button for the device you are already on.
 *
 *   node apps/downloads/build.mjs [android|desktop]
 *
 *   parcha-android.web.app   the patient app for Android  (apps/patient/parcha.apk)
 *   parcha-desktop.web.app   the clinic program for Windows (apps/desktop/release/*.exe)
 *
 * Build the binaries first (`node apps/patient/scripts/android.mjs live`, and in
 * apps/desktop `node scripts/build-web.mjs clinic live && npx electron-builder --win nsis`).
 * Output goes to apps/downloads/dist/<site>/, which firebase.json serves.
 */
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

const here = import.meta.dirname;
const repo = path.resolve(here, "..", "..");

const SITES = [
  {
    id: "android",
    url: "https://parcha-android.web.app",
    title: "Parcha for Android",
    who: "The patient app",
    file: "parcha.apk",
    from: () => path.join(repo, "apps", "patient", "parcha.apk"),
    button: "Download for Android",
    note: "Scan with your phone's camera. When Android asks, allow installing from your browser, then open Parcha.",
  },
  {
    id: "desktop",
    url: "https://parcha-desktop.web.app",
    title: "Parcha Clinic for Windows",
    who: "The front desk and doctor program",
    file: "Parcha-Clinic-Setup.exe",
    from: () => {
      const dir = path.join(repo, "apps", "desktop", "release");
      const exe = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => /setup.*\.exe$/i.test(f));
      return exe ? path.join(dir, exe) : null;
    },
    button: "Download for Windows",
    note: "The installer is not code-signed yet: if Windows warns, choose More info, then Run anyway.",
  },
];

const icon = fs.readFileSync(path.join(repo, "apps", "patient", "public", "favicon.svg"), "utf8");

const page = (s, qr, size) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${s.title}</title>
<meta name="description" content="${s.who}. Scan to download.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<style>
  :root { --ink: #232326; --paper: #faf5ea; --brand: #ff7f5a; --mint: #adefc4; }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    background: var(--brand);
    color: var(--ink);
    font: 400 18px/1.4 "Atkinson Hyperlegible", ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
    display: grid; place-items: center; padding: 24px 16px;
  }
  main {
    width: min(420px, 100%);
    background: var(--paper);
    border: 3px solid var(--ink);
    border-radius: 28px;
    box-shadow: 8px 8px 0 var(--ink);
    padding: 28px 24px 24px;
    text-align: center;
  }
  .mark { width: 56px; height: 56px; display: block; margin: 0 auto 10px; }
  h1 { font-size: 26px; line-height: 1.15; font-weight: 700; }
  .who { margin-top: 4px; font-size: 16px; }
  .qr {
    margin: 22px auto 0; width: min(272px, 100%); aspect-ratio: 1;
    background: #fff; border: 3px solid var(--ink); border-radius: 20px; padding: 14px;
  }
  .qr svg { display: block; width: 100%; height: 100%; }
  .scan { margin-top: 12px; font-weight: 700; }
  a.dl {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    margin-top: 18px; min-height: 56px; padding: 0 20px;
    background: var(--brand); color: var(--ink); text-decoration: none;
    font-weight: 700; font-size: 18px;
    border: 3px solid var(--ink); border-radius: 18px; box-shadow: 0 4px 0 var(--ink);
  }
  a.dl:active { transform: translateY(2px); box-shadow: 0 2px 0 var(--ink); }
  a.dl:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
  .size { margin-top: 8px; font-size: 15px; }
  .note { margin-top: 14px; font-size: 15px; }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">${icon}</div>
  <h1>${s.title}</h1>
  <p class="who">${s.who}</p>
  <div class="qr" role="img" aria-label="QR code to download ${s.file}">${qr}</div>
  <p class="scan">Scan to download</p>
  <a class="dl" href="/${s.file}" download>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
    ${s.button}
  </a>
  <p class="size">${s.file} · ${size}</p>
  <p class="note">${s.note}</p>
</main>
</body>
</html>
`;

// `node build.mjs android` builds just one.
const only = process.argv[2];
for (const s of SITES.filter((x) => !only || x.id === only)) {
  const src = s.from();
  if (!src || !fs.existsSync(src)) {
    console.error(`Skipping ${s.id}: build the ${s.file} first.`);
    continue;
  }
  const out = path.join(here, "dist", s.id);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(src, path.join(out, s.file));
  fs.writeFileSync(path.join(out, "favicon.svg"), icon);
  const qr = await QRCode.toString(`${s.url}/${s.file}`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#232326", light: "#ffffff" } });
  const mb = `${(fs.statSync(src).size / 1048576).toFixed(0)} MB`;
  fs.writeFileSync(path.join(out, "index.html"), page(s, qr, mb));
  console.log(`${s.id}: ${s.url}  (${s.file}, ${mb})`);
}
