import { AlertTriangle, ChevronRight, Clock, EarOff, EyeOff, Hand } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";

import { cn } from "./cn";
import type { Sex } from "@parcha/core";
import { waitingFor } from "@parcha/core";

/**
 * One person in a queue.
 *
 * Name, who they are, what they came in with, and how long they have been
 * waiting — in that order, because that is the order a compounder reads them
 * in when deciding who to call next. The allergy flag is the one thing that
 * has to survive being glanced at rather than read.
 */
export function PatientRow({
  href,
  name,
  ageYears,
  sex,
  area,
  complaint,
  since,
  token,
  hasAllergy,
  accessNeeds,
  trailing,
  tone = "default",
}: {
  href?: string;
  name: string;
  ageYears: number | null;
  sex: Sex | null;
  area?: string | null;
  complaint?: string | null;
  since?: string | null;
  token?: number | null;
  hasAllergy?: boolean;
  /** Low vision, deaf, sign language: shown so nobody calls out a name to someone who cannot hear it. */
  accessNeeds?: string[];
  trailing?: ReactNode;
  tone?: "default" | "active";
}) {
  const who = [
    ageYears != null ? `${ageYears}` : null,
    sex ? sex[0].toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <div className="flex items-start gap-3">
        {token != null ? (
          <span className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-medium tabular-nums">
            {token}
          </span>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[15px] leading-tight font-medium">
              {name}
            </p>
            {hasAllergy ? (
              <AlertTriangle
                className="text-destructive size-3.5 shrink-0"
                aria-label="Has a recorded allergy"
              />
            ) : null}
            {accessNeeds?.includes("low_vision") ? <EyeOff className="size-3.5 shrink-0" aria-label="Blind or low vision" /> : null}
            {accessNeeds?.includes("deaf") ? <EarOff className="size-3.5 shrink-0" aria-label="Deaf or hard of hearing" /> : null}
            {accessNeeds?.includes("sign_language") ? <Hand className="size-3.5 shrink-0" aria-label="Uses sign language" /> : null}
          </div>

          <p className="text-muted-foreground mt-0.5 text-xs">
            {[who, area].filter(Boolean).join(" · ") || "—"}
          </p>

          {complaint ? (
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug">
              {complaint}
            </p>
          ) : null}

          {since ? (
            <p className="text-muted-foreground mt-1.5 flex items-center gap-1 text-[11px]">
              <Clock className="size-3" />
              waiting {waitingFor(since)}
            </p>
          ) : null}
        </div>

        {trailing ?? (href ? <ChevronRight className="text-muted-foreground mt-1 size-5 shrink-0" /> : null)}
      </div>
    </>
  );

  const className = cn(
    "block w-full border-b px-4 py-3 text-left",
    tone === "active" ? "bg-amber-50 dark:bg-amber-950/30" : "bg-background",
    href ? "active:bg-muted" : "",
  );

  if (!href) return <div className={className}>{body}</div>;
  return (
    <Link to={href} className={className}>
      {body}
    </Link>
  );
}

/** Shown in place of a queue when there is nobody in it. */
export function EmptyQueue({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      {detail ? (
        <p className="text-muted-foreground mx-auto mt-1 max-w-[22rem] text-xs leading-relaxed">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

/** A small all-caps section heading inside a scrolling screen. */
export function SectionLabel({
  children,
  count,
}: {
  children: ReactNode;
  count?: number;
}) {
  return (
    <div className="bg-muted/50 text-muted-foreground flex items-center justify-between border-b px-4 py-1.5 text-[11px] font-medium tracking-wide uppercase">
      <span>{children}</span>
      {count != null ? <span className="tabular-nums">{count}</span> : null}
    </div>
  );
}
