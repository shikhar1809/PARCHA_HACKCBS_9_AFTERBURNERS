import { AccessNeedsPicker } from "./access";
import {
  errorMessage,
  registerPatient,
  startVisit,
  usePatientsByPhone,
} from "@parcha/client";
import type { AccessNeed, Patient, Sex } from "@parcha/core";
import { ActionBar, AppBar, cn } from "@parcha/ui";
import { Loader2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { mayAct, useIdentity } from "../auth";
import { Btn, Card, FIELD, Label } from "../bits";

const SEXES: { value: Sex; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
];

/**
 * Registering somebody the clinic has not seen.
 *
 * Reached from the desk when a phone number matches nobody, or to add
 * another person to a number that already has people on it. A shared family
 * handset is the normal case here, not an error, so the people already on the
 * number are shown rather than treated as a conflict. What is guarded is the
 * same person being registered twice, which would split their history in two.
 *
 * It registers and starts the visit in one go, because nobody registers a
 * patient at a clinic desk without meaning to see them today.
 */
export function NewPatient() {
  const navigate = useNavigate();
  const { identity } = useIdentity();
  const [params] = useSearchParams();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState(
    (params.get("phone") ?? "").replace(/\D/g, "").slice(-10),
  );
  const [sex, setSex] = useState<Sex | null>(null);
  const [age, setAge] = useState("");
  const [area, setArea] = useState("");
  const [needs, setNeeds] = useState<AccessNeed[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once the patient exists, so a failed visit start can be retried
   *  without registering a second time. */
  const [patientId, setPatientId] = useState<string | null>(null);

  const phoneOk = /^\d{10}$/.test(phone);
  const ageNum = age.trim() === "" ? null : Number(age);
  const ageOk = ageNum === null || (Number.isInteger(ageNum) && ageNum >= 0 && ageNum <= 120);
  const nameOk = name.trim().length >= 2;

  const household = usePatientsByPhone(phoneOk ? phone : null);
  const twin: Patient | undefined = household.data.find(
    (p) => p.fullName.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  async function begin(id: string, p?: Patient) {
    const { visitId } = await startVisit(
      id,
      p ?? { fullName: name.trim(), phone, statedAgeYears: ageNum, sex, villageOrArea: area.trim() || null },
    );
    navigate(`/intake/${visitId}`, { replace: true });
  }

  async function submit() {
    setAttempted(true);
    setError(null);
    if (!nameOk || !phoneOk || !ageOk) return;
    setBusy(true);
    try {
      const id =
        patientId ??
        (
          await registerPatient({
            fullName: name.trim(),
            phone,
            sex,
            statedAgeYears: ageNum,
            villageOrArea: area.trim() || null,
            accessNeeds: needs,
          })
        ).patientId;
      setPatientId(id);
      await begin(id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function startForTwin(id: string) {
    setError(null);
    setBusy(true);
    try {
      await begin(id, twin);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppBar back="/desk" title="New patient" subtitle="Register and start the visit" />

      {!mayAct(identity, "compounder") ? (
        <div className="p-4">
          <Card>
            <p className="text-lg">Registration is done at the front desk.</p>
            <p className="text-muted-foreground mt-1 text-base">
              This account is a {identity?.accountType} account and cannot
              register patients.
            </p>
          </Card>
        </div>
      ) : (
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div>
              <Label>Full name</Label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                autoComplete="off"
                placeholder="As they say it"
                aria-invalid={attempted && !nameOk}
                className={cn(
                  FIELD,
                  attempted && !nameOk && "!bg-[oklch(0.94_0.05_25)]",
                )}
              />
              {attempted && !nameOk ? (
                <p role="alert" className="mt-1 text-sm">
                  Write their name.
                </p>
              ) : null}
            </div>

            <div>
              <Label>Mobile number</Label>
              <div className="flex items-center gap-2">
                <span className="text-lg">+91</span>
                <input
                  value={phone}
                  onChange={(e) =>
                    setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  inputMode="numeric"
                  placeholder="10 digits"
                  aria-invalid={attempted && !phoneOk}
                  className={cn(
                    FIELD,
                    "tabular-nums",
                    attempted && !phoneOk && "!bg-[oklch(0.94_0.05_25)]",
                  )}
                />
              </div>
              {attempted && !phoneOk ? (
                <p role="alert" className="mt-1 text-sm">
                  A mobile number is ten digits.
                </p>
              ) : (
                <p className="text-muted-foreground mt-1 text-sm">
                  Families often share one phone. That is fine.
                </p>
              )}
            </div>

            {phoneOk && household.data.length > 0 ? (
              <Card tone={twin ? "warn" : "plain"}>
                <p className="mb-1 text-sm tracking-wide uppercase">
                  Already on this number
                </p>
                <ul className="space-y-0.5 text-base">
                  {household.data.map((p) => (
                    <li key={p.id}>
                      {p.fullName}
                      <span className="text-muted-foreground">
                        {[
                          p.statedAgeYears != null ? ` · ${p.statedAgeYears}` : null,
                          p.sex ? ` ${p.sex[0].toUpperCase()}` : null,
                        ].join("")}
                      </span>
                    </li>
                  ))}
                </ul>
                {twin ? (
                  <div className="mt-3">
                    <p className="text-base">
                      {twin.fullName} is already registered on this number.
                      Registering again would split their history in two.
                    </p>
                    <Btn
                      kind="primary"
                      className="mt-2"
                      disabled={busy}
                      onClick={() => void startForTwin(twin.id)}
                    >
                      Start a visit for {twin.fullName}
                    </Btn>
                  </div>
                ) : null}
              </Card>
            ) : null}

            <div className="grid gap-5 @lg:grid-cols-2">
              <div>
                <Label>Sex</Label>
                <div className="flex flex-wrap gap-2" role="group">
                  {SEXES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      aria-pressed={sex === s.value}
                      onClick={() => setSex(sex === s.value ? null : s.value)}
                      className={cn(
                        "rounded-full border-[3px] border-[#232326] px-4 py-1.5 text-base",
                        sex === s.value
                          ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]"
                          : "bg-card hover:bg-[var(--hover-soft)]",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label>Age (years)</Label>
                <input
                  value={age}
                  onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  inputMode="numeric"
                  placeholder="As they say it"
                  aria-invalid={attempted && !ageOk}
                  className={cn(
                    FIELD,
                    "w-40 tabular-nums",
                    attempted && !ageOk && "!bg-[oklch(0.94_0.05_25)]",
                  )}
                />
                {attempted && !ageOk ? (
                  <p role="alert" className="mt-1 text-sm">
                    Age should be between 0 and 120.
                  </p>
                ) : (
                  <p className="text-muted-foreground mt-1 text-sm">
                    Most patients have no birth date. A stated age is fine.
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label>Village or area</Label>
              <input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                autoComplete="off"
                placeholder="Optional"
                className={FIELD}
              />
            </div>

            <div>
              <Label>Seeing, hearing, language</Label>
              <AccessNeedsPicker value={needs} onChange={setNeeds} />
            </div>
          </div>

          <ActionBar>
            {error ? (
              <p role="alert" className="text-destructive mb-2 text-base">
                {error}
                {patientId
                  ? " The patient is registered. Try again to start the visit."
                  : ""}
              </p>
            ) : null}
            <Btn
              kind="primary"
              type="submit"
              disabled={busy || !!twin}
              className="h-14 w-full text-lg"
            >
              {busy ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <UserPlus className="size-5" />
              )}
              {patientId ? "Start the visit" : "Register and start the visit"}
            </Btn>
          </ActionBar>
        </form>
      )}
    </div>
  );
}
