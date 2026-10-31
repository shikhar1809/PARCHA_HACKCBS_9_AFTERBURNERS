import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * The top bar. Title, an optional back arrow, and room for one action.
 *
 * Titles stay short because they have to survive a 360dp screen: the screen
 * says where you are, the subtitle says which patient.
 */
export function AppBar({
  title,
  subtitle,
  back,
  action,
  tone = "default",
}: {
  title: string;
  subtitle?: string;
  back?: string;
  action?: ReactNode;
  tone?: "default" | "accent";
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-1 border-b px-2 pt-3 pb-3",
        tone === "accent"
          ? "border-[var(--brand-deep)] bg-[var(--brand)] text-[var(--brand-deep)]"
          : "border-border bg-background",
      )}
    >
      {back ? (
        <Link
          to={back}
          aria-label="Back"
          className={cn(
            "-ml-1 flex size-11 shrink-0 items-center justify-center rounded-full",
            tone === "accent" ? "active:bg-black/10" : "active:bg-muted",
          )}
        >
          <ChevronLeft className="size-6" />
        </Link>
      ) : (
        <span className="w-2" />
      )}

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base leading-tight font-medium">{title}</h1>
        {subtitle ? (
          <p
            className={cn(
              "truncate text-xs leading-tight",
              tone === "accent" ? "text-[var(--brand-deep)]/75" : "text-muted-foreground",
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {action ? <div className="shrink-0 pr-1">{action}</div> : null}
    </header>
  );
}

export type TabItem = {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: number;
};

/**
 * The bottom tab bar.
 *
 * Counters are tabs rather than a menu because a compounder at a busy desk
 * should never have to find anything. Badges carry the queue depth, which is
 * the one number that decides where they go next.
 */
export function TabBar({
  items,
  current,
}: {
  items: TabItem[];
  current: string;
}) {
  return (
    <nav className="border-border bg-background flex shrink-0 border-t">
      {items.map((item) => {
        const active = current === item.href;
        return (
          <Link
            key={item.href}
            to={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-0.5 py-2.5",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span className="relative">
              {item.icon}
              {item.badge ? (
                <span className="bg-destructive absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium text-white">
                  {item.badge}
                </span>
              ) : null}
            </span>
            <span className="text-[11px] leading-none font-medium">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** A full-width primary action pinned above the tab bar or screen bottom. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="border-border bg-background shrink-0 border-t p-3">
      {children}
    </div>
  );
}
