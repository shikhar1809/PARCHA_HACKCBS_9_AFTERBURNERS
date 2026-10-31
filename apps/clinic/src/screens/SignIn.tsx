import { call, errorMessage, takeSessionEndedNotice } from "@parcha/client";
import { cn, Screen, Wordmark } from "@parcha/ui";
import {
  Building,
  Building2,
  Loader2,
  SlidersHorizontal,
  Store,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { demoMode, demoSignIn, signInWithEmail } from "../auth";
import { Btn, FIELD } from "../bits";

/**
 * The first screen: choose the shape of the place.
 *
 * Parcha is one product for a hospital with every counter, a small hospital
 * with a desk and doctors, and a doctor practising alone. The first three
 * choices open a working example of each, already in use, and list the
 * services it has; Custom makes a new,
 * empty clinic and walks through setting it up (its size, its seats, its
 * PIN). Another seat in the same set-up is a tap away in the sidebar.
 */
type Preset = { id: string; title: string; scale: string; services: string[]; email: string; icon: ReactNode };

const PRESETS: Preset[] = [
  {
    id: "big",
    title: "Rohini City Hospital",
    scale: "Large hospital · every service",
    services: ["Reception", "Triage", "Doctors (7 departments)", "Pharmacy", "Billing", "Ward clerk", "Management", "Stats"],
    email: "staff@parcha.test",
    icon: <Building2 className="size-5" />,
  },
  {
    id: "medium",
    title: "Sector 9 Care Hospital",
    scale: "Medium hospital · a few services",
    services: ["Front desk", "Doctors", "Management", "Stats"],
    email: "dwarka.desk@parcha.test",
    icon: <Building className="size-5" />,
  },
  {
    id: "personal",
    title: "Dr. Verma's Clinic",
    scale: "One doctor",
    services: ["The doctor does everything: desk, vitals, prescribing, managing"],
    email: "noida.doctor@parcha.test",
    icon: <Store className="size-5" />,
  },
];

export function SignIn() {
  const [busy, setBusy] = useState<string | null>(null);
  // Read once: if a session ended by itself, say so, so it never feels random.
  const [error, setError] = useState<string | null>(() => takeSessionEndedNotice());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function run(key: string, fn: () => Promise<unknown>, failure: string) {
    setError(null);
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      setError(`${failure} ${errorMessage(e)}`.trim());
      setBusy(null);
    }
  }

  const open = (address: string) => run(address, () => demoSignIn(address), "Could not open that.");
  const custom = () =>
    run(
      "custom",
      async () => {
        const made = await call<object, { email: string; password: string }>("startNewClinic", {});
        await signInWithEmail(made.email, made.password);
      },
      "Could not start a new clinic.",
    );

  return (
    <Screen className="flex flex-col gap-6 p-6">
      <div className="pt-4">
        <h1 className="text-6xl">
          <Wordmark />
        </h1>
        <p className="text-muted-foreground mt-5 text-base leading-relaxed">One visit, one record: from the front desk to a signed prescription.</p>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {demoMode ? (
        <>
          <div className="space-y-2">
            <p className="text-sm font-bold tracking-wide uppercase">Choose your set-up</p>
            {PRESETS.map((p) => (
              <Choice key={p.id} icon={p.icon} title={p.title} scale={p.scale} services={p.services} busy={busy === p.email} disabled={busy !== null} onClick={() => void open(p.email)} />
            ))}
            <Choice
              icon={<SlidersHorizontal className="size-5" />}
              title="Custom"
              scale="Your own"
              services={["Pick the size", "Name it", "Set who does what", "Set the PIN"]}
              busy={busy === "custom"}
              disabled={busy !== null}
              onClick={() => void custom()}
              quiet
            />
          </div>

        </>
      ) : null}

      {/* A real clinic's own sign-in. The example set-ups switch seats from the sidebar. */}
      {!demoMode ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim() && password) void run(email.trim(), () => signInWithEmail(email.trim(), password), "That email and password did not match.");
          }}
        >
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" placeholder="Email" aria-label="Email" className={FIELD} />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            className={FIELD}
          />
          <Btn kind="primary" type="submit" disabled={busy !== null || !email.trim() || !password} className="w-full">
            {busy === email.trim() ? <Loader2 className="size-5 animate-spin" /> : null}
            Sign in
          </Btn>
        </form>
      ) : null}
    </Screen>
  );
}

function Choice({
  icon,
  title,
  scale,
  services,
  busy,
  disabled,
  onClick,
  quiet,
}: {
  icon: ReactNode;
  title: string;
  scale: string;
  services: string[];
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border-2 border-[#232326] px-3 py-2 text-left shadow-[2px_2px_0_#232326] transition active:translate-y-0.5 disabled:opacity-60",
        quiet ? "bg-card" : "bg-[var(--brand-soft)]",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border-2 border-[#232326] bg-white">
        {busy ? <Loader2 className="size-5 animate-spin" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="text-base leading-tight font-bold">{title}</span>
          <span className="text-xs">{scale}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 text-xs leading-snug opacity-80">{services.join(" · ")}</span>
      </span>
    </button>
  );
}
