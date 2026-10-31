/**
 * Parcha for the desk: the clinic app (or the patient app) as a program.
 *
 * It is the same web app, in a window of its own. What the desktop adds: it
 * opens from the taskbar like any program, prints prescriptions through the
 * computer's own printers, and keeps its own copy of the data on the computer
 * (the app's encrypted local store lives in this program's profile, separate
 * from any browser).
 *
 * The web app is served from a private address, `app://parcha/`, out of the
 * files packed inside, not from a web server, so the window works the same
 * with no internet.
 */
const { app, BrowserWindow, ipcMain, Menu, net, protocol, session, shell } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEV = process.argv.includes("--dev");
const WEB = path.join(__dirname, "web");

function packedApp() {
  try {
    return JSON.parse(fs.readFileSync(path.join(WEB, "app.json"), "utf8")).app;
  } catch {
    return null;
  }
}
const WHICH = process.env.PARCHA_APP || packedApp() || "clinic";
const TITLE = WHICH === "patient" ? "Parcha" : "Parcha Clinic";
const DEV_URL = WHICH === "patient" ? "http://localhost:3001" : "http://localhost:3000";

// The private address must be declared before the app is ready, so the web app
// gets a real origin: it can use its local store and sign in.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// One window per computer: opening it again brings the first to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

function windowState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "window.json"), "utf8"));
  } catch {
    return { width: 1280, height: 820 };
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try {
    fs.writeFileSync(path.join(app.getPath("userData"), "window.json"), JSON.stringify({ ...win.getNormalBounds(), maximised: win.isMaximized() }));
  } catch {
    /* losing the window position is not worth a crash */
  }
}

function createWindow() {
  const state = windowState();
  win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    title: TITLE,
    backgroundColor: "#faf5ea",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (state.maximised) win.maximize();

  win.loadURL(DEV ? DEV_URL : "app://parcha/");

  // Anything that is not this app opens in the person's browser, not in here.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const ours = url.startsWith("app://parcha/") || (DEV && url.startsWith(DEV_URL));
    if (!ours) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  // `PARCHA_SMOKE=1 npm run start:built` loads the app, says what appeared, and quits.
  if (process.env.PARCHA_SMOKE) {
    win.webContents.on("did-fail-load", (_e, code, desc, url) => {
      console.log(JSON.stringify({ smoke: "failed", code, desc, url }));
      app.exit(1);
    });
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const info = await win.webContents.executeJavaScript(
          "({ url: location.href, title: document.title, secure: isSecureContext, vault: typeof indexedDB !== `undefined`, desktop: !!window.parchaDesktop, text: document.body.innerText.slice(0, 120) })",
        );
        console.log(JSON.stringify({ smoke: "ok", ...info }));
        app.exit(0);
      }, 7000);
    });
  }

  win.on("close", saveWindowState);
  win.on("closed", () => {
    win = null;
  });
}

function buildMenu() {
  const print = { label: "Print…", accelerator: "CmdOrCtrl+P", click: () => win?.webContents.print() };
  const template = [
    { label: "File", submenu: [print, { type: "separator" }, { role: "quit", label: "Quit" }] },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "zoomIn", accelerator: "CmdOrCtrl+=" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        ...(DEV ? [{ type: "separator" }, { role: "toggleDevTools" }] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Serve the packed web app. Anything that is not a file is the app's own page
  // (it does its own routing), so a reload on /doctor/123 still opens.
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || !path.extname(rel)) rel = "/index.html";
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB)) return new Response("Not allowed", { status: 403 });
    if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // What the page may load and talk to. The emulators and Google's servers are
  // the only outside places the app uses; everything else is refused.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (DEV || !details.url.startsWith("app://")) return callback({ responseHeaders: details.responseHeaders });
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
            "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
            "img-src 'self' data: blob: https://tile.openstreetmap.org; " +
            "connect-src 'self' http://127.0.0.1:* http://localhost:* https://*.googleapis.com https://*.cloudfunctions.net https://*.run.app wss://*.firebaseio.com; " +
            "frame-src blob:",
        ],
      },
    });
  });

  // Microphone for dictation and notifications for alerts; nothing else.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(["media", "notifications", "clipboard-sanitized-write", "geolocation"].includes(permission)));

  // Where the computer is. Electron's own location asks a Google service that
  // needs an API key, so on Windows ask Windows directly (its location service,
  // through .NET's GeoCoordinateWatcher). Elsewhere the page falls back to the
  // browser's location.
  ipcMain.handle("parcha:location", () => windowsLocation());

  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

const LOCATE = [
  "Add-Type -AssemblyName System.Device;",
  "$w = New-Object System.Device.Location.GeoCoordinateWatcher('High');",
  "$null = $w.TryStart($false, [TimeSpan]::FromSeconds(10));",
  "$end = (Get-Date).AddSeconds(15);",
  "while (($w.Status -ne 'Ready' -or $w.Position.Location.IsUnknown) -and (Get-Date) -lt $end) { Start-Sleep -Milliseconds 250 }",
  "$l = $w.Position.Location; $w.Stop();",
  "if ($l.IsUnknown) { 'null' } else { ConvertTo-Json -Compress @{ lat = $l.Latitude; lng = $l.Longitude; accuracy = [math]::Round($l.HorizontalAccuracy) } }",
].join(" ");

/** The computer's position from Windows, or null (not Windows, location off, or no fix). */
function windowsLocation() {
  if (process.platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", LOCATE], { timeout: 25_000, windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      try {
        const v = JSON.parse(String(out).trim());
        resolve(v && Number.isFinite(v.lat) && Number.isFinite(v.lng) ? v : null);
      } catch {
        resolve(null);
      }
    });
  });
}
