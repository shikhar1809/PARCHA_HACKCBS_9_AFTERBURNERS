import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android app is the patient web app in a native shell.
 *
 * Build the web app first (`npm run build`), then `npm run android:sync` copies
 * it into the Android project. The web code is the same code that runs in a
 * browser; the native layer adds what a browser cannot: reminders that fire
 * while the app is closed (local notifications), and a launcher icon and
 * splash.
 *
 * Until there is a hosted backend, the app talks to the Firebase emulators on a
 * development machine. `cleartext` lets the WebView reach them over plain
 * http; remove it when the app points at a real project.
 */
const config: CapacitorConfig = {
  appId: "in.parcha.patient",
  appName: "Parcha",
  webDir: "dist",
  backgroundColor: "#faf5ea",
  server: {
    androidScheme: "http",
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    // Android 15 draws apps edge to edge, under the status bar and the phone's
    // own Back / Home buttons. This keeps the app between them, so the tab bar
    // is never under the system buttons.
    adjustMarginsForEdgeToEdge: "force",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: "#faf5ea",
      androidScaleType: "CENTER_INSIDE",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#faf5ea",
    },
    LocalNotifications: {
      smallIcon: "ic_stat_parcha",
      iconColor: "#ff7f5a",
    },
  },
};

export default config;
