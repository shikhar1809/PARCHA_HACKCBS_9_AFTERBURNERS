import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { VitePWA } from "vite-plugin-pwa";

const pkg = (name: string) =>
  path.resolve(import.meta.dirname, `../../packages/${name}/src`);

/**
 * Reading a bill or a strip happens on the phone (Tesseract, in WebAssembly).
 * Its worker, engine and English model are served from this app itself, so
 * nothing is fetched from anywhere else and no photo leaves the phone. Copied
 * into public/ocr (not in git) whenever the app is served or built.
 */
const modules = path.resolve(import.meta.dirname, "../../node_modules");
const OCR_FILES: [string, string][] = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "eng.traineddata.gz"],
];
const ocrDir = path.resolve(import.meta.dirname, "public/ocr");
mkdirSync(ocrDir, { recursive: true });
for (const [from, to] of OCR_FILES) {
  const src = path.join(modules, from);
  const dst = path.join(ocrDir, to);
  if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) copyFileSync(src, dst);
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable on Android from the browser, and usable with no connection:
    // the app shell is cached by a service worker, and so are the fonts and the
    // map tiles already seen. Data is not cached here; Firestore keeps its own
    // offline copy.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Parcha",
        short_name: "Parcha",
        description: "Your prescriptions, medicine schedule and records, in one place.",
        lang: "en-IN",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#faf5ea",
        theme_color: "#ff7f5a",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      // The service worker also runs in dev, so notifications can be tried on
      // localhost without building.
      devOptions: { enabled: true, type: "classic", navigateFallback: "index.html" },
      workbox: {
        // Notification buttons (Taken / Later): see public/sw-notify.js.
        importScripts: ["/sw-notify.js"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/__\//, /^\/emulator\//],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // The map chunk is large and only some screens use it: fetch it on
        // first use, then keep it.
        globIgnores: ["**/map-*.js", "**/map-*.css", "ocr/**"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // The text reader (about 6 MB): fetched the first time a bill is read, then kept.
            urlPattern: /\/ocr\/.*$/,
            handler: "CacheFirst",
            options: { cacheName: "ocr", expiration: { maxEntries: 8 } },
          },
          {
            urlPattern: /\/assets\/map-.*\.(js|css)$/,
            handler: "CacheFirst",
            options: { cacheName: "map-code", expiration: { maxEntries: 4 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "fonts", expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/,
            handler: "CacheFirst",
            options: { cacheName: "map-tiles", expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 14 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // The shared packages are plain source, compiled by Vite along with the
      // app rather than pre-built, so an edit in core or ui is picked up by
      // both apps with no build step in between.
      "@parcha/core": pkg("core"),
      "@parcha/ui": pkg("ui"),
      "@parcha/client": pkg("client"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Third-party code changes rarely, so it is cached apart from the app
        // and a new release re-downloads only what changed. On a slow phone
        // connection that is the difference between seconds and a minute.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("firebase") || id.includes("@firebase")) return "firebase";
          if (id.includes("leaflet")) return "map";
          if (/react|scheduler|react-router/.test(id)) return "react";
          return "vendor";
        },
      },
    },
  },
  server: { host: "localhost" },
});
