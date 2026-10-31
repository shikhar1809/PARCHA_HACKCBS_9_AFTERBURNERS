/**
 * Adding a new Parcha (New Parcha on Home, or the button on the Parchas tab)
 * starts here: "Do you have a printed Parcha?"
 *
 * Yes: scan the code on it, and the medicines come in exactly as the doctor
 * wrote them. No: check the medicines from the bill and what the doctor said
 * (the RapidRX way). Either way the person ends with reminders. Anyone who just
 * wants their medicines or to ask for a visit goes straight to their home.
 */
import { Screen } from "@parcha/ui";
import { ChevronLeft, FileX2, QrCode } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Logo } from "@parcha/ui";
import { useT } from "../i18n";
import { useGoBack } from "../kit";

const ASKED = "parcha.askedThisTime";

/** Whether the question was already asked since the app was opened. */
export const askedThisTime = () => {
  try {
    return sessionStorage.getItem(ASKED) === "1";
  } catch {
    return true;
  }
};
const markAsked = () => {
  try {
    sessionStorage.setItem(ASKED, "1");
  } catch {
    /* only this screen's memory */
  }
};

export function Start() {
  const t = useT();
  const navigate = useNavigate();
  const goBack = useGoBack("/");
  const go = (to: string) => {
    markAsked();
    navigate(to, { replace: true });
  };
  return (
    <Screen className="flex flex-1 flex-col gap-5 px-5 pt-8 pb-8">
      <Logo className="mx-auto size-20" />
      <h1 className="text-center text-3xl leading-tight font-bold text-balance">
        {t("Do you have a printed Parcha?", "क्या आपके पास छपा हुआ पर्चा है?", "Kya aapke paas chhapa hua Parcha hai?")}
      </h1>
      <p className="text-center text-lg leading-snug">
        {t("The printed prescription from a Parcha hospital, with a square code on it.", "पर्चा अस्पताल का छपा पर्चा, जिस पर चौकोर कोड बना हो।", "Parcha hospital ka chhapa parcha, jis par chaukor code bana ho.")}
      </p>

      <button
        type="button"
        onClick={() => go("/scan")}
        className="flex min-h-28 w-full items-center gap-4 rounded-3xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-5 text-left shadow-[0_5px_0_#232326] active:translate-y-0.5"
      >
        <QrCode className="size-12 shrink-0" strokeWidth={2} aria-hidden />
        <span>
          <span className="block text-2xl leading-tight font-bold">{t("Yes", "हाँ", "Haan")}</span>
          <span className="block text-lg">{t("Scan the code to get my reminders", "कोड स्कैन करके रिमाइंडर पाएँ", "Code scan karke reminder paayein")}</span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => go("/check")}
        className="flex min-h-28 w-full items-center gap-4 rounded-3xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-5 text-left shadow-[0_5px_0_#232326] active:translate-y-0.5"
      >
        <FileX2 className="size-12 shrink-0" strokeWidth={2} aria-hidden />
        <span>
          <span className="block text-2xl leading-tight font-bold">{t("No", "नहीं", "Nahi")}</span>
          <span className="block text-lg">{t("Check my medicines from the bill", "बिल से अपनी दवाइयाँ जाँचें", "Bill se apni dawaiyan jaanchein")}</span>
        </span>
      </button>

      <button type="button" onClick={() => { markAsked(); goBack(); }} className="mx-auto mt-auto flex min-h-12 items-center gap-2 text-lg font-bold underline">
        <ChevronLeft className="size-5" aria-hidden />
        {t("Not now", "अभी नहीं", "Abhi nahi")}
      </button>
    </Screen>
  );
}
