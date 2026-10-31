/**
 * The device vault: an encrypted copy of a person's data, kept on the device.
 *
 * What it is for. The patient's medical data should live on their phone (and a
 * clinic's day's work on its computer), not only on a server: it has to open
 * with no signal, survive a bad connection, and stay in the person's hands.
 * Everything a screen has read is mirrored here as it arrives, and read back
 * from here first when the network is slow or gone.
 *
 * How it is kept. Each value is encrypted with AES-GCM before it is written to
 * IndexedDB. The key is generated on the device and stored as a *non-extractable*
 * key: this code can use it to encrypt and decrypt but cannot read its bytes, so
 * the data cannot be lifted out of a copied database file. Values are kept under
 * the signed-in user's id, so two people sharing a device do not see each other's.
 *
 * What it is not. Anyone who can run this app on the unlocked device as that
 * user can read it; the encryption protects data at rest, not a person holding
 * the phone open. Deleting the app's data (or "Clear this device") removes it.
 *
 * Every call is best-effort and never throws: no IndexedDB (a private window,
 * a very old browser) means no local copy, and the app carries on without one.
 */
import { getAuthClient } from "./firebase";

const DB_NAME = "parcha-vault";
const VERSION = 1;

let opened: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opened) return opened;
  opened = new Promise((resolve) => {
    if (typeof indexedDB === "undefined" || typeof crypto === "undefined" || !crypto.subtle) return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("kv");
        req.result.createObjectStore("meta");
      };
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

let keyPromise: Promise<CryptoKey | null> | null = null;

/** The device's key, made on first use and never exportable. */
function deviceKey(): Promise<CryptoKey | null> {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    const db = await open();
    if (!db) return null;
    try {
      const existing = await wrap<CryptoKey>(db.transaction("meta").objectStore("meta").get("master"));
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await wrap(db.transaction("meta", "readwrite").objectStore("meta").put(key, "master"));
      return key;
    } catch {
      return null;
    }
  })();
  return keyPromise;
}

/** Everything is stored under who is signed in, so a shared device keeps people apart. */
const scope = () => getAuthClient().currentUser?.uid ?? null;
const full = (key: string) => {
  const uid = scope();
  return uid ? `${uid}|${key}` : null;
};

type Sealed = { iv: Uint8Array; data: ArrayBuffer; at: number };

export async function vaultPut(key: string, value: unknown): Promise<void> {
  const k = full(key);
  const db = await open();
  const dk = await deviceKey();
  if (!k || !db || !dk) return;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dk, new TextEncoder().encode(JSON.stringify(value)));
    const sealed: Sealed = { iv, data, at: Date.now() };
    await wrap(db.transaction("kv", "readwrite").objectStore("kv").put(sealed, k));
  } catch {
    /* a full disk or a blocked store: the live copy still works */
  }
}

export async function vaultGet<T>(key: string): Promise<T | undefined> {
  const k = full(key);
  const db = await open();
  const dk = await deviceKey();
  if (!k || !db || !dk) return undefined;
  try {
    const sealed = await wrap<Sealed>(db.transaction("kv").objectStore("kv").get(k));
    if (!sealed) return undefined;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv as unknown as BufferSource }, dk, sealed.data);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return undefined;
  }
}

export async function vaultDelete(key: string): Promise<void> {
  const k = full(key);
  const db = await open();
  if (!k || !db) return;
  await wrap(db.transaction("kv", "readwrite").objectStore("kv").delete(k));
}

/** Every key this user has stored, without the user prefix. */
export async function vaultKeys(prefix = ""): Promise<string[]> {
  const uid = scope();
  const db = await open();
  if (!uid || !db) return [];
  const all = ((await wrap(db.transaction("kv").objectStore("kv").getAllKeys())) ?? []) as string[];
  return all.filter((k) => k.startsWith(`${uid}|${prefix}`)).map((k) => k.slice(uid.length + 1));
}

/** Removes this user's whole local copy. */
export async function vaultClear(): Promise<number> {
  const keys = await vaultKeys();
  const db = await open();
  if (!db) return 0;
  const store = db.transaction("kv", "readwrite").objectStore("kv");
  const uid = scope();
  for (const k of keys) store.delete(`${uid}|${k}`);
  return keys.length;
}

/** What is held, for the "stored on this device" screen. */
export async function vaultStats(): Promise<{ items: number; bytes: number; files: number }> {
  const uid = scope();
  const db = await open();
  if (!uid || !db) return { items: 0, bytes: 0, files: 0 };
  const store = db.transaction("kv").objectStore("kv");
  const keys = ((await wrap(store.getAllKeys())) ?? []) as string[];
  const rows = ((await wrap(db.transaction("kv").objectStore("kv").getAll())) ?? []) as Sealed[];
  let items = 0;
  let files = 0;
  let bytes = 0;
  keys.forEach((k, i) => {
    if (!k.startsWith(`${uid}|`)) return;
    items += 1;
    if (k.startsWith(`${uid}|file:`)) files += 1;
    bytes += rows[i]?.data?.byteLength ?? 0;
  });
  return { items, bytes, files };
}
