import {
  PendingBar,
  SessionGuard,
  StaffSessionGate,
  useFormulary,
  useOutboxSync,
  useQueue,
  useRoutes,
  useSafetyData,
  useTeam,
} from "@parcha/client";
import { Splash, useFontsReady } from "@parcha/ui";
import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";

import { Loader2 } from "lucide-react";

import { can, demoMode, switchDone, useIdentity, useSwitching, type Identity, takeAfterSwitch } from "./auth";
import { NeedsAttention } from "./NeedsAttention";
import { Pick, Single, Split } from "./Shell";
import { CommsDock } from "./comms/Comms";
import { Sidebar, Tabs } from "./Tabs";
import { Team } from "./screens/Team";
import { Activity } from "./screens/Activity";
import { Billing } from "./screens/Billing";
import { Pharmacy } from "./screens/Pharmacy";
import { Manage } from "./screens/manage/Manage";
import { ClinicGate } from "./screens/setup/ClinicGate";
import { Consultation } from "./screens/Consultation";
import { Desk } from "./screens/Desk";
import { DoctorQueue } from "./screens/DoctorQueue";
import { Intake } from "./screens/Intake";
import { Kiosk } from "./screens/Kiosk";
import { Me } from "./screens/Me";
import { NewPatient } from "./screens/NewPatient";
import { RespondRequest } from "./screens/RespondRequest";
import { RequestDetail } from "./screens/RequestDetail";
import { SignIn } from "./screens/SignIn";

/**
 * Where a person starts: the first counter their seat works at (a doctor who
 * also registers starts at the desk, where the day's patients arrive), else
 * the activity log, else the team.
 */
function homeFor(identity: Identity): string {
  if (identity.counters.includes("compounder")) return "/desk";
  if (identity.counters.includes("doctor")) return "/doctor";
  if (can(identity, "dispense")) return "/pharmacy";
  if (can(identity, "billing")) return "/billing";
  if (can(identity, "activity")) return "/activity";
  if (can(identity, "manage")) return "/manage";
  return "/team";
}

/**
 * Only a seat that works at this counter gets past. Anyone else is sent to
 * their own start, so a link to a screen that was never theirs lands somewhere
 * useful. The server and the rules are what actually refuse; this keeps the
 * screen in agreement with them instead of showing an empty or broken page.
 */
function Only({ counter }: { counter: Identity["counters"][number] }) {
  const { identity } = useIdentity();
  return identity?.counters.includes(counter) ? <Outlet /> : <Navigate to="/" replace />;
}

/**
 * The clinic app, as a web app.
 *
 * One device, two account types. Which screens exist depends on which
 * counters the signed-in account holds, so a doctor never sees the medicine
 * counter and the desk never sees the prescribing screen.
 *
 * Wide screens get a sidebar and a list beside the open patient; a phone gets
 * the same screens one at a time with a tab bar. It is the same code, laid out
 * for the room there is.
 */
export function App() {
  const { identity, loading } = useIdentity();
  // A different person signed in on this device (a switch of seat): start
  // them at their own counter, not on whatever screen the last person left.
  const navigate = useNavigate();
  const lastUid = useRef<string | null>(null);
  const switching = useSwitching();
  useEffect(() => {
    if (!identity) return;
    if (lastUid.current && lastUid.current !== identity.uid) {
      // Stay in the same part of the app when the new seat works there
      // (the routes send anyone else to their own start).
      const section = `/${window.location.pathname.split("/")[1] ?? ""}`;
      navigate(takeAfterSwitch() ?? (section === "/" ? homeFor(identity) : section), { replace: true });
    }
    lastUid.current = identity.uid;
    switchDone();
  }, [identity, navigate]);
  // Changes made with no connection are sent as soon as there is one.
  useOutboxSync();

  // The splash waits on the real start-up work: the fonts, the sign-in check,
  // and the first read of the live queue. The splash also plays its own short
  // story, so it never flashes past.
  const fonts = useFontsReady();
  const [warm, setWarm] = useState(false);
  const ready = !loading && fonts && (!identity || warm);
  const status = !fonts
    ? "Getting things ready"
    : loading
      ? "Checking who is signed in"
      : identity && !warm
        ? "Loading the queue"
        : "Opening Parcha";

  return (
    <div className="relative flex h-dvh overflow-hidden bg-[var(--color-background)]">
      {loading ? null : switching && !identity ? null : !identity ? (
        <SignInPage />
      ) : (
        <>
          {/* Whenever someone is waiting on the server, a bar runs across the top. */}
          <PendingBar />
          {/* Nothing opens until the server has a session for this device: its
              location and internet address, pinned for the whole session. */}
          <StaffSessionGate>
          {/* First run: the clinic's set-up, then a person's own profile. */}
          <ClinicGate>
          {/* A staff device locks after ten idle minutes and asks for the password. */}
          {/* The example set-ups have no passwords to type, so they do not lock when idle. */}
          <SessionGuard kind="staff" idleMinutes={demoMode ? 24 * 60 : 10}>
            <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Routes>
              <Route
                path="/"
                element={
                  <Navigate
                    to={homeFor(identity)}
                    replace
                  />
                }
              />

              <Route element={<Only counter="compounder" />}>
              <Route element={<Split base="/desk" master={<Desk />} />}>
                <Route
                  path="/desk"
                  element={
                    <Pick
                      title="Look someone up"
                      detail="Search a phone number on the left, then start a visit and take their vitals here."
                    />
                  }
                />
                <Route path="/desk/new" element={<NewPatient />} />
                <Route path="/desk/requests/:visitId" element={<RequestDetail />} />
                <Route path="/intake/:visitId" element={<Intake />} />
              </Route>
              {/* The waiting-room screen: full width, no queue beside it, because
                  it faces the patients rather than the desk. */}
              <Route path="/kiosk" element={<Kiosk />} />
              </Route>

              <Route element={<Only counter="doctor" />}>
              <Route element={<Split base="/doctor" master={<DoctorQueue />} />}>
                <Route
                  path="/doctor"
                  element={
                    <Pick
                      title="Pick a patient"
                      detail="Choose someone from the queue to read their intake and start prescribing."
                    />
                  }
                />
                <Route path="/doctor/requests/:visitId" element={<RespondRequest />} />
                <Route path="/doctor/:visitId" element={<Consultation />} />
              </Route>
              </Route>
              <Route
                path="/pharmacy"
                element={
                  can(identity, "dispense") ? (
                    <Single>
                      <Pharmacy />
                    </Single>
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="/billing"
                element={
                  can(identity, "billing") ? (
                    <Single>
                      <Billing />
                    </Single>
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route path="/team" element={<Team />} />
              <Route
                path="/manage"
                element={
                  can(identity, "manage") ? (
                    <Single>
                      <Manage />
                    </Single>
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="/activity"
                element={
                  <Single>
                    <Activity />
                  </Single>
                }
              />
              <Route
                path="/me"
                element={
                  <Single>
                    <Me />
                  </Single>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <Tabs />
          </div>
          {/* Messages inside the team: a button at the bottom right, or Ctrl+M. */}
          <CommsDock />
          </SessionGuard>
          </ClinicGate>
          </StaffSessionGate>
          <NeedsAttention />
        </>
      )}

      {identity ? (
        <WarmQueue
          owner={identity}
          onReady={() => setWarm(true)}
        />
      ) : null}
      <Splash ready={ready} status={status} />
      {switching ? <SwitchingWindow to={switching} /> : null}
    </div>
  );
}

/** Over everything while one seat signs out and the next signs in. */
function SwitchingWindow({ to }: { to: string }) {
  return (
    <div role="status" aria-live="polite" className="absolute inset-0 z-50 grid place-items-center bg-[#232326]/40 p-6">
      <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-[1.5rem] border-[3px] border-[#232326] bg-[var(--brand-soft)] px-6 py-7 text-center shadow-[6px_6px_0_#232326]">
        <Loader2 className="size-8 animate-spin" aria-hidden />
        <p className="text-lg leading-tight font-bold">Switching to {to}</p>
        <p className="text-sm">Signing in. This takes a moment.</p>
      </div>
    </div>
  );
}

/** The sign-in card, centred on a coral page on a wide screen. */
function SignInPage() {
  return (
    <div className="grid h-full w-full place-items-center bg-[#ff7f5a] sm:p-6">
      <div className="bg-background flex h-full w-full max-w-md flex-col overflow-hidden sm:h-[min(46rem,100%)] sm:rounded-[2rem] sm:border-[3px] sm:border-[#232326] sm:shadow-[8px_8px_0_#232326]">
        <SignIn />
      </div>
    </div>
  );
}

/**
 * Reads this account's own queue once up front, so the first screen opens
 * with data in it: a doctor's patients or the desk's waiting list.
 */
function WarmQueue({
  owner,
  onReady,
}: {
  owner: { uid: string; accountType: "staff" | "doctor" };
  onReady: () => void;
}) {
  const isDoctor = owner.accountType === "doctor";
  const queue = useQueue(
    isDoctor ? ["intake_complete", "in_consultation"] : ["registered"],
    isDoctor ? { doctorUid: owner.uid } : undefined,
  );
  // Kept on this computer, so the formulary and the safety check work with no connection.
  useFormulary();
  useTeam();
  useRoutes();
  useQueue(["intake_complete", "in_consultation"]);
  useSafetyData();
  useEffect(() => {
    if (!queue.loading) onReady();
  }, [queue.loading, onReady]);
  return null;
}
