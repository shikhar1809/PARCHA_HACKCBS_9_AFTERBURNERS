import { setMyDuty, useHospital, useMyDutySwitch, useQueue, useTodaysVisits } from "@parcha/client";
import { cn, TabBar, Wordmark, type TabItem } from "@parcha/ui";
import {
  Building2,
  ClipboardList,
  Loader2,
  History,
  KeyRound,
  LogOut,
  Network,
  Pill,
  Repeat,
  ReceiptIndianRupee,
  Stethoscope,
  User,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { can, demoMode, openAfterSwitch, signOutOfClinic, switchSeat, useIdentity } from "./auth";
import { SEATS } from "./screens/seats";
import { useFocusMode } from "./Shell";

/**
 * The counters this account can reach, and which one is current.
 *
 * The badges are live Firestore counts, so a doctor sees the queue grow the
 * moment the desk sends somebody through, without a refresh and without
 * polling. Shared by the phone tab bar and the desktop sidebar so the two can
 * never disagree about where you are.
 */
function useNav(): { items: TabItem[]; current: string } | null {
  const { identity } = useIdentity();
  const { pathname } = useLocation();

  // Each account counts only its own queue, and only if it has one.
  // A seat may work at both counters (a doctor on their own), one, or neither.
  const isDoctor = identity?.counters.includes("doctor") ?? false;
  const isDesk = identity?.counters.includes("compounder") ?? false;
  // The desk's badge is the requests nobody has picked up yet.
  const unclaimed = useQueue(["requested"], undefined, isDesk);
  const doctorQueue = useQueue(
    ["intake_complete", "in_consultation"],
    { doctorUid: identity?.uid },
    isDoctor,
  );
  // Requests waiting on this doctor count towards their badge too.
  const asks = useQueue(["proposed"], { doctorUid: identity?.uid }, isDoctor);
  // The pharmacy and the billing desk count from today's visits.
  const dispenses = !!identity && can(identity, "dispense");
  const bills = !!identity && can(identity, "billing");
  const today = useTodaysVisits(dispenses || bills);
  const toGive = today.data.filter((v) => v.stage === "prescribed" && !v.dispensedAt).length;
  const toBill = today.data.filter((v) => !["cancelled", "requested", "proposed"].includes(v.stage) && (typeof v.billTotal !== "number" || !v.paid)).length;

  if (!identity) return null;

  // The counters this seat works at, then the team, the log and Manage if the seat has them, then Me.
  const items: TabItem[] = [
    ...(isDesk
      ? [{ href: "/desk", label: "Desk", icon: <ClipboardList className="size-5" />, badge: unclaimed.data.length }]
      : []),
    ...(isDoctor
      ? [{ href: "/doctor", label: "Queue", icon: <Stethoscope className="size-5" />, badge: doctorQueue.data.length + asks.data.length }]
      : []),
    ...(dispenses ? [{ href: "/pharmacy", label: "Pharmacy", icon: <Pill className="size-5" />, badge: toGive }] : []),
    ...(bills ? [{ href: "/billing", label: "Billing", icon: <ReceiptIndianRupee className="size-5" />, badge: toBill }] : []),
    { href: "/team", label: "Team", icon: <Network className="size-5" /> },
    ...(can(identity, "activity") ? [{ href: "/activity", label: "Activity", icon: <History className="size-5" /> }] : []),
    ...(can(identity, "manage") ? [{ href: "/manage", label: "Manage", icon: <KeyRound className="size-5" /> }] : []),
    { href: "/me", label: "Me", icon: <User className="size-5" /> },
  ];

  // A tab stays lit while you are deeper inside it, so somebody reading a
  // dossier still sees which counter they are working at.
  const current =
    items.find((i) => pathname === i.href)?.href ??
    items.find((i) => i.href !== "/" && pathname.startsWith(i.href))?.href ??
    (pathname.startsWith("/intake") ? "/desk" : "");

  return { items, current };
}

/** The phone layout's bottom bar. Hidden once there is room for the sidebar. */
export function Tabs() {
  const nav = useNav();
  const { identity } = useIdentity();
  const hospital = useHospital(identity?.hospitalId || null);
  const focus = useFocusMode();
  if (!nav || focus) return null;
  return (
    <div className="lg:hidden">
      {hospital.data?.name ? (
        <p className="truncate border-t-2 border-[#232326]/15 bg-[var(--brand-soft)] px-4 py-1 text-center text-xs font-bold">
          {hospital.data.name} · {identity?.seatName ?? identity?.displayName}
        </p>
      ) : null}
      <TabBar items={nav.items} current={nav.current} />
    </div>
  );
}

/** The desktop layout's sidebar. Hidden on a phone. */
export function Sidebar() {
  const nav = useNav();
  const { identity } = useIdentity();
  const hospital = useHospital(identity?.hospitalId || null);
  const focus = useFocusMode();
  if (!nav || !identity || focus) return null;

  return (
    // It always fits the window: the links are compact, and on a short screen
    // the whole column scrolls rather than hiding the duty switch and the role.
    <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r-[3px] border-[#232326] bg-[var(--brand)] p-3 text-[var(--brand-deep)] lg:flex">
      <h1 className="px-2 pt-1 pb-4 text-3xl">
        <Wordmark />
      </h1>

      <nav className="flex flex-col gap-1">
        {nav.items.map((item) => {
          const active = nav.current === item.href;
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-2xl border-[3px] px-3 py-2 text-base",
                active
                  ? "border-[#232326] bg-[var(--color-background)] shadow-[3px_3px_0_#232326]"
                  : "border-transparent hover:bg-black/10",
              )}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.badge ? (
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#232326] px-1.5 text-sm text-white">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2 pt-4">
        <DutySwitch />
        <RoleSwitcher hospitalName={hospital.data?.name ?? null} />
      </div>
    </aside>
  );
}

/** On or off duty: off stays off until switched on, so a break needs no signing out. */
function DutySwitch() {
  const on = useMyDutySwitch();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => void setMyDuty(!on)}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border-[3px] border-[#232326] px-3 py-2 text-left text-base font-bold shadow-[2px_2px_0_#232326]",
        on ? "bg-[var(--brand-soft)]" : "bg-white",
      )}
    >
      <span className={cn("flex h-6 w-11 shrink-0 items-center rounded-full border-[3px] border-[#232326] p-0.5", on ? "justify-end bg-[#232326]" : "justify-start bg-white")}>
        <span className={cn("size-3.5 rounded-full", on ? "bg-[var(--brand-soft)]" : "bg-[#232326]")} />
      </span>
      {on ? "I am on duty" : "I am off duty"}
    </button>
  );
}

/**
 * Who is signed in, at which hospital, and a switch to another role there
 * (in the example set-ups), to another set-up, or out.
 */
function RoleSwitcher({ hospitalName }: { hospitalName: string | null }) {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!identity) return null;
  const seats = demoMode ? (SEATS.find((h) => h.name === hospitalName)?.accounts ?? []) : [];
  // Management: straight there for someone who may manage; in an example
  // set-up, as the person who runs it.
  const manager = seats.find((a) => /management/i.test(a.name));
  const canManage = can(identity, "manage");

  function openManagement() {
    setOpen(false);
    if (canManage) navigate("/manage");
    else if (manager) {
      openAfterSwitch("/manage");
      void switchTo(manager.email, manager.name);
    }
  }

  async function switchTo(email: string, label: string) {
    setBusy(email);
    try {
      await switchSeat(email, label);
    } catch {
      setBusy(null);
    }
  }

  return (
    <div className="relative rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-2 p-3 text-left">
        <span className="min-w-0 flex-1">
          {hospitalName ? <span className="mb-1 block text-xs leading-tight font-bold">{hospitalName}</span> : null}
          <span className="block truncate text-base leading-tight">{identity.displayName}</span>
          <span className="block text-sm">{identity.seatName ?? (identity.accountType === "doctor" ? "Doctor" : "Staff")}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full border-2 border-[#232326] bg-white px-2 py-0.5 text-xs font-bold">
          <Repeat className="size-3.5" aria-hidden /> Switch
        </span>
      </button>
      {/* Opens upwards, over the links, so nothing at the bottom is pushed off the screen. */}
      {open ? (
        <div className="absolute right-0 bottom-full left-0 z-20 mb-2 space-y-1 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-2 shadow-[3px_3px_0_#232326]">
          {seats.length ? <p className="px-2 pt-1 text-xs font-bold tracking-wide uppercase">Switch to</p> : null}
          {seats
            .filter((a) => !identity.displayName.startsWith(a.detail))
            .map((a) => (
              <button
                key={a.email}
                type="button"
                disabled={busy !== null}
                onClick={() => void switchTo(a.email, a.name)}
                className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-black/10 disabled:opacity-60"
              >
                {busy === a.email ? <Loader2 className="size-4 animate-spin" /> : a.icon}
                <span className="min-w-0 flex-1 truncate">
                  {a.name} <span className="opacity-70">· {a.detail}</span>
                </span>
              </button>
            ))}
          {canManage || manager ? (
            <button type="button" disabled={busy !== null} onClick={openManagement} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm font-bold hover:bg-black/10 disabled:opacity-60">
              <Building2 className="size-4" aria-hidden /> Management
              <span className="ml-auto text-xs font-normal opacity-70">people and roles</span>
            </button>
          ) : null}
          <button type="button" onClick={() => void signOutOfClinic()} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm font-bold hover:bg-black/10">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
