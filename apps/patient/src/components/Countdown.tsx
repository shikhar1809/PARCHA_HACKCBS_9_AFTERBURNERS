import { clock, secondsLeft } from "@parcha/core";
import { useEffect, useState } from "react";
import { currentLang, tr } from "../i18n";

/** The current time, ticking. One timer per component, cleared on unmount. */
export function useNow(everyMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/**
 * A ring that empties as the hospital's time runs out.
 *
 * Time is the one thing a patient waiting on a hospital wants to know, and a
 * shrinking ring says it faster than a sentence: full means just asked, empty
 * means the next hospital is about to be tried. The number is for those who want
 * it. Colour changes only when it matters (the last two minutes), and the ring
 * never lies about being late: at zero it says so.
 */
export function Countdown({
  deadline,
  totalSeconds,
  size = 148,
}: {
  deadline: string;
  totalSeconds: number;
  size?: number;
}) {
  const now = useNow();
  const left = secondsLeft(deadline, now);
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fraction = Math.min(1, left / totalSeconds);
  const low = left <= 120;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="timer"
      aria-label={left === 0 ? tr(currentLang(), "Time is up", "समय पूरा", "Time khatam") : tr(currentLang(), `${clock(left)} left`, `${clock(left)} बाकी`, `${clock(left)} baaki`)}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8dfca" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={low ? "#e5484d" : "#ff7f5a"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - fraction)}
          style={{ transition: "stroke-dashoffset 1s linear, stroke 300ms" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl leading-none font-bold tabular-nums">
          {left === 0 ? "0:00" : clock(left)}
        </span>
        <span className="mt-1 text-base font-bold">{left === 0 ? "time is up" : "left"}</span>
      </div>
    </div>
  );
}
