/**
 * Who a memory belongs to, as Meko is allowed to see it.
 *
 * Meko has no notion of our doctors or our hospitals, and its search is a
 * ranker rather than an access boundary, so scope is carried two ways: in the
 * memory text (where the hybrid scorer's keyword signal can use it) and in
 * `metadata` (where our own server filters on it before anything goes back to
 * a browser). Neither is a uid and neither is a name.
 *
 * The keys are one-way: salted SHA-256, truncated. Given a key you cannot get
 * back the doctor; given the doctor and the salt you always get the same key,
 * which is what makes a habit accumulate instead of fragmenting.
 *
 * The salt lives in a server secret. It never reaches a browser and never
 * goes into the build datapack.
 */

export type MekoScope = {
  /** This doctor, at this hospital. Stable, opaque, not reversible. */
  doctorKey: string;
  /** This hospital. Shared by every doctor in it, so canon can be clinic-wide. */
  clinicKey: string;
};

/** The three agents that own a datapack. The curator is a scheduled function, not an agent. */
export type MekoAgent = "habit" | "formulary" | "scribe";

export const MEKO_AGENTS: MekoAgent[] = ["habit", "formulary", "scribe"];

/** What a stored fact is about. */
export type MemoryKind = "habit" | "naming" | "placement";

/** The one shape we ever send to Meko. Free of patient data by construction. */
export type MekoFact = {
  kind: MemoryKind;
  /** Which agent's datapack it belongs in. */
  agent: MekoAgent;
  /** The sentence Meko stores and searches. English, no identifiers. */
  text: string;
  metadata: {
    doctorKey: string;
    clinicKey: string;
    kind: MemoryKind;
    parchaVersion: string;
  };
};

/** How a key is written into a memory's text, so the keyword scorer can see it. */
export const doctorTag = (doctorKey: string) => `d:${doctorKey}`;
export const clinicTag = (clinicKey: string) => `c:${clinicKey}`;

/**
 * The hash, as a hex string of `length` characters.
 *
 * Node and the browser both have WebCrypto, but only asynchronously, and this
 * is called on a hot path. FNV-1a over the salted input, run twice with
 * different seeds and concatenated, gives a stable opaque key that is plenty
 * for separating doctors inside one clinic's datapack. It is deliberately NOT
 * presented as a security boundary: the real boundary is the datapack and the
 * server-side metadata filter. It exists so that a human reading Meko's portal
 * cannot tell which doctor a row came from.
 */
function opaque(input: string, length = 12): string {
  const hash = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return (hash(0x811c9dc5) + hash(0x7f4a7c15)).slice(0, length);
}

/** The keys for one doctor at one hospital. The salt is a server secret. */
export function scopeKeys(hospitalId: string, uid: string, salt: string): MekoScope {
  return {
    doctorKey: opaque(`${salt}|${hospitalId}|${uid}`),
    clinicKey: opaque(`${salt}|${hospitalId}`),
  };
}
