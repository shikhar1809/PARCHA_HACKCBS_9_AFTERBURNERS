/**
 * Adding a new Parcha (New Parcha on Home, or the button on the Parchas tab)
 * starts here: "Do you have a printed Parcha?"
 *
 * Yes: scan the code on it, and the medicines come in exactly as the doctor
 * wrote them. No: check the medicines from the bill and what the doctor said.
 * Either way the person ends with reminders. Anyone who just wants their
 * medicines or to ask for a visit goes straight to their home.
 */
import { Screen } from "@parcha/ui";
import { Camera, ChevronLeft, FileX2 } from "lucide-react";
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
        {t("The prescription the doctor printed for you.", "डॉक्टर का छपा हुआ पर्चा।", "Doctor ka chhapa hua parcha.")}
      </p>

      <button
        type="button"
        onClick={() => go("/add?printed=1")}
        className="flex min-h-28 w-full items-center gap-4 rounded-3xl border-[3px] border-[#232326] bg-[var(--brand-soft)] p-5 text-left shadow-[0_5px_0_#232326] active:translate-y-0.5"
      >
        <Camera className="size-12 shrink-0" strokeWidth={2} aria-hidden />
        <span>
          <span className="block text-2xl leading-tight font-bold">{t("Yes", "हाँ", "Haan")}</span>
          <span className="block text-lg">{t("Photograph it with the bill", "बिल के साथ फ़ोटो लें", "Bill ke saath photo lein")}</span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => go("/add")}
        className="flex min-h-28 w-full items-center gap-4 rounded-3xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-5 text-left shadow-[0_5px_0_#232326] active:translate-y-0.5"
      >
        <FileX2 className="size-12 shrink-0" strokeWidth={2} aria-hidden />
        <span>
          <span className="block text-2xl leading-tight font-bold">{t("No", "नहीं", "Nahi")}</span>
          <span className="block text-lg">{t("Handwritten, or no slip: the bill and what was said", "हाथ से लिखा या पर्चा नहीं: बिल और कही बात", "Haath se likha ya parcha nahi: bill aur kahi baat")}</span>
        </span>
      </button>

      <button type="button" onClick={() => { markAsked(); goBack(); }} className="mx-auto mt-auto flex min-h-12 items-center gap-2 text-lg font-bold underline">
        <ChevronLeft className="size-5" aria-hidden />
        {t("Not now", "अभी नहीं", "Abhi nahi")}
      </button>
    </Screen>
  );
}
