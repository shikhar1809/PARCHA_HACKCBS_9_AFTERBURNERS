import {
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  Pill,
  ScrollText,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "./cn";
import { Logo } from "./logo";

/**
 * Where each sheet of paperwork starts, relative to the mark: x, y, tilt.
 * They spread around all four sides so it reads as a desk emptying into the
 * app, not a single stream.
 */
const SHEETS: { x: number; y: number; r: number; bg: string }[] = [
  { x: -150, y: -190, r: -25, bg: "#faf5ea" },
  { x: 160, y: -170, r: 18, bg: "#adefc4" },
  { x: -170, y: 20, r: -40, bg: "#ff7f5a" },
  { x: 170, y: 70, r: 30, bg: "#faf5ea" },
  { x: -120, y: 210, r: 15, bg: "#adefc4" },
  { x: 110, y: 215, r: -20, bg: "#faf5ea" },
  { x: 0, y: -235, r: 8, bg: "#ff7f5a" },
  { x: -195, y: -90, r: 35, bg: "#adefc4" },
];

/** A patient's whole visit, end to end, in five stops. */
const JOURNEY: { icon: LucideIcon; label: string; caption: string }[] = [
  { icon: ClipboardList, label: "Register", caption: "Registered at the desk" },
  { icon: HeartPulse, label: "Check-up", caption: "Vitals taken in a minute" },
  { icon: Stethoscope, label: "Doctor", caption: "Seen by the doctor" },
  { icon: ScrollText, label: "Prescription", caption: "Prescription signed" },
  { icon: Pill, label: "Medicine", caption: "Medicine in your hand" },
];

const HEADLINE = ["Simplifying", "your", "medical", "journey"];

/** The splash's words, for an app that speaks another language. */
export type SplashWords = {
  headline: string[];
  /** One label and one caption per stop, in order; an icon to tell a different story. */
  stops: { label: string; caption: string; icon?: LucideIcon }[];
  skip: string;
  loading: string;
};

/** Beats of the sequence, in ms from mount. */
const HEADLINE_AT = 2300;
const JOURNEY_AT = 3400;
const STEP_MS = 480;
const HOLD_MS = 650;
const SEQUENCE_MS = JOURNEY_AT + JOURNEY.length * STEP_MS + HOLD_MS;

/** True once the web fonts have loaded, so the first paint is not a reflow. */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(
    typeof document === "undefined" || !document.fonts,
  );
  useEffect(() => {
    if (!document.fonts) return;
    let live = true;
    // A font that never arrives (offline, blocked) must not hold the app
    // hostage, so the wait is capped.
    const cap = new Promise((r) => setTimeout(r, 3000));
    void Promise.race([document.fonts.ready, cap]).then(
      () => live && setReady(true),
    );
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

/** True once `ms` has passed. */
export function useMinTime(ms: number): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return done;
}

/**
 * The opening screen, in three beats:
 *
 *   1. Loose paperwork flies into the Parcha mark.
 *   2. The mark settles at the top and the line "Simplifying your medical
 *      journey" writes itself in.
 *   3. A tiny journey plays end to end: register, check-up, doctor,
 *      prescription, medicine.
 *
 * The app underneath is already mounted and fetching, so this is a real wait
 * on real work as well as a story: the splash leaves only when `ready` is
 * true and the story has finished, and `status` names what is still loading.
 * Once the app is ready, a tap skips what is left.
 */
export function Splash({
  ready,
  status,
  words,
}: {
  ready: boolean;
  status: string;
  words?: SplashWords;
}) {
  const headline = words?.headline ?? HEADLINE;
  const stops = JOURNEY.map((s, i) => ({ ...s, ...words?.stops[i] }));
  const [phase, setPhase] = useState(0);
  const [step, setStep] = useState(-1);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const reduce =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Reduced motion: show the finished picture briefly instead of the show.
    if (reduce) {
      setPhase(2);
      setStep(JOURNEY.length - 1);
      const t = setTimeout(() => setDone(true), 900);
      return () => clearTimeout(t);
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setPhase(1), HEADLINE_AT));
    timers.push(setTimeout(() => setPhase(2), JOURNEY_AT));
    JOURNEY.forEach((_, i) =>
      timers.push(setTimeout(() => setStep(i), JOURNEY_AT + 250 + i * STEP_MS)),
    );
    timers.push(setTimeout(() => setDone(true), SEQUENCE_MS));
    return () => timers.forEach(clearTimeout);
  }, []);

  const leaving = ready && (done || skipped);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setGone(true), 520);
    return () => clearTimeout(t);
  }, [leaving]);

  if (gone) return null;

  const last = JOURNEY.length - 1;
  const caption = step >= 0 ? stops[step].caption : "";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={words?.loading ?? "Parcha is loading"}
      onClick={() => ready && setSkipped(true)}
      // Above everything, the connection strip and session dialogs included
      // (z-70 to z-90): nothing should show before the app has opened.
      className={cn(
        "splash fixed inset-0 z-[100] flex sm:absolute flex-col items-center overflow-hidden bg-[var(--color-background)] px-4",
        leaving && "splash-leaving",
      )}
    >
      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
      <div className="splash-stage relative flex items-center justify-center" data-phase={phase}>
        {SHEETS.map((s, i) => (
          <span
            key={i}
            aria-hidden
            className="sheet"
            style={
              {
                "--sx": `${s.x}px`,
                "--sy": `${s.y}px`,
                "--sr": `${s.r}deg`,
                "--sheet-bg": s.bg,
                animationDelay: `${i * 0.14}s`,
              } as React.CSSProperties
            }
          />
        ))}
        <Logo className="splash-mark relative size-28" />
      </div>

      {phase >= 1 ? (
        <h2 className="mt-5 max-w-[17rem] text-center text-3xl leading-[1.1] font-bold tracking-tight">
          {headline.map((w, i) => (
            <span
              key={w}
              className={cn("word", i === 0 && "word-mark")}
              style={{ animationDelay: `${i * 0.13}s` }}
            >
              {w}
            </span>
          ))}
        </h2>
      ) : null}

      {phase >= 2 ? (
        <div className="journey mt-7 w-full max-w-[22rem]">
          <div className="relative">
            {/* the road */}
            <div className="road-base" />
            <div
              className="road-fill"
              style={{
                transform: `scaleX(${step <= 0 ? 0 : step / last})`,
              }}
            />
            {/* the document that travels it */}
            <div
              className="traveller"
              style={{
                left: `calc(24px + (100% - 48px) * ${step < 0 ? 0 : step / last})`,
              }}
            >
              <Logo className="size-8" />
            </div>

            <ol className="relative flex justify-between">
              {stops.map((s, i) => {
                const Icon = i === last && step === last ? CheckCircle2 : s.icon;
                const on = step >= i;
                return (
                  <li key={s.label} className="flex w-12 flex-col items-center gap-2">
                    <span
                      className={cn(
                        "stop",
                        on && "stop-on",
                        on && i === last && "stop-final",
                      )}
                    >
                      <Icon className="size-6" strokeWidth={2.4} aria-hidden />
                    </span>
                    <span className="text-center text-[0.7rem] leading-tight font-bold whitespace-nowrap">
                      {s.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <p key={step} className="caption mt-6 h-7 text-center text-lg font-bold">
            {caption}
          </p>
        </div>
      ) : null}

      </div>

      <div className="flex shrink-0 flex-col items-center gap-1.5 pt-3 pb-6">
        <p className="text-base font-bold">{status}</p>
        <span aria-hidden className="splash-dots flex gap-2">
          <i />
          <i />
          <i />
        </span>
        {ready && !done ? (
          <p className="text-muted-foreground mt-1 text-sm font-bold">
            {words?.skip ?? "Tap to skip"}
          </p>
        ) : null}
      </div>
    </div>
  );
}
