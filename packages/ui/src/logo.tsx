import { cn } from "./cn";

/**
 * The Parcha mark: a document, drawn neobrutalist. Thick charcoal outline, a
 * folded corner in mint, a cream page with a coral "p" outlined in charcoal,
 * and a hard coral offset shadow with no blur. A prescription is a piece of
 * paper, so the mark is one.
 *
 * Drawn as paths rather than set in a font, so it is the same on every
 * handset and matches the favicon exactly.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="Parcha"
      className={cn("size-14", className)}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {/* hard shadow */}
      <path d="M10 6H36L48 18V54H10Z" transform="translate(5 5)" fill="#ff7f5a" stroke="#232326" strokeWidth="4" />
      {/* page */}
      <path d="M10 6H36L48 18V54H10Z" fill="#faf5ea" stroke="#232326" strokeWidth="4" />
      {/* folded corner */}
      <path d="M36 6V18H48" fill="#adefc4" stroke="#232326" strokeWidth="4" />
      {/* the p: a charcoal outline under a coral stroke */}
      <g fill="none">
        <path d="M23 27V48" stroke="#232326" strokeWidth="10" />
        <circle cx="30" cy="34" r="7" stroke="#232326" strokeWidth="10" />
        <path d="M23 27V48" stroke="#ff7f5a" strokeWidth="4" />
        <circle cx="30" cy="34" r="7" stroke="#ff7f5a" strokeWidth="4" />
      </g>
    </svg>
  );
}

/**
 * The word "Parcha", with the mark standing in for the P.
 *
 * The mark is sized in em so it scales with the text around it, and sits on
 * the baseline so its stem drops through like the descender of a real p.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Parcha"
      className={cn(
        "inline-flex items-end font-bold tracking-tight text-[var(--brand-deep)]",
        className,
      )}
    >
      <Logo className="size-[1.25em] -mr-[0.12em] -mb-[0.2em]" />
      <span aria-hidden className="leading-[0.95]">
        archa
      </span>
    </span>
  );
}
