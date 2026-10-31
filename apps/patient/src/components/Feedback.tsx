/**
 * "How was your visit?", asked once the doctor has signed the Parcha.
 *
 * Stars first (one tap is enough), then a few words to tap and an optional
 * line. Sending it keeps it on the visit for the hospital to see; after that
 * the card shrinks to a thank-you with the stars given.
 */
import { errorMessage, rateVisit } from "@parcha/client";
import type { Visit } from "@parcha/core";
import { cn } from "@parcha/ui";
import { Loader2, Star } from "lucide-react";
import { useState } from "react";

import { useT } from "../i18n";

const TAGS: { id: string; label: [string, string, string]; good: boolean }[] = [
  { id: "explained_well", label: ["Doctor explained well", "डॉक्टर ने अच्छे से समझाया", "Doctor ne achhe se samjhaya"], good: true },
  { id: "short_wait", label: ["Short wait", "कम इंतज़ार", "Kam intezaar"], good: true },
  { id: "kind_staff", label: ["Kind staff", "स्टाफ़ अच्छा था", "Staff achha tha"], good: true },
  { id: "long_wait", label: ["Long wait", "लंबा इंतज़ार", "Lamba intezaar"], good: false },
  { id: "rushed", label: ["Felt rushed", "जल्दबाज़ी लगी", "Jaldbaazi lagi"], good: false },
  { id: "unclear", label: ["Medicines unclear", "दवा समझ नहीं आई", "Dawa samajh nahi aayi"], good: false },
];

export function Feedback({ visit }: { visit: Visit }) {
  const t = useT();
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(visit.feedback ?? null);

  if (sent) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-3">
        <span className="flex shrink-0" aria-label={t(`${sent.stars} of 5 stars`, `5 में से ${sent.stars}`, `5 mein se ${sent.stars}`)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} className={cn("size-5", n <= sent.stars ? "fill-[#f5a524]" : "fill-white")} aria-hidden />
          ))}
        </span>
        <p className="text-base font-bold">{t("Thank you for your feedback", "आपकी राय के लिए धन्यवाद", "Aapki raay ke liye dhanyavaad")}</p>
      </section>
    );
  }

  // Good words for a good visit, the others for a poor one; all of them in between.
  const shown = TAGS.filter((x) => stars === 0 || stars === 3 || x.good === stars > 3);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await rateVisit(visit.id, stars, tags, note.trim() || undefined);
      setSent({ stars, tags, note: note.trim() || null, at: new Date().toISOString() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-4 shadow-[0_3px_0_#232326]">
      <h2 className="text-xl leading-tight font-bold">{t("How was your visit?", "आपकी विज़िट कैसी रही?", "Aapki visit kaisi rahi?")}</h2>
      <div className="mt-2 flex justify-between" role="radiogroup" aria-label={t("Stars", "स्टार", "Star")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={t(`${n} of 5`, `5 में से ${n}`, `5 mein se ${n}`)}
            onClick={() => {
              setStars(n);
              setTags([]);
            }}
            className="flex size-14 items-center justify-center"
          >
            <Star className={cn("size-11 transition-transform", n <= stars ? "scale-110 fill-[#f5a524]" : "fill-white")} strokeWidth={2.2} aria-hidden />
          </button>
        ))}
      </div>

      {stars > 0 ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {shown.map((x) => {
              const on = tags.includes(x.id);
              return (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTags((all) => (on ? all.filter((y) => y !== x.id) : [...all, x.id]))}
                  className={cn("min-h-11 rounded-full border-[3px] border-[#232326] px-3 text-base font-bold", on ? "bg-[var(--brand)]" : "bg-white")}
                >
                  {t(...x.label)}
                </button>
              );
            })}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder={t("Anything else? (optional)", "कुछ और? (ज़रूरी नहीं)", "Kuch aur? (zaroori nahi)")}
            className="mt-3 w-full rounded-2xl border-2 border-[#232326] bg-white px-3 py-2 text-lg outline-none focus:border-[var(--brand)]"
          />
          {error ? (
            <p role="alert" className="text-destructive mt-2 text-base font-bold">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void send()}
            className="mt-3 flex min-h-14 w-full items-center justify-center rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-lg font-bold shadow-[0_4px_0_#232326] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-6 animate-spin" /> : t("Send", "भेजें", "Bhejein")}
          </button>
        </>
      ) : null}
    </section>
  );
}
