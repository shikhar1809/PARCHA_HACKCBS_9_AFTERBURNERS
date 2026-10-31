import type { Visit } from "@parcha/core";
import { cn } from "@parcha/ui";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import { dateIn, dayWordIn, slotIn, tr, useLang, type Lang } from "../i18n";
import { StageChip } from "../kit";
import { Avatar } from "./art";

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/** The one line that matters for this visit, by where it is. */
export function visitDetail(visit: Visit, lang: Lang): string {
  const hospital = visit.attempts?.[visit.attempts.length - 1]?.hospitalName;
  if (visit.stage === "scheduled" && visit.scheduledFor) {
    return `${slotIn(lang, visit.scheduledFor)}${hospital ? ` · ${hospital}` : ""}`;
  }
  if (visit.stage === "proposed" && visit.assignedDoctorName) {
    return tr(lang, `Asked ${visit.assignedDoctorName}`, `${visit.assignedDoctorName} से पूछा`, `${visit.assignedDoctorName} se poocha`);
  }
  if (visit.stage === "requested" && visit.preferredDate) {
    const day = dayWordIn(lang, visit.preferredDate);
    return `${hospital ?? ""} · ${tr(lang, `for ${day.toLowerCase()}`, `${day} के लिए`, `${day} ke liye`)}`;
  }
  // The doctor's finding belongs to the clinic's record, not to a card on a
  // phone: a visit is shown by what the patient came with.
  return visit.complaint ?? "";
}

/** A visit as a tappable row: who, when, what, and where it stands. */
export function VisitCard({ visit, featured }: { visit: Visit; featured?: boolean }) {
  const lang = useLang();
  const detail = visitDetail(visit, lang);
  return (
    <li>
      <Link
        to={`/visit/${visit.id}`}
        className={cn(
          "flex items-center gap-3 rounded-2xl border-[3px] border-[#232326] p-2.5",
          featured ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card shadow-[0_3px_0_#232326]",
        )}
      >
        <Avatar name={visit.patientName} sex={visit.patientSex} age={visit.patientAgeYears} size={46} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-lg leading-tight font-bold">{visit.patientName}</p>
          <p className="line-clamp-2 text-base leading-snug">
            {dateIn(lang, visit.registeredAt)}
            {detail ? ` · ${detail}` : ""}
          </p>
          <StageChip stage={visit.stage} since={visit.prescribedAt} />
        </div>
        <ChevronRight className="size-6 shrink-0" strokeWidth={2.6} />
      </Link>
    </li>
  );
}
