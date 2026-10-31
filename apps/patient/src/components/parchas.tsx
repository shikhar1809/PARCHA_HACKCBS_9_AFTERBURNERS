/**
 * Every Parcha a person has, newest first, and the way to add a new one.
 *
 * Everything in this list is on this phone. A consultation at a Parcha
 * hospital shows as the visit it was — who saw them, where, when — because
 * that much the phone knows from its own appointment; what the doctor
 * prescribed is not here until the family adds it from the paper, and the row
 * says so and offers to. The rest are slips scanned from their QR (signature
 * checked here), photographs of slips that would not scan, and medicines
 * checked from a pharmacy bill when there was no Parcha at all.
 */
import { vaultGet, vaultKeys } from "@parcha/client";
import { rxName, type RxPayload, type Visit } from "@parcha/core";
import { BadgeCheck, ChevronRight, FilePlus2, Hospital, Image as ImageIcon, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { dateIn, useLang, useT } from "../i18n";

type Scanned = { payload: RxPayload; person: string; savedAt: string; photo?: string | null };
type Checked = { person: string; medicines: { name: string; frequency: string }[]; savedAt: string };
/** A Parcha whose code would not read, kept as the picture it is. */
type Snap = { person: string; photo: string; savedAt: string };
type Row =
  | { kind: "hospital"; at: string; visit: Visit }
  | { kind: "scanned"; at: string; slip: Scanned }
  | { kind: "photo"; at: string; snap: Snap }
  | { kind: "checked"; at: string; list: Checked };

/**
 * The Parcha kept on this phone for one visit, found by the code printed on
 * the slip. Nothing is fetched: either the family added it from the paper or
 * the phone does not have it, which is the whole arrangement.
 */
export function useSavedParcha(visitCode: string | null): { loading: boolean; parcha: Scanned | null } {
  const [state, setState] = useState<{ loading: boolean; parcha: Scanned | null }>({ loading: true, parcha: null });
  useEffect(() => {
    let live = true;
    if (!visitCode) {
      setState({ loading: false, parcha: null });
      return;
    }
    setState({ loading: true, parcha: null });
    void vaultGet<Scanned>(`parcha:${visitCode}`).then((s) => live && setState({ loading: false, parcha: s ?? null }));
    return () => {
      live = false;
    };
  }, [visitCode]);
  return state;
}

/** What is kept on this phone for one person. */
function useKept(person: string) {
  const [kept, setKept] = useState<Row[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      const keys = [...(await vaultKeys("parcha:")), ...(await vaultKeys("slip:")), ...(await vaultKeys("check:"))];
      const rows: Row[] = [];
      for (const k of keys) {
        if (k.startsWith("parcha:")) {
          const s = await vaultGet<Scanned>(k);
          if (s?.person === person) rows.push({ kind: "scanned", at: s.savedAt, slip: s });
        } else if (k.startsWith("slip:")) {
          const s = await vaultGet<Snap>(k);
          if (s?.person === person) rows.push({ kind: "photo", at: s.savedAt, snap: s });
        } else {
          const c = await vaultGet<Checked>(k);
          if (c?.person === person) rows.push({ kind: "checked", at: c.savedAt, list: c });
        }
      }
      if (live) setKept(rows);
    })();
    return () => {
      live = false;
    };
  }, [person]);
  return kept;
}

export function ParchaList({ person, visits }: { person: string; visits: Visit[] }) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const kept = useKept(person);
  const rows: Row[] = [
    ...visits.filter((v) => v.stage === "prescribed").map((v) => ({ kind: "hospital" as const, at: v.prescribedAt ?? v.registeredAt ?? "", visit: v })),
    ...kept,
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => navigate("/start")}
        className="flex min-h-20 w-full items-center gap-4 rounded-3xl border-[3px] border-[#232326] bg-[var(--brand)] p-4 text-left shadow-[0_4px_0_#232326] active:translate-y-0.5"
      >
        <FilePlus2 className="size-10 shrink-0" strokeWidth={2.2} aria-hidden />
        <span>
          <span className="block text-2xl leading-tight font-bold">{t("Add a new Parcha", "नया पर्चा जोड़ें", "Naya Parcha jodein")}</span>
          <span className="block text-base">{t("Scan it, or check the medicines from the bill", "स्कैन करें, या बिल से दवा जाँचें", "Scan karein, ya bill se dawa jaanchein")}</span>
        </span>
      </button>

      {rows.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-[var(--color-input)] p-5 text-lg leading-relaxed">
          {t("No Parchas yet. Add the one from your last visit.", "अभी कोई पर्चा नहीं। अपनी पिछली विज़िट का पर्चा जोड़ें।", "Abhi koi Parcha nahi. Apni pichhli visit ka Parcha jodein.")}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r, i) => {
            const when = r.at ? dateIn(lang, r.at) : "";
            if (r.kind === "hospital") {
              const v = r.visit;
              return (
                <li key={`h${v.id}`}>
                  <Link to={`/visit/${v.id}`} className="hover-orange flex items-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-card p-3.5">
                    <Hospital className="size-8 shrink-0" strokeWidth={2.2} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg leading-tight font-bold">
                        {t("Seen by the doctor", "डॉक्टर ने देखा", "Doctor ne dekha")}
                      </span>
                      <span className="block text-base">{[v.assignedDoctorName, when].filter(Boolean).join(" · ")}</span>
                    </span>
                    <ChevronRight className="size-6 shrink-0" aria-hidden />
                  </Link>
                </li>
              );
            }
            if (r.kind === "photo") {
              return (
                <li key={`p${i}`} className="space-y-2 rounded-2xl border-[3px] border-[#232326] bg-card p-3.5">
                  <p className="flex items-center gap-2 text-lg leading-tight font-bold">
                    <ImageIcon className="size-6 shrink-0" aria-hidden />
                    {t("A photo of a Parcha", "पर्चे की फ़ोटो", "Parche ki photo")}
                  </p>
                  <p className="text-base">{when}</p>
                  <img src={r.snap.photo} alt="" className="w-full rounded-xl border-2 border-[#232326] object-contain" />
                </li>
              );
            }
            if (r.kind === "scanned") {
              const p = r.slip.payload;
              return (
                <li key={`s${i}`} className="rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-3.5">
                  <p className="flex items-center gap-2 text-lg leading-tight font-bold">
                    <BadgeCheck className="size-6 shrink-0" aria-hidden />
                    {p.x ?? t("Scanned Parcha", "स्कैन किया पर्चा", "Scan kiya Parcha")}
                  </p>
                  <p className="text-base">
                    {p.h} · {p.d[0]} · {when}
                  </p>
                  <p className="mt-1 text-base font-bold">{p.m.map(([name, strength, form]) => rxName({ drugName: name, strength, form })).join(", ")}</p>
                </li>
              );
            }
            return (
              <li key={`c${i}`} className="rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-3.5">
                <p className="flex items-center gap-2 text-lg leading-tight font-bold">
                  <ReceiptText className="size-6 shrink-0" aria-hidden />
                  {t("Checked from the bill", "बिल से जाँचा", "Bill se jaancha")}
                </p>
                <p className="text-base">{when}</p>
                <p className="mt-1 text-base font-bold">{r.list.medicines.map((m) => m.name).join(", ")}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
