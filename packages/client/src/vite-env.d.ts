/// <reference types="vite/client" />

/**
 * The environment the Firebase config is read from.
 *
 * All optional: with none of them set, both apps point at the local emulator
 * suite, which is how development runs. Setting them switches to a real
 * project. Firebase client config is not a secret — it identifies the
 * project, it does not authorise anything.
 */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  /** "false" points the apps at a real project instead of the emulators. */
  readonly VITE_FIREBASE_USE_EMULATORS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
