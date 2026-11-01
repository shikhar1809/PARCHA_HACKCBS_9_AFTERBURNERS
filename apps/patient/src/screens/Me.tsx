import { Screen } from "@parcha/ui";
import { useHistories } from "@parcha/client";
import { HeartHandshake, HeartPulse, Languages, LogOut, Pencil, Plus, QrCode, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";

import { signOutOfPatient, useHandset } from "../auth";
import { Avatar, DoctorArt } from "../components/art";
import { useActivePerson, usePeople, type Person } from "../components/people";
import { MyData, PrivacyNotice } from "../components/privacy";
import { Sheet } from "../components/records";
import { useMemoryParchas } from "../components/memory";
import { ShareHistory } from "../components/ShareHistory";
import { Health } from "./Records";
import { ProfileEditor } from "../components/profile-editor";
import { LangChoice, setLang, useLang, useT } from "../i18n";
import { Header } from "../kit";

/** Who this phone is, and the few things that are not about a visit. */
export function Me() {
  const t = useT();
  const lang = useLang();
  const { handset } = useHandset();
  const { people } = usePeople();
  const me = useActivePerson();
  const [sheet, setSheet] = useState<null | "data" | "privacy" | "health" | "share">(null);
  const histories = useHistories(handset?.phone ?? null);
  // Whose health summary: the person using the phone, else whoever is picked in the sheet.
  const [healthFor, setHealthFor] = useState<string | null>(null);
  const healthPerson = me?.name ?? healthFor ?? people[0]?.name ?? null;
  const [editing, setEditing] = useState<null | Person | "new">(null);
  // The person whose papers and history the three tiles below act on.
  const who = me ?? people[0] ?? null;
  const parchas = useMemoryParchas(who?.name ?? null);

  return (
    <>
      <Header title={t("Me", "मैं", "Main")} subtitle={`+91 ${handset?.phone ?? ""}`} />
      <Screen className="stagger space-y-3 px-4 pb-4">
        {/* The language: this person's own on a shared phone, else the phone's. */}
        <section className="rounded-3xl border-[3px] border-[#232326] bg-card p-4 shadow-[0_4px_0_#232326]">
          <p className="flex items-center gap-2 text-lg font-bold">
            <Languages className="size-6" aria-hidden />
            {me && people.length > 1
              ? t(`${me.shown.split(" ")[0]}'s language`, `${me.shown.split(" ")[0]} की भाषा`, `${me.shown.split(" ")[0]} ki bhasha`)
              : t("Language", "भाषा", "Bhasha")}
          </p>
          <div className="mt-3">
            <LangChoice value={lang} onChange={(l) => setLang(l, me && people.length > 1 ? me.name : null)} />
          </div>
        </section>

        <section className="rounded-3xl border-[3px] border-[#232326] bg-card p-4 shadow-[0_4px_0_#232326]">
          <p className="flex items-center gap-2 text-lg font-bold">
            <Users className="size-6" aria-hidden /> {t("On this phone", "इस फ़ोन पर", "Is phone par")}
          </p>
          <ul className="mt-3 space-y-2">
            {people.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  onClick={() => setEditing(p)}
                  aria-label={t(`Change ${p.shown}`, `${p.shown} को बदलें`, `${p.shown} ko badlein`)}
                  className="flex w-full items-center gap-2.5 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-2 text-left"
                >
                  <Avatar name={p.name} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg leading-tight font-bold">{p.shown}</span>
                    <span className="block text-base">
                      {p.ageYears != null ? t(`${p.ageYears} years`, `${p.ageYears} साल`, `${p.ageYears} saal`) : t("Age not set", "उम्र नहीं लिखी", "Umar nahi likhi")}
                      {p.needsHelp ? t(" · simple screen", " · आसान स्क्रीन", " · simple screen") : ""}
                    </span>
                  </span>
                  {p.needsHelp ? <HeartHandshake className="size-5 shrink-0" aria-hidden /> : null}
                  <Pencil className="size-5 shrink-0" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-[3px] border-dashed border-[#232326] text-base font-bold"
          >
            <Plus className="size-5" aria-hidden /> {t("Add a family member", "परिवार का सदस्य जोड़ें", "Family member jodein")}
          </button>
        </section>

        <button
          type="button"
          onClick={() => setSheet("health")}
          className="flex min-h-14 flex-col items-center justify-center rounded-2xl border-[3px] border-[#232326] bg-card px-3 py-2 text-center shadow-[0_4px_0_#232326]"
        >
          <span className="flex items-center gap-3 text-lg font-bold">
            <HeartPulse className="size-6" aria-hidden /> {me && people.length > 1 ? t(`${me.shown.split(" ")[0]}'s health`, `${me.shown.split(" ")[0]} की सेहत`, `${me.shown.split(" ")[0]} ki sehat`) : t("My health", "मेरी सेहत", "Meri sehat")}
          </span>
          <span className="text-sm">{t("Illnesses, allergies, regular medicines, blood group", "बीमारियाँ, एलर्जी, रोज़ की दवाइयाँ, ब्लड ग्रुप", "Bimariyan, allergy, roz ki dawaiyan, blood group")}</span>
        </button>

        {/* Papers are added on the Parchas tab, where they are read. */}
        <button
          type="button"
          disabled={!who}
          onClick={() => setSheet("share")}
          className="flex min-h-14 flex-col items-center justify-center rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] px-3 py-2 text-center shadow-[0_4px_0_#232326] disabled:opacity-40"
        >
          <span className="flex items-center gap-3 text-lg font-bold">
            <QrCode className="size-6" aria-hidden /> {t("Show the doctor", "डॉक्टर को दिखाएँ", "Doctor ko dikhayein")}
          </span>
          <span className="text-sm">
            {t("A code the doctor scans to read your history.", "एक कोड, जिसे स्कैन कर डॉक्टर आपका इतिहास पढ़ लें।", "Ek code, jise scan kar doctor aapki history padh lein.")}
          </span>
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setSheet("data")}
            className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-card text-base font-bold shadow-[0_4px_0_#232326]"
          >
            <ShieldCheck className="size-5" aria-hidden /> {t("My data", "मेरा डेटा", "Mera data")}
          </button>
          <button
            type="button"
            onClick={() => setSheet("privacy")}
            className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-card text-base font-bold shadow-[0_4px_0_#232326]"
          >
            {t("Privacy", "निजता", "Privacy")}
          </button>
        </div>

        <button
          type="button"
          onClick={() => void signOutOfPatient()}
          className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-[oklch(0.94_0.05_25)] text-lg font-bold shadow-[0_4px_0_#232326]"
        >
          <LogOut className="size-6" aria-hidden /> {t("Sign out", "साइन आउट", "Sign out")}
        </button>

        <div className="flex flex-col items-center pt-1">
          <DoctorArt size={84} />
          <p className="max-w-72 px-2 text-center text-base">
            {t("For your safety, you are signed out after a while without use.", "आपकी सुरक्षा के लिए, कुछ देर इस्तेमाल न होने पर साइन आउट हो जाता है।", "Aapki safety ke liye, kuch der use na hone par sign out ho jaata hai.")}
          </p>
        </div>
      </Screen>
      {editing ? <ProfileEditor person={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {sheet === "data" ? <MyData onClose={() => setSheet(null)} /> : null}
      {sheet === "share" && who ? <ShareHistory person={who} parchas={parchas} onClose={() => setSheet(null)} /> : null}
      {sheet === "health" && healthPerson ? (
        <Sheet title={t("Health", "सेहत", "Sehat")} onClose={() => setSheet(null)}>
          {!me && people.length > 1 ? (
            <div className="mb-3 flex flex-wrap gap-2" aria-label={t("Who", "कौन", "Kaun")}>
              {people.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  aria-pressed={p.name === healthPerson}
                  onClick={() => setHealthFor(p.name)}
                  className={`flex min-h-11 items-center gap-1.5 rounded-full border-[3px] border-[#232326] py-0.5 pr-3 pl-0.5 text-base font-bold ${p.name === healthPerson ? "bg-[var(--brand)]" : "bg-card"}`}
                >
                  <Avatar name={p.name} size={28} /> {p.shown}
                </button>
              ))}
            </div>
          ) : null}
          <Health person={healthPerson} saved={histories.data.find((h) => h.personName === healthPerson) ?? null} loading={histories.loading} />
        </Sheet>
      ) : null}
    </>
  );
}
