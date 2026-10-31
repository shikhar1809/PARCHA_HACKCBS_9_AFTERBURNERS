import { useVisitsForPhone } from "@parcha/client";
import { Screen } from "@parcha/ui";
import { CalendarPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useHandset } from "../auth";
import { Avatar, ClipboardArt } from "../components/art";
import { usePeople } from "../components/people";
import { VisitCard } from "../components/VisitCard";
import { useT } from "../i18n";
import { Header } from "../kit";
import { NOW, UPCOMING, isFresh } from "./Home";

type Tab = "now" | "upcoming" | "past";

const TABS: { id: Tab; label: [string, string, string] }[] = [
  { id: "now", label: ["Now", "अभी", "Abhi"] },
  { id: "upcoming", label: ["Coming up", "आने वाली", "Aane wali"] },
  { id: "past", label: ["Past", "पिछली", "Pichhli"] },
];

const EMPTY: Record<Tab, [string, string, string]> = {
  now: ["Nothing at the clinic right now.", "अभी अस्पताल में कोई विज़िट नहीं।", "Abhi hospital mein koi visit nahi."],
  upcoming: ["No visit is booked. Use Book a visit on Home.", "कोई विज़िट बुक नहीं है। घर पर \"विज़िट बुक करें\" दबाएँ।", "Koi visit book nahi hai. Ghar par \"Visit book karein\" dabayein."],
  past: ["Finished visits will appear here.", "पूरी हुई विज़िट यहाँ दिखेंगी।", "Poori hui visits yahan dikhengi."],
};

/**
 * Every visit, one list at a time. Three tabs split them by where they are, and
 * when a phone is shared the names on it become filters, so a long history never
 * becomes a long scroll.
 */
export function Visits() {
  const t = useT();
  const { handset } = useHandset();
  const visits = useVisitsForPhone(handset?.phone ?? null);
  const [chosen, setChosen] = useState<Tab | null>(null);
  const { active } = usePeople();
  const [picked, setPerson] = useState<string | null>(null);
  // The person using the phone, once chosen, is the only one shown.
  const person = active ?? picked;

  const people = useMemo(() => [...new Set(visits.data.map((v) => v.patientName))], [visits.data]);
  const mine = person ? visits.data.filter((v) => v.patientName === person) : visits.data;

  const groups: Record<Tab, typeof mine> = {
    now: mine.filter((v) => NOW.has(v.stage)),
    upcoming: mine.filter((v) => UPCOMING.has(v.stage)),
    past: mine.filter((v) => v.stage === "prescribed" || v.stage === "cancelled"),
  };
  // Open on the first list that has something in it.
  const tab: Tab = chosen ?? (TABS.find((x) => groups[x.id].length > 0)?.id ?? "now");

  return (
    <>
      <Header
        title={t("My visits", "मेरी विज़िट", "Meri visits")}
        subtitle={`+91 ${handset?.phone ?? ""}`}
        action={
          <Link
            to="/book"
            className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-full border-[3px] border-[#232326] bg-[var(--brand)] px-3.5 text-base font-bold shadow-[0_3px_0_#232326]"
          >
            <CalendarPlus className="size-5" strokeWidth={2.4} aria-hidden />
            {t("New visit", "नई विज़िट", "Nayi visit")}
          </Link>
        }
      />

      <div className="shrink-0 space-y-2.5 px-4 pb-3">
        <div role="tablist" className="grid grid-cols-3 gap-2">
          {TABS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setChosen(x.id)}
              className={`flex min-h-12 items-center justify-center gap-1.5 rounded-xl border-[3px] border-[#232326] px-1 text-base font-bold ${
                tab === x.id ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card"
              }`}
            >
              {t(...x.label)}
              <span className="rounded-full border-2 border-[#232326] bg-white px-1.5 text-sm">{groups[x.id].length}</span>
            </button>
          ))}
        </div>

        {people.length > 1 && !active ? (
          <div className="flex flex-wrap gap-2" aria-label={t("Who", "कौन", "Kaun")}>
            {[null, ...people].map((p) => (
              <button
                key={p ?? "all"}
                type="button"
                aria-pressed={person === p}
                onClick={() => setPerson(p)}
                className={`flex min-h-11 items-center gap-1.5 rounded-full border-[3px] border-[#232326] py-0.5 pr-3 text-base font-bold ${
                  p ? "pl-0.5" : "pl-3"
                } ${person === p ? "bg-[var(--brand-soft)]" : "bg-card"}`}
              >
                {p ? <Avatar name={p} size={30} /> : null}
                {p ?? t("Everyone", "सब", "Sab")}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Screen className="px-4 pb-4">
        {visits.error ? (
          <p role="alert" className="text-destructive py-4 text-base">
            {t("Could not load your visits.", "आपकी विज़िट नहीं खुल पाईं।", "Aapki visits nahi khul paayi.")} {visits.error}
          </p>
        ) : visits.loading ? (
          <div className="space-y-3" role="status" aria-label={t("Loading", "खुल रहा है", "Khul raha hai")}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-24 rounded-2xl border-[3px] border-[#232326]" />
            ))}
          </div>
        ) : groups[tab].length === 0 ? (
          <div className="pop flex flex-col items-center px-2 py-8 text-center">
            <ClipboardArt size={104} />
            <p className="mt-1 max-w-72 text-lg">{t(...EMPTY[tab])}</p>
          </div>
        ) : (
          <ul key={tab + (person ?? "")} className="stagger space-y-2.5">
            {groups[tab].map((v) => (
              <VisitCard key={v.id} visit={v} featured={isFresh(v)} />
            ))}
          </ul>
        )}
      </Screen>
    </>
  );
}
