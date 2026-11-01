/**
 * The history as the doctor sees it, after scanning the family's QR.
 *
 * Everything on this screen came out of the code itself — the part of the link
 * after the "#", which the browser never sent anywhere. Nothing is fetched,
 * nothing is saved, and signing in is not asked for: a doctor's camera opens
 * this and it reads.
 *
 * Provenance is on the page, not in a footnote. The conditions, allergies and
 * regular medicines are what the family wrote down. A medicine marked with a
 * tick came off a Parcha whose signature this family's phone checked; one
 * without was entered by hand from a bill or a photograph. A doctor reading
 * this should be able to tell those apart at a glance, which is why they are
 * labelled rather than merged into one list.
 */
import { readHistoryToken, rxName, type HistoryPayload } from "@parcha/core";
import { Screen } from "@parcha/ui";
import { AlertTriangle, BadgeCheck, Loader2, Pencil } from "lucide-react";
import { useEffect, useState } from "react";

import { dateIn, useLang, useT } from "../i18n";
import { Header } from "../kit";

function Facts({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section className="rounded-2xl border-[3px] border-[#232326] bg-card p-3.5">
      <p className="text-base font-bold">{title}</p>
      {items.length ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {items.map((v) => (
            <li key={v} className="rounded-full border-2 border-[#232326] px-2.5 py-0.5 text-base">
              {v}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-base">{empty}</p>
      )}
    </section>
  );
}

export function HistoryView() {
  const t = useT();
  const lang = useLang();
  const [state, setState] = useState<{ loading: boolean; payload: HistoryPayload | null }>({ loading: true, payload: null });

  useEffect(() => {
    const token = window.location.hash.replace(/^#/, "");
    if (!token) {
      setState({ loading: false, payload: null });
      return;
    }
    let live = true;
    void readHistoryToken(token).then((p) => live && setState({ loading: false, payload: p }));
    return () => {
      live = false;
    };
  }, []);

  if (state.loading) {
    return (
      <>
        <Header back="/" title={t("History", "इतिहास", "History")} />
        <Screen className="flex items-center justify-center">
          <Loader2 className="size-10 animate-spin" aria-hidden />
        </Screen>
      </>
    );
  }

  if (!state.payload) {
    return (
      <>
        <Header back="/" title={t("History", "इतिहास", "History")} />
        <Screen className="px-4 pt-4">
          <p className="text-lg">
            {t(
              "This code could not be read. Ask the family to show it again.",
              "यह कोड पढ़ा नहीं जा सका। परिवार से दोबारा दिखाने को कहें।",
              "Yeh code padha nahi ja saka. Family se dobara dikhane ko kahein.",
            )}
          </p>
        </Screen>
      </>
    );
  }

  return <HistoryPage payload={state.payload} />;
}

/**
 * The summary itself, however it arrived — scanned off a QR, or opened from a
 * fifteen-minute link. One page, so a doctor reads the same thing either way.
 */
export function HistoryPage({ payload }: { payload: HistoryPayload }) {
  const t = useT();
  const lang = useLang();
  const p = payload;
  const [name, age, sex] = p.p;

  return (
    <>
      <Header back="/" title={name} subtitle={[age != null ? t(`${age} years`, `${age} साल`, `${age} saal`) : null, sex, p.b].filter(Boolean).join(" · ")} />
      <Screen className="space-y-3 px-4 pb-5">
        <p className="rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-3 text-base">
          {t(
            "Shown from the family's own phone. It is their record, not a hospital's — read the labels on each medicine.",
            "परिवार के फ़ोन से दिखाया गया। यह उनका रिकॉर्ड है, किसी अस्पताल का नहीं — हर दवा का लेबल देखें।",
            "Family ke phone se dikhaya gaya. Yeh unka record hai, kisi hospital ka nahi — har dawa ka label dekhein.",
          )}
          {" "}
          {t(`Made ${dateIn(lang, p.t)}.`, `${dateIn(lang, p.t)} को बना।`, `${dateIn(lang, p.t)} ko bana.`)}
        </p>

        {p.note ? <p className="rounded-2xl border-[3px] border-[#232326] bg-card p-3.5 text-lg">{p.note}</p> : null}

        <Facts
          title={t("Allergies (said by the family)", "एलर्जी (परिवार के अनुसार)", "Allergy (family ke anusaar)")}
          items={p.a}
          empty={t("None written down.", "कुछ नहीं लिखा।", "Kuch nahi likha.")}
        />
        <Facts
          title={t("Long-term conditions", "पुरानी बीमारियाँ", "Purani bimariyan")}
          items={p.c}
          empty={t("None written down.", "कुछ नहीं लिखा।", "Kuch nahi likha.")}
        />
        <Facts
          title={t("Regular medicines (said by the family)", "रोज़ की दवाइयाँ (परिवार के अनुसार)", "Roz ki dawaiyan (family ke anusaar)")}
          items={p.r}
          empty={t("None written down.", "कुछ नहीं लिखा।", "Kuch nahi likha.")}
        />

        <section className="space-y-2">
          <p className="text-lg font-bold">{t("From their Parchas", "उनके पर्चों से", "Unke Parchon se")}</p>
          {p.m.length === 0 ? (
            <p className="text-base">{t("No Parchas on that phone.", "उस फ़ोन पर कोई पर्चा नहीं।", "Us phone par koi Parcha nahi.")}</p>
          ) : (
            <ul className="space-y-2">
              {p.m.map((m, i) => (
                <li key={i} className="rounded-2xl border-[3px] border-[#232326] bg-card p-3">
                  <p className="flex items-start gap-2 text-lg leading-tight font-bold">
                    {m.ok ? <BadgeCheck className="mt-0.5 size-5 shrink-0" aria-hidden /> : <Pencil className="mt-0.5 size-5 shrink-0" aria-hidden />}
                    {m.s || m.f ? rxName({ drugName: m.n, strength: m.s ?? "", form: m.f ?? "" }) : m.n}
                  </p>
                  <p className="text-base">
                    {[m.q, m.d ? t(`${m.d} days`, `${m.d} दिन`, `${m.d} din`) : null, m.by, m.on ? dateIn(lang, m.on) : null].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-0.5 text-sm">
                    {m.ok
                      ? t("From a signed Parcha, checked on their phone.", "साइन किए पर्चे से, उनके फ़ोन पर जाँचा गया।", "Sign kiye Parche se, unke phone par jaancha gaya.")
                      : t("Entered by the family from a bill or a photo.", "परिवार ने बिल या फ़ोटो से लिखा।", "Family ne bill ya photo se likha.")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          {t(
            "This is a summary a family carries, not a clinical record. Nothing here was fetched from a hospital.",
            "यह परिवार का रखा सार है, क्लिनिकल रिकॉर्ड नहीं। यहाँ कुछ भी किसी अस्पताल से नहीं लिया गया।",
            "Yeh family ka rakha summary hai, clinical record nahi. Yahan kuch bhi kisi hospital se nahi liya gaya.",
          )}
        </p>
      </Screen>
    </>
  );
}
