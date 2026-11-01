import { saveHistory, errorMessage, useDocuments, useHistories } from "@parcha/client";
import type { PatientDocument, PatientHistory } from "@parcha/core";
import { Screen } from "@parcha/ui";
import { Check, Loader2, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useHandset } from "../auth";
import { Avatar, FolderArt } from "../components/art";
import { usePeople } from "../components/people";
import { AddDocument, KINDS, ViewDocument, kindLabel, kindOf } from "../components/records";
import { ParchaList } from "../components/parchas";
import { dateIn, useLang, useT, type T } from "../i18n";
import { Header } from "../kit";

type Tab = "parchas" | "papers";
const TABS: { id: Tab; label: [string, string, string] }[] = [
  { id: "parchas", label: ["Parchas", "पर्चे", "Parche"] },
  { id: "papers", label: ["Lab reports", "लैब रिपोर्ट", "Lab reports"] },
];

/**
 * The common choices are stored in English (the doctor reads them) and shown
 * in the language in force.
 */
const WORDS: Record<string, [string, string]> = {
  Diabetes: ["मधुमेह (शुगर)", "Sugar (diabetes)"],
  "High BP": ["हाई BP", "High BP"],
  Asthma: ["दमा", "Dama (asthma)"],
  Thyroid: ["थायरॉइड", "Thyroid"],
  "Heart disease": ["दिल की बीमारी", "Dil ki bimari"],
  "Kidney disease": ["गुर्दे की बीमारी", "Gurde ki bimari"],
  TB: ["टीबी", "TB"],
  Epilepsy: ["मिर्गी", "Mirgi"],
  Penicillin: ["पेनिसिलिन", "Penicillin"],
  "Sulfa drugs": ["सल्फ़ा दवाएँ", "Sulfa dawaiyan"],
  Aspirin: ["एस्पिरिन", "Aspirin"],
  Dust: ["धूल", "Dhool"],
  Food: ["खाना", "Khana"],
  Pollen: ["पराग (फूलों से)", "Parag (phoolon se)"],
};
const word = (t: T, v: string) => (WORDS[v] ? t(v, WORDS[v][0], WORDS[v][1]) : v);

const COMMON_CONDITIONS = ["Diabetes", "High BP", "Asthma", "Thyroid", "Heart disease", "Kidney disease", "TB", "Epilepsy"];
const COMMON_ALLERGIES = ["Penicillin", "Sulfa drugs", "Aspirin", "Dust", "Food", "Pollen"];
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];


/**
 * The patient's Parchas and their lab reports (and the other papers they keep:
 * scans, insurance). One person at a time, because a phone is often shared by a
 * family. Visits have their own tab; the health summary lives under Me.
 */
export function Records() {
  const t = useT();
  const { handset } = useHandset();
  const phone = handset?.phone ?? null;
  const docs = useDocuments(phone);
  const histories = useHistories(phone);

  const people = useMemo(
    () => [...new Set([...histories.data.map((h) => h.personName), ...docs.data.map((d) => d.personName)])],
    [histories.data, docs.data],
  );
  const { active } = usePeople();
  const [picked, setChosen] = useState<string | null>(null);
  // The person using the phone, once chosen, is the only one shown.
  const chosen = active ?? picked;
  const person = chosen && people.includes(chosen) ? chosen : (people[0] ?? null);
  const [tab, setTab] = useState<Tab>("parchas");

  return (
    <>
      <Header title={t("My Parchas", "मेरे पर्चे", "Mere Parche")} subtitle={t("Prescriptions and lab reports", "पर्चे और लैब रिपोर्ट", "Parche aur lab reports")} />

      {people.length > 1 && !active ? (
        <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-2" aria-label={t("Who", "कौन", "Kaun")}>
          {people.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === person}
              onClick={() => setChosen(p)}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-[3px] border-[#232326] py-0.5 pr-3.5 pl-0.5 text-base font-bold ${p === person ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card"}`}
            >
              <Avatar name={p} size={28} />
              {p}
            </button>
          ))}
        </div>
      ) : null}

      <div role="tablist" className="grid shrink-0 grid-cols-2 gap-1.5 px-4 pb-3">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={`min-h-12 rounded-xl border-[3px] border-[#232326] px-0.5 text-base leading-tight font-bold ${tab === x.id ? "bg-[var(--brand-soft)] shadow-[0_3px_0_#232326]" : "bg-card"}`}
          >
            {t(...x.label)}
          </button>
        ))}
      </div>

      <Screen className="px-4 pb-4">
        {!person ? (
          <div className="pop flex flex-col items-center px-2 py-8 text-center">
            <FolderArt size={110} />
            <p className="max-w-72 text-lg">{t("Your records will appear here after your first visit.", "पहली विज़िट के बाद आपके काग़ज़ यहाँ दिखेंगे।", "Pehli visit ke baad aapke kagaz yahan dikhenge.")}</p>
          </div>
        ) : tab === "parchas" ? (
          <ParchaList person={person} />
        ) : (
          <Papers person={person} docs={docs.data.filter((d) => d.personName === person)} loading={docs.loading} error={docs.error} />
        )}
      </Screen>
    </>
  );
}

function Papers({ person, docs, loading, error }: { person: string; docs: PatientDocument[]; loading: boolean; error: string | null }) {
  const t = useT();
  const lang = useLang();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<PatientDocument | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const shown = kind ? docs.filter((d) => d.kind === kind) : docs;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-lg font-bold shadow-[0_4px_0_#232326]"
      >
        <Plus className="size-6" strokeWidth={2.8} aria-hidden /> {t("Add a paper", "काग़ज़ जोड़ें", "Kagaz jodein")}
      </button>

      {docs.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[null, ...KINDS.map((k) => k.id)].map((k) => (
            <button
              key={k ?? "all"}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`min-h-11 shrink-0 rounded-full border-[3px] border-[#232326] px-3 py-1 text-base font-bold ${kind === k ? "bg-[var(--brand-soft)]" : "bg-card"}`}
            >
              {k ? kindLabel(t, k) : t("All", "सब", "Sab")}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-base font-bold text-[#b3261e]">{t("Could not load your papers.", "आपके काग़ज़ नहीं खुल पाए।", "Aapke kagaz nahi khul paaye.")} {error}</p>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-3" role="status" aria-label={t("Loading", "खुल रहा है", "Khul raha hai")}>
          {[0, 1].map((i) => <div key={i} className="skeleton h-28 rounded-2xl border-[3px] border-[#232326]" />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="pop flex flex-col items-center px-2 py-6 text-center">
          <FolderArt size={104} />
          <p className="max-w-64 text-base">
            {docs.length === 0
              ? t("Keep your lab reports, scans and insurance here, so they are with you at every visit.", "अपनी जाँच रिपोर्ट, स्कैन और बीमा यहाँ रखें, ताकि हर विज़िट पर साथ रहें।", "Apni test reports, scans aur insurance yahan rakhein, taaki har visit par saath rahein.")
              : t("Nothing of that kind yet.", "इस तरह का अभी कुछ नहीं।", "Is tarah ka abhi kuch nahi.")}
          </p>
        </div>
      ) : (
        <ul className="stagger grid grid-cols-2 gap-3">
          {shown.map((d) => {
            const { icon: Icon } = kindOf(d.kind);
            const label = kindLabel(t, d.kind);
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setOpen(d)}
                  className="flex h-full min-h-28 w-full flex-col items-start gap-1 rounded-2xl border-[3px] border-[#232326] bg-card p-3 text-left shadow-[0_3px_0_#232326] active:translate-y-0.5"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl border-2 border-[#232326] bg-[var(--brand-soft)]">
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <span className="line-clamp-2 text-base leading-tight font-bold">{d.title}</span>
                  <span className="text-base">{label} · {dateIn(lang, d.takenOn ?? d.createdAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? <AddDocument person={person} onClose={() => setAdding(false)} /> : null}
      {open ? <ViewDocument doc={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** Tap-to-toggle chips, with the common choices ready and a box for the rest. */
function ChipPicker({ label, common, value, onChange }: { label: string; common: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  const [other, setOther] = useState("");
  const all = [...common, ...value.filter((v) => !common.includes(v))];
  const toggle = (c: string) => onChange(value.includes(c) ? value.filter((v) => v !== c) : [...value, c]);
  return (
    <section>
      <p className="mb-2 text-lg font-bold">{label}</p>
      <div className="flex flex-wrap gap-2">
        {all.map((c) => {
          const on = value.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c)}
              className={`flex min-h-11 items-center gap-1.5 rounded-full border-[3px] border-[#232326] px-3 py-1.5 text-base font-bold ${on ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card"}`}
            >
              {on ? <Check className="size-4" strokeWidth={3} aria-hidden /> : null}
              {word(t, c)}
            </button>
          );
        })}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const typed = other.trim();
          if (typed && !value.includes(typed)) onChange([...value, typed]);
          setOther("");
        }}
      >
        <input
          value={other}
          onChange={(e) => setOther(e.target.value)}
          maxLength={60}
          placeholder={t("Something else", "कुछ और", "Kuch aur")}
          aria-label={t(`Add to ${label}`, `${label} में जोड़ें`, `${label} mein jodein`)}
          className="h-12 min-w-0 flex-1 rounded-xl border-[3px] border-[#232326] bg-card px-3 text-base outline-none focus:bg-[var(--hover-soft)]"
        />
        <button type="submit" aria-label={t("Add", "जोड़ें", "Jodein")} className="flex size-12 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-card">
          <Plus className="size-6" aria-hidden />
        </button>
      </form>
    </section>
  );
}

/** The health summary a person keeps for their doctors: shown under Me. */
export function Health({ person, saved, loading }: { person: string; saved: PatientHistory | null; loading: boolean }) {
  const t = useT();
  const [conditions, setConditions] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [medicines, setMedicines] = useState<string[]>([]);
  const [blood, setBlood] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<"clean" | "dirty" | "saving" | "saved">("clean");
  const [error, setError] = useState<string | null>(null);

  // Start from what was saved, once it has arrived, and again for another person.
  const key = `${person}:${loading}:${saved?.updatedAt ?? ""}`;
  useEffect(() => {
    if (loading) return;
    setConditions(saved?.conditions ?? []);
    setAllergies(saved?.allergies ?? []);
    setMedicines(saved?.medicines ?? []);
    setBlood(saved?.bloodGroup ?? null);
    setNotes(saved?.notes ?? "");
    setState((s) => (s === "saving" ? "saved" : "clean"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setState("dirty");
  };

  async function save() {
    setState("saving");
    setError(null);
    try {
      await saveHistory({ personName: person, conditions, allergies, medicines, bloodGroup: blood, notes });
    } catch (e) {
      setError(errorMessage(e));
      setState("dirty");
    }
  }

  if (loading) return <div className="skeleton h-64 rounded-2xl border-[3px] border-[#232326]" role="status" aria-label={t("Loading", "खुल रहा है", "Khul raha hai")} />;

  return (
    <div className="space-y-5">
      <p className="rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-3 text-base leading-snug">
        {t("This is what you tell us about yourself. It helps the doctor, who also checks it with you.", "यह आप अपने बारे में बताते हैं। इससे डॉक्टर को मदद मिलती है, जो आपसे भी पूछ लेते हैं।", "Yeh aap apne baare mein batate hain. Isse doctor ko madad milti hai, jo aapse bhi pooch lete hain.")}
      </p>
      <ChipPicker label={t("Health conditions", "बीमारियाँ", "Bimariyan")} common={COMMON_CONDITIONS} value={conditions} onChange={edit(setConditions)} />
      <ChipPicker label={t("Allergies", "एलर्जी", "Allergy")} common={COMMON_ALLERGIES} value={allergies} onChange={edit(setAllergies)} />
      <ChipPicker label={t("Medicines I take now", "अभी ली जा रही दवाइयाँ", "Abhi li ja rahi dawaiyan")} common={[]} value={medicines} onChange={edit(setMedicines)} />

      <section>
        <p className="mb-2 text-lg font-bold">{t("Blood group", "ब्लड ग्रुप", "Blood group")}</p>
        <div className="grid grid-cols-4 gap-2">
          {BLOOD.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={blood === b}
              onClick={() => edit(setBlood)(blood === b ? null : b)}
              className={`h-12 rounded-xl border-[3px] border-[#232326] text-lg font-bold ${blood === b ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card"}`}
            >
              {b}
            </button>
          ))}
        </div>
      </section>

      <label className="block">
        <span className="mb-2 block text-lg font-bold">{t("Anything else", "और कुछ", "Aur kuch")}</span>
        <textarea
          value={notes}
          maxLength={600}
          rows={3}
          onChange={(e) => edit(setNotes)(e.target.value)}
          className="w-full rounded-xl border-[3px] border-[#232326] bg-card p-3 text-base outline-none focus:bg-[var(--hover-soft)]"
        />
      </label>

      {error ? <p role="alert" className="text-base font-bold text-[#b3261e]">{error}</p> : null}
      <button
        type="button"
        disabled={state === "clean" || state === "saved" || state === "saving"}
        onClick={() => void save()}
        className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-xl font-bold shadow-[0_4px_0_#232326] active:translate-y-0.5 disabled:opacity-60"
      >
        {state === "saving" ? <Loader2 className="size-6 animate-spin" aria-hidden /> : state === "saved" ? <Check className="size-6" aria-hidden /> : null}
        {state === "saving" ? t("Saving…", "सहेज रहे हैं…", "Save ho raha hai…") : state === "saved" ? t("Saved", "सहेज लिया", "Save ho gaya") : t("Save", "सहेजें", "Save karein")}
      </button>
    </div>
  );
}
