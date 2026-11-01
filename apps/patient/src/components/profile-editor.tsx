import { deleteProfile, errorMessage, saveProfile } from "@parcha/client";
import { NO_ACCESS, type PersonAccess } from "@parcha/core";
import { AVATAR_PALETTE, HAIR_STYLES, HEADWEAR, type AvatarLook, type HairStyle, type Headwear } from "@parcha/core";
import { Check, Dices, KeyRound, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { BG, Face, HAIR, SHIRT, SKIN, resolveLook } from "./art";
import { CallNumber } from "./call-number";
import { hasPin, PinPad, setPin } from "./pin";
import type { Person } from "./people";
import { Sheet } from "./records";
import { useT, type T } from "../i18n";

const STYLE_WORDS: Record<HairStyle, [string, string, string]> = {
  short: ["Short", "छोटे", "Chhote"],
  long: ["Long", "लंबे", "Lambe"],
  bun: ["Bun", "जूड़ा", "Jooda"],
  ponytail: ["Ponytail", "चोटी", "Choti"],
  curly: ["Curly", "घुँघराले", "Ghunghrale"],
  bald: ["None", "नहीं", "Nahi"],
};
const COVER_WORDS: Record<Headwear, [string, string, string]> = {
  none: ["None", "कुछ नहीं", "Kuch nahi"],
  turban: ["Turban", "पगड़ी", "Pagdi"],
  cap: ["Cap", "टोपी", "Topi"],
  dupatta: ["Dupatta", "दुपट्टा", "Dupatta"],
};
const words = <K extends string>(t: T, m: Record<K, [string, string, string]>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, t(...(v as [string, string, string]))])) as Record<K, string>;

const field =
  "min-h-12 w-full rounded-xl border-[3px] border-[#232326] bg-card px-3 text-base outline-none focus:bg-[var(--hover-soft)]";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-base font-bold">{title}</p>
      {children}
    </div>
  );
}

/** A row of colour dots; the chosen one is ringed and ticked. */
function Swatches({ colours, value, onPick, label }: { colours: readonly string[]; value: string; onPick: (i: number) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {colours.map((c, i) => {
        const on = c === value;
        return (
          <button
            key={c}
            type="button"
            aria-label={`${label} ${i + 1}`}
            aria-pressed={on}
            onClick={() => onPick(i)}
            style={{ background: c }}
            className={`flex size-11 items-center justify-center rounded-full border-[3px] border-[#232326] ${on ? "shadow-[0_0_0_3px_#fff,0_0_0_6px_#232326]" : ""}`}
          >
            {on ? <Check className="size-5 text-[#232326]" strokeWidth={3.5} aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

function Chips<T extends string>({ options, value, labels, onPick }: { options: readonly T[]; value: T; labels: Record<T, string>; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onPick(o)}
          className={`min-h-11 rounded-full border-[3px] border-[#232326] px-3.5 py-1.5 text-base font-bold ${value === o ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card"}`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`flex min-h-12 items-center gap-2 rounded-full border-[3px] border-[#232326] px-3.5 text-base font-bold ${on ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card"}`}
    >
      {on ? <Check className="size-4" strokeWidth={3.4} aria-hidden /> : null}
      {label}
    </button>
  );
}

const rand = (n: number) => Math.floor(Math.random() * n);

/**
 * Make or change a person: draw their face, say how old they are, what to call
 * them, and whether they need somebody to help with the phone. Someone a
 * hospital has registered keeps their registered name; the rest is the
 * family's to change.
 */
const ACCESS_SWITCHES: { key: keyof PersonAccess; label: [string, string, string]; detail: [string, string, string] }[] = [
  {
    key: "lowVision",
    label: ["Cannot see well", "ठीक से नहीं दिखता", "Theek se nahi dikhta"],
    detail: ["Reads medicines and reminders aloud, and makes the text larger.", "दवा और रिमाइंडर बोलकर सुनाता है, और अक्षर बड़े करता है।", "Dawai aur reminders bolkar sunata hai, aur letters bade karta hai."],
  },
  {
    key: "deaf",
    label: ["Cannot hear", "सुनाई नहीं देता", "Sunai nahi deta"],
    detail: ["Reminders flash and vibrate instead of ringing. No reminder calls.", "रिमाइंडर बजने की जगह चमकते और काँपते हैं। कोई कॉल नहीं।", "Reminders bajne ki jagah chamakte aur vibrate karte hain. Koi call nahi."],
  },
  { key: "largeText", label: ["Larger text", "बड़े अक्षर", "Bade letters"], detail: ["Everything one size bigger.", "सब कुछ एक नाप बड़ा।", "Sab kuch ek size bada."] },
  {
    key: "highContrast",
    label: ["High contrast", "गहरा रंग", "High contrast"],
    detail: ["Black on white, for screens that are hard to read.", "सफ़ेद पर काला, ताकि पढ़ना आसान हो।", "Safed par kaala, taaki padhna aasaan ho."],
  },
];

export function ProfileEditor({ person, onClose }: { person?: Person; onClose: () => void }) {
  const t = useT();
  const editing = !!person;
  const [name, setName] = useState(person?.name ?? "");
  const [nickname, setNickname] = useState(person?.nickname ?? "");
  const [age, setAge] = useState<string>(person?.ageYears != null ? String(person.ageYears) : "");
  const [sex, setSex] = useState<string | null>(person?.sex ?? null);
  const [look, setLook] = useState<AvatarLook>(person?.look ?? {});
  const [needsHelp, setNeedsHelp] = useState(person?.needsHelp ?? false);
  const [access, setAccess] = useState<PersonAccess>(person?.access ?? NO_ACCESS);
  const [helperName, setHelperName] = useState(person?.helperName ?? "");
  const [helperNumber, setHelperNumber] = useState(person?.helperNumber ?? "");
  const [pinStep, setPinStep] = useState<null | "enter" | "again">(null);
  const [pinFirst, setPinFirst] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSet, setPinSet] = useState(hasPin());
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ageNum = age === "" ? null : Number(age);
  const resolved = resolveLook(name || "New person", sex, ageNum, look);
  const set = (patch: AvatarLook) => setLook((l) => ({ ...l, ...patch }));
  const valid = name.trim().length > 0 && (ageNum === null || (Number.isInteger(ageNum) && ageNum >= 0 && ageNum <= 120));

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await saveProfile({
        name: name.trim(),
        nickname: nickname.trim() || null,
        ageYears: ageNum,
        sex,
        look,
        needsHelp,
        helperName: needsHelp ? helperName.trim() || null : null,
        helperNumber: needsHelp ? helperNumber.replace(/\D/g, "").slice(-10) || null : null,
        access,
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  async function remove() {
    if (!person) return;
    setBusy("remove");
    setError(null);
    try {
      await deleteProfile(person.name);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <Sheet title={editing ? person.shown : t("Add a family member", "परिवार का सदस्य जोड़ें", "Family member jodein")} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-2">
          <div className="pop rounded-full" key={JSON.stringify(look) + sex + ageNum}>
            <Face look={resolved} size={132} label={t("Preview", "झलक", "Preview")} />
          </div>
          <button
            type="button"
            onClick={() =>
              setLook({
                skin: rand(AVATAR_PALETTE.skin),
                hairColor: rand(AVATAR_PALETTE.hairColor),
                shirt: rand(AVATAR_PALETTE.shirt),
                bg: rand(AVATAR_PALETTE.bg),
                hairStyle: HAIR_STYLES[rand(HAIR_STYLES.length)],
                headwear: Math.random() < 0.25 ? HEADWEAR[1 + rand(HEADWEAR.length - 1)] : "none",
                glasses: Math.random() < 0.3,
                beard: sex !== "female" && Math.random() < 0.3,
                bindi: sex === "female" && Math.random() < 0.4,
              })
            }
            className="flex min-h-12 items-center gap-2 rounded-full border-[3px] border-[#232326] bg-card px-4 text-base font-bold"
          >
            <Dices className="size-4" aria-hidden /> {t("Surprise me", "कुछ भी बना दो", "Kuch bhi bana do")}
          </button>
        </div>

        {!editing ? (
          <label className="block">
            <span className="mb-1 block text-base font-bold">{t("Name", "नाम", "Naam")}</span>
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("Full name", "पूरा नाम", "Poora naam")} className={field} />
          </label>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-base font-bold">{t("What do you call them?", "आप उन्हें क्या बुलाते हैं?", "Aap unhe kya bulate hain?")}</span>
          <input value={nickname} maxLength={30} onChange={(e) => setNickname(e.target.value)} placeholder="Dadi, Papa, Chhotu…" className={field} />
        </label>

        <Group title={t("Age", "उम्र", "Umar")}>
          <div className="flex items-center gap-2">
            <button type="button" aria-label={t("Younger", "कम", "Kam")} onClick={() => setAge(String(Math.max(0, (ageNum ?? 30) - 1)))} className="flex size-12 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-card">
              <Minus className="size-5" aria-hidden />
            </button>
            <input
              value={age}
              inputMode="numeric"
              aria-label={t("Age in years", "उम्र (साल)", "Umar (saal)")}
              onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
              placeholder={t("Years", "साल", "Saal")}
              className={`${field} text-center text-xl font-bold`}
            />
            <button type="button" aria-label={t("Older", "ज़्यादा", "Zyada")} onClick={() => setAge(String(Math.min(120, (ageNum ?? 29) + 1)))} className="flex size-12 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-card">
              <Plus className="size-5" aria-hidden />
            </button>
          </div>
        </Group>

        <Group title={t("Man, woman or other", "आदमी, औरत या अन्य", "Aadmi, aurat ya aur")}>
          <div className="grid grid-cols-3 gap-2">
            {([["female", t("Woman", "औरत", "Aurat")], ["male", t("Man", "आदमी", "Aadmi")], ["other", t("Other", "अन्य", "Aur")]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={sex === v}
                onClick={() => setSex(sex === v ? null : v)}
                className={`min-h-12 rounded-xl border-[3px] border-[#232326] text-base font-bold ${sex === v ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Group>

        {/* The details of the picture are one tap away, not all on screen at once. */}
        <details className="group rounded-2xl border-[3px] border-[#232326] bg-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 text-base font-bold">
            {t("Change the picture", "तस्वीर बदलें", "Tasveer badlein")}
            <span aria-hidden className="text-sm font-normal group-open:hidden">{t("Skin, hair, clothes…", "रंग, बाल, कपड़े…", "Rang, baal, kapde…")}</span>
          </summary>
          <div className="space-y-4 border-t-[3px] border-[#232326] p-3">
        <Group title={t("Skin", "रंग", "Rang")}>
          <Swatches colours={SKIN} value={resolved.skin} onPick={(i) => set({ skin: i })} label={t("Skin", "रंग", "Rang")} />
        </Group>
        <Group title={t("Hair", "बाल", "Baal")}>
          <Chips options={HAIR_STYLES} value={resolved.hairStyle} labels={words(t, STYLE_WORDS)} onPick={(v) => set({ hairStyle: v })} />
          <div className="mt-2.5">
            <Swatches colours={HAIR} value={resolved.hair} onPick={(i) => set({ hairColor: i })} label={t("Hair colour", "बालों का रंग", "Baalon ka rang")} />
          </div>
        </Group>
        <Group title={t("Head covering", "सिर पर", "Sir par")}>
          <Chips options={HEADWEAR} value={resolved.headwear} labels={words(t, COVER_WORDS)} onPick={(v) => set({ headwear: v })} />
        </Group>
        <Group title={t("Extras", "और", "Aur")}>
          <div className="flex flex-wrap gap-2">
            <Toggle on={resolved.glasses} onChange={(v) => set({ glasses: v })} label={t("Glasses", "चश्मा", "Chashma")} />
            <Toggle on={resolved.beard} onChange={(v) => set({ beard: v })} label={t("Beard", "दाढ़ी", "Daadhi")} />
            <Toggle on={resolved.bindi} onChange={(v) => set({ bindi: v })} label={t("Bindi", "बिंदी", "Bindi")} />
          </div>
        </Group>
        <Group title={t("Clothes", "कपड़े", "Kapde")}>
          <Swatches colours={SHIRT} value={resolved.shirt} onPick={(i) => set({ shirt: i })} label={t("Clothes", "कपड़े", "Kapde")} />
        </Group>
        <Group title={t("Background", "पीछे का रंग", "Peeche ka rang")}>
          <Swatches colours={BG} value={resolved.bg} onPick={(i) => set({ bg: i })} label={t("Background", "पीछे का रंग", "Peeche ka rang")} />
        </Group>
          </div>
        </details>

        <div className="rounded-2xl border-[3px] border-[#232326] bg-card p-3">
          <p className="text-base leading-tight font-bold">{t("Seeing and hearing", "देखना और सुनना", "Dekhna aur sunna")}</p>
          <p className="text-base leading-snug">{t("Changes the app for this person only.", "सिर्फ़ इस व्यक्ति के लिए ऐप बदलता है।", "Sirf is insaan ke liye app badalta hai.")}</p>
          <div className="mt-2 divide-y-2 divide-[#232326]/15">
            {ACCESS_SWITCHES.map((a) => (
              <div key={a.key} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-base leading-tight font-bold">{t(...a.label)}</p>
                  <p className="text-base leading-snug">{t(...a.detail)}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={access[a.key]}
                  aria-label={t(...a.label)}
                  onClick={() => setAccess((v) => ({ ...v, [a.key]: !v[a.key] }))}
                  className={`relative h-8 w-14 shrink-0 rounded-full border-[3px] border-[#232326] ${access[a.key] ? "bg-[var(--brand)]" : "bg-white"}`}
                >
                  <span className="absolute top-0.5 size-5 rounded-full border-2 border-[#232326] bg-white" style={{ left: access[a.key] ? "1.6rem" : "0.15rem", transition: "left 200ms var(--ease-spring)" }} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border-[3px] border-[#232326] bg-card p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-base leading-tight font-bold">{t("Needs help with the phone", "फ़ोन चलाने में मदद चाहिए", "Phone chalane mein madad chahiye")}</p>
              <p className="text-base leading-snug">{t("Shows one big, simple screen with the medicines to take, and keeps settings out of reach.", "लेने वाली दवाओं की एक बड़ी, आसान स्क्रीन दिखाता है, और सेटिंग दूर रखता है।", "Lene wali dawaiyon ki ek badi, aasaan screen dikhata hai, aur settings door rakhta hai.")}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={needsHelp}
              aria-label={t("Needs help with the phone", "फ़ोन चलाने में मदद चाहिए", "Phone chalane mein madad chahiye")}
              onClick={() => setNeedsHelp((v) => !v)}
              className={`relative h-8 w-14 shrink-0 rounded-full border-[3px] border-[#232326] ${needsHelp ? "bg-[var(--brand)]" : "bg-white"}`}
            >
              <span className="absolute top-0.5 size-5 rounded-full border-2 border-[#232326] bg-white" style={{ left: needsHelp ? "1.6rem" : "0.15rem", transition: "left 200ms var(--ease-spring)" }} />
            </button>
          </div>
          {needsHelp ? (
            <div className="pop mt-3 space-y-2">
              <input value={helperName} maxLength={40} onChange={(e) => setHelperName(e.target.value)} placeholder={t("Who helps? (Beta, Didi…)", "कौन मदद करता है? (बेटा, दीदी…)", "Kaun madad karta hai? (Beta, Didi…)")} aria-label={t("Helper's name", "मददगार का नाम", "Helper ka naam")} className={field} />
              <input value={helperNumber} inputMode="tel" onChange={(e) => setHelperNumber(e.target.value)} placeholder={t("Their phone number", "उनका फ़ोन नंबर", "Unka phone number")} aria-label={t("Helper's phone number", "मददगार का फ़ोन नंबर", "Helper ka phone number")} className={field} />
              <p className="text-sm">{t("Shown as a Call button on the simple screen.", "आसान स्क्रीन पर कॉल बटन बनकर दिखेगा।", "Simple screen par call button bankar dikhega.")}</p>
              {pinStep ? (
                <div className="rounded-2xl border-[3px] border-[#232326] bg-white p-3">
                  <PinPad
                    title={pinStep === "enter" ? t("Choose a 4-digit PIN", "4 अंकों का PIN चुनें", "4 digit ka PIN chunein") : t("Enter it again", "फिर से डालें", "Phir se daalein")}
                    hint={t("Needed to leave the simple screen. Kept on this phone only.", "आसान स्क्रीन छोड़ने के लिए चाहिए। सिर्फ़ इसी फ़ोन पर रहता है।", "Simple screen chhodne ke liye chahiye. Sirf isi phone par rehta hai.")}
                    error={pinError}
                    onCancel={() => { setPinStep(null); setPinError(null); }}
                    onDone={(pin) => {
                      if (pinStep === "enter") {
                        setPinFirst(pin);
                        setPinStep("again");
                        setPinError(null);
                      } else if (pin === pinFirst) {
                        void setPin(pin).then(() => { setPinSet(true); setPinStep(null); });
                      } else {
                        setPinError(t("They did not match. Start again.", "दोनों मेल नहीं खाए। फिर से शुरू करें।", "Dono match nahi hue. Phir se shuru karein."));
                        setPinStep("enter");
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPinStep("enter")} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-card text-base font-bold">
                    <KeyRound className="size-4" aria-hidden /> {pinSet ? t("Change PIN", "PIN बदलें", "PIN badlein") : t("Set a PIN", "PIN लगाएँ", "PIN lagayein")}
                  </button>
                  {pinSet ? (
                    <button type="button" onClick={() => void setPin(null).then(() => setPinSet(false))} className="min-h-12 rounded-xl border-[3px] border-[#232326] bg-card px-3 text-base font-bold">
                      {t("Remove", "हटाएँ", "Hatayein")}
                    </button>
                  ) : null}
                </div>
              )}
              <p className="text-sm">{t("A PIN stops an accidental tap, not a determined person.", "PIN ग़लती से छूने को रोकता है, ज़िद्दी इंसान को नहीं।", "PIN galti se tap ko rokta hai, ziddi insaan ko nahi.")}</p>
            </div>
          ) : null}
        </div>

        {person ? <CallNumber person={person} /> : null}

        {error ? (
          <p role="alert" className="text-base font-bold text-[#b3261e]">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!valid || busy !== null}
          onClick={() => void save()}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-lg font-bold shadow-[0_4px_0_#232326] disabled:opacity-45"
        >
          {busy === "save" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
          {t("Save", "सहेजें", "Save karein")}
        </button>
        {person?.hasProfile ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void remove()}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-[oklch(0.94_0.05_25)] text-base font-bold"
          >
            {busy === "remove" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
            {t("Remove this person", "इन्हें हटाएँ", "Inhe hatayein")}
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
