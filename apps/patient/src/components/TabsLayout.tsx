import { cn } from "@parcha/ui";
import { AlarmClock, FileText, HeartHandshake, Home, MessageCircle, User } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { setFullAppFor, useFullAppFor } from "./full-app";
import { useActivePerson } from "./people";
import { SwitchBar } from "./switcher";
import { useT } from "../i18n";


const TABS = [
  { href: "/", label: ["Overview", "सारांश", "Overview"], icon: Home },
  { href: "/schedule", label: ["Medicines", "दवाई", "Dawai"], icon: AlarmClock },
  // In the middle: the Parchas, and the way to add a new one.
  { href: "/records", label: ["Parchas", "पर्चे", "Parche"], icon: FileText },
  { href: "/ask", label: ["Ask", "पूछें", "Poochhein"], icon: MessageCircle },
  { href: "/me", label: ["Me", "मैं", "Main"], icon: User },
] as const;

/**
 * The bottom bar for the five places a patient lives. A picture and a word on
 * each, with one highlight that slides to the tab you chose. Focused flows
 * (booking, one visit) sit outside it so nothing competes with the task.
 */
export function TabsLayout() {
  const t = useT();
  const { pathname } = useLocation();
  const index = Math.max(
    0,
    TABS.findIndex(({ href }) => (href === "/" ? pathname === "/" : pathname.startsWith(href))),
  );
  const me = useActivePerson();
  const fullFor = useFullAppFor();
  return (
    <>
      {/* The full app opened from someone's simple screen: one tap back to it. */}
      {me?.needsHelp && fullFor === me.name ? (
        <button
          type="button"
          onClick={() => setFullAppFor(null)}
          className="flex shrink-0 items-center justify-center gap-2 border-b-[3px] border-[#232326] bg-[var(--brand-soft)] px-4 py-2.5 text-base font-bold"
        >
          <HeartHandshake className="size-5" aria-hidden /> {t(`Back to ${me.shown}'s simple screen`, `${me.shown} की आसान स्क्रीन पर वापस`, `${me.shown} ki simple screen par wapas`)}
        </button>
      ) : null}
      {/* Whose turn it is on a shared phone, and the switch. */}
      <SwitchBar />
      {/* Keyed by the screen, so each one arrives with a short fade and slide. */}
      <div key={pathname} className="page-in flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
      {/* Big targets, and clear of the phone's own buttons: the bottom padding is the
          system area where a phone reports one (the Android app also sits above it). */}
      <nav
        aria-label="Main"
        className="relative grid shrink-0 grid-cols-5 border-t-[3px] border-[#232326] bg-[var(--color-background)] px-1.5 pt-2"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <span
          aria-hidden
          className="tab-pill pointer-events-none absolute top-2 left-1.5 rounded-2xl border-[3px] border-[#232326] bg-[var(--chosen)] shadow-[0_3px_0_#232326]"
          style={{ width: "calc((100% - 0.75rem) / 5)", bottom: "max(0.5rem, env(safe-area-inset-bottom))", transform: `translateX(${index * 100}%)` }}
        />
        {TABS.map(({ href, label, icon: Icon }, i) => (
          <Link
            key={href}
            to={href}
            aria-current={i === index ? "page" : undefined}
            className={cn("relative z-10 flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl text-[0.95rem] leading-tight font-bold")}
          >
            <Icon className="size-7" strokeWidth={2.4} aria-hidden />
            {t(label[0], label[1], label[2])}
          </Link>
        ))}
      </nav>
    </>
  );
}
