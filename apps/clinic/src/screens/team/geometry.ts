import type { Account, AccountType, Route } from "@parcha/core";

/**
 * Where everything sits on the wiring diagram.
 *
 * Three columns, left to right in the order a patient moves: desk, doctor,
 * pharmacy. Positions are computed from the list, never measured from the
 * page, so a wire can be drawn before the cards it joins have painted and
 * the two can never drift apart.
 */

export const COLUMNS: AccountType[] = ["staff", "doctor"];

export const NODE_H = 118;
export const GAP = 18;
export const PAD_Y = 14;

export type Rect = { x: number; y: number; w: number; h: number };

export type Layout = {
  pos: Map<string, Rect>;
  nodeW: number;
  height: number;
};

export function layout(people: Account[], width: number): Layout {
  const colW = width / COLUMNS.length;
  const nodeW = Math.max(150, Math.min(250, colW - 44));
  const counts = [0, 0, 0];
  const pos = new Map<string, Rect>();

  for (const p of people) {
    const col = COLUMNS.indexOf(p.accountType);
    if (col === -1) continue;
    pos.set(p.uid, {
      x: colW * col + (colW - nodeW) / 2,
      y: PAD_Y + counts[col] * (NODE_H + GAP),
      w: nodeW,
      h: NODE_H,
    });
    counts[col] += 1;
  }

  const tallest = Math.max(...counts, 0);
  return {
    pos,
    nodeW,
    height: Math.max(360, PAD_Y * 2 + tallest * (NODE_H + GAP) - GAP),
  };
}

/** The right edge of a card, where a wire leaves. */
export const outPoint = (r: Rect) => ({ x: r.x + r.w, y: r.y + r.h / 2 });
/** The left edge of a card, where a wire arrives. */
export const inPoint = (r: Rect) => ({ x: r.x, y: r.y + r.h / 2 });

/** A smooth S-curve between two points. */
export function curve(
  a: { x: number; y: number },
  b: { x: number; y: number },
): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}

/** Whom each kind of person may be wired to: a desk to a doctor. */
export const TARGET_OF: Partial<Record<AccountType, AccountType>> = {
  staff: "doctor",
};

export function canWire(from: Account, to: Account): boolean {
  return TARGET_OF[from.accountType] === to.accountType;
}

/**
 * Everything on a person's path through the hospital: the wires downstream of
 * them (where their patients go) and upstream (where they come from).
 * Hovering a card lights exactly these, so the whole journey through that
 * person reads at a glance.
 */
export function pathThrough(uid: string, routes: Route[]): Set<string> {
  const lit = new Set<string>();
  const walk = (start: string, dir: "down" | "up") => {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const r of routes) {
        const next =
          dir === "down" && r.fromUid === at
            ? r.toUid
            : dir === "up" && r.toUid === at
              ? r.fromUid
              : null;
        if (next === null) continue;
        lit.add(r.id);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  };
  walk(uid, "down");
  walk(uid, "up");
  return lit;
}

/** What is wrong with a person's place in the flow, if anything. */
export function problemFor(person: Account, routes: Route[]): string | null {
  const out = routes.some((r) => r.fromUid === person.uid);
  const into = routes.some((r) => r.toUid === person.uid);
  switch (person.accountType) {
    case "staff":
      return out ? null : "Cannot send patients to any doctor";
    case "doctor":
      // A doctor who registers their own patients is their own desk.
      return into || person.abilities?.includes("register") ? null : "No desk sends patients here";
    default:
      return null;
  }
}
