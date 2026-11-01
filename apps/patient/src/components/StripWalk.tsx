/**
 * The strips, one medicine at a time: front, then back, then the next.
 *
 * This comes after every medicine has been checked and before the schedule is
 * locked, and it is the only time the person is asked. One medicine per screen
 * because a list of six camera boxes is where a strip gets photographed under
 * the wrong name, and that picture is what she will be shown at dose time.
 * Both sides are needed to go on: the front is how she knows it, the back is
 * where the name and expiry are printed.
 */
import { cn } from "@parcha/ui";
import { ChevronLeft, Lock } from "lucide-react";
import { useState } from "react";

import { useT } from "../i18n";
import { BigButton } from "../kit";
import { StripCapture, useStrip } from "./strips";

export function StripWalk({ medicines, onDone, finishLabel }: { medicines: { name: string; detail?: string }[]; onDone: () => void; finishLabel?: string }) {
  const t = useT();
  const [at, setAt] = useState(0);
  const current = medicines[at];
  const strip = useStrip(current?.name);
  // A sample drawing is not a photo of the strip in her hand, so it does not count.
  const both = !!strip?.front && !!strip?.back && !strip.sample;
  const last = at === medicines.length - 1;
  if (!current) return null;

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5" aria-hidden>
        {medicines.map((m, i) => (
          <span key={m.name} className={cn("h-2 flex-1 rounded-full border-2 border-[#232326]", i <= at ? "bg-[var(--brand)]" : "bg-white")} />
        ))}
      </div>
      <p className="text-base font-bold">
        {t(`Medicine ${at + 1} of ${medicines.length}`, `दवा ${at + 1} / ${medicines.length}`, `Dawai ${at + 1} / ${medicines.length}`)}
      </p>
      <div className="space-y-3 rounded-2xl border-[3px] border-[#232326] bg-card p-4">
        <div>
          <p className="text-2xl leading-tight font-bold">{current.name}</p>
          {current.detail ? <p className="text-lg">{current.detail}</p> : null}
        </div>
        <p className="text-lg leading-snug">
          {t(
            "Hold this strip up and take a photo of the front, then turn it over for the back.",
            "यही पत्ता लेकर आगे की फ़ोटो लें, फिर पलटकर पीछे की।",
            "Yahi patta lekar aage ki photo lein, phir palatkar peeche ki.",
          )}
        </p>
        {/* Keyed by medicine so the photo check of one strip never shows on the next. */}
        <StripCapture key={current.name} medicine={current.name} />
      </div>
      <BigButton disabled={!both} onClick={() => (last ? onDone() : setAt(at + 1))}>
        {last ? (
          <>
            <Lock className="size-6" aria-hidden /> {finishLabel ?? t("Next: lock my schedule", "आगे: समय लॉक करें", "Aage: schedule lock karein")}
          </>
        ) : (
          t("Next medicine", "अगली दवा", "Agli dawai")
        )}
      </BigButton>
      {!both ? (
        <p className="text-center text-base">{t("Both sides are needed.", "दोनों तरफ़ की फ़ोटो चाहिए।", "Dono taraf ki photo chahiye.")}</p>
      ) : null}
      {at > 0 ? (
        <button type="button" onClick={() => setAt(at - 1)} className="mx-auto flex min-h-11 items-center gap-1 text-lg font-bold underline">
          <ChevronLeft className="size-5" aria-hidden /> {t("Previous medicine", "पिछली दवा", "Pichhli dawai")}
        </button>
      ) : null}
    </div>
  );
}
