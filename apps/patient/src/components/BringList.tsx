import { setBringReady } from "@parcha/client";
import { BRING_ITEMS, type Visit } from "@parcha/core";
import { BringIcon, cn } from "@parcha/ui";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Heading } from "../kit";
import { useT } from "../i18n";

/**
 * "Please bring": what the hospital asked for, as pictures to tap.
 *
 * Each tile is one thing, drawn and named in two languages. Tapping it marks
 * it ready, and the hospital sees how many are ready, so the desk knows who is
 * coming prepared. It is a checklist, not a form: nothing here needs typing.
 */
export function BringList({ visit }: { visit: Visit }) {
  const t = useT();
  const asked = BRING_ITEMS.filter((i) => (visit.bring ?? []).includes(i.id));
  const [ready, setReady] = useState<string[]>(visit.bringReady ?? []);

  const inFlight = useRef(false);
  const latest = useRef<string[]>(visit.bringReady ?? []);

  // Follow the saved list if it changes elsewhere (the hospital edits the ask).
  const saved = (visit.bringReady ?? []).join(",");
  useEffect(() => {
    setReady(visit.bringReady ?? []);
    latest.current = visit.bringReady ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  // Saves go one at a time, and always finish on the latest state. Two saves in
  // flight at once reach the server in whatever order the network delivers them,
  // so a quick tick-untick-tick could end with the old answer winning.
  function toggle(id: string) {
    // Build on the latest answer, not the last render: two taps closer together
    // than a render must still add up.
    const base = latest.current;
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    setReady(next);
    latest.current = next;
    if (inFlight.current) return;
    inFlight.current = true;
    void (async () => {
      let sent: string[];
      do {
        sent = latest.current;
        try {
          await setBringReady(visit.id, sent);
        } catch {
          // A failed save puts the tiles back, so the screen never claims what
          // the hospital has not been told.
          setReady(visit.bringReady ?? []);
          latest.current = visit.bringReady ?? [];
          break;
        }
      } while (sent !== latest.current);
      inFlight.current = false;
    })();
  }

  return (
    <section>
      <Heading>{t("Please bring", "कृपया साथ लाएँ", "Please saath laayein")}</Heading>
      {asked.length > 0 ? (
        <>
          <ul className="grid grid-cols-2 gap-2.5 px-4">
            {asked.map((item) => {
              const on = ready.includes(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(item.id)}
                    className={cn(
                      "hover-orange relative flex h-full w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-[var(--brand-deep)] px-2 pt-4 pb-3 text-center",
                      on ? "bg-[var(--brand-soft)] shadow-[0_3px_0_var(--brand-deep)]" : "bg-card",
                    )}
                  >
                    {on ? (
                      <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-[var(--brand-deep)] text-white">
                        <Check className="size-4" strokeWidth={3} />
                      </span>
                    ) : null}
                    <BringIcon name={item.icon} className="size-9" />
                    <span className="text-lg leading-tight font-bold">{t(item.label, item.hindi, item.hinglish)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="px-5 pt-2.5 text-lg font-bold">
            {t(`${ready.length} of ${asked.length} ready`, `${asked.length} में से ${ready.length} तैयार`, `${asked.length} mein se ${ready.length} taiyar`)}
          </p>
        </>
      ) : null}
      {visit.bringNote ? (
        <p className="mx-4 mt-3 rounded-2xl border-2 border-[var(--brand-deep)] bg-[var(--morning-soft)] px-4 py-3 text-lg leading-snug font-bold">
          {visit.bringNote}
        </p>
      ) : null}
    </section>
  );
}
