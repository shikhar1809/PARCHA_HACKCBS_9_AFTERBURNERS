import { AccessCard } from "../access";
import { errorMessage, saveIntake } from "@parcha/client";
import {
  SUGAR_TYPES,
  VITAL_LIMITS,
  missingRequiredVitals,
  validateVitals,
  vitalAlarms,
  type Allergy,
  type SugarReading,
  type VitalKey,
  type Visit,
} from "@parcha/core";
import { ActionBar, cn } from "@parcha/ui";
import { AlertTriangle, ChevronDown, Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Btn, Card, FIELD, Label } from "../../bits";
import { DoctorPicker, type ChosenDoctor } from "./DoctorPicker";

/** Everything is held as text while typing, and read as numbers on send. */
type Text = Record<VitalKey | "complaint" | "durationDays", string>;

const EMPTY: Text = {
  complaint: "",
  durationDays: "",
  systolicMmhg: "",
  diastolicMmhg: "",
  pulseBpm: "",
  temperatureC: "",
  respiratoryRate: "",
  spo2Pct: "",
  weightKg: "",
  heightCm: "",
  bloodSugarMgdl: "",
};

function num(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * The intake form: the complaint in the patient's words, and whatever
 * readings the desk could take.
 *
 * Two readings are taken every time: blood pressure and weight. The rest
 * (sugar, temperature, pulse, oxygen, breathing, height) sit under "More
 * readings", taken when the patient needs them. A reading that is entered has
 * to be plausible: a pulse of 720 is a keystroke, and it is refused here
 * rather than copied onto the doctor's queue as an emergency. A sugar needs a
 * type, for the same reason the database always insisted on one.
 */
export function IntakeForm({
  visit,
  allergies,
}: {
  visit: Visit;
  allergies: Allergy[];
}) {
  // Somebody who asked before coming has already said what is wrong, and to
  // which doctor: start from that, and let the desk add to it.
  const [t, setT] = useState<Text>({ ...EMPTY, complaint: visit.complaint ?? "" });
  // The complaint can also arrive while this screen is open: the patient is at
  // the waiting-room kiosk saying where it hurts. It is taken only while the
  // box still holds what we last put there, so a desk that is mid-sentence is
  // never written over.
  const seeded = useRef(visit.complaint ?? "");
  useEffect(() => {
    const arrived = visit.complaint ?? "";
    if (arrived === seeded.current) return;
    setT((now) => (now.complaint === seeded.current ? { ...now, complaint: arrived } : now));
    seeded.current = arrived;
  }, [visit.complaint]);
  const [doctor, setDoctor] = useState<ChosenDoctor | null>(null);
  const [sugarType, setSugarType] = useState<SugarReading | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof Text) => (e: { target: { value: string } }) =>
    setT((s) => ({ ...s, [key]: e.target.value }));

  const vitals = {
    systolicMmhg: num(t.systolicMmhg),
    diastolicMmhg: num(t.diastolicMmhg),
    pulseBpm: num(t.pulseBpm),
    temperatureC: num(t.temperatureC),
    respiratoryRate: num(t.respiratoryRate),
    spo2Pct: num(t.spo2Pct),
    weightKg: num(t.weightKg),
    heightCm: num(t.heightCm),
    bloodSugarMgdl: num(t.bloodSugarMgdl),
  };
  const problems = { ...missingRequiredVitals(vitals), ...validateVitals({ ...vitals, bloodSugarType: sugarType }) };
  // The optional readings open by themselves if any of them is already filled or has a problem.
  const [more, setMore] = useState(false);
  const OPTIONAL = ["pulseBpm", "temperatureC", "spo2Pct", "respiratoryRate", "heightCm", "bloodSugarMgdl"] as const;
  const moreOpen = more || OPTIONAL.some((k) => t[k].trim() !== "" || (attempted && problems[k]));
  const alarms = vitalAlarms(vitals);
  const complaintMissing = t.complaint.trim() === "";

  /** Typos show as you type; the "needs the other half" kind wait for send. */
  const problem = (key: string, text?: string) =>
    problems[key] && (attempted || (text ?? "").trim() !== "" && key !== "bloodSugarType")
      ? problems[key]
      : undefined;

  const flagged = [
    alarms.bp ? "blood pressure" : null,
    alarms.temperatureC ? "temperature" : null,
    alarms.spo2Pct ? "oxygen" : null,
    alarms.bloodSugarMgdl ? "blood sugar" : null,
  ].filter(Boolean);

  async function send() {
    setAttempted(true);
    setError(null);
    if (complaintMissing || Object.keys(problems).length > 0 || doctor === null) {
      return;
    }
    setBusy(true);
    try {
      await saveIntake({
        visitId: visit.id,
        doctorUid: doctor.uid,
        complaint: t.complaint.trim(),
        durationDays: num(t.durationDays),
        ...vitals,
        bloodSugarType: vitals.bloodSugarMgdl != null ? sugarType : null,
      }, { doctorName: doctor.name });
      // The stage moves to "intake complete" and this screen follows it.
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="@container min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <Allergies allergies={allergies} />
        <AccessCard patientId={visit.patientId} needs={visit.accessNeeds} />

        <div>
          <Label>Why they came</Label>
          <textarea
            value={t.complaint}
            onChange={set("complaint")}
            rows={3}
            placeholder="In the patient's own words"
            aria-invalid={attempted && complaintMissing}
            className={cn(
              FIELD,
              "resize-y leading-snug",
              attempted && complaintMissing && "!bg-[oklch(0.94_0.05_25)]",
            )}
          />
          {attempted && complaintMissing ? (
            <p role="alert" className="mt-1 text-sm">
              Write what they came in with. The doctor reads this first.
            </p>
          ) : null}
          <label className="mt-3 block w-40 text-sm">
            For how many days?
            <input
              value={t.durationDays}
              onChange={set("durationDays")}
              inputMode="numeric"
              placeholder="optional"
              className={`${FIELD} mt-1`}
            />
          </label>
        </div>

        <div>
          <Label>Vitals</Label>

          {flagged.length > 0 ? (
            <Card tone="warn" className="mb-3">
              <p className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-5 shrink-0" aria-hidden />
                Worth telling the doctor: {flagged.join(", ")}. It will show in
                red on their queue.
              </p>
            </Card>
          ) : null}

          {/* Taken every time. */}
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3">
            <div className="col-span-2 @xl:col-span-2">
              <p className="mb-1 text-sm font-bold">Blood pressure (required)</p>
              <div className="flex items-center gap-2">
                <Num
                  value={t.systolicMmhg}
                  onChange={set("systolicMmhg")}
                  placeholder="120"
                  label="Upper number"
                  bad={!!problem("systolicMmhg", t.systolicMmhg)}
                  alarm={alarms.bp}
                />
                <span aria-hidden>/</span>
                <Num
                  value={t.diastolicMmhg}
                  onChange={set("diastolicMmhg")}
                  placeholder="80"
                  label="Lower number"
                  bad={!!problem("diastolicMmhg", t.diastolicMmhg)}
                  alarm={alarms.bp}
                />
              </div>
              <Err>
                {problem("systolicMmhg", t.systolicMmhg) ??
                  problem("diastolicMmhg", t.diastolicMmhg)}
              </Err>
            </div>
            <Field
              k="weightKg"
              t={t}
              set={set}
              problem={problem}
              placeholder="62"
              decimal
              required
            />
          </div>

          {/* Taken when needed. */}
          <button
            type="button"
            onClick={() => setMore(!moreOpen)}
            aria-expanded={moreOpen}
            className="mt-4 flex items-center gap-2 text-base font-bold"
          >
            <ChevronDown className={cn("size-5 transition", moreOpen && "rotate-180")} aria-hidden />
            More readings: sugar, temperature, pulse, oxygen
          </button>
          {moreOpen ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 @xl:grid-cols-3">
                <Field
                  k="bloodSugarMgdl"
                  t={t}
                  set={set}
                  problem={problem}
                  placeholder="110"
                  alarm={alarms.bloodSugarMgdl}
                />
                <Field
                  k="temperatureC"
                  t={t}
                  set={set}
                  problem={problem}
                  placeholder="37.0"
                  alarm={alarms.temperatureC}
                  decimal
                />
                <Field
                  k="pulseBpm"
                  t={t}
                  set={set}
                  problem={problem}
                  placeholder="76"
                />
                <Field
                  k="spo2Pct"
                  t={t}
                  set={set}
                  problem={problem}
                  placeholder="98"
                  alarm={alarms.spo2Pct}
                />
                <Field
                  k="respiratoryRate"
                  t={t}
                  set={set}
                  problem={problem}
                  placeholder="18"
                />
                <Field
                  k="heightCm"
                  t={t}
                  set={set}
                  problem={problem}
                  placeholder="160"
                />
              </div>

              {t.bloodSugarMgdl.trim() !== "" ? (
                <div className="mt-3">
                  <p className="mb-1.5 text-sm">What kind of sugar reading?</p>
                  <div className="flex flex-wrap gap-2" role="group">
                    {SUGAR_TYPES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setSugarType(s.value)}
                        aria-pressed={sugarType === s.value}
                        className={cn(
                          "rounded-full border-[3px] border-[#232326] px-4 py-1.5 text-base",
                          sugarType === s.value
                            ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]"
                            : "bg-card hover:bg-[var(--hover-soft)]",
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <Err>{problem("bloodSugarType")}</Err>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <DoctorPicker
          value={doctor}
          onChange={setDoctor}
          invalid={attempted && doctor === null}
          preferUid={visit.assignedDoctorUid}
          preferNote={visit.source === "pre_visit" ? "Confirmed for this patient" : undefined}
        />
      </div>

      <ActionBar>
        {error ? (
          <p role="alert" className="text-destructive mb-2 text-base">
            {error}
          </p>
        ) : null}
        {attempted &&
        (complaintMissing || Object.keys(problems).length > 0 || doctor === null) ? (
          <p role="alert" className="mb-2 text-base">
            {doctor === null && !complaintMissing && Object.keys(problems).length === 0
              ? "Choose which doctor to send them to."
              : "Fix the highlighted fields, then send."}
          </p>
        ) : null}
        <Btn
          kind="primary"
          type="submit"
          disabled={busy}
          className="h-14 w-full text-lg"
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Send className="size-5" />
          )}
          Send {visit.patientName.split(" ")[0]} to {doctor?.name ?? "the doctor"}
        </Btn>
      </ActionBar>
    </form>
  );
}

/** One labelled reading with its unit. */
function Field({
  k,
  t,
  set,
  problem,
  placeholder,
  alarm,
  decimal,
  required,
}: {
  k: VitalKey;
  t: Text;
  set: (key: keyof Text) => (e: { target: { value: string } }) => void;
  problem: (key: string, text?: string) => string | undefined;
  placeholder: string;
  alarm?: boolean;
  decimal?: boolean;
  required?: boolean;
}) {
  const { label, unit } = VITAL_LIMITS[k];
  const msg = problem(k, t[k]);
  return (
    <div>
      <label className={cn("mb-1 block text-sm", required && "font-bold")}>
        {label} <span className="text-muted-foreground font-normal">({unit})</span>
        {required ? " (required)" : null}
      </label>
      <Num
        value={t[k]}
        onChange={set(k)}
        placeholder={placeholder}
        label={label}
        bad={!!msg}
        alarm={alarm}
        decimal={decimal}
      />
      <Err>{msg}</Err>
    </div>
  );
}

function Num({
  value,
  onChange,
  placeholder,
  label,
  bad,
  alarm,
  decimal,
}: {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  placeholder: string;
  label: string;
  bad?: boolean;
  alarm?: boolean;
  decimal?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) =>
        onChange({
          target: {
            value: e.target.value.replace(decimal ? /[^\d.]/g : /\D/g, ""),
          },
        })
      }
      inputMode={decimal ? "decimal" : "numeric"}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={bad || undefined}
      className={cn(
        FIELD,
        "tabular-nums",
        alarm && "!bg-[oklch(0.94_0.05_25)]",
        bad && "!bg-[oklch(0.94_0.05_25)]",
      )}
    />
  );
}

function Err({ children }: { children?: string }) {
  return children ? (
    <p role="alert" className="mt-1 text-sm">
      {children}
    </p>
  ) : null;
}

/**
 * The desk sees what is already on record, so a patient who mentions a new
 * allergy can be told to say so to the doctor. Recording one is the doctor's
 * act, not a field on this form.
 */
function Allergies({ allergies }: { allergies: Allergy[] }) {
  if (allergies.length === 0) {
    return (
      <Card>
        <p className="text-base">
          No allergies on record. Ask, and tell the doctor if there is one.
        </p>
      </Card>
    );
  }
  return (
    <Card tone="danger">
      <p className="mb-1 flex items-center gap-2 text-sm tracking-wide uppercase">
        <AlertTriangle className="size-5" aria-hidden />
        Allergies on record
      </p>
      <p className="text-lg leading-snug">
        {allergies.map((a) => a.label).join(", ")}
      </p>
      <p className="text-sm">Ask if there is anything new.</p>
    </Card>
  );
}
