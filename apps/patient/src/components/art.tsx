/**
 * The patient app's own drawings: a face for every person, and small flat
 * illustrations for the places that would otherwise be empty. All SVG, drawn
 * in the app's thick-outline style, so there is nothing to download and they
 * stay sharp at any size.
 */
import type { AvatarLook, HairStyle, Headwear } from "@parcha/core";
import { useId } from "react";

import { usePerson } from "./people";

const INK = "#232326";
const CORAL = "#ff7f5a";
const MINT = "#adefc4";
const CREAM = "#faf5ea";
const SUN = "#ffd66b";
const SKY = "#a9d8ff";
const LILAC = "#cdbcff";

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const pick = <T,>(list: readonly T[], h: number, shift: number): T => list[(h >>> shift) % list.length];

/**
 * The palettes. The first entries are what a name picks from by default; the
 * rest are only reachable by choosing them, so nobody's default face changes
 * when a swatch is added. The counts match `AVATAR_PALETTE` in core.
 */
export const SKIN = ["#f7d3b5", "#eab88f", "#d99a6c", "#b97b4f", "#8e5a37"] as const;
export const BG = [MINT, SUN, SKY, LILAC, "#ffc2b0", CREAM] as const;
export const SHIRT = [CORAL, "#6fbf8f", "#5aa7e8", "#b59cf5", "#f2b84b", "#ef6f8f"] as const;
export const HAIR = ["#2b2321", "#3b2a20", "#51372a", "#1d1d22", "#8a8a92", "#d9d9de"] as const;

/** What a face is made of, once the name's defaults and the family's choices are put together. */
export type ResolvedLook = {
  skin: string;
  bg: string;
  shirt: string;
  hair: string;
  hairStyle: HairStyle;
  headwear: Headwear;
  glasses: boolean;
  beard: boolean;
  bindi: boolean;
  child: boolean;
};

/**
 * Works out the face for a person. The family's choices (a `look`) win; anything
 * they have not chosen comes from the name, and from age and sex when those are
 * known, so a face is never empty and never changes by itself.
 */
export function resolveLook(name: string, sex?: string | null, age?: number | null, look?: AvatarLook | null): ResolvedLook {
  const h = hash(name.toLowerCase());
  const grey = age != null && age >= 55;
  const child = age != null && age < 12;
  const longByDefault = sex === "female" ? (h >>> 19) % 3 !== 0 : sex === "male" ? false : (h >>> 19) % 2 === 0;
  const bun = sex === "female" && !longByDefault;
  const bald = !longByDefault && !child && sex === "male" && age != null && age >= 50 && (h >>> 23) % 3 === 0;
  const defaultStyle: HairStyle = bald ? "bald" : longByDefault ? "long" : bun ? "bun" : "short";
  const glassesByDefault = (h >>> 21) % 4 === 0 || (age != null && age >= 60 && (h >>> 21) % 2 === 0);
  const l = look ?? {};
  return {
    skin: SKIN[l.skin ?? (h >>> 3) % 5],
    bg: BG[l.bg ?? (h >>> 7) % 5],
    shirt: SHIRT[l.shirt ?? (h >>> 11) % 5],
    hair: HAIR[l.hairColor ?? (grey ? 5 : (h >>> 15) % 4)],
    hairStyle: l.hairStyle ?? defaultStyle,
    headwear: l.headwear ?? "none",
    glasses: l.glasses ?? glassesByDefault,
    beard: l.beard ?? false,
    bindi: l.bindi ?? false,
    child,
  };
}

/** The drawing itself, from a resolved look. Used by the avatar and by the designer's preview. */
export function Face({ look, size = 48, label, className }: { look: ResolvedLook; size?: number; label?: string; className?: string }) {
  const id = useId();
  const { skin, bg, shirt, hair, hairStyle, headwear, glasses, beard, bindi, child } = look;
  const headR = child ? 15 : 14;
  const cy = child ? 33 : 31;
  const eyeY = child ? 34 : 32;
  const showHair = headwear === "none" || headwear === "dupatta";
  const topHair = hairStyle !== "bald" && showHair;
  const stroke = { stroke: INK, strokeWidth: 2.5, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={label ?? "Face"} className={className} style={{ flexShrink: 0 }}>
      <defs>
        <clipPath id={`${id}c`}>
          <circle cx="32" cy="32" r="30" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect width="64" height="64" fill={bg} />
        {/* behind the head */}
        {hairStyle === "long" && headwear !== "turban" && headwear !== "cap" ? (
          <path d="M15 33c-2-17 8-22 17-22s19 5 17 22c0 8 1 14 3 18H12c2-4 3-10 3-18z" fill={hair} {...stroke} />
        ) : null}
        {hairStyle === "ponytail" && showHair ? <path d="M44 28c9 1 11 13 6 21-1-8-3-12-8-14z" fill={hair} {...stroke} /> : null}
        {headwear === "dupatta" ? (
          <path d="M13 36c-1-15 7-24 19-24s20 9 19 24c0 9-3 14-7 18l-4-9c-1-6-4-10-8-10s-7 4-8 10l-4 9c-4-4-7-9-7-18z" fill={shirt} {...stroke} />
        ) : null}
        {/* shoulders and neck */}
        <path d="M6 66c1-13 11-17 26-17s25 4 26 17z" fill={shirt} {...stroke} />
        <rect x="28" y="42" width="8" height="9" rx="2" fill={skin} {...stroke} />
        {/* head */}
        <circle cx="32" cy={cy} r={headR} fill={skin} {...stroke} />
        {hairStyle === "bun" && showHair ? <circle cx="32" cy="12" r="6" fill={hair} {...stroke} /> : null}
        {hairStyle === "curly" && showHair ? (
          <g fill={hair} {...stroke}>
            {[[21, 22], [27, 17], [35, 17], [43, 22], [19, 30], [45, 30]].map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="5.2" />
            ))}
          </g>
        ) : null}
        {topHair && hairStyle !== "curly" ? (
          <path
            d={hairStyle === "long" ? "M18 29c0-9 6-13 14-13s14 4 14 13c-4-3-9-5-14-5s-10 2-14 5z" : "M18 28c0-9 6-13 14-13s14 4 14 13c-3-2-6-4-9-4-6 2-13 2-19 4z"}
            fill={hair}
            {...stroke}
          />
        ) : null}
        {headwear === "turban" ? (
          <g fill={shirt} {...stroke}>
            <path d="M16 29C16 14 25 8 32 8s16 6 16 21c-4-3-9-5-16-5s-12 2-16 5z" />
            <path d="M20 21c8-4 16-4 24 0M18 26c9-4 19-4 28 0" fill="none" />
          </g>
        ) : null}
        {headwear === "cap" ? (
          <g fill={shirt} {...stroke}>
            <path d="M17 27c0-10 6-14 15-14s15 4 15 14z" />
            <path d="M14 27.5h23" fill="none" />
          </g>
        ) : null}
        {headwear === "dupatta" ? <path d="M17 26c3-8 8-11 15-11s12 3 15 11c-5-3-9-5-15-5s-10 2-15 5z" fill={shirt} {...stroke} /> : null}
        {/* the face */}
        <circle cx="26.5" cy={eyeY} r={child ? 2.1 : 1.8} fill={INK} />
        <circle cx="37.5" cy={eyeY} r={child ? 2.1 : 1.8} fill={INK} />
        <circle cx="22.5" cy="37" r="2.2" fill="#ff9a86" opacity=".55" />
        <circle cx="41.5" cy="37" r="2.2" fill="#ff9a86" opacity=".55" />
        {bindi ? <circle cx="32" cy={child ? 26.5 : 25} r="1.8" fill="#d63a2f" /> : null}
        {beard && !child ? (
          <path d="M19 33c0 14 6 19 13 19s13-5 13-19c-2 5-4 7-6 8-2-2-4-3-7-3s-5 1-7 3c-2-1-4-3-6-8z" fill={hair} {...stroke} />
        ) : null}
        <path d={`M27 ${beard ? 40 : child ? 39 : 38}q5 ${beard ? 3 : 5} 10 0`} fill="none" stroke={beard ? "#fff" : INK} strokeWidth="2.2" strokeLinecap="round" />
        {glasses ? (
          <g fill="none" stroke={INK} strokeWidth="2">
            <circle cx="26.5" cy={eyeY} r="4.6" />
            <circle cx="37.5" cy={eyeY} r="4.6" />
            <path d="M31 32h2" />
          </g>
        ) : null}
      </g>
      <circle cx="32" cy="32" r="30" fill="none" stroke={INK} strokeWidth="3" />
    </svg>
  );
}

/**
 * A face for a person. Made from their name so it is the same every time, then
 * shaped by what the family has chosen for them (see `PeopleProvider`): the
 * avatar looks the person up by name, so any screen that shows a name shows
 * their chosen face without being told.
 */
export function Avatar({
  name,
  sex,
  age,
  look,
  size = 48,
  className,
}: {
  name: string;
  sex?: string | null;
  age?: number | null;
  look?: AvatarLook | null;
  size?: number;
  className?: string;
}) {
  const person = usePerson(name);
  const resolved = resolveLook(name, person?.sex ?? sex, person?.ageYears ?? age, look ?? person?.look);
  return <Face look={resolved} size={size} label={name} className={className} />;
}

/** Overlapping faces, for "who is on this phone". */
export function AvatarStack({ people, size = 36, max = 3 }: { people: { name: string; sex?: string | null; age?: number | null }[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <div className="flex items-center" aria-label={`${people.length} people on this phone`}>
      {shown.map((p, i) => (
        <span key={p.name} style={{ marginLeft: i === 0 ? 0 : -size * 0.3, zIndex: max - i }} className="rounded-full">
          <Avatar name={p.name} sex={p.sex} age={p.age} size={size} />
        </span>
      ))}
      {people.length > max ? (
        <span
          style={{ marginLeft: -size * 0.3, width: size, height: size }}
          className="flex items-center justify-center rounded-full border-[3px] border-[#232326] bg-card text-sm font-bold"
        >
          +{people.length - max}
        </span>
      ) : null}
    </div>
  );
}

type ArtProps = { size?: number; className?: string };

function Frame({ size = 120, className, children, label }: ArtProps & { children: React.ReactNode; label: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label} className={`art-float ${className ?? ""}`}>
      {children}
    </svg>
  );
}

const line = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round", strokeLinecap: "round" } as const;

/** A friendly doctor with a clipboard. */
export function DoctorArt(props: ArtProps) {
  return (
    <Frame {...props} label="A doctor">
      <circle cx="60" cy="62" r="52" fill={MINT} {...line} />
      <path d="M22 112c2-22 16-30 38-30s36 8 38 30z" fill="#fff" {...line} />
      <path d="M52 82l8 14 8-14" fill="none" {...line} />
      <circle cx="60" cy="52" r="17" fill="#eab88f" {...line} />
      <path d="M43 50c0-12 8-18 17-18s17 6 17 18c-5-4-11-6-17-6s-12 2-17 6z" fill="#2b2321" {...line} />
      <circle cx="54" cy="54" r="2" fill={INK} />
      <circle cx="66" cy="54" r="2" fill={INK} />
      <path d="M54 61q6 5 12 0" fill="none" {...line} strokeWidth={2.5} />
      <path d="M46 84c-6 8-4 18 6 18" fill="none" {...line} />
      <circle cx="52" cy="103" r="4" fill={SUN} {...line} />
      <rect x="76" y="78" width="26" height="32" rx="4" fill={CREAM} {...line} />
      <path d="M82 90h14M82 98h14" {...line} strokeWidth={2.5} />
      <path d="M86 76v-4h6v4" fill={CORAL} {...line} strokeWidth={2.5} />
      <path d="M26 30h10M31 25v10" stroke={CORAL} strokeWidth={5} strokeLinecap="round" />
    </Frame>
  );
}

/** A clipboard with a ticked list. */
export function ClipboardArt(props: ArtProps) {
  return (
    <Frame {...props} label="A checklist">
      <circle cx="60" cy="62" r="52" fill={SUN} {...line} />
      <rect x="32" y="22" width="56" height="76" rx="7" fill={CREAM} {...line} />
      <rect x="47" y="15" width="26" height="14" rx="5" fill={CORAL} {...line} />
      <path d="M42 46l5 5 9-10" fill="none" stroke="#2e9e5b" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M62 46h16" {...line} strokeWidth={3} />
      <path d="M42 66l5 5 9-10" fill="none" stroke="#2e9e5b" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M62 66h16" {...line} strokeWidth={3} />
      <circle cx="47" cy="84" r="4.5" fill="#fff" {...line} strokeWidth={2.5} />
      <path d="M62 84h16" {...line} strokeWidth={3} />
    </Frame>
  );
}

/** A folder with papers and a heart. */
export function FolderArt(props: ArtProps) {
  return (
    <Frame {...props} label="A folder of papers">
      <circle cx="60" cy="62" r="52" fill={SKY} {...line} />
      <rect x="34" y="30" width="38" height="46" rx="4" fill="#fff" transform="rotate(-8 53 53)" {...line} />
      <rect x="46" y="28" width="38" height="46" rx="4" fill={CREAM} transform="rotate(6 65 51)" {...line} />
      <path d="M26 50h26l6 8h38a4 4 0 0 1 4 4v34a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4z" fill={CORAL} {...line} />
      <path d="M60 90c-9-6-13-11-13-16a7 7 0 0 1 13-3 7 7 0 0 1 13 3c0 5-4 10-13 16z" fill="#fff" {...line} strokeWidth={2.5} />
    </Frame>
  );
}

/** Capsules and a bottle. */
export function PillsArt(props: ArtProps) {
  return (
    <Frame {...props} label="Medicines">
      <circle cx="60" cy="62" r="52" fill={LILAC} {...line} />
      <rect x="36" y="44" width="30" height="50" rx="6" fill="#fff" {...line} />
      <rect x="33" y="34" width="36" height="14" rx="5" fill={CORAL} {...line} />
      <rect x="42" y="60" width="18" height="18" rx="3" fill={MINT} {...line} strokeWidth={2.5} />
      <path d="M51 63v12M45 69h12" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <g transform="rotate(-35 86 78)">
        <rect x="70" y="68" width="34" height="16" rx="8" fill="#fff" {...line} />
        <path d="M87 68h9a8 8 0 0 1 0 16h-9z" fill={SUN} {...line} />
      </g>
      <circle cx="92" cy="40" r="8" fill="#fff" {...line} />
      <path d="M86 40h12" {...line} strokeWidth={2.5} />
    </Frame>
  );
}

/** A calendar with a ticked day. */
export function CalendarArt(props: ArtProps) {
  return (
    <Frame {...props} label="A calendar">
      <circle cx="60" cy="62" r="52" fill="#ffc2b0" {...line} />
      <rect x="28" y="28" width="64" height="64" rx="8" fill={CREAM} {...line} />
      <path d="M28 46h64V36a8 8 0 0 0-8-8H36a8 8 0 0 0-8 8z" fill={CORAL} {...line} />
      <path d="M44 22v12M76 22v12" {...line} strokeWidth={4} />
      <path d="M40 62h8M56 62h8M72 62h8M40 76h8M56 76h8" {...line} strokeWidth={4} />
      <circle cx="76" cy="76" r="9" fill={MINT} {...line} />
      <path d="M71 76l4 4 6-8" fill="none" {...line} strokeWidth={3} />
    </Frame>
  );
}
