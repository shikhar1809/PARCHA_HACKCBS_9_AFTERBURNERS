/**
 * The exact words a finding came from, cut out of the photo and boxed, so the
 * person can see what the phone read without hunting for it on a small screen.
 */
import type { Box } from "@parcha/core";

export function PhotoCrop({ picture, size, box, width = 150, tone = "sure" }: { picture: string; size: { w: number; h: number }; box: Box; width?: number; tone?: "sure" | "check" }) {
  const padX = Math.max(24, (box.x1 - box.x0) * 0.3);
  const padY = Math.max(16, (box.y1 - box.y0) * 0.8);
  const x0 = Math.max(0, box.x0 - padX);
  const y0 = Math.max(0, box.y0 - padY);
  const w = Math.min(size.w, box.x1 + padX) - x0;
  const h = Math.min(size.h, box.y1 + padY) - y0;
  const scale = width / w;
  return (
    <span className="relative block shrink-0 overflow-hidden rounded-lg border-2 border-[#232326] bg-white" style={{ width, height: Math.max(32, h * scale) }}>
      <img src={picture} alt="" className="absolute max-w-none" style={{ width: size.w * scale, left: -x0 * scale, top: -y0 * scale }} />
      <span
        className={`absolute rounded-sm border-2 ${tone === "sure" ? "border-[#2f9e5b]" : "border-[#f5a524]"}`}
        style={{ left: (box.x0 - x0) * scale - 3, top: (box.y0 - y0) * scale - 3, width: (box.x1 - box.x0) * scale + 6, height: (box.y1 - box.y0) * scale + 6 }}
      />
    </span>
  );
}
