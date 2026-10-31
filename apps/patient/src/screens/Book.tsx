import {
  errorMessage,
  requestVisit,
  usePatientHospitals,
  usePatientsByPhone,
  useVisitsForPhone,
} from "@parcha/client";
import { DEMO_PLACE, nextDays, type Patient, type Sex } from "@parcha/core";
import { Screen, cn } from "@parcha/ui";
import { Check, Loader2, MessageSquareText, Stethoscope, UserPlus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { HospitalPicker } from "../components/HospitalPicker";
import { usePeople } from "../components/people";
import { useHandset } from "../auth";
import { dayWordIn, useLang, useT } from "../i18n";
import { BigButton, Header, useGoBack } from "../kit";

type Mode = "new_problem" | "existing_doctor";
type Step = "who" | "what" | "where" | "when" | "review";

/** Stands for "somebody not on this phone yet" in the answer to "who". */
const NEW_PERSON = "\u0000new";

const SEXES: { value: Sex; en: string; hi: string; hinglish: string }[] = [
  { value: "female", en: "Female", hi: "महिला", hinglish: "Mahila" },
  { value: "male", en: "Male", hi: "पुरुष", hinglish: "Purush" },
  { value: "other", en: "Other", hi: "अन्य", hinglish: "Anya" },
];

/**
 * Asking for a visit, one question per screen.
 *
 * Who it is for, what is wrong (or which doctor to see again), which hospital
 * nearby, which day, then a last look before asking. Every answer is a tap on a
 * big card; the typing is describing a new problem, and naming somebody the
 * hospitals have not seen. Seeing a doctor again also picks their hospital, so
 * that question is skipped.
 *
 * "Who" always includes somebody new. A family's first visit starts on a phone
 * with nobody on it, and a child or a grandmother is added the same way: the
 * hospital opens their record when the request reaches it, so nobody has to be
 * sent to a front desk first to be allowed to ask.
 *
 * It is a request, not a booking: the hospital's desk has fifteen minutes to
 * find a doctor, and if it does not answer the request moves to the next
 * nearest one on its own. Once one accepts, the visit screen shows where to go.
 */
export function Book() {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const { handset } = useHandset();
  const household = usePatientsByPhone(handset?.phone ?? null);
  const visits = useVisitsForPhone(handset?.phone ?? null);
  const hospitals = usePatientHospitals();

  const [step, setStep] = useState<Step>("who");
  const [forName, setForName] = useState<string | null>(null);
  // Somebody being named now: the name is what a hospital matches on, so it is
  // asked for in full; age and sex are what a doctor reads first.
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState("");
  const [newSex, setNewSex] = useState<Sex | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [requirement, setRequirement] = useState("");
  const [doctorUid, setDoctorUid] = useState<string | null>(null);
  const [day, setDay] = useState(nextDays(1)[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt, reused if the same tap is retried, so a flaky network
  // can never turn one request into two.
  const attemptKey = useRef(crypto.randomUUID());

  // The household: a person may have a record at several hospitals, but they are
  // one person to the patient, so one card each.
  const people = useMemo(() => {
    const byName = new Map<string, Patient>();
    for (const p of household.data) if (!byName.has(p.fullName)) byName.set(p.fullName, p);
    return [...byName.values()];
  }, [household.data]);

  // The person already chosen on this phone ("who is using Parcha?") is who it
  // is for, until the family picks somebody else on the first question.
  const { active } = usePeople();
  const chosen = people.find((p) => p.fullName === active);
  const forWhom =
    forName ?? chosen?.fullName ?? (people.length === 1 ? people[0].fullName : null);
  const addingNew = forWhom === NEW_PERSON;
  const patient: Patient | undefined = addingNew
    ? undefined
    : people.find((p) => p.fullName === forWhom);

  const newNameOk = newName.trim().length >= 2;
  const newAgeNum = newAge.trim() === "" ? null : Number(newAge);
  const newAgeOk =
    newAgeNum === null || (Number.isInteger(newAgeNum) && newAgeNum >= 0 && newAgeNum <= 120);
  /** What the questions after "who" call this person. */
  const forLabel = addingNew ? newName.trim() : (patient?.fullName ?? "");

  const mine = useMemo(
    () => visits.data.filter((v) => v.patientName === patient?.fullName),
    [visits.data, patient?.fullName],
  );
  const open = mine.find((v) => !["prescribed", "cancelled"].includes(v.stage));

  // Doctors this person has seen, and where: asking for one again also picks the hospital.
  const seen = useMemo(() => {
    const out = new Map<string, { uid: string; name: string; hospitalId: string }>();
    for (const v of mine) {
      if (v.assignedDoctorUid && v.assignedDoctorName && v.stage === "prescribed") {
        out.set(v.assignedDoctorUid, { uid: v.assignedDoctorUid, name: v.assignedDoctorName, hospitalId: v.hospitalId });
      }
    }
    return [...out.values()];
  }, [mine]);

  const chosenHospital = hospitals.data.find((h) => h.id === hospitalId) ?? null;
  // Asked every time: even on a phone with one person, this is where somebody
  // new is added, and it is the only question a new family can start from.
  const askWho = true;
  const steps: Step[] = [
    ...(askWho ? (["who"] as Step[]) : []),
    "what",
    ...(mode === "existing_doctor" ? [] : (["where"] as Step[])),
    "when",
    "review",
  ];
  const current: Step = !askWho && step === "who" ? "what" : step;
  const at = Math.max(0, steps.indexOf(current));
  const next = () => setStep(steps[Math.min(steps.length - 1, at + 1)]);
  const leave = useGoBack("/");
  const back = () => (at === 0 ? leave() : setStep(steps[at - 1]));

  const canGo: Record<Step, boolean> = {
    who: addingNew ? newNameOk && newAgeOk : patient !== undefined,
    what: mode === "new_problem" ? requirement.trim().length >= 3 : mode === "existing_doctor" && doctorUid !== null,
    where: !!chosenHospital?.accepting,
    when: true,
    review: true,
  };

  // A second tap while the first is still sending does nothing.
  const sending = useRef(false);
  async function submit() {
    if ((!patient && !addingNew) || !mode || !hospitalId || sending.current) return;
    sending.current = true;
    setError(null);
    setBusy(true);
    try {
      const { visitId } = await requestVisit({
        patientId: patient?.id,
        newPerson: addingNew
          ? { fullName: newName.trim(), sex: newSex, statedAgeYears: newAgeNum }
          : undefined,
        hospitalId,
        from: { lat: DEMO_PLACE.lat, lng: DEMO_PLACE.lng },
        mode,
        requirement: requirement.trim() || undefined,
        doctorUid: mode === "existing_doctor" ? (doctorUid ?? undefined) : undefined,
        preferredDate: day,
        requestKey: attemptKey.current,
      });
      attemptKey.current = crypto.randomUUID();
      navigate(`/visit/${visitId}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      sending.current = false;
    }
  }

  const doctorName = seen.find((d) => d.uid === doctorUid)?.name;
  // The questions show (with Next pinned below them) once there is someone to ask for.
  const asking = !household.loading && !(patient && open && current !== "who");

  return (
    <>
      <Header
        back="/"
        title={t("New visit", "नई विज़िट", "Nayi visit")}
        subtitle={t(`Step ${at + 1} of ${steps.length}`, `चरण ${at + 1} / ${steps.length}`, `Step ${at + 1} / ${steps.length}`)}
      />
      <Screen className="space-y-5 px-4 pb-6">
        <div className="flex gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <span key={s} className={cn("h-2 flex-1 rounded-full border-2 border-[#232326]", i <= at ? "bg-[var(--brand)]" : "bg-white")} />
          ))}
        </div>

        {household.loading ? (
          <p className="text-muted-foreground text-lg">{t("Loading…", "खुल रहा है…", "Khul raha hai…")}</p>
        ) : household.error && people.length === 0 ? (
          // A failed read is never "you are not registered": say what happened and offer a retry.
          <div role="alert" className="space-y-3 rounded-2xl border-2 border-dashed border-[var(--color-input)] p-5 text-lg leading-relaxed">
            <p>
              {t("We could not load your family's records just now.", "अभी आपके परिवार के काग़ज़ नहीं खुल पाए।", "Abhi aapke parivaar ke records nahi khul paaye.")} {household.error}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-12 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] px-5 font-bold shadow-[0_3px_0_#232326]"
            >
              {t("Try again", "फिर कोशिश करें", "Phir try karein")}
            </button>
          </div>
        ) : patient && open && current !== "who" ? (
          <div className="rounded-2xl border-2 border-[var(--brand-deep)] bg-[var(--morning-soft)] p-5">
            <p className="text-xl leading-tight font-bold">
              {t(
                `${patient.fullName} already has a visit in progress.`,
                `${patient.fullName} की एक विज़िट पहले से चल रही है।`,
                `${patient.fullName} ki ek visit pehle se chal rahi hai.`,
              )}
            </p>
            <Link to={`/visit/${open.id}`} className="hover-orange mt-3 inline-block rounded-xl border-2 border-[var(--brand-deep)] bg-card px-4 py-2.5 text-lg font-bold">
              {t("Open it", "उसे खोलें", "Use kholein")}
            </Link>
          </div>
        ) : (
          <>
            {current === "who" ? (
              <Step n={at + 1} title={t("Who is it for?", "किसके लिए?", "Kiske liye?")}>
                <div className="space-y-2.5" role="radiogroup">
                  {people.map((p) => (
                    <Choice
                      key={p.fullName}
                      on={patient?.fullName === p.fullName}
                      onClick={() => {
                        setForName(p.fullName);
                        setDoctorUid(null);
                      }}
                      title={p.fullName}
                      detail={[p.statedAgeYears != null ? t(`${p.statedAgeYears} years`, `${p.statedAgeYears} साल`, `${p.statedAgeYears} saal`) : null, p.sex]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  ))}
                  <Choice
                    on={addingNew}
                    onClick={() => {
                      setForName(NEW_PERSON);
                      setDoctorUid(null);
                      setMode("new_problem");
                    }}
                    icon={<UserPlus className="size-7" strokeWidth={2.2} />}
                    title={
                      people.length === 0
                        ? t("It is for me", "मेरे लिए है", "Mere liye hai")
                        : t("Somebody else", "किसी और के लिए", "Kisi aur ke liye")
                    }
                    detail={t(
                      "Not seen at a hospital yet",
                      "जिनका नाम अभी कहीं नहीं लिखा",
                      "Jinka naam abhi kahin nahi likha",
                    )}
                  />
                </div>

                {addingNew ? (
                  <div className="mt-4 space-y-4 rounded-2xl border-2 border-[var(--brand-deep)] bg-card p-4">
                    <div>
                      <label htmlFor="new-name" className="mb-1 block text-base font-bold">
                        {t("Full name", "पूरा नाम", "Poora naam")}
                      </label>
                      <input
                        id="new-name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        autoComplete="off"
                        placeholder={t("As it is said", "जैसे बोलते हैं", "Jaise bolte hain")}
                        className="w-full rounded-2xl border-2 border-[var(--color-input)] bg-white px-4 py-3 text-lg outline-none focus:border-[var(--brand)]"
                      />
                      <p className="text-muted-foreground mt-1 text-base leading-relaxed">
                        {t(
                          "The hospital opens their record under this name.",
                          "अस्पताल इसी नाम से काग़ज बनाएगा।",
                          "Hospital isi naam se record banayega.",
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-4">
                      <div>
                        <label htmlFor="new-age" className="mb-1 block text-base font-bold">
                          {t("Age (years)", "उम्र (साल)", "Umar (saal)")}
                        </label>
                        <input
                          id="new-age"
                          value={newAge}
                          onChange={(e) => setNewAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
                          inputMode="numeric"
                          placeholder={t("About", "लगभग", "Lagbhag")}
                          className="w-28 rounded-2xl border-2 border-[var(--color-input)] bg-white px-4 py-3 text-lg tabular-nums outline-none focus:border-[var(--brand)]"
                        />
                      </div>
                      <div
                        className="flex flex-wrap gap-2"
                        role="group"
                        aria-label={t("Sex", "लिंग", "Sex")}
                      >
                        {SEXES.map((x) => (
                          <button
                            key={x.value}
                            type="button"
                            aria-pressed={newSex === x.value}
                            onClick={() => setNewSex(newSex === x.value ? null : x.value)}
                            className={cn(
                              "min-h-12 rounded-2xl border-2 border-[var(--brand-deep)] px-4 text-lg font-bold",
                              newSex === x.value
                                ? "bg-[var(--brand-soft)] shadow-[0_3px_0_var(--brand-deep)]"
                                : "bg-card",
                            )}
                          >
                            {t(x.en, x.hi, x.hinglish)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </Step>
            ) : null}

            {current === "what" ? (
              <Step n={at + 1} title={t("What do you need?", "क्या चाहिए?", "Kya chahiye?")}>
                <div className="space-y-2.5" role="radiogroup">
                  <Choice
                    on={mode === "new_problem"}
                    onClick={() => setMode("new_problem")}
                    icon={<MessageSquareText className="size-7" strokeWidth={2.2} />}
                    title={t("I have a new problem", "नई तकलीफ़ है", "Nayi takleef hai")}
                  />
                  <Choice
                    on={mode === "existing_doctor"}
                    onClick={() => seen.length > 0 && setMode("existing_doctor")}
                    disabled={seen.length === 0}
                    icon={<Stethoscope className="size-7" strokeWidth={2.2} />}
                    title={t("See my doctor again", "अपने डॉक्टर को फिर दिखाना है", "Apne doctor ko phir dikhana hai")}
                    detail={seen.length === 0 ? t("No doctor seen yet.", "अभी किसी डॉक्टर को नहीं दिखाया।", "Abhi kisi doctor ko nahi dikhaya.") : undefined}
                  />
                </div>
                {mode === "new_problem" ? (
                  <textarea
                    value={requirement}
                    onChange={(e) => setRequirement(e.target.value)}
                    rows={4}
                    maxLength={500}
                    placeholder={t(
                      "What is wrong? For example: stomach pain for three days.",
                      "क्या तकलीफ़ है? जैसे: पेट में दर्द, तीन दिन से।",
                      "Kya takleef hai? Jaise: pet mein dard, teen din se.",
                    )}
                    className="bg-card mt-3 w-full resize-y rounded-2xl border-2 border-[var(--color-input)] px-4 py-3 text-lg leading-snug outline-none focus:border-[var(--brand)]"
                  />
                ) : null}
                {mode === "existing_doctor" ? (
                  <div className="mt-3 space-y-2.5" role="radiogroup">
                    {seen.map((d) => (
                      <Choice
                        key={d.uid}
                        on={doctorUid === d.uid}
                        onClick={() => {
                          setDoctorUid(d.uid);
                          setHospitalId(d.hospitalId);
                        }}
                        title={d.name}
                        detail={hospitals.data.find((h) => h.id === d.hospitalId)?.name}
                      />
                    ))}
                  </div>
                ) : null}
              </Step>
            ) : null}

            {current === "where" ? (
              <Step n={at + 1} title={t("Which hospital nearby?", "पास का कौन सा अस्पताल?", "Paas ka kaun sa hospital?")}>
                {hospitals.loading ? (
                  <div className="skeleton h-60 rounded-3xl" />
                ) : hospitals.error ? (
                  <p role="alert" className="text-destructive text-lg font-bold">
                    {t("Could not load the hospitals.", "अस्पताल नहीं खुल पाए।", "Hospitals nahi khul paaye.")} {hospitals.error}
                  </p>
                ) : (
                  <HospitalPicker hospitals={hospitals.data} value={hospitalId} onChange={setHospitalId} />
                )}
              </Step>
            ) : null}

            {current === "when" ? (
              <Step n={at + 1} title={t("Which day would you like to come?", "किस दिन आना चाहेंगे?", "Kis din aana chahenge?")}>
                <div className="grid grid-cols-2 gap-2.5" role="radiogroup">
                  {nextDays(6).map((d) => (
                    <Choice key={d} on={day === d} onClick={() => setDay(d)} title={dayWordIn(lang, d)} />
                  ))}
                </div>
                <p className="text-muted-foreground mt-3 text-base leading-relaxed">
                  {t("The hospital will tell you the time.", "समय अस्पताल बताएगा।", "Time hospital batayega.")}
                </p>
              </Step>
            ) : null}

            {current === "review" && (patient || addingNew) ? (
              <Step n={at + 1} title={t("Is this right?", "क्या यह सही है?", "Kya yeh sahi hai?")}>
                <dl className="space-y-2.5 rounded-2xl border-[3px] border-[#232326] bg-card p-4 text-lg">
                  <div>
                    <dt className="text-sm font-bold uppercase">{t("For", "किसके लिए", "Kiske liye")}</dt>
                    <dd className="font-bold">{forLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-bold uppercase">{t("Need", "ज़रूरत", "Zaroorat")}</dt>
                    <dd>{mode === "existing_doctor" ? doctorName : requirement}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-bold uppercase">{t("Hospital", "अस्पताल", "Hospital")}</dt>
                    <dd>
                      {chosenHospital?.name}
                      {chosenHospital?.area ? ` · ${chosenHospital.area}` : ""}
                    </dd>
                  </div>
                  {chosenHospital?.consultationFee != null ? (
                    <div>
                      <dt className="text-sm font-bold uppercase">{t("Doctor's fee", "डॉक्टर फ़ीस", "Doctor fees")}</dt>
                      <dd>₹{chosenHospital.consultationFee} {t("(paid at the hospital)", "(अस्पताल में दें)", "(hospital mein dein)")}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-sm font-bold uppercase">{t("Day", "दिन", "Din")}</dt>
                    <dd>{dayWordIn(lang, day)}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-base leading-relaxed">
                  {t(
                    "The hospital's desk will reply within 15 minutes. If it cannot, we ask the next nearest one for you.",
                    "अस्पताल का काउंटर 15 मिनट में जवाब देगा। न दे पाए तो हम अगले पास वाले से पूछ लेंगे।",
                    "Hospital ka counter 15 minute mein jawab dega. Na de paaye to hum agle paas wale se pooch lenge.",
                  )}
                </p>
              </Step>
            ) : null}

            {error ? (
              <p role="alert" className="text-destructive text-lg font-bold">
                {error}
              </p>
            ) : null}

          </>
        )}
      </Screen>
      {asking ? (
        // Pinned under the question, so Next never needs a scroll to find.
        <div className="shrink-0 space-y-1 border-t-[3px] border-[#232326] bg-[var(--color-background)] px-4 pt-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          {current === "review" ? (
            <BigButton disabled={busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="size-6 animate-spin" /> : t("Ask for a visit", "विज़िट माँगें", "Visit maangein")}
            </BigButton>
          ) : (
            <BigButton disabled={!canGo[current]} onClick={next}>
              {t("Next", "आगे", "Aage")}
            </BigButton>
          )}
          <button type="button" onClick={back} className="min-h-11 w-full text-center text-lg font-bold underline">
            {t("Back", "वापस", "Wapas")}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** One question, numbered. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-3 text-xl font-bold tracking-tight">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-deep)] text-base text-white"
        >
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One big, tappable answer. */
function Choice({
  on,
  onClick,
  title,
  detail,
  icon,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  detail?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-disabled={disabled}
      onClick={onClick}
      className={cn(
        "hover-orange flex w-full items-center gap-4 rounded-2xl border-2 border-[var(--brand-deep)] p-4 text-left",
        on ? "bg-[var(--brand-soft)] shadow-[0_3px_0_var(--brand-deep)]" : "bg-card",
        disabled && "opacity-50",
      )}
    >
      {icon ?? (
        <span
          aria-hidden
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-[var(--brand-deep)]",
            on ? "bg-[var(--brand-deep)] text-white" : "bg-white",
          )}
        >
          {on ? <Check className="size-4" strokeWidth={3} /> : null}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-xl leading-tight font-bold">{title}</span>
        {detail ? <span className="text-muted-foreground block text-base">{detail}</span> : null}
      </span>
      {icon && on ? <Check className="size-6 shrink-0" strokeWidth={3} aria-hidden /> : null}
    </button>
  );
}
