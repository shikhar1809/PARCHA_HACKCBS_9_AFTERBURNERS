/**
 * The patient's own papers and self-kept history (see firebase/functions/src/records.ts).
 *
 * A list reads only the small description of each file; the file itself is
 * fetched once, when it is opened.
 */
import { doc, getDoc, limit, orderBy, where } from "firebase/firestore";

import type { AvatarLook, DocKind, PatientDocument, PatientHistory, Profile } from "@parcha/core";

import { call, getDb } from "./firebase";
import { vaultGet, vaultPut } from "./vault";
import { useDoc, useQuery, useQueryFactory, type Loadable } from "./hooks";

export function useDocuments(phone: string | null): Loadable<PatientDocument[]> {
  const build = useQueryFactory(
    "documents",
    [where("ownerPhone", "==", phone ?? "__none__"), orderBy("createdAt", "desc"), limit(100)],
    [phone],
  );
  return useQuery<PatientDocument>(phone ? build : null, phone ? "documents" : undefined);
}

export function useHistories(phone: string | null): Loadable<PatientHistory[]> {
  const build = useQueryFactory(
    "histories",
    [where("ownerPhone", "==", phone ?? "__none__"), limit(50)],
    [phone],
  );
  return useQuery<PatientHistory>(phone ? build : null, phone ? "histories" : undefined);
}

/**
 * The file's bytes as a data URL, for showing or saving. A file that has been
 * opened once is kept on the device, so it opens again with no connection.
 */
export async function readDocumentFile(id: string, mime: string): Promise<string> {
  const saved = await vaultGet<string>(`file:${id}`);
  if (saved) return `data:${mime};base64,${saved}`;
  const snap = await getDoc(doc(getDb(), "documents", id, "files", "main"));
  const data = snap.data()?.data as string | undefined;
  if (!data) throw new Error("That file could not be opened.");
  void vaultPut(`file:${id}`, data);
  return `data:${mime};base64,${data}`;
}

/** Keeps every paper on this device, so all of them open with no connection. Returns how many were saved. */
export async function savePapersToDevice(ids: string[]): Promise<number> {
  let saved = 0;
  for (const id of ids) {
    if (await vaultGet<string>(`file:${id}`)) continue;
    try {
      const snap = await getDoc(doc(getDb(), "documents", id, "files", "main"));
      const data = snap.data()?.data as string | undefined;
      if (data) {
        await vaultPut(`file:${id}`, data);
        saved += 1;
      }
    } catch {
      /* offline or gone: the rest are still worth saving */
    }
  }
  return saved;
}

export const addDocument = (input: {
  personName: string;
  title: string;
  kind: DocKind;
  mime: string;
  /** Base64, without the `data:` prefix. */
  data: string;
  takenOn?: string | null;
}) => call<typeof input, { id: string }>("addDocument", input);

export const deleteDocument = (id: string) => call<{ id: string }, { ok: true }>("deleteDocument", { id });

export const saveHistory = (input: {
  personName: string;
  conditions: string[];
  allergies: string[];
  medicines: string[];
  bloodGroup: string | null;
  notes: string;
}) => call<typeof input, { ok: true }>("saveHistory", input);

/* ----------------------------------------------------------- privacy rights */


/** Whether this number has agreed to the current privacy notice (null until it has). */
export function useConsent(phone: string | null): Loadable<{ version: string; acceptedAt: string } | null> {
  return useDoc<{ version: string; acceptedAt: string }>(phone ? `consents/${phone}` : null, phone ? "consent" : undefined);
}

export const recordConsent = (language: "en" | "hi" | "hg") =>
  call<{ agree: true; language: string }, { version: string }>("recordConsent", { agree: true, language });

/** Everything held that is tied to this number. */
export const exportMyData = () => call<Record<string, never>, Record<string, unknown>>("exportMyData", {});

/** Deletes what the patient made and closes the sign-in. Needs the word DELETE. */
export const deleteMyData = () =>
  call<{ confirm: string }, { removed: Record<string, number>; retainedAt: string[] }>("deleteMyData", { confirm: "DELETE" });

/* ------------------------------------------------------------------ profiles */


export function useProfiles(phone: string | null): Loadable<Profile[]> {
  const build = useQueryFactory("profiles", [where("ownerPhone", "==", phone ?? "__none__"), limit(20)], [phone]);
  return useQuery<Profile>(phone ? build : null, phone ? "profiles" : undefined);
}

export type ProfileInput = {
  name: string;
  nickname?: string | null;
  ageYears?: number | null;
  sex?: string | null;
  look?: AvatarLook;
  needsHelp?: boolean;
  helperName?: string | null;
  helperNumber?: string | null;
  /** Read aloud, larger text, flashing alerts (access.ts). */
  access?: import("@parcha/core").PersonAccess;
};

export const saveProfile = (input: ProfileInput) => call<ProfileInput, { id: string }>("saveProfile", input);
export const deleteProfile = (name: string) => call<{ name: string }, { ok: true }>("deleteProfile", { name });
