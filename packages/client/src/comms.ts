/**
 * Talking inside the team: channels everyone at the hospital can read, and
 * direct messages only the two people in them can. End-to-end encrypted (see
 * e2e.ts): the database holds ciphertext, and only the devices a message was
 * sealed for can read it.
 *
 * A message never carries patient data. It can point at a patient's record, a
 * visit or a prescription by id alone; the reader's app fetches the details
 * under the reader's own rights, so someone who may not see that patient sees
 * only that something was shared.
 *
 * Unlike clinical data, these are written straight from the app: a message is
 * not part of a record and has to feel instant. The security rules hold the
 * line: a message is always from the person signed in, stamped with the
 * server's time, never changed or deleted, and a direct thread is readable
 * only by its two members.
 *
 *   hospitals/{h}/threads/{t}              a channel, or a direct thread "dm_a_b"
 *   hospitals/{h}/threads/{t}/messages/{m} its messages: ciphertext, append-only
 *   hospitals/{h}/commsKeys/{uid}__{dev}   each device's public key
 *   hospitals/{h}/commsRead/{uid}          when this person last read each thread
 */
import {
  collection,
  doc,
  getDoc,
  limitToLast,
  orderBy,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

import { deviceKey, open, seal, type DeviceKey, type JWK, type PublicDevice, type Sealed } from "./e2e";
import { getDb } from "./firebase";
import { getHospitalScope, useDoc, useHospitalScope, useQuery, useQueryFactory, type Loadable } from "./hooks";

export { e2eSupported, safetyCode, type DeviceKey, type PublicDevice } from "./e2e";

export type CommsThread = {
  id: string;
  kind: "channel" | "dm";
  hospitalId: string;
  /** Channels: the name, without the #. */
  name?: string;
  topic?: string;
  /** Direct threads: the two people, in id order. */
  members?: string[];
  createdBy: string;
  createdAt?: string | null;
  lastAt?: string | null;
  lastFromUid?: string;
  lastFromName?: string;
  /** Who the last message mentioned, so they can be told. */
  lastMentions?: string[];
};

/**
 * What a message points at: ids only. Never a name, a reading or a medicine;
 * those are looked up by whoever opens it, if they are allowed to.
 */
export type CommsRef =
  | { kind: "patient"; patientId: string }
  | { kind: "visit"; visitId: string }
  | { kind: "prescription"; visitId: string };

/** A visit or prescription named inline with "@": the label as written in the text, and what it opens. */
export type CommsTag = { label: string; ref: CommsRef };

/** What is inside the encryption. */
export type CommsBody = { text: string; voice: boolean; ref: CommsRef | null; tags?: CommsTag[] };

/** A message as stored: who and when in the clear, the rest sealed. */
export type CommsMessage = Partial<Sealed> & {
  id: string;
  fromUid: string;
  fromName: string;
  fromRole: string | null;
  fromDevice?: string;
  mentions: string[];
  at: string | null;
  /** Messages from before encryption carried their text in the clear. */
  text?: string;
};

/** A message as this device reads it. */
export type ReadMessage = CommsMessage & {
  body: CommsBody | null;
  /** Why there is no body: sent before this device existed, or damaged. */
  unreadable?: "not-for-this-device" | "damaged" | "opening";
};

export type CommsMe = { uid: string; name: string; role: string | null };

type StoredKey = { id: string; uid: string; deviceId: string; pub: JWK; label?: string; seenAt?: string | null };

const threadsPath = (h: string) => `hospitals/${h}/threads`;
const keysPath = (h: string) => `hospitals/${h}/commsKeys`;

/** The id of the direct thread between two people: the same from either side. */
export const dmId = (a: string, b: string) => `dm_${[a, b].sort().join("_")}`;

/** A channel's id from its name: "Desk & doctors" is "desk-doctors". */
export const channelId = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "channel";

function scope(): string {
  const h = getHospitalScope();
  if (h) return h;
  throw new Error("Not signed in to a hospital.");
}

/* ------------------------------------------------------------------ devices */

/** A short name for this device, shown to nobody but kept with its key. */
function deviceLabel(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const app = /Electron/.test(ua) ? "Parcha for Windows" : /Edg\//.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Firefox/.test(ua) ? "Firefox" : "Browser";
  return `${app} on ${os}`;
}

/**
 * This device's key, made the first time and published so others can write
 * to it. Undefined while it is being set up; an error if this browser cannot
 * keep a key (a private window, for one).
 */
export function useDeviceKey(uid: string | null): { key: DeviceKey | null; error: string | null } {
  const h = useHospitalScope();
  const [state, setState] = useState<{ key: DeviceKey | null; error: string | null }>({ key: null, error: null });
  useEffect(() => {
    if (!uid || !h) return;
    let live = true;
    void (async () => {
      try {
        const key = await deviceKey(uid, h);
        const pub: JWK = { kty: key.publicJwk.kty, crv: key.publicJwk.crv, x: key.publicJwk.x, y: key.publicJwk.y };
        await setDoc(doc(getDb(), `${keysPath(h)}/${key.id}`), { uid, deviceId: key.deviceId, pub, label: deviceLabel(), seenAt: serverTimestamp() });
        if (live) setState({ key, error: null });
      } catch {
        if (live) setState({ key: null, error: "This browser cannot keep a private key (a private window, or storage is blocked), so messages cannot be read or sent here." });
      }
    })();
    return () => {
      live = false;
    };
  }, [uid, h]);
  return state;
}

/** Every device at the hospital that can be written to. */
export function useDevices(): Loadable<PublicDevice[]> {
  const h = useHospitalScope();
  const build = useQueryFactory(h ? keysPath(h) : "none", [], [h]);
  const keys = useQuery<StoredKey>(h ? build : null);
  const data = useMemo(() => {
    // A device not opened for 60 days is no longer written to.
    const cutoff = new Date(Date.now() - 60 * 864e5).toISOString();
    return keys.data.filter((k) => k.pub?.x && (!k.seenAt || k.seenAt > cutoff)).map((k) => ({ id: k.id, uid: k.uid, pub: k.pub }));
  }, [keys.data]);
  return { ...keys, data };
}

/* ------------------------------------------------------------------ threads */

/** Every channel, and every direct thread this person is in. */
export function useThreads(uid: string | null): Loadable<CommsThread[]> {
  const h = useHospitalScope();
  const channels = useQueryFactory(h ? threadsPath(h) : "none", [where("kind", "==", "channel")], [h]);
  const mine = useQueryFactory(h ? threadsPath(h) : "none", [where("members", "array-contains", uid ?? "")], [h, uid]);
  const a = useQuery<CommsThread>(h ? channels : null);
  const b = useQuery<CommsThread>(h && uid ? mine : null);
  const data = useMemo(() => [...a.data, ...b.data], [a.data, b.data]);
  return { data, loading: a.loading || b.loading, error: a.error ?? b.error };
}

/**
 * A thread's latest messages, oldest first, opened on this device. What was
 * opened is kept in memory only, for as long as the page is open.
 */
const opened = new Map<string, { body: CommsBody | null; unreadable?: ReadMessage["unreadable"] }>();

export function useMessages(threadId: string | null, me: DeviceKey | null, max = 150): Loadable<ReadMessage[]> {
  const h = useHospitalScope();
  const path = h && threadId ? `${threadsPath(h)}/${threadId}/messages` : "none";
  const build = useQueryFactory(path, [orderBy("at"), limitToLast(max)], [path, max]);
  const raw = useQuery<CommsMessage>(h && threadId ? build : null);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!me || !threadId) return;
    let live = true;
    const todo = raw.data.filter((m) => !opened.has(`${me.id}/${m.id}`));
    if (!todo.length) return;
    void Promise.all(
      todo.map(async (m) => {
        const key = `${me.id}/${m.id}`;
        if (!m.ct || !m.eph || !m.keys || !m.iv) {
          opened.set(key, { body: m.text ? { text: m.text, voice: false, ref: null } : null });
          return;
        }
        const r = await open<CommsBody>(m as unknown as Sealed, me, threadId, m.fromUid);
        opened.set(key, r.ok ? { body: r.value } : { body: null, unreadable: r.reason });
      }),
    ).then(() => live && bump((n) => n + 1));
    return () => {
      live = false;
    };
  }, [raw.data, me, threadId]);

  const data = raw.data.map((m): ReadMessage => {
    const o = me ? opened.get(`${me.id}/${m.id}`) : undefined;
    return o ? { ...m, ...o } : { ...m, body: null, unreadable: "opening" };
  });
  return { ...raw, data };
}

/** When this person last read each thread, by thread id. */
export function useCommsRead(uid: string | null): Record<string, string> {
  const h = useHospitalScope();
  const read = useDoc<Record<string, string>>(h && uid ? `hospitals/${h}/commsRead/${uid}` : null);
  return read.data ?? {};
}

/** True when someone else has written since this person last looked. */
export function isUnread(t: CommsThread, read: Record<string, string>, uid: string): boolean {
  if (!t.lastAt || t.lastFromUid === uid) return false;
  const seen = read[t.id];
  return !seen || seen < t.lastAt;
}

export async function markRead(uid: string, threadId: string) {
  const h = scope();
  await setDoc(doc(getDb(), `hospitals/${h}/commsRead/${uid}`), { [threadId]: serverTimestamp() }, { merge: true });
}

/** Opens (making it the first time) the direct thread with another person. */
export async function openDm(me: string, other: string): Promise<string> {
  const h = scope();
  const id = dmId(me, other);
  const ref = doc(getDb(), `${threadsPath(h)}/${id}`);
  if (!(await getDoc(ref)).exists()) {
    await setDoc(ref, { kind: "dm", hospitalId: h, members: [me, other].sort(), createdBy: me, createdAt: serverTimestamp() });
  }
  return id;
}

/** Makes a channel anyone on the team can read and write in. */
export async function createChannel(me: string, name: string, topic = ""): Promise<string> {
  const h = scope();
  const clean = name.trim().replace(/^#/, "").slice(0, 40);
  if (clean.length < 2) throw new Error("A channel needs a name of two letters or more.");
  const id = channelId(clean);
  const ref = doc(getDb(), `${threadsPath(h)}/${id}`);
  if ((await getDoc(ref)).exists()) return id;
  await setDoc(ref, { kind: "channel", hospitalId: h, name: clean, topic: topic.trim().slice(0, 120), createdBy: me, createdAt: serverTimestamp() });
  return id;
}

/**
 * Seals a message for every device that may read it and sends it, moving the
 * thread's "last message" along (who and when only; never the words).
 */
export async function sendMessage(
  thread: CommsThread,
  me: CommsMe,
  device: DeviceKey,
  readers: PublicDevice[],
  input: { text: string; voice?: boolean; ref?: CommsRef | null; mentions?: string[]; tags?: CommsTag[] },
) {
  const h = scope();
  const text = input.text.trim().slice(0, 2000);
  if (!text && !input.ref) return;
  const mentions = [...new Set(input.mentions ?? [])].slice(0, 20);
  // A direct thread: both people's devices. A channel: every device here.
  const to = thread.kind === "dm" ? readers.filter((d) => thread.members?.includes(d.uid)) : readers;
  // This device, even before its own key shows up in the list.
  const all = to.some((d) => d.id === device.id) ? to : [...to, { id: device.id, uid: me.uid, pub: device.publicJwk }];
  // Only tags still written in the text, a few at most.
  const tags = (input.tags ?? []).filter((t) => text.includes(`@${t.label}`)).map((t) => ({ label: t.label.slice(0, 80), ref: t.ref })).slice(0, 10);
  const sealed = await seal({ text, voice: input.voice === true, ref: input.ref ?? null, tags } satisfies CommsBody, all, thread.id, me.uid);

  const batch = writeBatch(getDb());
  batch.set(doc(collection(getDb(), `${threadsPath(h)}/${thread.id}/messages`)), {
    fromUid: me.uid,
    fromName: me.name,
    fromRole: me.role,
    fromDevice: device.id,
    mentions,
    at: serverTimestamp(),
    ...sealed,
  });
  batch.update(doc(getDb(), `${threadsPath(h)}/${thread.id}`), {
    lastAt: serverTimestamp(),
    lastFromUid: me.uid,
    lastFromName: me.name,
    lastMentions: mentions,
  });
  await batch.commit();
}
