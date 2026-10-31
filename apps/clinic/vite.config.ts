import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// @ts-expect-error a plain .mjs build helper, no types
import { ensureSpeechAssets } from "./scripts/speech-assets.mjs";

const pkg = (name: string) =>
  path.resolve(import.meta.dirname, `../../packages/${name}/src`);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The on-device speech engine (Whisper) and its runtime, served from public/asr.
    { name: "speech-assets", buildStart: () => ensureSpeechAssets(import.meta.dirname) },
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
          // The speech engine is loaded only when a doctor first speaks.
          if (id.includes("@huggingface/transformers") || id.includes("onnxruntime")) return "speech";
          // The 3D view of the clinic is one tab inside Management: without
          // this three.js falls into "vendor" and every desk downloads it at
          // start-up, which is most of a megabyte nobody asked for.
          if (/node_modules[\/]three[\/]/.test(id)) return "three";
          if (/react|scheduler|react-router/.test(id)) return "react";
          return "vendor";
        },
      },
    },
  },
  server: { host: "localhost" },
});
