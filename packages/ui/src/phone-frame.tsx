import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * The 9:16 portrait shell.
 *
 * Both apps are built for a phone held in one hand, so every screen is laid
 * out at phone width. On a desktop browser this centres that phone inside a
 * frame at a true 9:16 aspect ratio, which is how you preview the thing
 * during development; on an actual phone the frame drops away and the app
 * fills the viewport.
 *
 * `tint` colours the frame surround only, so the two apps are
 * distinguishable at a glance when both are open side by side.
 */
export function PhoneFrame({
  children,
  tint = "slate",
  label,
}: {
  children: ReactNode;
  tint?: "slate" | "teal" | "coral";
  label?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-dvh w-full flex-col items-center justify-center p-0",
        "sm:p-6",
        tint === "teal"
          ? "sm:bg-teal-950"
          : tint === "coral"
            ? "sm:bg-[#ff7f5a]"
            : "sm:bg-zinc-900",
      )}
    >
      {label ? (
        <p
          className={cn(
            "hidden pb-3 text-xs font-medium tracking-wide uppercase sm:block",
            tint === "coral" ? "text-black/55" : "text-white/50",
          )}
        >
          {label}
        </p>
      ) : null}

      <div
        className={cn(
          // Phone: exactly the screen, so the tab bar stays pinned to the bottom
          // and each screen scrolls inside it (a frame that grew with the page
          // pushed the bar off the screen, under the phone's own buttons).
          // Desktop: a 9:16 frame, height-capped so it never runs off a laptop screen.
          "bg-background relative flex w-full flex-col overflow-hidden",
          "h-dvh",
          "sm:aspect-[9/16] sm:min-h-0 sm:h-[min(88dvh,820px)] sm:w-auto",
          "sm:rounded-[2.5rem] sm:border-[10px] sm:border-zinc-950 sm:shadow-2xl",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The scrollable body of a screen. Scrolling is confined here so the app bar
 * and tab bar stay put, the way they would in a native app.
 */
export function Screen({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("flex-1 overflow-y-auto overscroll-contain", className)}>
      {children}
    </main>
  );
}
