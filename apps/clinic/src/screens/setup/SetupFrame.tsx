import { Wordmark } from "@parcha/ui";
import type { ReactNode } from "react";

import { signOutOfClinic } from "../../auth";

/**
 * The frame for the first-run screens (clinic set-up, a person's profile): the
 * coral ground, one card, the wordmark, and a way out. Wide enough for a form,
 * and the card scrolls on a small screen.
 */
export function SetupFrame({ step, steps, children }: { step?: number; steps?: number; children: ReactNode }) {
  return (
    <div className="flex h-full w-full overflow-y-auto bg-[#ff7f5a] p-4 sm:p-8">
      <div className="bg-background m-auto w-full max-w-xl rounded-[2rem] border-[3px] border-[#232326] p-5 shadow-[8px_8px_0_#232326] sm:p-7">
        <div className="mb-5 flex items-center justify-between gap-3">
          <Wordmark />
          {steps ? (
            <ol aria-label={`Step ${step} of ${steps}`} className="flex gap-1.5">
              {Array.from({ length: steps }, (_, i) => (
                <li
                  key={i}
                  aria-hidden
                  className={`h-2.5 w-7 rounded-full border-2 border-[#232326] ${i < (step ?? 0) ? "bg-[#232326]" : "bg-white"}`}
                />
              ))}
            </ol>
          ) : null}
        </div>
        {children}
        <button type="button" onClick={() => void signOutOfClinic()} className="mt-6 block text-sm font-bold underline">
          Sign out
        </button>
      </div>
    </div>
  );
}
