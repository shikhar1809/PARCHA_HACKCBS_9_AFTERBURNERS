import { errorMessage, linkVisitByCode } from "@parcha/client";
import { Screen } from "@parcha/ui";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useT } from "../i18n";
import { BigButton, Header } from "../kit";

/** Redeem the code printed on a slip, to add that visit to this handset. */
export function LinkCode() {
  const t = useT();
  const navigate = useNavigate();
  // A scanned QR arrives as /link?code=XXXX: the code is already filled in.
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get("code")?.toUpperCase().slice(0, 12) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { visitId } = await linkVisitByCode(code);
      navigate(`/visit/${visitId}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Header back="/" title={t("Add a visit", "विज़िट जोड़ें", "Visit jodein")} />
      <Screen className="space-y-5 px-5 pt-2">
        <p className="text-muted-foreground text-lg leading-relaxed">
          {t(
            "Type the code printed on your slip. It uses letters and numbers, but never 0, 1, O or I.",
            "अपनी पर्ची पर छपा कोड लिखें। इसमें अक्षर और अंक होते हैं, पर कभी 0, 1, O या I नहीं।",
            "Apni parchi par chhapa code likhein. Ismein letters aur numbers hote hain, par kabhi 0, 1, O ya I nahi.",
          )}
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label={t("Code from your slip", "पर्ची का कोड", "Parchi ka code")}
          className="bg-card h-20 w-full rounded-2xl border-2 border-[var(--color-input)] px-4 text-center text-3xl font-bold tracking-[0.18em] outline-none focus:border-[var(--brand)]"
        />
        <BigButton
          disabled={code.replace(/[^2-9A-Z]/gi, "").length < 6 || busy}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 className="size-6 animate-spin" /> : t("Add this visit", "यह विज़िट जोड़ें", "Yeh visit jodein")}
        </BigButton>
        {error ? (
          <p role="alert" className="text-destructive text-lg font-bold">
            {error}
          </p>
        ) : null}
      </Screen>
    </>
  );
}
