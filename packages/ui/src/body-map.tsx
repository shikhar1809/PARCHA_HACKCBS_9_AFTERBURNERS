import { BODY_PARTS, type BodyPart } from "@parcha/core";
import { cn } from "./cn";

/**
 * A body to point at.
 *
 * Drawn, not photographed, and drawn plainly: a figure with no face, no
 * clothes and no sex, because the person pointing at it is standing in a
 * waiting room where other people can see the screen. The regions are big
 * enough for a thumb — at a kiosk the hand is often an older patient's, often
 * shaking — and a chosen one is filled in the brand colour with a thick
 * outline, the same way every other chosen thing in Parcha is drawn.
 *
 * The parts of the face are too small to hit on a figure this size, so they
 * sit beside it as their own buttons rather than being drawn as dots nobody
 * could tap. Everything is a real control: each region takes focus, says its
 * own name, and reports whether it is chosen, so the map works with a
 * keyboard and with a screen reader as well as with a finger.
 */

export type BodyView = "front" | "back";

export function BodyMap({
  view,
  chosen,
  onToggle,
  label = (p) => p.en,
  className,
}: {
  view: BodyView;
  /** The ids chosen so far, from both views. */
  chosen: string[];
  onToggle: (id: string) => void;
  /** How to name a part — the patient app's language, when there is one. */
  label?: (part: BodyPart) => string;
  className?: string;
}) {
  const parts = BODY_PARTS.filter((p) => p.view === view);
  const face = parts.filter((p) => ["eyes", "ears", "mouth"].includes(p.id));
  const on = (id: string) => chosen.includes(id);

  /**
   * A shape that is drawn but is not a choice: the back of the head, the arms
   * behind, the feet. A part belongs to one view, and the other view still has
   * to draw it — a back without a head or arms is a stack of boxes, and a
   * figure nobody recognises is a figure nobody points at.
   */
  const outline = (shape: React.ReactNode) => (
    <g fill="#ffffff" stroke="#232326" strokeWidth={3} strokeLinejoin="round" aria-hidden="true">
      {shape}
    </g>
  );

  const region = (id: string, shape: React.ReactNode) => {
    const part = parts.find((p) => p.id === id);
    // Not a part of this view: drawn, so the body stays whole, but not tappable.
    if (!part) return outline(shape);
    const picked = on(id);
    return (
      <g
        key={id}
        role="button"
        tabIndex={0}
        aria-pressed={picked}
        aria-label={label(part)}
        onClick={() => onToggle(id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(id);
          }
        }}
        className="cursor-pointer outline-none focus-visible:[&>*]:stroke-[var(--brand-deep)]"
        fill={picked ? "var(--brand)" : "#ffffff"}
        stroke="#232326"
        strokeWidth={picked ? 5 : 3}
        strokeLinejoin="round"
      >
        {shape}
      </g>
    );
  };

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <svg
        viewBox="0 0 200 430"
        className="h-[clamp(18rem,52vh,30rem)] w-auto"
        role="group"
        aria-label={view === "front" ? "The body, from the front" : "The body, from behind"}
      >
        {view === "front" ? (
          <>
            {region("head", <ellipse cx="100" cy="40" rx="30" ry="34" />)}
            {region("neck", <rect x="86" y="72" width="28" height="18" rx="7" />)}
            {region("chest", <rect x="60" y="88" width="80" height="62" rx="16" />)}
            {region("belly", <rect x="62" y="150" width="76" height="68" rx="16" />)}
            {region(
              "arm",
              <>
                <rect x="30" y="92" width="26" height="100" rx="13" />
                <rect x="144" y="92" width="26" height="100" rx="13" />
              </>,
            )}
            {region(
              "hand",
              <>
                <ellipse cx="43" cy="207" rx="16" ry="19" />
                <ellipse cx="157" cy="207" rx="16" ry="19" />
              </>,
            )}
            {region("hip", <rect x="62" y="218" width="76" height="40" rx="14" />)}
            {region(
              "leg",
              <>
                <rect x="66" y="258" width="30" height="66" rx="13" />
                <rect x="104" y="258" width="30" height="66" rx="13" />
              </>,
            )}
            {region(
              "knee",
              <>
                <ellipse cx="81" cy="334" rx="17" ry="15" />
                <ellipse cx="119" cy="334" rx="17" ry="15" />
              </>,
            )}
            {region(
              "foot",
              <>
                <rect x="66" y="350" width="30" height="56" rx="12" />
                <rect x="104" y="350" width="30" height="56" rx="12" />
              </>,
            )}
          </>
        ) : (
          <>
            {outline(<ellipse cx="100" cy="40" rx="30" ry="34" />)}
            {outline(<rect x="86" y="72" width="28" height="18" rx="7" />)}
            {region(
              "shoulder",
              <>
                <rect x="38" y="88" width="48" height="26" rx="13" />
                <rect x="114" y="88" width="48" height="26" rx="13" />
              </>,
            )}
            {outline(
              <>
                <rect x="30" y="100" width="26" height="100" rx="13" />
                <rect x="144" y="100" width="26" height="100" rx="13" />
                <ellipse cx="43" cy="215" rx="16" ry="19" />
                <ellipse cx="157" cy="215" rx="16" ry="19" />
              </>,
            )}
            {region("upper_back", <rect x="60" y="114" width="80" height="60" rx="16" />)}
            {region("lower_back", <rect x="64" y="176" width="72" height="48" rx="16" />)}
            {region("buttock", <rect x="62" y="224" width="76" height="40" rx="18" />)}
            {outline(
              <>
                <rect x="66" y="264" width="30" height="62" rx="13" />
                <rect x="104" y="264" width="30" height="62" rx="13" />
              </>,
            )}
            {region(
              "calf",
              <>
                <rect x="66" y="326" width="30" height="62" rx="14" />
                <rect x="104" y="326" width="30" height="62" rx="14" />
              </>,
            )}
            {outline(
              <>
                <ellipse cx="81" cy="398" rx="16" ry="13" />
                <ellipse cx="119" cy="398" rx="16" ry="13" />
              </>,
            )}
          </>
        )}
      </svg>

      {face.length ? (
        <div className="flex flex-wrap justify-center gap-2">
          {face.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={on(p.id)}
              onClick={() => onToggle(p.id)}
              className={cn(
                "min-h-12 rounded-2xl border-[3px] border-[#232326] px-4 text-lg font-bold",
                on(p.id) ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-white",
              )}
            >
              {label(p)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
