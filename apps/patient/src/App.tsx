import { useEffect } from "react";
import { PendingBar, SessionGuard, useOutboxSync, usingEmulators, useVisitsForPhone } from "@parcha/client";
import { PhoneFrame, Splash, useFontsReady } from "@parcha/ui";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { useHandset } from "./auth";
import { Book } from "./screens/Book";
import { TabsLayout } from "./components/TabsLayout";
import { Home } from "./screens/Home";
import { LinkCode } from "./screens/LinkCode";
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
import { VisitScreen } from "./screens/VisitScreen";
import { setLangPerson, useT } from "./i18n";
import { Visits } from "./screens/Visits";
import { Start } from "./screens/Start";
import { ScanParcha } from "./screens/ScanParcha";
import { CheckMedicines } from "./screens/CheckMedicines";
import { ConsultationDone } from "./components/NewSchedule";

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
  const { handset } = useHandset();
  const visits = useVisitsForPhone(handset?.phone ?? null);
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
            <Route path="/visits" element={<Visits />} />
            <Route path="/records" element={<Records />} />
            <Route path="/me" element={<Me />} />
          </Route>
          <Route path="/visit/:visitId" element={<VisitScreen />} />
          <Route path="/book" element={<Book />} />
          <Route path="/start" element={<Start />} />
          <Route path="/scan" element={<ScanParcha />} />
          <Route path="/rx" element={<ScanParcha />} />
          <Route path="/check" element={<CheckMedicines />} />
          <Route path="/link" element={<LinkCode />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
      {easy ? null : <DueAlerts />}
      {/* When a doctor signs: "consultation finished", the new Parcha, and its schedule to check. */}
      {easy ? null : <ConsultationDone visits={visits.data} />}
      <NativeReminders />
    </>
  );
}

/** The patient's own app: sign in with a phone number, read your records. */
export function App() {
  const { handset, loading } = useHandset();
  const t = useT();

  // The splash waits on the real start-up work: the fonts, the sign-in check,
  // and the first batch of this handset's visits, which Home reads next. The
  // splash also plays its own short story, so it never flashes past.
  const fonts = useFontsReady();
  const visits = useVisitsForPhone(handset?.phone ?? null);
  const ready = !loading && fonts && !visits.loading;
  const status = !fonts
    ? t("Getting things ready", "तैयारी हो रही है", "Taiyari ho rahi hai")
    : loading
      ? t("Checking your phone", "आपका फ़ोन देख रहे हैं", "Aapka phone check kar rahe hain")
      : visits.loading
        ? t("Gathering your records", "आपके काग़ज़ ला रहे हैं", "Aapke records la rahe hain")
        : t("Opening Parcha", "पर्चा खुल रहा है", "Parcha khul raha hai");

  return (
    <PhoneFrame tint="coral" label={usingEmulators ? "Patient app · localhost:3001" : "Parcha"}>
      {/* Whenever someone is waiting on the server, a bar runs across the top. */}
      <PendingBar />
      {loading ? (
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
        ready={ready}
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
