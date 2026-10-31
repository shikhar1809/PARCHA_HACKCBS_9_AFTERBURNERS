import { Logo, cn } from "@parcha/ui";
import type { ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";

/**
 * A consultation is the doctor's whole screen: no sidebar, no queue beside it,
 * so the dossier and the pad get every pixel. The queue is one Back away.
 */
export function useFocusMode(): boolean {
  const { pathname } = useLocation();
  return /^\/doctor\/(?!requests\/)[^/]+\/?$/.test(pathname);
}

/**
 * Master and detail.
 *
 * On a wide screen the list stays put on the left and the selected patient
 * opens beside it, so a compounder never loses the queue and a doctor reads
 * the dossier with the next patient in view. On a phone there is room for
 * only one, so it shows the detail when one is open and the list otherwise.
 *
 * It is a layout route, so the list is not remounted as you move between
 * patients: a typed phone number and the scroll position both survive.
 */
export function Split({ base, master }: { base: string; master: ReactNode }) {
  const { pathname } = useLocation();
  const detailOpen = pathname.replace(/\/$/, "") !== base;
  const focus = useFocusMode();

  return (
    <div className="flex min-h-0 flex-1">
      <section
        className={cn(
          "min-h-0 w-full flex-col lg:w-[27rem] lg:shrink-0 lg:border-r-[3px] lg:border-[#232326]",
          detailOpen ? "hidden" : "flex",
          !focus && "lg:flex",
        )}
      >
        {master}
      </section>
      <section
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col lg:flex",
          detailOpen ? "flex" : "hidden",
        )}
      >
        <Outlet />
      </section>
    </div>
  );
}

/** What the detail side says when nothing is selected yet. */
export function Pick({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="m-auto max-w-sm p-8 text-center">
      <Logo className="mx-auto size-24" />
      <p className="mt-6 text-2xl leading-tight">{title}</p>
      <p className="text-muted-foreground mt-2 text-base leading-relaxed">
        {detail}
      </p>
    </div>
  );
}

/** A page with no list beside it: centred, and never stretched edge to edge. */
export function Single({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col lg:border-x-[3px] lg:border-[#232326]/15">
      {children}
    </div>
  );
}
