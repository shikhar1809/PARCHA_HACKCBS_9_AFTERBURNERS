/**
 * Who is signed in on this handset.
 *
 * A patient signs in with a phone number and a one-time code. The security
 * rules match records to the number on the token, so the household model
 * falls out of the sign-in: everyone on the handset is reachable from it.
 *
 * On the Auth emulator no SMS is sent. The code is read back from the
 * emulator's own endpoint so the demo needs no second window; against a real
 * project that read does not exist and the patient types the code they got.
 *
 * The seeded demo handsets can also sign in with one tap and no SMS
 * (`demoSignIn`), where the project has demo sign-in switched on.
 */
import { call, EMULATOR_HOST, getAuthClient, signOutUser, usingEmulators } from "@parcha/client";
import {
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  type ConfirmationResult,
  type User,
} from "firebase/auth";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Handset = {
  uid: string;
  /** Ten digits, the form the records store. */
  phone: string;
};

type AuthState = { handset: Handset | null; loading: boolean };

const AuthContext = createContext<AuthState>({ handset: null, loading: true });

function toHandset(user: User | null): Handset | null {
  if (!user?.phoneNumber) return null;
  return {
    uid: user.uid,
    phone: user.phoneNumber.replace(/\D/g, "").slice(-10),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    handset: null,
    loading: true,
  });

  useEffect(
    () =>
      onAuthStateChanged(getAuthClient(), (user) =>
        setState({ handset: toHandset(user), loading: false }),
      ),
    [],
  );

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useHandset(): AuthState {
  return useContext(AuthContext);
}

let verifier: RecaptchaVerifier | null = null;

/** Asks for a code to be sent to a ten-digit number. */
export function sendCode(tenDigitPhone: string): Promise<ConfirmationResult> {
  const auth = getAuthClient();
  if (usingEmulators) auth.settings.appVerificationDisabledForTesting = true;
  verifier?.clear();
  verifier = new RecaptchaVerifier(auth, "recaptcha-anchor", {
    size: "invisible",
  });
  return signInWithPhoneNumber(auth, `+91${tenDigitPhone}`, verifier);
}

/**
 * The one demo handset the app offers: the family phone shared by Priya,
 * Prashant and Prabha (Dadi), which shows every part of the app, the simple
 * screen and medicine reminders included. Its number is filled in on sign-in.
 */
export const DEMO_PHONES = [
  { phone: "9811044321", note: { en: "Shared by Priya, Prashant and Prabha (Dadi)", hi: "प्रिया, प्रशांत और प्रभा (दादी) का साझा फ़ोन", hg: "Priya, Prashant aur Prabha (Dadi) ka shared phone" } },
];

/** Whether this build offers the one-tap demo handsets. */
export const demoHandsets = usingEmulators || import.meta.env.VITE_DEMO_SIGN_IN === "on";

/** Signs in as a demo handset with no SMS: the server hands back a sign-in for that number. */
export async function demoSignIn(tenDigitPhone: string): Promise<void> {
  type Answer = { token?: string; email?: string; password?: string };
  const r = await call<{ phone: string }, Answer>("demoPhoneSignIn", { phone: tenDigitPhone });
  // A token where the project can sign one; else the handset's demo email and
  // password, which carry the same phone number on the sign-in.
  if (r.token) await signInWithCustomToken(getAuthClient(), r.token);
  else if (r.email && r.password) await signInWithEmailAndPassword(getAuthClient(), r.email, r.password);
  else throw new Error("No demo sign-in came back.");
}

/** Emulator only: the code the emulator "sent" to this number. */
export async function emulatorCodeFor(
  tenDigitPhone: string,
): Promise<string | null> {
  if (!usingEmulators) return null;
  try {
    const res = await fetch(
      `http://${EMULATOR_HOST}:9099/emulator/v1/projects/parcha-dev/verificationCodes`,
    );
    const body = (await res.json()) as {
      verificationCodes?: { phoneNumber: string; code: string }[];
    };
    const mine = (body.verificationCodes ?? []).filter((c) =>
      c.phoneNumber.endsWith(tenDigitPhone),
    );
    return mine.at(-1)?.code ?? null;
  } catch {
    return null;
  }
}

export function signOutOfPatient() {
  return signOutUser();
}
