import { errorMessage, saveMyProfile } from "@parcha/client";
import type { Account } from "@parcha/core";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { can, useIdentity } from "../../auth";
import { Btn, FIELD, Label } from "../../bits";
import { SetupFrame } from "./SetupFrame";

/**
 * A person's first sign-in: who they are, as patients and colleagues will see
 * it. For a doctor the qualification and registration number go on every
 * prescription, so the registration number is asked for, not optional.
 */
export function Profile({ account }: { account: Account | null }) {
  const { identity } = useIdentity();
  const doctor = can(identity, "consult");
  const [displayName, setDisplayName] = useState(account?.displayName ?? identity?.displayName ?? "");
  const [qualification, setQualification] = useState(account?.qualification ?? "");
  const [registrationNo, setRegistrationNo] = useState(account?.registrationNo ?? "");
  const [department, setDepartment] = useState(account?.department ?? "");
  const [phone, setPhone] = useState(account?.phone ?? "");
  const [consultingHours, setConsultingHours] = useState(account?.consultingHours ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await saveMyProfile({ displayName: displayName.trim(), qualification, registrationNo, department, phone, consultingHours });
      // The account now says the profile is done, and the app opens.
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <SetupFrame>
      <form onSubmit={(e) => void save(e)}>
        <h1 className="text-2xl leading-tight font-bold">{doctor ? "Welcome, doctor" : "Welcome"}</h1>
        <p className="mt-1 text-base">
          {identity?.seatName ? `You are in the seat ${identity.seatName}. ` : ""}
          {doctor
            ? "Your name, qualification and registration number are printed on every prescription you sign."
            : "This is how the rest of the team sees you."}
        </p>
        <div className="mt-5 space-y-4">
          <label className="block">
            <Label>Name as it should be shown</Label>
            <input className={FIELD} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={doctor ? "e.g. Dr. R. Iyer" : "e.g. Grace"} required minLength={2} autoFocus />
          </label>
          {doctor ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <Label>Qualification</Label>
                  <input className={FIELD} value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="e.g. MBBS, MD (Paediatrics)" />
                </label>
                <label className="block">
                  <Label>Registration number</Label>
                  <input className={FIELD} value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} placeholder="e.g. DMC/R/07781" required />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <Label>Department</Label>
                  <input className={FIELD} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. General medicine" />
                </label>
                <label className="block">
                  <Label>Consulting hours</Label>
                  <input className={FIELD} value={consultingHours} onChange={(e) => setConsultingHours(e.target.value)} placeholder="e.g. Mon to Sat, 10 am to 2 pm" />
                </label>
              </div>
            </>
          ) : null}
          <label className="block">
            <Label>Phone (for the team, optional)</Label>
            <input className={FIELD} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </label>
        </div>
        {error ? (
          <p role="alert" className="text-destructive mt-3 text-base">
            {error}
          </p>
        ) : null}
        <Btn type="submit" kind="primary" className="mt-6 w-full" disabled={busy || displayName.trim().length < 2 || (doctor && !registrationNo.trim())}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          Save and continue
        </Btn>
      </form>
    </SetupFrame>
  );
}
