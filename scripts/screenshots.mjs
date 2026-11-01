/**
 * Takes the screenshots used in the README, from the running demo.
 *
 *   npm run emulators ; npm run seed ; npm run dev:clinic ; npm run dev:patient
 *   node scripts/screenshots.mjs            (all)
 *   node scripts/screenshots.mjs patient    (just one app)
 *
 * It drives Chrome through its DevTools protocol (no extra packages; needs
 * Chrome or Edge, and Node 22+ for the built-in WebSocket) and signs in with the
 * demo accounts, so what it shows is exactly what DEMO.md describes. Images go to
 * docs/screenshots/.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = new URL("../docs/screenshots/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(OUT, { recursive: true });

const CHROME = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("Chrome or Edge not found. Set CHROME to its path.");

const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const which = process.argv[2] ?? "all";

const chrome = spawn(
  CHROME,
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "parcha-shots-"))}`, "--headless=new", "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank"],
  { stdio: "ignore" },
);
process.on("exit", () => chrome.kill());

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = tabs.find((t) => t.type === "page");
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

const ws = await connect();
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    const { ok, fail } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
  }
};
const cdp = (method, params = {}) =>
  new Promise((ok, fail) => {
    const n = ++id;
    waiting.set(n, { ok, fail });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

/** Evaluates in the page; awaits promises. */
async function js(expression) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "page error");
  return r.result.value;
}

async function size(width, height, mobile) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1.5, mobile });
}

async function go(url, settle = 2500) {
  await cdp("Page.navigate", { url });
  await sleep(settle);
  // The opening animation can be tapped through.
  await js(`[...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.trim() === "Tap to skip")?.click()`).catch(() => undefined);
  await sleep(1200);
}

/** Clicks the first visible element whose text contains `text`. */
async function click(text, selector = "button,a,[role=button],[role=radio],[role=tab],summary") {
  const ok = await js(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = els.find((e) => e.offsetParent !== null && e.textContent.replace(/\\s+/g, " ").trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`nothing to click: ${text}`);
  await sleep(900);
}

/** Types into the first visible input with this placeholder (React-safe). */
async function type(placeholder, value) {
  const ok = await js(`(() => {
    const el = [...document.querySelectorAll("input,textarea")].find((e) => e.offsetParent !== null && (e.placeholder || "").includes(${JSON.stringify(placeholder)}));
    if (!el) return false;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`no input: ${placeholder}`);
  await sleep(500);
}

async function shot(name, full = false) {
  await sleep(500);
  const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log("  ", name);
}

const text = () => js("document.body.innerText");

// ---------------------------------------------------------------- clinic
async function clinic() {
  console.log("clinic");
  await cdp("Page.enable");
  await size(1440, 900, false);
  // The clinic app opens a session with this computer's location first: say it is at the clinic.
  await cdp("Browser.grantPermissions", { origin: "http://localhost:3000", permissions: ["geolocation"] });
  await cdp("Emulation.setGeolocationOverride", { latitude: 28.6316, longitude: 77.2168, accuracy: 20 });

  await go("http://localhost:3000/");
  await js("localStorage.clear(); sessionStorage.clear()");
  await go("http://localhost:3000/");
  await shot("clinic-sign-in");

  // The front desk, at the large demo hospital.
  await click("Rohini City Hospital");
  await sleep(3000);
  await go("http://localhost:3000/desk", 4000);
  await shot("clinic-desk");

  // Messages: "@rx" puts today's active prescription in the line, with a quick view.
  try {
    await click("", 'button[aria-label^="Messages"]');
    await sleep(2500);
    await click("general");
    await sleep(3000);
    await type("Message #general", "Please give out @rx");
    await sleep(1500);
    await click("Active prescription", "[role=listbox] button");
    await click("", 'button[aria-label="Send"]');
    await sleep(3000);
    await js(`[...document.querySelectorAll('button[title="Open it"], button[title="Show it"]')].at(-1)?.focus()`);
    await sleep(2500);
    await shot("clinic-messages");
    await js(`document.activeElement?.blur()`);
  } catch (e) {
    console.log("  (messages skipped:", e.message + ")");
  }

  await type("Phone number", "9811044321");
  await click("Look up");
  await sleep(1500);

  await go("http://localhost:3000/team", 9000);
  await shot("clinic-team");

  // The Manage page, behind the PIN.
  await go("http://localhost:3000/manage", 3000);
  await js(`(() => { const i = document.querySelector('input[aria-label="Manage PIN"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "1234"); i.dispatchEvent(new Event("input", { bubbles: true })); i.form.requestSubmit(); })()`);
  await sleep(15000);
  await shot("clinic-manage");

  // A waiting patient's intake form
  await go("http://localhost:3000/desk", 3000);
  const href = await js(`(document.querySelector('a[href^="/intake/"]') || {}).getAttribute?.("href") || ""`);
  if (href) {
    await go(`http://localhost:3000${href}`, 3500);
    await shot("clinic-intake", true);
  }

  // The doctor
  await js("[...document.querySelectorAll('button')].find(b => /sign out/i.test(b.textContent))?.click()");
  await sleep(2500);
  await go("http://localhost:3000/", 2500);
  await click("Dr. A. Khan");
  await sleep(3500);
  await go("http://localhost:3000/doctor", 4000);
  await shot("clinic-doctor-queue");

  const visit = await js(`(document.querySelector('a[href^="/doctor/"]:not([href*="requests"])') || {}).getAttribute?.("href") || ""`);
  if (visit) {
    await go(`http://localhost:3000${visit}`, 3500);
    await shot("clinic-consultation");

    // Two medicines that should not go together: the safety check stops the signature until it is read.
    await click("Prescribe");
    for (const drug of ["prednis", "ibupro"]) {
      await type("Medicine, brand, formula", drug);
      await sleep(900);
      await click("", "[role=option] button");
    }
    await type("What you found", "Knee pain with swelling");
    await sleep(2500);
    await shot("clinic-prescribe-safety", true);
    await js(`[...document.querySelectorAll("[role=checkbox]")].filter((c) => c.getAttribute("aria-checked") !== "true").forEach((c) => c.click())`);
    await sleep(800);
    await js(`[...document.querySelectorAll("button")].find((b) => /Sign and print/.test(b.textContent))?.scrollIntoView({ block: "end" })`);
    await click("Sign and print");
    await sleep(3500);
    await shot("clinic-prescription-signed", true);
  }

  // First runs: a clinic that is not set up yet, and a doctor with no profile.
  for (const [email, name] of [["solo@parcha.test", "clinic-setup"], ["doctor3@parcha.test", "clinic-doctor-profile"]]) {
    await js("[...document.querySelectorAll('button')].find(b => /sign out/i.test(b.textContent))?.click()");
    await sleep(2500);
    await go("http://localhost:3000/", 2500);
    try {
      await type("Email", email);
      await type("Password", "parcha123");
      await click("Sign in");
      await sleep(8000);
      await shot(name);
    } catch (e) {
      console.log(`  (${name} skipped:`, e.message + ")");
    }
  }
}

// ---------------------------------------------------------------- patient
async function patient() {
  console.log("patient");
  await cdp("Page.enable");
  await size(390, 844, true);

  await go("http://localhost:3001/");
  await js("localStorage.clear(); sessionStorage.clear()");
  await go("http://localhost:3001/", 3000);

  // The README is in English; the app starts in Hindi.
  await click("English");
  // One family phone: Priya, Prashant and Prabha (the one the demo offers, filled in).
  await click("9811044321");
  await sleep(2500);
  // The Auth emulator keeps the one-time codes it "sent".
  const codes = await (await fetch("http://127.0.0.1:9099/emulator/v1/projects/parcha-dev/verificationCodes")).json();
  const code = codes.verificationCodes.filter((c) => c.phoneNumber.endsWith("9811044321")).at(-1).code;
  await type("", code);
  await click("Open my records");
  await sleep(5000);
  // The privacy notice comes first on a phone that has not agreed yet.
  await click("I agree, continue").catch(() => undefined);
  await sleep(3000);
  // A shared phone asks who is using it.
  await shot("patient-who-is-using");
  await click("Prashant");
  await sleep(3000);
  await shot("patient-home");

  // The prescription as pictures.
  await click("Medicines");
  await sleep(3000);
  await shot("patient-prescription", true);
  await go("http://localhost:3001/", 3500);

  // A new visit: the map, one hospital suggested and why, Next always in view.
  try {
    await click("New visit");
    await sleep(1500);
    await click("I have a new problem");
    await type("What is wrong", "Bukhar aur khaansi, do din se");
    await click("Next");
    await sleep(5000);
    await shot("patient-new-visit");
  } catch (e) {
    console.log("  (new visit skipped:", e.message + ")");
  }
  await go("http://localhost:3001/", 3500);

  for (const [tab, name] of [["Medicines", "patient-schedule"], ["Visits", "patient-visits"], ["Parchas", "patient-records"], ["Me", "patient-me"]]) {
    await click(tab, "nav a");
    await sleep(2500);
    await shot(name);
  }

  // Designing a person's face (one section opens for the details).
  try {
    await click("Dadi", "button");
    await sleep(1500);
    await click("Change the picture", "summary");
    await shot("patient-profile-editor", true);
  } catch (e) {
    console.log("  (profile editor skipped:", e.message + ")");
  }

  // The same phone, handed to someone who needs help: one big simple screen.
  try {
    await go("http://localhost:3001/", 3500);
    await click("Switch");
    await sleep(1200);
    await click("Dadi", "button");
    await sleep(2500);
    await shot("patient-easy-mode");
  } catch (e) {
    console.log("  (easy mode skipped:", e.message + ")");
  }
}

if (which === "all" || which === "clinic") await clinic();
if (which === "all" || which === "patient") await patient();
chrome.kill();
process.exit(0);
