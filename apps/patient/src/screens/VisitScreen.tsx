import { useHospitals, useVisit } from "@parcha/client";
import { Screen } from "@parcha/ui";
import { BadgeCheck, QrCode } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Avatar, PillsArt } from "../components/art";
import { Feedback } from "../components/Feedback";
import { useSavedParcha } from "../components/parchas";
import { dateIn, useLang, useT } from "../i18n";
import { Header, StageChip } from "../kit";
import { Upcoming } from "./Upcoming";

/** Stages before the patient has been in (and a request that was called off). */
const BEFORE_ARRIVAL = new Set(["requested", "proposed", "scheduled"]);

/**
 * One visit, kept short: where it stands, why they came, and — once the doctor
 * has signed — how it went and whether the Parcha has been added.
 *
 * What it deliberately does not do is show the prescription from the clinic's
 * database. The medicines live on the printed slip and reach this phone only
 * when somebody scans the QR on it, exactly once, as the signed document. Two
 * reasons, and the second is the one that matters: a copy can drift from the
 * paper the chemist is reading, and a clinic's record should not be sitting on
 * a handset that nobody at the clinic controls. So the visit here is the
 * appointment, and the Parcha is the paper.
 */
export function VisitScreen() {
  const t = useT();
  const lang = useLang();
  const { visitId = null } = useParams();
  const visit = useVisit(visitId);
  const hospitals = useHospitals();

  const v = visit.data;
  // The Parcha for this visit, if it was added from the paper. Kept on this
  // phone, never fetched.
  const saved = useSavedParcha(v?.visitCode ?? null);

  return (
    <>
      <Header back="/visits" title={v?.patientName ?? t("Visit", "विज़िट", "Visit")} subtitle={v ? dateIn(lang, v.registeredAt) : undefined} />
      <Screen className="pb-6">
        {visit.error ? (
          <p role="alert" className="text-destructive px-5 py-4 text-base">
            {t("You cannot open this visit.", "यह विज़िट नहीं खुल सकती।", "Yeh visit nahi khul sakti.")} {visit.error}
          </p>
        ) : !v ? (
          <div className="space-y-3 px-4" role="status" aria-label={t("Loading", "खुल रहा है", "Khul raha hai")}>
            <div className="skeleton h-20 rounded-2xl border-[3px] border-[#232326]" />
            <div className="skeleton h-40 rounded-2xl border-[3px] border-[#232326]" />
          </div>
        ) : BEFORE_ARRIVAL.has(v.stage) || (v.stage === "cancelled" && v.source === "pre_visit") ? (
          <Upcoming visit={v} />
        ) : (
          <div className="stagger space-y-3 px-4">
            <div className="flex items-center gap-3">
              <Avatar name={v.patientName} sex={v.patientSex} age={v.patientAgeYears} size={44} />
              <StageChip stage={v.stage} since={v.prescribedAt} />
            </div>

            {/* The consultation is over: ask how it went, while it is fresh. */}
            {v.stage === "prescribed" ? <Feedback visit={v} /> : null}

            {v.complaint ? (
              <section className="rounded-2xl border-[3px] border-[#232326] bg-card p-3 shadow-[0_3px_0_#232326]">
                <p className="line-clamp-3 text-base leading-snug">
                  {t("Why you came:", "आप क्यों आए:", "Aap kyun aaye:")} {v.complaint}
                </p>
              </section>
            ) : null}

            {v.stage !== "prescribed" ? (
              <div className="pop flex flex-col items-center rounded-2xl border-[3px] border-dashed border-[#232326] px-5 py-5 text-center">
                <PillsArt size={96} />
                <p className="text-lg font-bold">{t("Not finished yet", "अभी पूरा नहीं हुआ", "Abhi poora nahi hua")}</p>
                <p className="mt-0.5 text-base leading-snug">
                  {t(
                    "The doctor will hand you a printed Parcha at the end. You can add it here then.",
                    "अंत में डॉक्टर आपको छपा हुआ पर्चा देंगे। तब उसे यहाँ जोड़ सकते हैं।",
                    "Ant mein doctor aapko chhapa hua Parcha denge. Tab use yahan jod sakte hain.",
                  )}
                </p>
              </div>
            ) : saved.loading ? (
              <div className="skeleton h-28 rounded-2xl border-[3px] border-[#232326]" role="status" aria-label={t("Loading", "खुल रहा है", "Khul raha hai")} />
            ) : saved.parcha ? (
              <Link
                to="/records"
                className="hover-orange flex items-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-3.5 shadow-[0_3px_0_#232326]"
              >
                <BadgeCheck className="size-8 shrink-0" strokeWidth={2.2} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-lg leading-tight font-bold">
                    {t("Your Parcha is on this phone", "आपका पर्चा इस फ़ोन में है", "Aapka Parcha is phone mein hai")}
                  </span>
                  <span className="block text-base leading-snug">
                    {t(
                      "Added from the slip, signature checked. Open your Parchas to read it.",
                      "पर्चे से लिया गया, साइन जाँचा गया। पढ़ने के लिए अपने पर्चे खोलें।",
                      "Parche se liya gaya, sign jaancha gaya. Padhne ke liye apne Parche kholein.",
                    )}
                  </span>
                </span>
              </Link>
            ) : (
              <Link
                to="/scan"
                className="flex items-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-white p-3.5 shadow-[0_3px_0_#232326]"
              >
                <QrCode className="size-8 shrink-0" strokeWidth={2.2} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-lg leading-tight font-bold">
                    {t("Add your Parcha", "अपना पर्चा जोड़ें", "Apna Parcha jodein")}
                  </span>
                  <span className="block text-base leading-snug">
                    {t(
                      "Scan the square code on the printed slip. The medicines, their times and the doctor's signature all come from the paper itself.",
                      "छपे पर्चे पर बना चौकोर कोड स्कैन कीजिए। दवाइयाँ, उनका समय और डॉक्टर का साइन, सब पर्चे से ही आते हैं।",
                      "Chhape parche par bana chaukor code scan kijiye. Dawaiyan, unka time aur doctor ka sign, sab parche se hi aate hain.",
                    )}
                  </span>
                </span>
              </Link>
            )}
          </div>
        )}
      </Screen>
    </>
  );
}
