/**
 * End-to-end encryption for messages inside the team.
 *
 * Each device (a browser on a computer, signed in as one person at one
 * hospital) makes its own key pair the first time it opens Messages. The
 * private half is made non-extractable and kept in this browser's IndexedDB:
 * no code, including Parcha's, can read it out, and it never leaves the device.
 * The public half is published so others can write to it.
 *
 * Sending: a fresh AES-256-GCM key encrypts the message. For each device that
 * may read it (both people's devices in a direct thread; every device at the
 * hospital in a channel, the sender's own included), a one-time ECDH P-256 key
 * and that device's public key derive, through HKDF-SHA-256, a key that wraps
 * the message key. The database receives the ciphertext and the wrapped keys,
 * never the words, the voice transcript or what a message points at. The
 * thread and the sender are bound in as associated data, so a ciphertext
 * cannot be replayed into another thread or passed off as someone else's.
 *
 * What it does not hide: who wrote to whom and when, who was @mentioned (so
 * they can be told), and the sender's name. A device added later cannot read
 * what was sent before it existed. Public keys come from the server, so the
 * direct-message header shows a safety code both people can compare in
 * person to rule out a swapped key.
 */
/** A P-256 public key as JSON (only these fields are kept or sent). */
export type JWK = { kty: string; crv: string; x: string; y: string };

const DB = "parcha-comms";
const STORE = "keys";
const INFO = "parcha-comms-v1";

export type DeviceKey = {
  /** `${uid}__${deviceId}`: the key's document id, and its name in a message. */
  id: string;
  deviceId: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
};

export type PublicDevice = { id: string; uid: string; pub: JWK };

/** The encrypted part of a message, as stored. */
export type Sealed = {
  v: 1;
  eph: JWK;
  iv: string;
  ct: string;
  keys: Record<string, { iv: string; k: string }>;
};

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export const e2eSupported = () => typeof crypto !== "undefined" && !!crypto.subtle && typeof indexedDB !== "undefined";

/* ------------------------------------------------------------------ storage */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

/**
 * This device's key for a person at a hospital, made the first time. The
 * private key is created non-extractable: it can be used here, never read.
 */
const making = new Map<string, Promise<DeviceKey>>();

export function deviceKey(uid: string, hospitalId: string): Promise<DeviceKey> {
  // One at a time: two screens asking at once must not make two keys.
  const name = `${hospitalId}/${uid}`;
  let p = making.get(name);
  if (!p) {
    p = loadOrMake(name, uid).catch((e) => {
      making.delete(name);
      throw e;
    });
    making.set(name, p);
  }
  return p;
}

async function loadOrMake(name: string, uid: string): Promise<DeviceKey> {
  const saved = await idb<DeviceKey | undefined>("readonly", (s) => s.get(name));
  if (saved?.privateKey) return saved;
  const pair = (await crypto.subtle.generateKey(ECDH, false, ["deriveBits"])) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JWK;
  const deviceId = b64(random(9)).replace(/[+/=]/g, "x");
  const key: DeviceKey = { id: `${uid}__${deviceId}`, deviceId, privateKey: pair.privateKey, publicJwk };
  await idb("readwrite", (s) => s.put(key, name));
  return key;
}

/* ------------------------------------------------------------------ crypto */

const importPub = (jwk: JWK) => crypto.subtle.importKey("jwk", jwk as globalThis.JsonWebKey, ECDH, false, []);

/** ECDH, then HKDF, to the AES key that wraps one message key for one device. */
async function wrapKeyFor(priv: CryptoKey, pub: CryptoKey, deviceDocId: string): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(`${INFO}|${deviceDocId}`) },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const aad = (threadId: string, fromUid: string) => enc.encode(`${INFO}|${threadId}|${fromUid}`);

/** Encrypts `payload` so that only `devices` can read it. */
export async function seal(payload: unknown, devices: PublicDevice[], threadId: string, fromUid: string): Promise<Sealed> {
  if (devices.length === 0) throw new Error("Nobody can read this yet: no device has opened Messages.");
  const messageKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = random(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(threadId, fromUid) }, messageKey, enc.encode(JSON.stringify(payload)));
  const raw = await crypto.subtle.exportKey("raw", messageKey);

  // A one-time key for this message: nothing about it outlives the send.
  const eph = (await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair;
  const keys: Sealed["keys"] = {};
  await Promise.all(
    devices.map(async (d) => {
      try {
        const wrap = await wrapKeyFor(eph.privateKey, await importPub(d.pub), d.id);
        const kiv = random(12);
        keys[d.id] = { iv: b64(kiv), k: b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv: kiv }, wrap, raw)) };
      } catch {
        /* a malformed public key is skipped; that device cannot read this */
      }
    }),
  );
  return { v: 1, eph: (await crypto.subtle.exportKey("jwk", eph.publicKey)) as JWK, iv: b64(iv), ct: b64(ct), keys };
}

/** Decrypts a message on this device, or says why it cannot. */
export async function open<T>(sealed: Sealed, me: DeviceKey, threadId: string, fromUid: string): Promise<{ ok: true; value: T } | { ok: false; reason: "not-for-this-device" | "damaged" }> {
  const mine = sealed.keys?.[me.id];
  if (!mine) return { ok: false, reason: "not-for-this-device" };
  try {
    const wrap = await wrapKeyFor(me.privateKey, await importPub(sealed.eph), me.id);
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(mine.iv) }, wrap, unb64(mine.k));
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv), additionalData: aad(threadId, fromUid) }, key, unb64(sealed.ct));
    return { ok: true, value: JSON.parse(dec.decode(plain)) as T };
  } catch {
    return { ok: false, reason: "damaged" };
  }
}

/**
 * A short code from a set of public keys. Two people who see the same code
 * on their screens are talking to each other's real devices.
 */
export async function safetyCode(devices: PublicDevice[]): Promise<string> {
  const text = devices
    .map((d) => `${d.id}:${d.pub.x}:${d.pub.y}`)
    .sort()
    .join("|");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  const n = [0, 1, 2, 3].map((i) => (((digest[i * 3] << 16) | (digest[i * 3 + 1] << 8) | digest[i * 3 + 2]) % 100000).toString().padStart(5, "0"));
  return n.join(" ");
}
