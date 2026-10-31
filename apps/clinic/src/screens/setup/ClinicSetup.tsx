import { errorMessage, getAuthClient, setupClinic } from "@parcha/client";
import { ABILITIES, PIN_RE, TEMPLATES, type TemplateId } from "@parcha/core";
import { cn } from "@parcha/ui";
import { Building2, Check, Hospital, LocateFixed, Loader2, Stethoscope } from "lucide-react";
import { useState } from "react";

import { useIdentity } from "../../auth";
import { Btn, FIELD, Label } from "../../bits";
import { SetupFrame } from "./SetupFrame";

const ICONS: Record<TemplateId, typeof Stethoscope> = { solo: Stethoscope, clinic: Building2, hospital: Hospital };
const short = (id: string) => ABILITIES.find((a) => a.id === id)!.label;

/**
 * The first run of a clinic, for whoever can manage it: how it works (a
 * template of seats), what it is called and where, and the Manage PIN. Four
 * short steps; nothing is saved until the last one.
 */
export function ClinicSetup() {
  const { identity } = useIdentity();
  const [step, setStep] = useState(1);
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = TEMPLATES.find((t) => t.id === template);

  async function locate() {
    setLocating(true);
    const desktop = (window as { parchaDesktop?: { getLocation?: () => Promise<{ lat: number; lng: number } | null> } }).parchaDesktop?.getLocation;
    const v = desktop
      ? await desktop().catch(() => null)
      : await new Promise<{ lat: number; lng: number } | null>((ok) =>
          navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => ok(null), { timeout: 15000 }),
        );
    setWhere(v);
    setLocating(false);
  }

  async function finish() {
    setError(null);
    if (!PIN_RE.test(pin)) return setError("The PIN is four to six digits.");
    if (pin !== pin2) return setError("The two PINs are not the same.");
    setBusy(true);
    try {
      await setupClinic({ template: template!, name: name.trim(), area, address, phone, pin, ...(where ?? {}) });
      // The seat is a claim: take the new token so the app opens in it.
      await getAuthClient().currentUser?.getIdToken(true);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <SetupFrame step={step} steps={4}>
      {step === 1 ? (
        <>
          <h1 className="text-2xl leading-tight font-bold">Set up your clinic</h1>
          <p className="mt-1 text-base">
            Welcome{identity?.displayName ? `, ${identity.displayName}` : ""}. First, how does your clinic work? You can change all of this later on the Manage page.
          </p>
          <ul className="mt-5 space-y-3">
            {TEMPLATES.map((t) => {
              const Icon = ICONS[t.id];
              const on = template === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTemplate(t.id)}
                    className={cn(
                      "flex w-full gap-3 rounded-2xl border-[3px] border-[#232326] p-4 text-left shadow-[0_3px_0_#232326] transition active:translate-y-0.5",
                      on ? "bg-[var(--brand-soft)]" : "bg-card",
                    )}
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-white">
                      <Icon className="size-6" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-lg font-bold">
                        {t.name} {on ? <Check className="size-5" aria-hidden /> : null}
                      </span>
                      <span className="block text-sm leading-snug">{t.description}</span>
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {t.seats.map((s) => (
                          <span key={s.id} title={s.abilities.map(short).join(", ")} className="rounded-full border-2 border-[#232326] bg-white px-2 py-0.5 text-xs font-bold">
                            {s.name}
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Btn kind="primary" className="mt-5 w-full" disabled={!template} onClick={() => setStep(2)}>
            Next
          </Btn>
        </>
      ) : step === 2 ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) setStep(3);
          }}
        >
          <h1 className="text-2xl leading-tight font-bold">Your clinic</h1>
          <p className="mt-1 text-base">This is what patients see when they choose where to go.</p>
          <div className="mt-5 space-y-4">
            <label className="block">
              <Label>Name</Label>
              <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sharma Clinic" autoFocus required minLength={2} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <Label>Area</Label>
                <input className={FIELD} value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Lajpat Nagar" />
              </label>
              <label className="block">
                <Label>Phone</Label>
                <input className={FIELD} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Clinic phone" />
              </label>
            </div>
            <label className="block">
              <Label>Address</Label>
              <input className={FIELD} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, PIN code" />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Btn onClick={() => void locate()} disabled={locating}>
                {locating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LocateFixed className="size-4" aria-hidden />}
                Use this computer's location
              </Btn>
              <span className="text-sm">{where ? "Location saved: the map and the activity log use it." : "Optional: puts the clinic on the patients' map."}</span>
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <Btn onClick={() => setStep(1)}>Back</Btn>
            <Btn type="submit" kind="primary" className="flex-1" disabled={name.trim().length < 2}>
              Next
            </Btn>
          </div>
        </form>
      ) : step === 3 ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!PIN_RE.test(pin)) return setError("The PIN is four to six digits.");
            if (pin !== pin2) return setError("The two PINs are not the same.");
            setStep(4);
          }}
        >
          <h1 className="text-2xl leading-tight font-bold">A PIN for the Manage page</h1>
          <p className="mt-1 text-base">
            Seats, the team and the clinic's settings open only with this PIN, on top of your own sign-in. Five wrong tries lock it for 15 minutes.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <Label>PIN (4 to 6 digits)</Label>
              <input className={cn(FIELD, "text-center text-2xl tracking-[0.4em]")} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" autoComplete="new-password" autoFocus />
            </label>
            <label className="block">
              <Label>The same PIN again</Label>
              <input className={cn(FIELD, "text-center text-2xl tracking-[0.4em]")} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" autoComplete="new-password" />
            </label>
          </div>
          {error ? (
            <p role="alert" className="text-destructive mt-3 text-base">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex gap-3">
            <Btn onClick={() => setStep(2)}>Back</Btn>
            <Btn type="submit" kind="primary" className="flex-1">
              Next
            </Btn>
          </div>
        </form>
      ) : (
        <>
          <h1 className="text-2xl leading-tight font-bold">Ready to open {name.trim()}</h1>
          <ul className="mt-4 space-y-2 text-base">
            <li>
              <b>How it works:</b> {chosen?.name.toLowerCase()}.
            </li>
            <li>
              <b>Seats:</b> {chosen?.seats.map((s) => s.name).join(", ")}.
            </li>
            <li>
              <b>Your seat:</b> {chosen?.seats.find((s) => s.id === chosen.ownerSeat)?.name}, which can {chosen?.seats.find((s) => s.id === chosen.ownerSeat)?.abilities.map((a) => short(a).toLowerCase()).join(", ")}.
            </li>
            <li>
              <b>Next:</b> add your team on the Manage page.
            </li>
          </ul>
          {error ? (
            <p role="alert" className="text-destructive mt-3 text-base">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex gap-3">
            <Btn onClick={() => setStep(3)} disabled={busy}>
              Back
            </Btn>
            <Btn kind="primary" className="flex-1" onClick={() => void finish()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
              Set up the clinic
            </Btn>
          </div>
        </>
      )}
    </SetupFrame>
  );
}
