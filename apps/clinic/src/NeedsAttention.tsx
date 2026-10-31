import { dismissQueued, useOutbox } from "@parcha/client";
import { TriangleAlert } from "lucide-react";

const WHAT: Record<string, string> = {
  registerPatient: "Registering a patient",
  startVisit: "Starting a visit",
  saveIntake: "Saving vitals and sending to the doctor",
  startConsultation: "Starting the consultation",
  signPrescription: "Signing a prescription",
};

/**
 * Actions made with no connection that the server refused once they arrived (the
 * patient had already moved on, a new safety warning appeared). They are kept,
 * with the server's own words, until somebody has read them.
 */
export function NeedsAttention() {
  const failed = useOutbox().filter((i) => i.status === "failed");
  if (failed.length === 0) return null;
  return (
    <div role="alert" className="fixed inset-x-0 bottom-0 z-[75] border-t-[3px] border-[#232326] bg-[oklch(0.88_0.1_25)] p-3">
      <p className="flex items-center gap-2 text-base font-bold">
        <TriangleAlert className="size-5" aria-hidden /> {failed.length} saved action{failed.length === 1 ? "" : "s"} could not be sent
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {failed.map((f) => (
          <li key={f.id} className="flex items-start justify-between gap-3 rounded-lg border-2 border-[#232326] bg-white p-2 text-sm">
            <span>
              <b>{WHAT[f.name] ?? f.name}.</b> {f.error}
            </span>
            <button
              type="button"
              onClick={() => void dismissQueued(f.id)}
              className="shrink-0 rounded-md border-2 border-[#232326] px-2 py-1 font-bold"
            >
              Understood
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
