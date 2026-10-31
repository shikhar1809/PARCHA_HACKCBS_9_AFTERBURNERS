import {
  DEMO_PLACE,
  formatDistance,
  rankByDistance,
  type Hospital,
} from "@parcha/core";
import { cn } from "@parcha/ui";
import { Clock, IndianRupee, MapPin, Sparkles, Star } from "lucide-react";
import { useEffect, useMemo } from "react";

import { HospitalMap } from "./LazyHospitalMap";
import { tr, useLang, useT, type Lang } from "../i18n";

type Ranked = Hospital & { km: number };

const SIZE = {
  large: ["Large hospital", "बड़ा अस्पताल", "Bada hospital"],
  medium: ["Medium hospital", "मध्यम अस्पताल", "Medium hospital"],
  small: ["Small clinic", "छोटा क्लिनिक", "Chhota clinic"],
} as const;

/** How big a place is: set on the hospital, else read from how it was set up. */
export function sizeOf(h: Hospital): keyof typeof SIZE | null {
  if (h.size) return h.size;
  return h.template === "hospital" ? "large" : h.template === "clinic" ? "medium" : h.template === "solo" ? "small" : null;
}

const LOAD_COST = { low: 0, medium: 0.8, high: 2 } as const;

/**
 * The one hospital to suggest, and why, in words a patient would use.
 *
 * Distance matters most, then how many people are waiting, then the rating.
 * The reason names only what is actually true of the pick, at most two things.
 */
export function bestPick(hospitals: Ranked[], lang: Lang): { hospital: Ranked; reason: string } | null {
  const open = hospitals.filter((h) => h.accepting && h.onParcha !== false);
  if (open.length === 0) return null;
  // A hospital with no rating yet counts as a 3, so a known good one is suggested first.
  const score = (h: Ranked) => h.km + LOAD_COST[h.load] - ((h.rating ?? 3) - 4) * 1.5;
  const best = [...open].sort((a, b) => score(a) - score(b))[0];
  const min = <K,>(f: (h: Ranked) => K | null | undefined) => open.map(f).filter((x): x is K => x != null).sort()[0];

  const reasons: string[] = [];
  if (best.km === Math.min(...open.map((h) => h.km))) reasons.push(tr(lang, `Closest to you (${formatDistance(best.km)})`, `आपके सबसे पास (${formatDistance(best.km)})`, `Aapke sabse paas (${formatDistance(best.km)})`));
  if (best.load === "low") reasons.push(tr(lang, "few people waiting now", "अभी कम लोग इंतज़ार में", "abhi kam log intezaar mein"));
  if (best.rating != null && best.rating === Math.max(...open.map((h) => h.rating ?? 0))) reasons.push(tr(lang, `best rated (${best.rating}★)`, `सबसे अच्छी रेटिंग (${best.rating}★)`, `sabse achhi rating (${best.rating}★)`));
  if (best.consultationFee != null && best.consultationFee === min((h) => h.consultationFee)) reasons.push(tr(lang, `lowest fee (₹${best.consultationFee})`, `सबसे कम फ़ीस (₹${best.consultationFee})`, `sabse kam fees (₹${best.consultationFee})`));
  const words = reasons.slice(0, 2).join(", ");
  const reason = words
    ? words.charAt(0).toUpperCase() + words.slice(1)
    : tr(lang, "Close by, and not too busy", "पास भी, भीड़ भी कम", "Paas bhi, bheed bhi kam");
  return { hospital: best, reason };
}

/**
 * Choosing a hospital: the map, and the one hospital that is best for you.
 *
 * The best pick is chosen to begin with and says why, so most people just tap
 * Next. Tapping another pin flies the map to it and shows that one instead,
 * with the same few facts: its size, its rating, the consultation fee, and how
 * far it is. Only hospitals on Parcha are on this map, because only they can
 * be asked.
 *
 * For the demo the patient is at Shaheed Sukhdev College in Rohini (DEMO_PLACE),
 * not wherever the phone is.
 */
export function HospitalPicker({
  hospitals,
  value,
  onChange,
}: {
  hospitals: Hospital[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const me = { lat: DEMO_PLACE.lat, lng: DEMO_PLACE.lng };

  const ranked = useMemo(
    () => rankByDistance(me, hospitals.filter((h) => h.onParcha !== false)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hospitals],
  );
  const best = useMemo(() => bestPick(ranked, lang), [ranked, lang]);

  // Start on the best pick, so most people have nothing to do but tap Next.
  useEffect(() => {
    if (value === null && best) onChange(best.hospital.id);
  }, [value, best, onChange]);

  const chosen = ranked.find((h) => h.id === value) ?? null;
  const isBest = chosen !== null && chosen.id === best?.hospital.id;

  return (
    <div className="space-y-3">
      <HospitalMap hospitals={ranked} selectedId={value} me={me} onSelect={onChange} zoomToSelected className="h-[19rem]" />
      <p className="flex items-center justify-center gap-1.5 text-base">
        <MapPin className="size-4 shrink-0" aria-hidden />
        {t("Tap a pin to see that hospital", "दूसरा अस्पताल देखने के लिए पिन दबाएँ", "Doosra hospital dekhne ke liye pin dabayein")}
      </p>

      {chosen ? (
        <section
          aria-live="polite"
          className={cn(
            "rounded-3xl border-[3px] border-[#232326] p-4 shadow-[0_4px_0_#232326]",
            isBest ? "bg-[var(--brand-soft)]" : "bg-card",
          )}
        >
          {isBest && best ? (
            <p className="mb-2 flex items-start gap-2 rounded-2xl bg-white px-3 py-2 text-base leading-snug font-bold">
              <Sparkles className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>
                {t("Best for you", "आपके लिए सबसे अच्छा", "Aapke liye sabse achha")}: <span className="font-normal">{best.reason}</span>
              </span>
            </p>
          ) : null}

          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xl leading-tight font-bold">{chosen.name}</h3>
            <span className="shrink-0 text-lg font-bold tabular-nums">{formatDistance(chosen.km)}</span>
          </div>

          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Fact label={t("Size", "आकार", "Size")} value={sizeOf(chosen) ? t(SIZE[sizeOf(chosen)!][0], SIZE[sizeOf(chosen)!][1], SIZE[sizeOf(chosen)!][2]) : "—"} />
            <Fact
              label={t("Rating", "रेटिंग", "Rating")}
              value={
                chosen.rating != null ? (
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-4 fill-[#f5a524] text-[#232326]" aria-hidden />
                    {chosen.rating.toFixed(1)}
                  </span>
                ) : (
                  t("New", "नया", "Naya")
                )
              }
            />
            <Fact
              label={t("Doctor's fee", "डॉक्टर फ़ीस", "Doctor fees")}
              value={
                chosen.consultationFee != null ? (
                  <span className="inline-flex items-center">
                    <IndianRupee className="size-4" strokeWidth={2.6} aria-hidden />
                    {chosen.consultationFee}
                  </span>
                ) : (
                  t("Ask", "पूछें", "Poochhein")
                )
              }
            />
          </dl>

          <p className="mt-3 flex items-center gap-1.5 text-base font-bold">
            {chosen.accepting ? (
              <>
                <Clock className="size-4 shrink-0" strokeWidth={2.6} aria-hidden />
                {t(`Replies within ${chosen.respondMinutes} min`, `${chosen.respondMinutes} मिनट में जवाब`, `${chosen.respondMinutes} minute mein jawab`)}
              </>
            ) : (
              t("Not taking requests right now. Choose another pin.", "अभी अनुरोध नहीं ले रहा। दूसरा पिन चुनें।", "Abhi request nahi le raha. Doosra pin chunein.")
            )}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("The fee is paid at the hospital. Ratings are examples in this demo.", "फ़ीस अस्पताल में दी जाती है। इस डेमो में रेटिंग उदाहरण हैं।", "Fees hospital mein di jaati hai. Is demo mein rating udaharan hain.")}
          </p>

          {!isBest && best ? (
            <button type="button" onClick={() => onChange(best.hospital.id)} className="mt-2 min-h-11 text-base font-bold underline">
              {t(`Back to the best choice: ${best.hospital.shortName}`, `सबसे अच्छे पर वापस: ${best.hospital.shortName}`, `Sabse achhe par wapas: ${best.hospital.shortName}`)}
            </button>
          ) : null}
        </section>
      ) : (
        <p className="rounded-2xl border-2 border-dashed border-[#232326] p-4 text-lg">
          {t("No hospital nearby is taking requests right now.", "अभी पास का कोई अस्पताल अनुरोध नहीं ले रहा।", "Abhi paas ka koi hospital request nahi le raha.")}
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-[#232326] bg-white px-1.5 py-2">
      <dt className="text-sm">{label}</dt>
      <dd className="text-base leading-tight font-bold">{value}</dd>
    </div>
  );
}
