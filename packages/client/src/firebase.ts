/**
 * Firebase, wired once.
 *
 * In development everything points at the emulator suite, so both apps run
 * with no Firebase project, no network and no billing — `npm run dev` starts
 * the emulators and the two apps together, and the seeded clinic is there.
 *
 * The config below is a placeholder for a real project. Firebase client
 * config is not a secret: it identifies the project, it does not authorise
 * anything. What authorises is the security rules plus the custom claim on
 * the signed-in account, which is why every write in this app goes through a
 * Cloud Function rather than straight to Firestore.
 */
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";

import { tracked } from "./pending";

const PROJECT_ID = "parcha-dev";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? `${PROJECT_ID}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? PROJECT_ID,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? `${PROJECT_ID}.appspot.com`,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_SENDER_ID ?? "000000000000",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:000000000000:web:demo",
};

/** True unless the app was pointed at a real project. */
export const usingEmulators =
  (import.meta.env.VITE_FIREBASE_USE_EMULATORS ?? "true") !== "false";

/**
 * Where the emulators are. A browser on the same machine reaches them at
 * 127.0.0.1; an Android emulator reaches the host machine at 10.0.2.2, and a
 * real phone on the same wifi at the computer's address. Set
 * VITE_EMULATOR_HOST when building for one of those.
 */
export const EMULATOR_HOST = import.meta.env.VITE_EMULATOR_HOST ?? "127.0.0.1";

let app: FirebaseApp | null = null;
let firestore: Firestore | null = null;
let auth: Auth | null = null;
let functions: Functions | null = null;

function ensure() {
  if (app) return;
  app = initializeApp(config);

  // Offline persistence is not a nicety here. Mobile data in a clinic is
  // patchy and metered, and a patient opening their prescription on the bus
  // should see it. Multi-tab so two open tabs do not fight over the lease.
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });

  auth = getAuth(app);
  // Mumbai, next to the patients; must match firebase/functions/src/options.ts.
  functions = getFunctions(app, "asia-south1");

  if (usingEmulators) {
    connectFirestoreEmulator(firestore, EMULATOR_HOST, 8080);
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, {
      disableWarnings: true,
    });
    connectFunctionsEmulator(functions, EMULATOR_HOST, 5001);
  }
}

export function getDb(): Firestore {
  ensure();
  return firestore!;
}

export function getAuthClient(): Auth {
  ensure();
  return auth!;
}

/**
 * Calls one of the Cloud Functions.
 *
 * Every write goes through here. A failure arrives as an `HttpsError` whose
 * message is written to be shown to a person — "Somebody else moved this
 * patient on while you were working" rather than a code — so callers can
 * surface `error.message` directly.
 */
export async function call<TArgs, TResult>(
  name: string,
  args: TArgs,
): Promise<TResult> {
  // While a person waits on this, the app shows it is working (see pending.tsx).
  return tracked(name, () => callNow<TArgs, TResult>(name, args));
}

async function callNow<TArgs, TResult>(
  name: string,
  args: TArgs,
): Promise<TResult> {
  ensure();
  const fn = httpsCallable<TArgs, TResult>(functions!, name);
  let reauthed = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return (await fn(args)).data;
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      const message = (error as { message?: string }).message ?? "";

      // The server wants the password typed again for this one action. Ask,
      // refresh the token so it carries the new sign-in time, and go again once.
      if (
        !reauthed &&
        code === "functions/failed-precondition" &&
        message.startsWith("RECENT_SIGN_IN") &&
        reauthHandler
      ) {
        reauthed = true;
        if (await reauthHandler()) {
          await auth?.currentUser?.getIdToken(true);
          continue;
        }
        throw new Error("Not done: your password was not confirmed.");
      }

      // The server ended this staff session (its address changed, it moved
      // away, or it was opened elsewhere). Nothing more can be done from it.
      if (code === "functions/unauthenticated" && message.startsWith("SESSION_ENDED") && sessionEndedHandler) {
        sessionEndedHandler(message.replace(/^SESSION_ENDED:s*/, ""));
      }

      // "Unavailable" means the call never got through (a cold start, a dropped
      // connection, a busy instance), so repeating it is safe. The wait grows
      // and is jittered so a thousand screens do not all retry in the same
      // instant and make it worse.
      if (code === "functions/unavailable" && attempt < 3) {
        await new Promise((r) =>
          setTimeout(r, 400 * 2 ** attempt + Math.random() * 300),
        );
        continue;
      }
      throw error;
    }
  }
}

let reauthHandler: (() => Promise<boolean>) | null = null;

let sessionEndedHandler: ((reason: string) => void) | null = null;
/** What to do when the server says this staff session has ended (sign out, with the reason). */
export function setSessionEndedHandler(handler: ((reason: string) => void) | null) {
  sessionEndedHandler = handler;
}

/** The screen registers how to ask for the password again; `call` uses it. */
export function setReauthHandler(handler: (() => Promise<boolean>) | null) {
  reauthHandler = handler;
}
