/**
 * Everyone on this phone, in one place.
 *
 * A person appears here because a hospital has seen them (their name, age and
 * sex come from the visit) or because the family added them. What the family
 * says (a face, an age, a nickname, who helps them) is laid over that. Screens
 * ask for a person by name and get the merged picture, so a change made once in
 * the profile editor shows everywhere.
 *
 * It also remembers whose turn it is. On a phone shared by a family, the app
 * asks "who is using Parcha?" each time it opens (like a streaming app's
 * profiles), and then shows only that person: their medicines, visits and
 * papers. A switch at the top of every tab asks again. With one person on the
 * phone there is nothing to ask. A person who needs help gets the simple screen.
 */
import { useProfiles, useVisitsForPhone } from "@parcha/client";
import { cleanAccess, shownName, type AvatarLook, type PersonAccess, type Profile } from "@parcha/core";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { useHandset } from "../auth";
import { setFullAppFor } from "./full-app";

export type Person = {
  name: string;
  /** The nickname if there is one, else the name. */
  shown: string;
  nickname: string | null;
  ageYears: number | null;
  sex: string | null;
  look: AvatarLook;
  needsHelp: boolean;
  helperName: string | null;
  helperNumber: string | null;
  callNumber: string | null;
  callNumberVerified: boolean;
  /** Seeing and hearing: read aloud, larger text, flashing alerts (access.ts). */
  access: PersonAccess;
  /** The family has saved details for them. */
  hasProfile: boolean;
  /** A hospital has seen them. */
  fromHospital: boolean;
};

type Ctx = {
  people: Person[];
  loading: boolean;
  /** Whose turn it is on this phone, or null for everybody. */
  active: string | null;
  setActive: (name: string | null) => void;
  /** True while the "who is using" screen should be showing. */
  picking: boolean;
  /** Shows it again (the switch button). */
  openPicker: () => void;
};

const PeopleContext = createContext<Ctx>({
  people: [],
  loading: true,
  active: null,
  setActive: () => undefined,
  picking: false,
  openPicker: () => undefined,
});

const KEY = "parcha.active";
/** Set once someone has been chosen since the app was opened; cleared when the app closes. */
const PICKED = "parcha.pickedThisLaunch";
const pickedThisLaunch = () => {
  try {
    return sessionStorage.getItem(PICKED) === "1";
  } catch {
    return false;
  }
};

function readActive(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function PeopleProvider({ children }: { children: ReactNode }) {
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const visits = useVisitsForPhone(phone);
  const profiles = useProfiles(phone);
  const [chosen, setChosen] = useState<string | null>(readActive);
  const [picked, setPicked] = useState(pickedThisLaunch);

  const people = useMemo<Person[]>(() => {
    const fromVisits = new Map<string, { age: number | null; sex: string | null }>();
    for (const v of visits.data) {
      if (!fromVisits.has(v.patientName)) fromVisits.set(v.patientName, { age: v.patientAgeYears, sex: v.patientSex });
    }
    const byProfile = new Map<string, Profile>(profiles.data.map((p) => [p.name, p]));
    const names = [...new Set([...fromVisits.keys(), ...byProfile.keys()])].sort((a, b) => a.localeCompare(b));
    return names.map((name) => {
      const v = fromVisits.get(name);
      const p = byProfile.get(name);
      return {
        name,
        shown: p ? shownName(p) : name,
        nickname: p?.nickname ?? null,
        ageYears: p?.ageYears ?? v?.age ?? null,
        sex: p?.sex ?? v?.sex ?? null,
        look: p?.look ?? {},
        needsHelp: p?.needsHelp ?? false,
        helperName: p?.helperName ?? null,
        helperNumber: p?.helperNumber ?? null,
        callNumber: p?.callNumber ?? null,
        callNumberVerified: p?.callNumberVerified ?? false,
        access: cleanAccess(p?.access),
        hasProfile: !!p,
        fromHospital: !!v,
      };
    });
  }, [visits.data, profiles.data]);

  const setActive = useCallback((name: string | null) => {
    setFullAppFor(null);
    setChosen(name);
    // Choosing someone answers "who is using"; clearing the choice asks again.
    setPicked(!!name);
    try {
      if (name) localStorage.setItem(KEY, name);
      else localStorage.removeItem(KEY);
      if (name) sessionStorage.setItem(PICKED, "1");
      else sessionStorage.removeItem(PICKED);
    } catch {
      /* private mode: it still works until the page closes */
    }
  }, []);
  const openPicker = useCallback(() => {
    setPicked(false);
    try {
      sessionStorage.removeItem(PICKED);
    } catch {
      /* as above */
    }
  }, []);

  const loading = visits.loading || profiles.loading;
  // One person on the phone: they are the one using it.
  const only = people.length === 1 ? people[0].name : null;
  const active = only ?? (chosen && people.some((p) => p.name === chosen) ? chosen : null);
  const picking = !loading && people.length > 1 && (!picked || !active);
  const value = useMemo(
    () => ({ people, loading, active, setActive, picking, openPicker }),
    [people, loading, active, setActive, picking, openPicker],
  );
  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

export const usePeople = () => useContext(PeopleContext);

/** One person by name, or undefined. */
export function usePerson(name: string | null | undefined): Person | undefined {
  const { people } = useContext(PeopleContext);
  return name ? people.find((p) => p.name === name) : undefined;
}

/** The person whose turn it is, if one is chosen. */
export function useActivePerson(): Person | undefined {
  const { people, active } = useContext(PeopleContext);
  return active ? people.find((p) => p.name === active) : undefined;
}
