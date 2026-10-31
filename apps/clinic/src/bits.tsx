import { cn } from "@parcha/ui";
import type { ReactNode } from "react";

/** A bordered card with a hard shadow, the clinic's one container. */
export function Card({
  children,
  tone = "plain",
  className,
}: {
  children: ReactNode;
  tone?: "plain" | "warn" | "danger" | "ok";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border-[3px] border-[#232326] p-4 shadow-[3px_3px_0_#232326]",
        tone === "plain" && "bg-card",
        tone === "warn" && "bg-[var(--morning-soft)]",
        tone === "danger" && "bg-[oklch(0.94_0.05_25)]",
        tone === "ok" && "bg-[var(--brand-soft)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A small uppercase label over a block. */
export function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground mb-2 text-sm tracking-wide uppercase">
      {children}
    </p>
  );
}

/** Text inputs, selects and textareas share this. */
export const FIELD =
  "w-full rounded-xl border-[3px] border-[#232326] bg-card px-3 py-2.5 text-base outline-none focus:bg-[var(--brand-soft)]";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "primary" | "quiet" | "danger";
};

/** Buttons: coral for the action that matters, outlined for the rest. */
export function Btn({ kind = "quiet", className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] px-4 py-2.5 text-base shadow-[0_3px_0_#232326] transition active:translate-y-0.5 active:shadow-[0_1px_0_#232326] disabled:opacity-45 disabled:shadow-none",
        kind === "primary" && "bg-[var(--brand)]",
        kind === "quiet" && "bg-card hover:bg-[var(--hover-soft)]",
        kind === "danger" && "bg-[oklch(0.94_0.05_25)]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
