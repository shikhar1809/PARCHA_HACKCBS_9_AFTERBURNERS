import { useEffect } from "react";
import { PendingBar, SessionGuard, useOutboxSync, useReminders, usingEmulators } from "@parcha/client";
import { usableUsername } from "@parcha/core";
import { PhoneFrame, Splash, useFontsReady } from "@parcha/ui";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { useHandset } from "./auth";
import { seedDemoParchas } from "./components/demoParchas";
import { drainCallAnswers } from "./components/callScreen";
import { BackupCheck } from "./components/backup";
import { Ask } from "./screens/Ask";
import { HistoryView } from "./screens/HistoryView";
import { SharedHistory } from "./screens/SharedHistory";
import { TabsLayout } from "./components/TabsLayout";
import { Home } from "./screens/Home";
import { Me } from "./screens/Me";
import { Records } from "./screens/Records";
import { Schedule } from "./screens/Schedule";
import { SignIn } from "./screens/SignIn";
import { DueAlerts, snoozeDose } from "./components/alerts";
import { useNotificationActions } from "./components/notify";
import { NativeReminders } from "./components/native";
import { PeopleProvider, useActivePerson, usePeople } from "./components/people";
import { WhoIsUsingScreen } from "./components/switcher";
import { EasyHome } from "./screens/EasyHome";
import { useFullAppFor } from "./components/full-app";
import { ConsentGate } from "./components/privacy";
import { setLangPerson, useT } from "./i18n";
import { Start } from "./screens/Start";
import { ScanParcha } from "./screens/ScanParcha";
import { CheckMedicines } from "./screens/CheckMedicines";

/**
 * The name in `parcha.web.app/<name>`, when the path is one of those and not a
 * screen of the app's own. The app's screens are reserved names, so a share
 * can never shadow one.
 */
function sharedUsername(path: string): string | null {
  const last = path.split("/").filter(Boolean).pop() ?? "";
  return usableUsername(last) ? last : null;
}

/**
 * What is on screen once someone is signed in and has agreed. A person who needs
 * help gets the one simple screen and nothing else; everyone else gets the app.
 * Reminders (the banner, and the phone's own alarms in the Android app) run in
 * both, because the person who most needs them is the one on the simple screen.
 */
function Inside() {
  const navigate = useNavigate();
  // Changes made with no connection are sent as soon as there is one.
  useOutboxSync();
  // The buttons on a reminder notification ("Taken", "Later") land here.
  useNotificationActions(() => navigate("/schedule"), snoozeDose);
  const active = useActivePerson();
  const { picking } = usePeople();
  // The demo phone starts with the family's three Parchas already on it, so
  // the Parchas tab, Ask and a shared history have something real in them.
  // A phone that has scanned anything is left alone.
  const { handset } = useHandset();
  useEffect(() => {
    void seedDemoParchas(handset?.phone ?? null);
  }, [handset?.phone]);

  // What was answered on a call screen while the app was closed joins the
  // outbox here, and is sent whenever the connection comes back.
  useEffect(() => {
    void drainCallAnswers();
  }, []);

  // The language follows the person using the phone, if they chose their own.
  useEffect(() => setLangPerson(active?.name ?? null), [active?.name]);
  // Larger text and high contrast follow the person using the phone.
  const access = active?.access;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.largeText = access?.largeText || access?.lowVision ? "1" : "";
    root.dataset.contrast = access?.highContrast ? "high" : "";
  }, [access?.largeText, access?.lowVision, access?.highContrast]);
  // The simple screen is the default for someone who needs help; its "full
  // app" button opens the rest of the app for them, until the next launch.
  const fullFor = useFullAppFor();
  const easy = active?.needsHelp === true && fullFor !== active.name;
  // A shared phone asks "who is using Parcha?" first, and again on Switch.
  if (picking) return <WhoIsUsingScreen />;
  return (
    <>
      {easy ? (
        <EasyHome person={active} />
      ) : (
        <Routes>
          <Route element={<TabsLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/records" element={<Records />} />
            <Route path="/ask" element={<Ask />} />
            <Route path="/me" element={<Me />} />
          </Route>
          <Route path="/start" element={<Start />} />
          <Route path="/scan" element={<ScanParcha />} />
          <Route path="/rx" element={<ScanParcha />} />
          <Route path="/check" element={<CheckMedicines />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
      {/* Once, on the way up: a backup newer than this phone's own data is
          offered back. A phone with its data intact is not interrupted. */}
      <BackupCheck />
      {easy ? null : <DueAlerts />}
      <NativeReminders />
    </>
  );
}

/** The patient's own app: sign in with a phone number, read your records. */
export function App() {
  const { handset, loading } = useHandset();
  const t = useT();
  // A doctor is not signed in and never will be. Both ways a family hands a
  // history over land before the sign-in gate: the scanned code, which carries
  // the summary itself, and `parcha.web.app/<name>`, which fetches a sealed
  // box and opens it here with the PIN they were told. Everything else on this
  // path belongs to the family and stays behind the gate.
  const path = window.location.pathname.replace(/\/+$/, "");
  const doctorScan = path.endsWith("/history");
  const sharedWith = doctorScan ? null : sharedUsername(path);

  // The splash waits on the real start-up work: the fonts, the sign-in check,
  // and the first batch of this handset's reminders, which Home reads next. The
  // splash also plays its own short story, so it never flashes past.
  const fonts = useFontsReady();
  const reminders = useReminders(handset?.phone ?? null);
  const ready = !loading && fonts && !reminders.loading;
  const status = !fonts
    ? t("Getting things ready", "तैयारी हो रही है", "Taiyari ho rahi hai")
    : loading
      ? t("Checking your phone", "आपका फ़ोन देख रहे हैं", "Aapka phone check kar rahe hain")
      : reminders.loading
        ? t("Gathering your medicines", "आपकी दवाइयाँ ला रहे हैं", "Aapki dawaiyan la rahe hain")
        : t("Opening Parcha", "पर्चा खुल रहा है", "Parcha khul raha hai");

  return (
    <PhoneFrame tint="coral" label={usingEmulators ? "Patient app · localhost:3001" : "Parcha"}>
      {/* Whenever someone is waiting on the server, a bar runs across the top. */}
      <PendingBar />
      {doctorScan ? (
        <HistoryView />
      ) : sharedWith ? (
        <SharedHistory username={sharedWith} />
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground text-sm">{t("Loading…", "खुल रहा है…", "Khul raha hai…")}</p>
        </div>
      ) : !handset ? (
        <SignIn />
      ) : (
        <SessionGuard kind="patient" idleMinutes={30}>
        <ConsentGate>
        <PeopleProvider>
        <Inside />
        </PeopleProvider>
        </ConsentGate>
        </SessionGuard>
      )}
      <Splash
        ready={doctorScan || !!sharedWith || ready}
        status={status}
        words={{
          headline: t("Simplifying your medical journey", "इलाज का सफ़र आसान", "Ilaaj ka safar aasaan").split(" "),
          stops: [
            { label: t("Register", "पंजीकरण", "Register"), caption: t("Registered at the desk", "काउंटर पर नाम लिखा", "Counter par naam likha") },
            { label: t("Check-up", "जाँच", "Jaanch"), caption: t("Vitals taken in a minute", "एक मिनट में जाँच", "Ek minute mein jaanch") },
            { label: t("Doctor", "डॉक्टर", "Doctor"), caption: t("Seen by the doctor", "डॉक्टर ने देखा", "Doctor ne dekha") },
            { label: t("Prescription", "पर्ची", "Parchi"), caption: t("Prescription signed", "पर्ची पर साइन हुए", "Parchi par sign hue") },
            { label: t("Medicine", "दवा", "Dawai"), caption: t("Medicine in your hand", "दवा आपके हाथ में", "Dawai aapke haath mein") },
          ],
          skip: t("Tap to skip", "छोड़ने के लिए छुएँ", "Skip karne ke liye chhuein"),
          loading: t("Parcha is loading", "Parcha खुल रहा है", "Parcha khul raha hai"),
        }}
      />
    </PhoneFrame>
  );
}
