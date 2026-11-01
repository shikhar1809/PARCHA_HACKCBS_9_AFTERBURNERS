/**
 * Pictures of the demo family's strips, drawn on the phone.
 *
 * A dose card is built round the photo of the strip, and a demo phone has
 * never had a strip held up to its camera. So for the demo handset only, each
 * of its medicines gets a drawn strip — front (the foil and the tablets, in a
 * colour of its own so two strips are never confused) and back (the printed
 * name, strength, batch and expiry, the way a real back reads).
 *
 * They are marked `sample`, and every screen that shows one says so: a drawing
 * passed off as a photo of the tablet in her hand would be exactly the kind of
 * reassurance this app must not fake. A real photo taken later replaces it.
 * Nothing is written over a strip that is already there.
 */
import { vaultGet, vaultPut } from "@parcha/client";
import type { Reminder } from "@parcha/core";

import { DEMO_PHONE } from "./demoParchas";
import { notifyStrips, type Strip } from "./strips";

const W = 640;
const H = 400;

/** A colour per medicine, from its name, so the same medicine always looks the same. */
function hue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function foil(ctx: CanvasRenderingContext2D, tint: string) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#e9ecef");
  g.addColorStop(0.45, "#c3c8cf");
  g.addColorStop(0.55, "#f5f6f8");
  g.addColorStop(1, "#b9bec6");
  ctx.fillStyle = "#2b2b2e";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = g;
  roundRect(ctx, 30, 40, W - 60, H - 80, 22);
  ctx.fill();
  ctx.fillStyle = tint;
  ctx.fillRect(30, 40, W - 60, 46);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws one side of a strip and returns it as a small JPEG, the size a real photo is kept at. */
export function drawStrip(title: string, side: "front" | "back"): string {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const h = hue(title);
  const tint = `hsl(${h} 65% 45%)`;
  const [name, ...rest] = title.split(" ");
  const strength = rest.join(" ");
  foil(ctx, tint);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 30px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(name.toUpperCase(), 52, 63);

  if (side === "front") {
    // Two rows of five tablets under clear blisters.
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 5; col++) {
        const cx = 100 + col * 110;
        const cy = 170 + row * 120;
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath();
        ctx.ellipse(cx, cy, 44, 40, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = `hsl(${h} 55% 78%)`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 28, 24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `hsl(${h} 40% 55%)`;
        ctx.beginPath();
        ctx.moveTo(cx - 20, cy);
        ctx.lineTo(cx + 20, cy);
        ctx.stroke();
      }
    }
    ctx.fillStyle = tint;
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(strength, W - 60 - ctx.measureText(strength).width, 63);
  } else {
    ctx.fillStyle = "#23262b";
    const lines = [
      `${name} Tablets IP ${strength}`.trim(),
      `Each tablet contains ${name} ${strength}`.trim(),
      "B.No. DM2611  MFG 08/2026  EXP 07/2028",
      "Store below 30°C. Keep out of reach of children.",
      "Rx only — to be sold on prescription",
    ];
    lines.forEach((text, i) => {
      ctx.font = i === 0 ? "bold 28px sans-serif" : "20px sans-serif";
      ctx.fillText(text, 52, 130 + i * 44, W - 104);
    });
  }
  // Said on the picture itself as well as beside it.
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, W - 186, H - 76, 150, 30, 15);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("SAMPLE PICTURE", W - 172, H - 61);
  return canvas.toDataURL("image/jpeg", 0.8);
}

const keyFor = (medicine: string) => `strip:${medicine.trim().toLowerCase()}`;

/** Gives each of the demo phone's medicines a drawn strip, if it has none. */
export async function seedDemoStrips(phone: string | null, reminders: Reminder[]): Promise<void> {
  if (phone !== DEMO_PHONE) return;
  let wrote = false;
  for (const r of reminders) {
    if (r.kind !== "medicine") continue;
    // Under the reminder's name and the bare medicine name, which is how a Parcha names it.
    const bare = r.title.replace(/\s+\d[\d.]*\s*(mg|mcg|g|ml|iu|%)?.*$/i, "").trim();
    const missing: string[] = [];
    for (const key of new Set([keyFor(r.title), keyFor(bare)])) {
      const have = await vaultGet<Strip>(key);
      if (!have?.front && !have?.back) missing.push(key);
    }
    if (!missing.length) continue;
    const drawn: Strip = { front: drawStrip(r.title, "front"), back: drawStrip(r.title, "back"), sample: true };
    for (const key of missing) await vaultPut(key, drawn);
    wrote = true;
  }
  if (wrote) notifyStrips();
}
