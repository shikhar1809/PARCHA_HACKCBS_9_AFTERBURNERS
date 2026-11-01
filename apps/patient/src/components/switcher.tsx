import { ArrowLeftRight, HeartHandshake, LogOut, Plus } from "lucide-react";
import { useState } from "react";

import { signOutOfPatient, useHandset } from "../auth";
import { LangChoice, setLang, useLang, useT } from "../i18n";
import { Avatar } from "./art";
import { usePeople, useActivePerson } from "./people";
import { DEMO_PHONE } from "./demoParchas";
import { ProfileEditor } from "./profile-editor";

/**
 * "Who is using Parcha?" A family shares one phone, so the app asks whose turn
 * it is each time it opens, like a streaming app's profiles, and then shows only
 * that person. Big faces, big names: it has to work for a grandmother who does
 * not read English. Someone who needs help goes straight to their simple screen.
 */
/**
 * The family's name for the greeting: the surname two or more of them share,
 * or "Shukla" on the demo phone, whose family is written with first names
 * only. No name is better than a guessed one, so with neither it just says
 * hello.
 */
function familyName(phone: string | null, names: string[]): string | null {
  const counts = new Map<string, number>();
  for (const n of names) {
    const parts = n.trim().split(/\s+/);
    if (parts.length > 1) counts.set(parts[parts.length - 1], (counts.get(parts[parts.length - 1]) ?? 0) + 1);
  }
  const shared = [...counts.entries()].find(([w, c]) => c > 1 && !/^(devi|kumar|kumari)$/i.test(w))?.[0];
  return shared ?? (phone === DEMO_PHONE ? "Shukla" : null);
}

export function WhoIsUsingScreen() {
  const { people, setActive } = usePeople();
  const { handset } = useHandset();
  const family = familyName(handset?.phone ?? null, people.map((p) => p.name));
  const [adding, setAdding] = useState(false);
  const t = useT();
  const lang = useLang();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--brand)]">
      <div className="px-5 pt-6 pb-5 text-center">
        <div className="mx-auto mb-5 max-w-md">
          <LangChoice value={lang} onChange={(l) => setLang(l)} size="sm" />
        </div>
        <p className="text-2xl leading-tight font-bold">
          {family ? t(`Hello, ${family} family`, `नमस्ते, ${family} परिवार`, `Namaste, ${family} parivaar`) : t("Hello", "नमस्ते", "Namaste")}
        </p>
        <h1 className="text-[2rem] leading-tight font-bold">{t("Who is using Parcha?", "पर्चा कौन इस्तेमाल कर रहा है?", "Parcha kaun use kar raha hai?")}</h1>
      </div>

      <ul className="stagger mx-auto grid w-full max-w-md grid-cols-2 gap-4 px-5">
        {people.map((p) => (
          <li key={p.name}>
            <button
              type="button"
              onClick={() => setActive(p.name)}
              className="bg-card flex w-full flex-col items-center gap-2 rounded-[1.75rem] border-[3px] border-[#232326] px-2 pt-5 pb-4 shadow-[0_5px_0_#232326] transition-transform active:translate-y-1 active:shadow-[0_2px_0_#232326]"
            >
              <Avatar name={p.name} size={104} />
              {/* Two lines if needed, so "Prashant" is never cut to "Prashant …". */}
              <span className="line-clamp-2 w-full px-1 text-xl leading-tight font-bold break-words">{p.shown}</span>
              <span className="text-base leading-none">
                {p.ageYears != null ? t(`${p.ageYears} years`, `${p.ageYears} साल`, `${p.ageYears} saal`) : " "}
              </span>
              {p.needsHelp ? (
                <span className="flex items-center gap-1 rounded-full border-2 border-[#232326] bg-[var(--mint,#adefc4)] px-2.5 py-0.5 text-sm font-bold">
                  <HeartHandshake className="size-4" aria-hidden /> {t("Simple screen", "आसान स्क्रीन", "Simple screen")}
                </span>
              ) : null}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-full min-h-[11.5rem] w-full flex-col items-center justify-center gap-2 rounded-[1.75rem] border-[3px] border-dashed border-[#232326] bg-white/40 px-2 py-4"
          >
            <span className="flex size-16 items-center justify-center rounded-full border-[3px] border-[#232326] bg-white">
              <Plus className="size-8" aria-hidden />
            </span>
            <span className="text-lg font-bold">{t("Add a person", "किसी को जोड़ें", "Kisi ko jodein")}</span>
          </button>
        </li>
      </ul>

      <div className="mt-auto flex justify-center px-5 pt-8 pb-8">
        <button
          type="button"
          onClick={() => void signOutOfPatient()}
          className="flex h-12 items-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-white px-5 text-lg font-bold shadow-[0_3px_0_#232326]"
        >
          <LogOut className="size-5" aria-hidden /> {t("Sign out", "साइन आउट", "Sign out")}
        </button>
      </div>

      {adding ? <ProfileEditor onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

/**
 * The strip at the top of every tab: whose turn it is, and a switch to change
 * it (which also leads to signing out). Only on a phone with more than one person.
 */
export function SwitchBar() {
  const t = useT();
  const { people, openPicker } = usePeople();
  const me = useActivePerson();
  if (people.length < 2 || !me) return null;
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b-[3px] border-[#232326] bg-[var(--color-background)] px-4 py-2">
      <Avatar name={me.name} size={34} />
      <p className="min-w-0 flex-1 truncate text-base font-bold">{me.shown}</p>
      <button
        type="button"
        onClick={openPicker}
        className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-full border-[3px] border-[#232326] bg-[var(--brand)] px-4 text-base font-bold shadow-[0_2px_0_#232326] active:translate-y-0.5"
      >
        <ArrowLeftRight className="size-4" aria-hidden /> {t("Switch", "बदलें", "Badlein")}
      </button>
    </div>
  );
}
