import { frequencySlots, howWords, isOral, unitWord, type Stage } from "@parcha/core";
import { cn } from "@parcha/ui";
import {
  Apple,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Droplet,
  MoonStar,
  Pill,
  Send,
  Stethoscope,
  Sun,
  Sunrise,
  Sunset,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { dateIn, tr, useLang, useT, type Lang } from "./i18n";

/**
 * Back goes to wherever the person came from (Home, a tab, a list), so the same
 * screen never sends them somewhere unexpected. `fallback` is only for a screen
 * opened straight from a link or a notification, with nothing behind it.
 */
export function useGoBack(fallback = "/") {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

/** The top of a screen: a back arrow when there is somewhere to go back to. */
export function Header({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  action?: ReactNode;
}) {
  const t = useT();
  const goBack = useGoBack(back);
  return (
    <header className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2.5">
      {back ? (
        <button
          type="button"
          onClick={goBack}
          aria-label={t("Back", "वापस", "Wapas")}
          className="bg-card border-border flex size-12 shrink-0 items-center justify-center rounded-full border-[3px] border-[#232326] shadow-[0_2px_0_#232326]"
        >
          <ChevronLeft className="size-6" strokeWidth={2.6} />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl leading-tight font-bold tracking-tight text-balance">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-muted-foreground truncate text-base">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

/** A small uppercase-free section title. */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <h2 className="px-5 pt-6 pb-2 text-lg font-bold tracking-tight">
      {children}
    </h2>
  );
}

const STAGES: Record<
  string,
  { label: [string, string, string]; icon: LucideIcon; tone: string }
> = {
  // Before they come in.
  requested: {
    label: ["Request sent", "अनुरोध भेजा", "Request bhej di"],
    icon: Send,
    tone: "bg-[var(--afternoon-soft)] text-[var(--afternoon-ink)]",
  },
  proposed: {
    label: ["Waiting for the doctor", "डॉक्टर का इंतज़ार", "Doctor ka intezaar"],
    icon: Clock,
    tone: "bg-[var(--afternoon-soft)] text-[var(--afternoon-ink)]",
  },
  scheduled: {
    label: ["Confirmed: come in", "पक्का: आ जाइए", "Pakka: aa jaiye"],
    icon: CalendarCheck,
    tone: "bg-[var(--ready-soft)] text-[var(--ready)]",
  },
  registered: {
    label: ["Waiting at the desk", "काउंटर पर इंतज़ार", "Counter par intezaar"],
    icon: Clock,
    tone: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
  },
  intake_complete: {
    label: ["Waiting for the doctor", "डॉक्टर का इंतज़ार", "Doctor ka intezaar"],
    icon: Clock,
    tone: "bg-[var(--afternoon-soft)] text-[var(--afternoon-ink)]",
  },
  in_consultation: {
    label: ["With the doctor", "डॉक्टर के पास", "Doctor ke paas"],
    icon: Stethoscope,
    tone: "bg-[var(--brand-soft)] text-[var(--brand-ink)]",
  },
  prescribed: {
    label: ["Prescription ready", "पर्ची तैयार", "Parchi taiyar"],
    icon: Pill,
    tone: "bg-[var(--ready-soft)] text-[var(--ready)]",
  },
  cancelled: {
    label: ["Cancelled", "रद्द", "Cancel"],
    icon: CheckCircle2,
    tone: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
  },
};

/** A prescription is "ready" for three days; after that the visit is simply done. */
const READY_DAYS = 3;
const stale = (stage: Stage, since?: string | null) =>
  stage === "prescribed" && !!since && Date.now() - new Date(since).getTime() > READY_DAYS * 86_400_000;

/** The words on a stage chip, for use elsewhere (a heading, a spoken line). */
export function stageWords(lang: Lang, stage: Stage, since?: string | null): string {
  if (stale(stage, since)) return tr(lang, `Seen · ${dateIn(lang, since!, false)}`, `दिखा दिया · ${dateIn(lang, since!, false)}`, `Dikha diya · ${dateIn(lang, since!, false)}`);
  const s = STAGES[stage] ?? STAGES.registered;
  return tr(lang, s.label[0], s.label[1], s.label[2]);
}

/**
 * Where a visit is: a word, an icon and a colour, never colour alone. Pass
 * `since` (when it was prescribed) so an old visit reads "Seen" and not
 * "Prescription ready" for ever.
 */
export function StageChip({ stage, since }: { stage: Stage; since?: string | null }) {
  const lang = useLang();
  const old = stale(stage, since);
  const s = old ? { ...STAGES.prescribed, tone: "bg-[var(--color-muted)] text-[var(--color-foreground)]", icon: CheckCircle2 } : (STAGES[stage] ?? STAGES.registered);
  const Icon = s.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-bold whitespace-nowrap",
        s.tone,
      )}
    >
      <Icon className="size-4" strokeWidth={2.4} aria-hidden />
      {stageWords(lang, stage, since)}
    </span>
  );
}

const SLOTS: {
  label: string;
  hindi: string;
  hinglish: string;
  icon: LucideIcon;
  fill: string;
  /** Text colour on the filled tile: dark on the light amber, white elsewhere. */
  on: string;
}[] = [
  {
    label: "Morning",
    hindi: "सुबह",
    hinglish: "Subah",
    icon: Sunrise,
    fill: "var(--morning)",
    on: "oklch(0.3 0.07 60)",
  },
  {
    label: "Afternoon",
    hindi: "दोपहर",
    hinglish: "Dopahar",
    icon: Sun,
    // Dark enough for white text to pass 4.5:1.
    fill: "oklch(0.54 0.16 46)",
    on: "white",
  },
  {
    label: "Night",
    hindi: "रात",
    hinglish: "Raat",
    icon: MoonStar,
    fill: "var(--night)",
    on: "white",
  },
  {
    label: "Evening",
    hindi: "शाम",
    hinglish: "Shaam",
    icon: Sunset,
    fill: "oklch(0.55 0.15 30)",
    on: "white",
  },
];

/** The tiles for a pattern: three slots are morning, afternoon, night; four add the evening (subah, dopahar, shaam, raat). */
const slotsFor = (count: number) => (count === 4 ? [SLOTS[0], SLOTS[1], SLOTS[3], SLOTS[2]] : count === 2 ? [SLOTS[0], SLOTS[2]] : SLOTS.slice(0, 3));

/**
 * When to take it, as big tiles.
 *
 * A due slot is a solid colour with the icon in white and the number printed
 * large; a slot with no dose is a quiet outline, struck through by its own
 * label, so "not now" is as readable as "now".
 *
 * The number carries the word for what one dose is ("2 बूँद", "1 गोली"),
 * because a bare 2 under a sunrise beside an eye drop is read as two tablets.
 * With no form given it stays a bare number, as it was.
 */
export function DoseTiles({ frequency, form, compact }: { frequency: string; form?: string; compact?: boolean }) {
  const lang = useLang();
  const slots = frequencySlots(frequency);
  const name = (s: (typeof SLOTS)[number]) => tr(lang, s.label, s.hindi, s.hinglish);

  if (!slots) {
    return (
      <p className="border-border rounded-2xl border-2 border-dashed px-4 py-3 text-lg font-bold">
        {frequency.toUpperCase() === "SOS"
          ? tr(lang, "Only when you need it", "सिर्फ़ ज़रूरत पड़ने पर", "Sirf zaroorat padne par")
          : frequency}
      </p>
    );
  }

  // One spoken sentence for a screen reader, instead of the drawn tiles.
  const none = tr(lang, "none", "नहीं", "nahi");
  const word = (n: number) => (form ? unitWord(form, n, lang === "hi" ? "hi" : "en") : "");
  const said = slots.map((n, i) => { const s = slotsFor(slots.length)[i]; return `${s ? name(s) : "Dose"}: ${n === 0 ? none : `${n} ${word(n)}`.trim()}`; }).join(". ");
  return (
    <div
      role="img"
      aria-label={`${said}.`}
      className={cn("grid", compact ? "gap-1.5" : "gap-2.5")}
      style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}
    >
      {slots.map((count, i) => {
        const slot = slotsFor(slots.length)[i] ?? SLOTS[2];
        const Icon = slot.icon;
        const due = count > 0;
        return (
          <div
            key={i}
            className={cn(
              "flex flex-col items-center rounded-2xl px-1",
              compact ? "gap-0.5 pt-2 pb-1.5" : "gap-1.5 pt-3.5 pb-3",
            )}
            style={
              due
                ? { background: slot.fill, color: slot.on }
                : {
                    background: "transparent",
                    border: "2px dashed var(--color-input)",
                    color: "var(--color-muted-foreground)",
                  }
            }
          >
            <Icon className={compact ? "size-6" : "size-9"} strokeWidth={2} aria-hidden />
            <span
              className={cn(
                compact ? "text-2xl" : "text-3xl",
                "leading-none font-bold tabular-nums",
                !due && "opacity-60",
              )}
            >
              {due ? count : "–"}
            </span>
            {due && form ? (
              <span className="text-center text-sm leading-none font-bold opacity-90">{word(count)}</span>
            ) : null}
            <span lang={lang === "hi" ? "hi" : undefined} className="text-center text-base leading-tight font-bold">
              {name(slot)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const TIMING: Record<
  string,
  { label: string; hindi: string; hinglish: string; order: "food-first" | "pill-first" | "together" | "none" }
> = {
  before_food: { label: "Before food", hindi: "खाने से पहले", hinglish: "Khane se pehle", order: "pill-first" },
  after_food: { label: "After food", hindi: "खाने के बाद", hinglish: "Khane ke baad", order: "food-first" },
  with_food: { label: "With food", hindi: "खाने के साथ", hinglish: "Khane ke saath", order: "together" },
  empty_stomach: { label: "Empty stomach", hindi: "खाली पेट", hinglish: "Khaali pet", order: "pill-first" },
  any: { label: "Any time", hindi: "कभी भी", hinglish: "Kabhi bhi", order: "none" },
};

/**
 * Before or after food, drawn in the order it happens.
 *
 * Food is an instruction to a stomach. For a drop, a cream or a puffer the row
 * says how it is used instead, which is the thing that actually gets done
 * wrong ("आँख में डालना है", not "खाने के बाद").
 */
export function TimingRow({ timing, form, compact }: { timing: string; form?: string; compact?: boolean }) {
  const lang = useLang();
  const t = TIMING[timing] ?? { label: timing, hindi: timing, hinglish: timing, order: "none" as const };
  const how = form && !isOral(form) ? howWords(form, lang === "hi" ? "hi" : "en") : null;
  if (how) {
    return (
      <div
        className={cn(
          "bg-[var(--brand-soft)] text-[var(--brand-ink)] flex items-center gap-3 rounded-2xl",
          compact ? "px-3 py-1.5" : "px-4 py-3",
        )}
      >
        <Droplet className="size-6" strokeWidth={2.2} aria-hidden />
        <span className="text-lg leading-tight font-bold">{how}</span>
      </div>
    );
  }
  const food = <Apple className="size-6" strokeWidth={2.2} aria-hidden />;
  const pill = <Pill className="size-6" strokeWidth={2.2} aria-hidden />;
  return (
    <div
      className={cn(
        "bg-[var(--brand-soft)] text-[var(--brand-ink)] flex items-center gap-3 rounded-2xl",
        compact ? "px-3 py-1.5" : "px-4 py-3",
      )}
    >
      {t.order !== "none" ? (
        <span className="flex items-center gap-1.5">
          {t.order === "food-first" ? (
            <>
              {food}
              <span aria-hidden>›</span>
              {pill}
            </>
          ) : t.order === "pill-first" ? (
            <>
              {pill}
              <span aria-hidden>›</span>
              {food}
            </>
          ) : (
            <>
              {food}
              {pill}
            </>
          )}
        </span>
      ) : (
        <CalendarClock className="size-6" strokeWidth={2.2} aria-hidden />
      )}
      <span className="text-lg leading-tight font-bold">{tr(lang, t.label, t.hindi, t.hinglish)}</span>
    </div>
  );
}

/** A big, plain button. 56px tall, solid brand colour. */
export function BigButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex h-16 w-full items-center justify-center gap-2 rounded-2xl border-2 border-[var(--brand-deep)] bg-[var(--brand-soft)] text-xl font-bold text-[var(--brand-deep)] shadow-[0_4px_0_var(--brand-deep)] transition active:translate-y-0.5 active:shadow-[0_2px_0_var(--brand-deep)] disabled:border-[var(--color-input)] disabled:bg-[var(--color-muted)] disabled:text-[var(--color-muted-foreground)] disabled:shadow-none",
        props.className,
      )}
    >
      {children}
    </button>
  );
}

/** "After food" / "खाने के बाद" / "Khane ke baad". */
export const timingWords = (lang: Lang, timing: string) => {
  const t = TIMING[timing];
  return t ? tr(lang, t.label, t.hindi, t.hinglish) : timing;
};
