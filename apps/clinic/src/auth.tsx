/**
 * Who is signed in on this device.
 *
 * What a person may do comes from their SEAT: a list of abilities (register,
 * vitals, consult, activity, manage) that each clinic sets for itself (see
 * packages/core/src/seats.ts). The abilities are custom claims set by the
 * server, which is why a client cannot grant itself any, and why the security
 * rules can trust them. The two counters of the visit (the desk and the
 * doctor) are worked out from them, so a doctor practising alone holds both.
 *
 * What is still missing, and should not be forgotten: these devices sit on a
 * shared counter and get walked away from. A real build pairs this with a
 * short idle lock, a PIN to resume, and re-authentication at the moment a
 * prescription is signed — that signature is the legally meaningful act in
 * the whole product, and it should not ride on a session opened hours ago.
 */
import { abilitiesFromClaims, countersFor, type Ability, type AccountType, type StaffRole } from "@parcha/core";
import { call, getAuthClient, setHospitalScope, signOutUser, usingEmulators } from "@parcha/client";
import {
  onIdTokenChanged,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  type User,
} from "firebase/auth";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type Identity = {
  uid: string;
  displayName: string;
  accountType: AccountType;
  counters: StaffRole[];
  /** What this person's seat lets them do. Claims only the server can set. */
  abilities: Ability[];
  /** The seat's name ("Front desk", "Triage nurse"), or null before set-up. */
  seatName: string | null;
  /** Holds the Manage ability. */
  admin: boolean;
  /** The hospital this account works at, also a claim. */
  hospitalId: string;
};

type AuthState = {
  identity: Identity | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState>({
  identity: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    identity: null,
    loading: true,
  });

  useEffect(() => {
    // onIdTokenChanged rather than onAuthStateChanged: the account type is a
    // custom claim, so the identity has to be rebuilt whenever the token is
    // refreshed, not only when somebody signs in or out.
    return onIdTokenChanged(getAuthClient(), async (user: User | null) => {
      if (!user) {
        setHospitalScope(null);
        setState({ identity: null, loading: false });
        return;
      }
      const token = await user.getIdTokenResult();
      const accountType = token.claims.accountType;
      if (accountType !== "staff" && accountType !== "doctor") {
        // Signed in, but not as a clinic account. Treated as signed out
        // rather than as a staff member with no counters.
        setHospitalScope(null);
        setState({ identity: null, loading: false });
        return;
      }
      // Confine every staff read to this hospital before anything subscribes.
      const hospitalId = (token.claims.hospitalId as string | undefined) ?? "";
      setHospitalScope(hospitalId || null);
      setState({
        identity: {
          uid: user.uid,
          displayName:
            (token.claims.name as string | undefined) ??
            user.displayName ??
            user.email ??
            "Clinic staff",
          accountType,
          ...(() => {
            const abilities = abilitiesFromClaims(token.claims as Record<string, unknown>);
            return { abilities, counters: countersFor(abilities), admin: abilities.includes("manage") };
          })(),
          seatName: typeof token.claims.seatName === "string" ? token.claims.seatName : null,
          hospitalId,
        },
        loading: false,
      });
    });
  }, []);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useIdentity(): AuthState {
  return useContext(AuthContext);
}

export function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(getAuthClient(), email, password);
}

/**
 * The example set-ups (a big hospital, a medium one, a personal practice) are
 * opened from the first screen with one tap: on the emulator, and on a live
 * project built with VITE_DEMO_SIGN_IN=on.
 */
export const demoMode = usingEmulators || import.meta.env.VITE_DEMO_SIGN_IN === "on";
const EXAMPLE_PASSWORD = "parcha123";

/**
 * Opens an example account with no password typed: the server hands back a
 * sign-in for it. Where the project cannot sign one, the example password does.
 */
const NO_TOKENS = "parcha.noTokenSignIn";
let tokensUnavailable = (() => {
  try {
    return localStorage.getItem(NO_TOKENS) === "1";
  } catch {
    return false;
  }
})();
export async function demoSignIn(email: string) {
  // Once the project has said it cannot sign tokens, go straight to the password.
  if (!tokensUnavailable) {
    try {
      const { token } = await call<{ email: string }, { token: string }>("demoStaffSignIn", { email });
      await signInWithCustomToken(getAuthClient(), token);
      return;
    } catch {
      tokensUnavailable = true;
      try {
        localStorage.setItem(NO_TOKENS, "1");
      } catch {
        /* this page load still remembers */
      }
    }
  }
  await signInWithEmailAndPassword(getAuthClient(), email, EXAMPLE_PASSWORD);
}

export function signOutOfClinic() {
  return signOutUser();
}

export function mayAct(identity: Identity | null, counter: StaffRole): boolean {
  return identity?.counters.includes(counter) ?? false;
}

/** Whether this person's seat has an ability. */
export function can(identity: Identity | null, ability: Ability): boolean {
  return identity?.abilities.includes(ability) ?? false;
}

/**
 * A switch of seat in progress: who is being opened. Held here, above every
 * screen, because a switch signs one person out before the next is in, and in
 * that gap nobody is signed in: the app shows a loading window instead of the
 * sign-in page, until the new person has arrived.
 */
let switching: string | null = null;
const switchListeners = new Set<() => void>();
const setSwitching = (to: string | null) => {
  switching = to;
  for (const l of switchListeners) l();
};
export const useSwitching = () =>
  useSyncExternalStore(
    (l) => {
      switchListeners.add(l);
      return () => switchListeners.delete(l);
    },
    () => switching,
  );
/** Called once the new person's identity is in. */
export const switchDone = () => setSwitching(null);

/** Signs out and opens another example seat, with the loading window between. */
export async function switchSeat(email: string, label: string) {
  setSwitching(label);
  try {
    await signOutOfClinic();
    await demoSignIn(email);
  } catch (e) {
    setSwitching(null);
    throw e;
  }
}

/**
 * Where to land after switching to another seat, when it is not that seat's
 * own counter (Management, from the sidebar). Read once.
 */
let afterSwitch: string | null = null;
export const openAfterSwitch = (path: string) => {
  afterSwitch = path;
};
export function takeAfterSwitch(): string | null {
  const path = afterSwitch;
  afterSwitch = null;
  return path;
}
