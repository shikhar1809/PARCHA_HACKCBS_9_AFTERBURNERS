/**
 * The backup a phone keeps of itself.
 *
 * Everything a family holds lives on their phone, which is the point of this
 * product and also its one real danger: a phone that is wiped, reinstalled or
 * replaced takes the Parchas with it, and there is no server copy to fall back
 * on because keeping one would undo the arrangement. So the phone writes a
 * copy of itself, sealed, that it reads on the way up and that a person can
 * save somewhere of their own.
 *
 * Sealed with what, is the question a backup always has to answer. Not the
 * vault's key: that one is deliberately non-extractable, cannot be read by
 * this code, and would be useless on a new phone anyway. So it is the family's
 * own PIN, worked out the same way the fifteen-minute share works it out —
 * which means a backup is portable (it opens on the new phone with the same
 * four digits) and that a backup with a forgotten PIN is gone. The screens say
 * so before one is made, because a backup nobody can open is worse than none.
 *
 *   key  = PBKDF2-SHA256(PIN + "@backup:" + phone, salt, 310k) -> AES-256-GCM
 *   file = { v, phone, madeAt, salt, iv, blob }
 *
 * The file carries the phone number in the clear, and nothing else: enough for
 * the app to refuse somebody else's backup before asking for a PIN, and not
 * enough to be worth stealing.
 */
import { b64url, fromB64url } from "./rxToken.js";

/** What a phone holds, as one object. Each part is what its own screens read. */
export type BackupContents = {
  /** The encrypted vault, key by key: the Parchas, and anything else mirrored there. */
  vault: Record<string, unknown>;
  /** The people on this phone. */
  profiles: unknown[];
  /** Medicine and check-up reminders. */
  reminders: unknown[];
  /** What the family says about each person's health. */
  histories: unknown[];
  /** Which doses were ticked, by day. */
  doseLogs: unknown[];
  /** Papers the family added. */
  documents: unknown[];
};

export type BackupFile = {
  v: 1;
  /** The handset this was made on, so a phone can refuse somebody else's. */
  phone: string;
  madeAt: string;
  /** What is inside, for the screen that offers to restore it. */
  counts: { parchas: number; people: number; reminders: number; papers: number };
  salt: string;
  iv: string;
  blob: string;
};

export const BACKUP_FILE_SUFFIX = ".parcha";

/** What a backup should be called when a person saves one of their own. */
export function backupFileName(phone: string, madeAt = new Date()): string {
  const day = madeAt.toISOString().slice(0, 10);
  return `parcha-${phone}-${day}${BACKUP_FILE_SUFFIX}`;
}

const ITERATIONS = 310_000;

async function keyFromPin(pin: string, phone: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${pin}@backup:${phone}`),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.slice().buffer as ArrayBuffer, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function backupCounts(contents: BackupContents): BackupFile["counts"] {
  return {
    parchas: Object.keys(contents.vault).filter((k) => k.startsWith("parcha:") || k.startsWith("slip:") || k.startsWith("check:")).length,
    people: contents.profiles.length,
    reminders: contents.reminders.length,
    papers: contents.documents.length,
  };
}

/** Seals what this phone holds into one file. */
export async function sealBackup(contents: BackupContents, pin: string, phone: string): Promise<BackupFile> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromPin(pin, phone, salt);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.slice().buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(JSON.stringify(contents)),
  );
  return {
    v: 1,
    phone,
    madeAt: new Date().toISOString(),
    counts: backupCounts(contents),
    salt: b64url(salt),
    iv: b64url(iv),
    blob: b64url(new Uint8Array(sealed)),
  };
}

/** Opens one, or null when the PIN is wrong or the file is not a backup. */
export async function openBackup(file: BackupFile, pin: string): Promise<BackupContents | null> {
  try {
    if (file?.v !== 1 || typeof file.blob !== "string") return null;
    const key = await keyFromPin(pin, file.phone, fromB64url(file.salt));
    const open = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(file.iv).slice().buffer as ArrayBuffer },
      key,
      fromB64url(file.blob).slice().buffer as ArrayBuffer,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(open));
    if (!parsed || typeof parsed !== "object") return null;
    const c = parsed as BackupContents;
    return c.vault && typeof c.vault === "object" && Array.isArray(c.profiles) ? c : null;
  } catch {
    return null;
  }
}

/** Whether a file read off the device looks like one of ours at all. */
export function isBackupFile(value: unknown): value is BackupFile {
  if (!value || typeof value !== "object") return false;
  const f = value as BackupFile;
  return f.v === 1 && typeof f.phone === "string" && typeof f.blob === "string" && typeof f.salt === "string" && typeof f.iv === "string";
}

/**
 * Which of two copies is the one to keep: the newer, by when it was made.
 * The phone's own data wins a tie, because it is what the person is looking at.
 */
export function backupIsNewer(file: Pick<BackupFile, "madeAt">, deviceTouchedAt: string | null): boolean {
  if (!deviceTouchedAt) return true;
  return new Date(file.madeAt).getTime() > new Date(deviceTouchedAt).getTime();
}
