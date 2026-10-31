/**
 * A person on a patient's phone.
 *
 * One phone number is often a whole household: a grandmother who cannot work a
 * phone, the son who manages her medicines, the children. Each of them is a
 * profile on that phone. A profile can be a person who has been to a hospital
 * (their name comes from the hospital's record) or one added by hand, and in
 * both cases it carries what the family says about them: a face they chose, an
 * age, what to call them, whether they need a helper, and the number their
 * reminder calls should go to.
 *
 * What the family says here is the family's, not the hospital's: changing an
 * age on a profile does not change any clinical record.
 */
import type { Sex } from "./types.js";

/** The drawn face. Every field is optional: what is missing is chosen from the name. */
export type AvatarLook = {
  skin?: number;
  hairStyle?: HairStyle;
  hairColor?: number;
  shirt?: number;
  bg?: number;
  glasses?: boolean;
  beard?: boolean;
  headwear?: Headwear;
  bindi?: boolean;
};

export const HAIR_STYLES = ["short", "long", "bun", "ponytail", "curly", "bald"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export const HEADWEAR = ["none", "turban", "cap", "dupatta"] as const;
export type Headwear = (typeof HEADWEAR)[number];

/** How many swatches each palette has; the screen and the server must agree. */
export const AVATAR_PALETTE = { skin: 5, hairColor: 6, shirt: 6, bg: 6 } as const;

export type Profile = {
  id: string;
  ownerPhone: string;
  /** The name the records use. It never changes. */
  name: string;
  /** What the family calls them: "Dadi", "Papa". */
  nickname: string | null;
  ageYears: number | null;
  sex: Sex | null;
  look: AvatarLook;
  /** This person cannot manage the app themselves: show the simple screen. */
  needsHelp: boolean;
  /** Who helps, and how to reach them from the simple screen. */
  helperName: string | null;
  helperNumber: string | null;
  /** Reminder calls for this person go here, once verified. Empty means the account's own number. */
  callNumber: string | null;
  callNumberVerified: boolean;
  /** Read aloud, larger text, flashing alerts and the rest (access.ts). */
  access?: import("./access.js").PersonAccess;
  updatedAt: string;
};

export const profileId = (phone: string, name: string) =>
  `${phone}__${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`;

/** What to show for a person: the nickname if there is one. */
export const shownName = (p: { name: string; nickname?: string | null }) => p.nickname?.trim() || p.name;

/** Clamps a look to what the palettes allow; anything else is dropped. */
export function cleanLook(input: unknown): AvatarLook {
  const l = (input ?? {}) as Record<string, unknown>;
  const idx = (v: unknown, n: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : undefined);
  const out: AvatarLook = {};
  const skin = idx(l.skin, AVATAR_PALETTE.skin);
  const hairColor = idx(l.hairColor, AVATAR_PALETTE.hairColor);
  const shirt = idx(l.shirt, AVATAR_PALETTE.shirt);
  const bg = idx(l.bg, AVATAR_PALETTE.bg);
  if (skin !== undefined) out.skin = skin;
  if (hairColor !== undefined) out.hairColor = hairColor;
  if (shirt !== undefined) out.shirt = shirt;
  if (bg !== undefined) out.bg = bg;
  if (HAIR_STYLES.includes(l.hairStyle as HairStyle)) out.hairStyle = l.hairStyle as HairStyle;
  if (HEADWEAR.includes(l.headwear as Headwear)) out.headwear = l.headwear as Headwear;
  if (typeof l.glasses === "boolean") out.glasses = l.glasses;
  if (typeof l.beard === "boolean") out.beard = l.beard;
  if (typeof l.bindi === "boolean") out.bindi = l.bindi;
  return out;
}
