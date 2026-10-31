import { useVisitsForPhone } from "@parcha/client";
import type { Visit } from "@parcha/core";
import { Screen } from "@parcha/ui";
import { CalendarPlus, ChevronRight, FilePlus2 } from "lucide-react";
import { Link } from "react-router-dom";

import { useHandset } from "../auth";
import { Avatar, AvatarStack, DoctorArt } from "../components/art";
import { usePeople } from "../components/people";
import { VisitCard, visitDetail } from "../components/VisitCard";
import { StageChip } from "../kit";
import { tr, useLang, useT, type Lang } from "../i18n";

/** Before they come in: asked for, or booked. */
export const UPCOMING = new Set(["requested", "proposed", "scheduled"]);
/** Somewhere between the front desk and the doctor signing. */
export const NOW = new Set(["registered", "intake_complete", "in_consultation"]);

/** A prescription is "ready" for three days; after that it is simply a past visit. */
export const isFresh = (v: Visit) =>
  v.stage === "prescribed" && Date.now() - new Date(v.prescribedAt ?? v.registeredAt).getTime() < 3 * 86400000;

/**
 * The one thing that matters most right now: medicines to collect, a visit in
 * progress, or the next visit. Everything else lives under Visits.
 */
function pickFocus(visits: Visit[]): { visit: Visit; kind: "ready" | "now" | "next" | "last" } | null {
  const ready = visits.find(isFresh);
  if (ready) return { visit: ready, kind: "ready" };
  const now = visits.find((v) => NOW.has(v.stage));
  if (now) return { visit: now, kind: "now" };
  const next = visits.find((v) => UPCOMING.has(v.stage));
  if (next) return { visit: next, kind: "next" };
  const last = visits.find((v) => v.stage === "prescribed");
  return last ? { visit: last, kind: "last" } : null;
}

const HEADLINE = {
  ready: ["Prescription ready", "पर्ची तैयार", "Parchi taiyar"],
  now: ["At the clinic", "अस्पताल में", "Hospital mein"],
  next: ["Next visit", "अगली विज़िट", "Agli visit"],
  last: ["Last visit", "पिछली विज़िट", "Pichhli visit"],
} as const;

const greeting = (lang: Lang) => {
  const h = new Date().getHours();
  return h < 12
    ? tr(lang, "Good morning", "नमस्ते, सुप्रभात", "Good morning")
    : h < 17
      ? tr(lang, "Good afternoon", "नमस्ते", "Namaste")
      : tr(lang, "Good evening", "शुभ संध्या", "Good evening");
};

/** Where someone in the building is waiting, in plain words. */
const WAITING: Record<string, [string, string, string]> = {
  registered: ["Waiting at the front desk", "काउंटर पर इंतज़ार", "Counter par intezaar"],
  intake_complete: ["Waiting to see the doctor", "डॉक्टर से मिलने का इंतज़ार", "Doctor se milne ka intezaar"],
  in_consultation: ["With the doctor now", "अभी डॉक्टर के पास", "Abhi doctor ke paas"],
};

/**
 * Home: one screen, no scrolling. A friendly line, the single most important
 * visit as one compact card, and the two things people come to do: ask for a
 * new visit, or add a new Parcha (and get its reminders). Lists of visits and
 * Parchas are their own tabs.
 */
export function Home() {
  const lang = useLang();
  const t = useT();
  const { handset } = useHandset();
  const all = useVisitsForPhone(handset?.phone ?? null);
  const { people: household, active } = usePeople();
  // On a shared phone, the person whose turn it is sees only their own visits.
  const visits = { ...all, data: active ? all.data.filter((v) => v.patientName === active) : all.data };

  const focus = pickFocus(visits.data);
  // Other visits that are still open, shown as small rows under the main card.
  const others = visits.data.filter(
    (v) => (UPCOMING.has(v.stage) || NOW.has(v.stage)) && v.id !== (focus?.kind !== "last" ? focus?.visit.id : undefined),
  );
  const people = household.map((p) => ({ name: p.name, sex: p.sex, age: p.ageYears }));
  const me = household.find((p) => p.name === active);

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">{greeting(lang)}</p>
          <h1 className="truncate text-2xl leading-tight font-bold">
            {me ? me.shown.split(" ")[0] : people.length === 1 ? household[0].shown.split(" ")[0] : t("Your family", "आपका परिवार", "Aapka parivaar")}
          </h1>
        </div>
        {/* With more than one person, the switch bar above says whose turn it is. */}
        {people.length === 1 ? <Avatar name={household[0].name} size={42} /> : people.length > 1 && !me ? <AvatarStack people={people} size={38} /> : null}
      </header>

      <Screen className="flex flex-col gap-3 px-4 pb-3">
        {visits.error ? (
          <p role="alert" className="text-destructive py-4 text-base">
            {t("Could not load your visits.", "आपकी विज़िट नहीं खुल पाईं।", "Aapki visits nahi khul paayi.")} {visits.error}
          </p>
        ) : visits.loading ? (
          <div className="skeleton h-36 rounded-2xl border-[3px] border-[#232326]" role="status" aria-label={t("Loading", "खुल रहा है", "Khul raha hai")} />
        ) : focus ? (
          <Link
            to={`/visit/${focus.visit.id}`}
            className={`pop block rounded-2xl border-[3px] border-[#232326] p-3.5 shadow-[0_4px_0_#232326] ${
              focus.kind === "ready" ? "halo bg-[var(--brand)]" : "bg-card"
            }`}
          >
            <div className="flex items-center gap-3">
              <Avatar name={focus.visit.patientName} sex={focus.visit.patientSex} age={focus.visit.patientAgeYears} size={52} />
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold">{t(HEADLINE[focus.kind][0], HEADLINE[focus.kind][1], HEADLINE[focus.kind][2])}</p>
                <p className="truncate text-xl leading-tight font-bold">{focus.visit.patientName}</p>
                <p className="line-clamp-2 text-base">
                  {focus.kind === "now" && WAITING[focus.visit.stage]
                    ? t(...WAITING[focus.visit.stage]!)
                    : visitDetail(focus.visit, lang)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <StageChip stage={focus.visit.stage} since={focus.visit.prescribedAt} />
              <span className="flex min-h-11 shrink-0 items-center gap-0.5 rounded-full border-[3px] border-[#232326] bg-white px-3 py-1 text-base font-bold whitespace-nowrap">
                {focus.kind === "ready" ? t("Medicines", "दवाई", "Dawai") : t("Open", "खोलें", "Kholein")}
                <ChevronRight className="nudge size-4" strokeWidth={3} aria-hidden />
              </span>
            </div>
          </Link>
        ) : (
          <div className="pop flex flex-col items-center rounded-2xl border-[3px] border-dashed border-[#232326] px-5 py-4 text-center">
            <DoctorArt size={92} />
            <p className="text-lg font-bold">{t("No visit coming up", "कोई विज़िट नहीं आने वाली", "Koi visit nahi aane wali")}</p>
            <p className="mx-auto mt-0.5 max-w-72 text-base leading-snug">
              {t("Tap New visit below. A hospital nearby answers within 15 minutes.", "नीचे नई विज़िट दबाएँ। पास का अस्पताल 15 मिनट में जवाब देगा।", "Neeche Nayi visit dabayein. Paas ka hospital 15 minute mein jawab dega.")}
            </p>
          </div>
        )}

        {others.length > 0 ? (
          <ul className="stagger space-y-2">
            {others.slice(0, 2).map((v) => (
              <VisitCard key={v.id} visit={v} />
            ))}
            {others.length > 2 ? (
              <li className="text-center">
                <Link to="/visits" className="inline-block min-h-11 py-2 text-base font-bold underline">
                  {t(`${others.length - 2} more in Visits`, `विज़िट में ${others.length - 2} और`, `Visits mein ${others.length - 2} aur`)}
                </Link>
              </li>
            ) : null}
          </ul>
        ) : focus ? (
          // Only where there is room: on a short screen New visit and New Parcha come first.
          <div className="hidden flex-1 flex-col items-center justify-center gap-0.5 text-center [@media(min-height:700px)]:flex">
            <DoctorArt size={96} />
            <p className="text-base font-bold">{t("Need a check-up?", "जाँच करानी है?", "Check-up karana hai?")}</p>
            <p className="text-base">{t("Tap New visit and a hospital nearby answers in 15 minutes.", "नई विज़िट दबाएँ, 15 मिनट में पास का अस्पताल जवाब देगा।", "Nayi visit dabayein, 15 minute mein paas ka hospital jawab dega.")}</p>
          </div>
        ) : null}

        <div className="stagger mt-auto grid grid-cols-2 gap-3">
          <Link
            to="/book"
            className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] p-2 text-center shadow-[0_4px_0_#232326] active:translate-y-0.5"
          >
            <CalendarPlus className="size-9" strokeWidth={2.2} aria-hidden />
            <span className="text-xl leading-tight font-bold">{t("New visit", "नई विज़िट", "Nayi visit")}</span>
            <span className="text-sm leading-tight">{t("See a doctor", "डॉक्टर को दिखाएँ", "Doctor ko dikhayein")}</span>
          </Link>
          <Link
            to="/start"
            className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-2 text-center shadow-[0_4px_0_#232326] active:translate-y-0.5"
          >
            <FilePlus2 className="size-9" strokeWidth={2.2} aria-hidden />
            <span className="text-xl leading-tight font-bold">{t("New Parcha", "नया पर्चा", "Naya Parcha")}</span>
            <span className="text-sm leading-tight">{t("Get medicine reminders", "दवा के रिमाइंडर पाएँ", "Dawa ke reminder paayein")}</span>
          </Link>
        </div>
      </Screen>
    </>
  );
}
