import { setMyDuty, useMyDutySwitch } from "@parcha/client";
import { isOnDuty, type Account, type Route } from "@parcha/core";
import { cn } from "@parcha/ui";
import { AlertTriangle, Unplug } from "lucide-react";
import { useIdentity } from "../../auth";
import { useNow } from "../Sla";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  COLUMNS,
  canWire,
  curve,
  inPoint,
  layout,
  outPoint,
  pathThrough,
  problemFor,
} from "./geometry";

const HEAD: Record<string, string> = {
  staff: "Front desk",
  doctor: "Doctors",
};

/** Green for everyone who is on duty, whatever their role; white for everyone else. */
const ON_DUTY = "bg-[oklch(0.86_0.15_150)]";

const ROLE: Record<string, string> = {
  staff: "Front desk",
  doctor: "Doctor",
};

const WIRE_COLOUR: Record<string, string> = {
  desk_doctor: "#ff7f5a",
};

type Drag = { from: string; x: number; y: number };

/**
 * The wiring diagram.
 *
 * Two columns in the order a patient moves: desk, then doctor. A wire
 * is "this person sends patients to that one". Drag from a card's right-hand
 * port to a card in the next column to connect them, or tap the port and then
 * the target. Tap a wire to remove it. Hover a card to light the whole path
 * through that person.
 *
 * It is editable only in Management, behind the Manage PIN; everywhere else it
 * is the same picture read-only, because knowing who you are connected to is
 * useful to the whole team.
 */
export function Wiring({
  people,
  routes,
  canEdit,
  onConnect,
  onDisconnect,
}: {
  people: Account[];
  routes: Route[];
  canEdit: boolean;
  onConnect: (from: string, to: string) => Promise<void>;
  onDisconnect: (from: string, to: string) => Promise<void>;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  // Re-read every 20 s so somebody who goes quiet turns white without a refresh.
  const nowMs = useNow(20_000).getTime();

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { pos, height } = useMemo(() => layout(people, width), [people, width]);
  const byUid = useMemo(() => new Map(people.map((p) => [p.uid, p])), [people]);
  const lit = useMemo(
    () => (hover ? pathThrough(hover, routes) : null),
    [hover, routes],
  );

  const source = byUid.get(drag?.from ?? armed ?? "") ?? null;

  const connect = useCallback(
    async (from: Account, to: Account) => {
      setNotice(null);
      if (routes.some((r) => r.fromUid === from.uid && r.toUid === to.uid)) {
        setNotice(`${from.displayName} is already connected to ${to.displayName}.`);
        return;
      }
      const key = `${from.uid}__${to.uid}`;
      setPending((s) => new Set(s).add(key));
      try {
        await onConnect(from.uid, to.uid);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not connect them.");
      } finally {
        setPending((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      }
    },
    [onConnect, routes],
  );

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hit = (p: { x: number; y: number }, from: Account): Account | null => {
    for (const person of people) {
      const r = pos.get(person.uid);
      if (!r || !canWire(from, person)) continue;
      if (p.x >= r.x - 10 && p.x <= r.x + r.w + 10 && p.y >= r.y - 10 && p.y <= r.y + r.h + 10) {
        return person;
      }
    }
    return null;
  };

  function startDrag(e: React.PointerEvent, from: Account) {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    setPicked(null);
    const start = toCanvas(e);
    setDrag({ from: from.uid, ...start });

    const move = (ev: PointerEvent) => {
      const p = toCanvas(ev);
      setDrag({ from: from.uid, ...p });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const p = toCanvas(ev);
      setDrag(null);
      if (Math.hypot(p.x - start.x, p.y - start.y) < 6) {
        // A tap, not a drag: arm this card, then tap its target.
        setArmed((a) => (a === from.uid ? null : from.uid));
        return;
      }
      setArmed(null);
      const target = hit(p, from);
      if (target) void connect(from, target);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onCard(person: Account) {
    if (armed && source && canWire(source, person)) {
      void connect(source, person);
      setArmed(null);
    }
  }

  const pickedRoute = routes.find((r) => r.id === picked) ?? null;
  const pickedFrom = pickedRoute ? pos.get(pickedRoute.fromUid) : null;
  const pickedTo = pickedRoute ? pos.get(pickedRoute.toUid) : null;

  return (
    <div className="space-y-3">
      {notice ? (
        <p
          role="alert"
          className="rounded-xl border-[3px] border-[#232326] bg-[oklch(0.94_0.05_25)] px-4 py-2.5 text-base"
        >
          {notice}
        </p>
      ) : null}

      {canEdit ? (
        <p className="text-muted-foreground text-base">
          {armed && source
            ? "Now tap the doctor to connect to."
            : "Drag from a card’s right-hand dot to the next column to connect. Tap a wire to remove it."}
        </p>
      ) : (
        <p className="text-muted-foreground text-base">
          This is how patients move through the hospital. Only Management can
          change it, with the Manage PIN.
        </p>
      )}

      <div className="overflow-x-auto pb-2">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-2 gap-2 pb-2 text-center text-sm tracking-wide uppercase">
            {COLUMNS.map((c) => (
              <div key={c} className="flex flex-col items-center gap-1.5">
                <p>{HEAD[c]}</p>
                <DutyHead role={c} people={people} />
              </div>
            ))}
          </div>

          <div
            ref={canvas}
            className="relative select-none"
            style={{ height }}
            onClick={() => setPicked(null)}
          >
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              style={{ zIndex: 1 }}
              aria-hidden={false}
            >
              {routes.map((r) => {
                const a = pos.get(r.fromUid);
                const b = pos.get(r.toUid);
                if (!a || !b) return null;
                const d = curve(outPoint(a), inPoint(b));
                const dim = lit !== null && !lit.has(r.id);
                const on = picked === r.id;
                return (
                  <g key={r.id} opacity={dim ? 0.2 : 1}>
                    <path d={d} fill="none" stroke="#232326" strokeWidth={on ? 11 : 8} strokeLinecap="round" />
                    <path d={d} fill="none" stroke={WIRE_COLOUR[r.kind]} strokeWidth={on ? 7 : 4} strokeLinecap="round" />
                    <path d={d} fill="none" stroke="#232326" strokeWidth={2.5} strokeLinecap="round" className="wire-flow" />
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={22}
                      style={{ pointerEvents: canEdit ? "stroke" : "none", cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPicked(on ? null : r.id);
                      }}
                    >
                      <title>
                        {byUid.get(r.fromUid)?.displayName} sends to{" "}
                        {byUid.get(r.toUid)?.displayName}
                      </title>
                    </path>
                  </g>
                );
              })}

              {[...pending].map((key) => {
                const [from, to] = key.split("__");
                const a = pos.get(from);
                const b = pos.get(to);
                if (!a || !b) return null;
                return (
                  <path
                    key={key}
                    d={curve(outPoint(a), inPoint(b))}
                    fill="none"
                    stroke="#232326"
                    strokeWidth={3}
                    strokeDasharray="4 8"
                    strokeLinecap="round"
                    opacity={0.6}
                  />
                );
              })}

              {drag && pos.get(drag.from) ? (
                <path
                  d={curve(outPoint(pos.get(drag.from)!), { x: drag.x, y: drag.y })}
                  fill="none"
                  stroke="#232326"
                  strokeWidth={4}
                  strokeDasharray="2 9"
                  strokeLinecap="round"
                />
              ) : null}
            </svg>

            {pickedRoute && pickedFrom && pickedTo ? (
              <button
                type="button"
                style={{
                  left: (outPoint(pickedFrom).x + inPoint(pickedTo).x) / 2,
                  top: (outPoint(pickedFrom).y + inPoint(pickedTo).y) / 2,
                  zIndex: 5,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setPicked(null);
                  void onDisconnect(pickedRoute.fromUid, pickedRoute.toUid).catch(
                    (err: unknown) =>
                      setNotice(err instanceof Error ? err.message : "Could not remove it."),
                  );
                }}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border-[3px] border-[#232326] bg-[oklch(0.94_0.05_25)] px-3.5 py-1.5 text-base shadow-[0_3px_0_#232326]"
              >
                <Unplug className="size-5" /> Disconnect
              </button>
            ) : null}

            {people.map((person) => {
              const r = pos.get(person.uid);
              if (!r) return null;
              const valid = source ? canWire(source, person) : false;
              const outs = routes.filter((x) => x.fromUid === person.uid).length;
              const ins = routes.filter((x) => x.toUid === person.uid).length;
              const problem = problemFor(person, routes);
              const dim = lit !== null && hover !== person.uid && !routes.some((x) => lit.has(x.id) && (x.fromUid === person.uid || x.toUid === person.uid));
              const hasOut = person.accountType === "staff";
              const hasIn = person.accountType !== "staff";
              return (
                <div
                  key={person.uid}
                  data-uid={person.uid}
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: 2 }}
                  onMouseEnter={() => setHover(person.uid)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCard(person);
                  }}
                  className={cn(
                    "absolute rounded-2xl border-[3px] border-[#232326] p-3 shadow-[3px_3px_0_#232326] transition-opacity",
                    isOnDuty(person, nowMs) ? ON_DUTY : "bg-white",
                    dim && "opacity-40",
                    source && !valid && source.uid !== person.uid && "opacity-50",
                    valid && "outline-[4px] outline-offset-2 outline-[#232326] outline-dashed",
                  )}
                >
                  {hasIn ? (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-1/2 -left-[14px] size-6 -translate-y-1/2 rounded-full border-[3px] border-[#232326] bg-white",
                        valid && "bg-[var(--brand)]",
                      )}
                    />
                  ) : null}
                  {hasOut ? (
                    <button
                      type="button"
                      aria-label={`Connect ${person.displayName} to a doctor`}
                      aria-pressed={armed === person.uid}
                      disabled={!canEdit}
                      onPointerDown={(e) => startDrag(e, person)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setArmed((a) => (a === person.uid ? null : person.uid));
                        }
                      }}
                      className={cn(
                        "absolute top-1/2 -right-[15px] size-7 -translate-y-1/2 touch-none rounded-full border-[3px] border-[#232326] bg-white",
                        canEdit && "cursor-grab hover:bg-[var(--brand)] active:cursor-grabbing",
                        (armed === person.uid || drag?.from === person.uid) && "bg-[var(--brand)]",
                      )}
                    />
                  ) : null}

                  <p className="flex items-center gap-2 truncate text-lg leading-tight">
                    <span
                      aria-hidden
                      className={cn(
                        "size-3 shrink-0 rounded-full border-2 border-[#232326]",
                        isOnDuty(person, nowMs) ? "bg-[oklch(0.62_0.19_150)]" : "bg-white",
                      )}
                    />
                    <span className="truncate">{person.displayName}</span>
                    <span className="sr-only">{isOnDuty(person, nowMs) ? "on duty" : "off duty"}</span>
                  </p>
                  <p className="truncate text-sm">
                    {person.accountType === "doctor" && person.department
                      ? person.department
                      : ROLE[person.accountType]}
                    {person.admin ? " · admin" : ""}
                  </p>
                  <p className="mt-1 truncate text-sm">
                    {person.accountType === "staff"
                      ? `Sends to ${outs} doctor${outs === 1 ? "" : "s"}`
                      : person.accountType === "doctor"
                        ? `Gets patients from ${ins} desk${ins === 1 ? "" : "s"}`
                        : `From ${ins} doctor${ins === 1 ? "" : "s"}`}
                  </p>
                  {problem ? (
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm">
                      <AlertTriangle className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{problem}</span>
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Above each role: who is on, and, over the column that is yours, the switch that
 * puts you on or off duty. Off stays off (even with the app open) until you switch it
 * on again, so a break does not need signing out.
 */
function DutyHead({ role, people }: { role: string; people: Account[] }) {
  const { identity } = useIdentity();
  const now = useNow(20_000).getTime();
  const mine = identity?.accountType === role;
  const on = useMyDutySwitch();
  const inRole = people.filter((p) => p.accountType === role);
  const count = inRole.filter((p) => isOnDuty(p, now)).length;
  return (
    <>
      <span className="text-xs tracking-normal normal-case">
        {count} of {inRole.length} on duty
      </span>
      {mine ? (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => void setMyDuty(!on)}
          className={cn(
            "flex h-9 items-center gap-2 rounded-full border-[3px] border-[#232326] px-3 text-sm font-bold tracking-normal normal-case shadow-[2px_2px_0_#232326]",
            on ? ON_DUTY : "bg-white",
          )}
        >
          <span aria-hidden className={cn("size-3 rounded-full border-2 border-[#232326]", on ? "bg-[#232326]" : "bg-white")} />
          {on ? "I am on duty" : "I am off duty"}
        </button>
      ) : null}
    </>
  );
}
