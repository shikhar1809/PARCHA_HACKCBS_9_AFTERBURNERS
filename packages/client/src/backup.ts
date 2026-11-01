/**
 * Writing the phone's backup, and reading it on the way up.
 *
 * Where the file lives. On a phone with a real filesystem the right answer is
 * a real file, and `writeDeviceFile`/`readDeviceFile` below are the seam for
 * that — one Capacitor plugin away. Until then it is a store of its own,
 * `parcha-backup`, kept apart from the vault on purpose: signing out, a stale
 * sign-in or "clear this device" empties the vault, and a backup that went
 * with it would be no backup at all. A person can also save the same bytes as
 * a file of their own, which is the copy that survives a reinstall and moves
 * to a new phone.
 *
 * What goes in it. Everything the family's own screens read — the vault (their
 * Parchas), and the records that belong to the phone number: people, medicine
 * reminders, health summaries, dose ticks, papers. Not the clinic's records,
 * which are not the phone's to hold.
 *
 * Sealed with the family's PIN (`packages/core/src/deviceBackup.ts`), so this
 * file is as portable as the four digits are memorable, and no more readable
 * than they are guessable. Nothing here throws: a device that cannot keep a
 * backup is still a working app, and the screen says it has none.
 */
import {
  isBackupFile,
  openBackup,
  sealBackup,
  type BackupContents,
  type BackupFile,
} from "@parcha/core";

import { getAuthClient } from "./firebase";
import { vaultGet, vaultKeys, vaultPut } from "./vault";

const DB_NAME = "parcha-backup";
const VERSION = 1;
const STORE = "files";
/** When the phone's own data was last touched, so a start-up knows which copy is newer. */
const TOUCHED = "backup.touchedAt";

let opened: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opened) return opened;
  opened = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

const wrap = <T>(req: IDBRequest<T>): Promise<T | undefined> =>
  new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });

/**
 * The device's own copy. One per handset, keyed by the phone number rather
 * than the sign-in, so it is still there after a sign-out and is found again
 * when the same family signs back in.
 */
export async function writeDeviceFile(phone: string, file: BackupFile): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  try {
    await wrap(db.transaction(STORE, "readwrite").objectStore(STORE).put(file, phone));
    return true;
  } catch {
    return false;
  }
}

export async function readDeviceFile(phone: string): Promise<BackupFile | null> {
  const db = await open();
  if (!db) return null;
  try {
    const found = await wrap<unknown>(db.transaction(STORE).objectStore(STORE).get(phone));
    return isBackupFile(found) ? found : null;
  } catch {
    return null;
  }
}

export async function forgetDeviceFile(phone: string): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await wrap(db.transaction(STORE, "readwrite").objectStore(STORE).delete(phone));
  } catch {
    /* nothing to forget */
  }
}

/** When this phone's own data was last changed, as far as the backup is concerned. */
export async function touchedAt(): Promise<string | null> {
  return (await vaultGet<string>(TOUCHED)) ?? null;
}

export const markTouched = (at = new Date().toISOString()) => vaultPut(TOUCHED, at);

/**
 * Everything this phone holds. The parts that come from the database are read
 * through whatever is already cached, so this works with no connection: a
 * backup made offline holds what the phone was showing offline.
 */
export async function gather(read: (collection: string) => Promise<unknown[]>): Promise<BackupContents> {
  const vault: Record<string, unknown> = {};
  for (const key of await vaultKeys()) {
    if (key === TOUCHED) continue;
    const value = await vaultGet<unknown>(key);
    if (value !== undefined) vault[key] = value;
  }
  const [profiles, reminders, histories, doseLogs, documents] = await Promise.all([
    read("profiles"),
    read("reminders"),
    read("histories"),
    read("doseLogs"),
    read("documents"),
  ]);
  return { vault, profiles, reminders, histories, doseLogs, documents };
}

/** Puts a backup's vault back on this phone. The database half is the server's to restore. */
export async function restoreVault(contents: BackupContents): Promise<number> {
  let put = 0;
  for (const [key, value] of Object.entries(contents.vault)) {
    await vaultPut(key, value);
    put += 1;
  }
  await markTouched();
  return put;
}

/** Makes a backup of what the phone holds now and keeps it on the device. */
export async function makeBackup(
  phone: string,
  pin: string,
  read: (collection: string) => Promise<unknown[]>,
): Promise<BackupFile | null> {
  try {
    const file = await sealBackup(await gather(read), pin, phone);
    await writeDeviceFile(phone, file);
    await markTouched(file.madeAt);
    return file;
  } catch {
    return null;
  }
}

/** Opens a backup — the device's own, or one a person picked off their phone. */
export async function readBackup(file: BackupFile, pin: string): Promise<BackupContents | null> {
  return await openBackup(file, pin);
}

/** The signed-in handset, for the screens that make and restore backups. */
export const backupPhone = (): string | null => {
  const phone = getAuthClient().currentUser?.phoneNumber ?? null;
  return phone ? phone.replace(/\D/g, "").slice(-10) : null;
};
