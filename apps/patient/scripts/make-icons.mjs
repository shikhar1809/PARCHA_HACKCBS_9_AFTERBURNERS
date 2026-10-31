/**
 * Draws the app icons and the splash from public/favicon.svg.
 *
 *   node scripts/make-icons.mjs
 *
 * Writes the web icons to public/icons and the sources `@capacitor/assets`
 * needs to assets/. Run it again if the logo changes.
 */
import fs from "node:fs";
import sharp from "sharp";

const svg = fs.readFileSync("public/favicon.svg");
const CREAM = "#faf5ea";
const CORAL = "#ff7f5a";

/** The logo, scaled to `size` pixels square. */
const logo = (size) => sharp(svg, { density: 384 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

/** The logo centred on a flat colour. */
async function onColour(canvas, colour, logoSize) {
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: colour } })
    .composite([{ input: await logo(logoSize), gravity: "centre" }])
    .png()
    .toBuffer();
}

fs.mkdirSync("public/icons", { recursive: true });
fs.mkdirSync("assets", { recursive: true });

// Web app icons. The "maskable" one keeps the logo inside the middle 60% so a
// round or squircle crop never cuts it.
fs.writeFileSync("public/icons/icon-192.png", await onColour(192, CREAM, 150));
fs.writeFileSync("public/icons/icon-512.png", await onColour(512, CREAM, 400));
fs.writeFileSync("public/icons/maskable-512.png", await onColour(512, CORAL, 300));
fs.writeFileSync("public/icons/apple-touch-icon.png", await onColour(180, CREAM, 140));

// Android launcher icon and splash sources.
fs.writeFileSync("assets/icon-only.png", await onColour(1024, CREAM, 760));
fs.writeFileSync("assets/icon-foreground.png", await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await logo(560), gravity: "centre" }]).png().toBuffer());
fs.writeFileSync("assets/icon-background.png", await sharp({ create: { width: 1024, height: 1024, channels: 4, background: CORAL } }).png().toBuffer());
fs.writeFileSync("assets/splash.png", await onColour(2732, CREAM, 720));
fs.writeFileSync("assets/splash-dark.png", await onColour(2732, "#232326", 720));
console.log("icons written");
