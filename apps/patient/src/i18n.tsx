import { addDays, dayOf, everyText, slotInstant, timeOf, todayInClinic } from "@parcha/core";
import { useSyncExternalStore } from "react";

/**
 * The patient app's language: हिन्दी, English, or Hinglish (Hindi written in
 * English letters, the way most people text).
 *
 * The phone has one choice, and each person on a shared phone can have their
 * own (Dadi in Hindi, Sunita in Hinglish); the person using the phone wins.
 * Text is written where it is used, in all three: t("Book a visit",
 * "विज़िट बुक करें", "Visit book karein"), so a screen reads as one piece in
 * every language and nothing is left untranslated by accident.
 */
export type Lang = "hi" | "en" | "hg";

export const LANGS: { id: Lang; label: string; sample: string }[] = [
  { id: "hi", label: "हिन्दी", sample: "दवा का समय" },
  { id: "en", label: "English", sample: "Medicine time" },
  { id: "hg", label: "Hinglish", sample: "Dawai ka time" },
];

const DEVICE = "parcha.lang";
const PEOPLE = "parcha.lang.people";
const listeners = new Set<() => void>();
let activePerson: string | null = null;

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* private mode: kept for this page only */
    }
  },
};
let memoryDevice: Lang | null = null;
const memoryPeople: Record<string, Lang> = {};

const isLang = (v: unknown): v is Lang => v === "hi" || v === "en" || v === "hg";

function people(): Record<string, Lang> {
  try {
    return { ...memoryPeople, ...(JSON.parse(store.get(PEOPLE) ?? "{}") as Record<string, Lang>) };
  } catch {
    return { ...memoryPeople };
  }
}

/** Whether the phone has been asked yet (the first-run screen asks once). */
export function langChosen(): boolean {
  return isLang(store.get(DEVICE)) || memoryDevice != null;
}

/** The language in force: this person's, else the phone's, else Hindi. */
export function currentLang(): Lang {
  const mine = activePerson ? people()[activePerson] : undefined;
  if (isLang(mine)) return mine;
  const device = store.get(DEVICE);
  return isLang(device) ? device : (memoryDevice ?? "hi");
}

function changed() {
  const lang = currentLang();
  if (typeof document !== "undefined") document.documentElement.lang = lang === "hi" ? "hi" : lang === "hg" ? "hi-Latn" : "en";
  listeners.forEach((l) => l());
}

/** Sets the phone's language, or one person's when `person` is given. */
export function setLang(lang: Lang, person?: string | null) {
  if (person) {
    const all = people();
    all[person] = lang;
    memoryPeople[person] = lang;
    store.set(PEOPLE, JSON.stringify(all));
  } else {
    memoryDevice = lang;
    store.set(DEVICE, lang);
  }
  changed();
}

/** Called by the app when the person using the phone changes. */
export function setLangPerson(name: string | null) {
  if (activePerson === name) return;
  activePerson = name;
  changed();
}

/** This person's own choice, if they made one (for the Me screen). */
export const personLang = (name: string): Lang | null => people()[name] ?? null;

export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    currentLang,
    () => "hi" as Lang,
  );
}

/** The text in the language in force. Hinglish falls back to English if not given. */
export type T = (en: string, hi: string, hg?: string) => string;
export function useT(): T {
  const lang = useLang();
  return (en, hi, hg) => (lang === "hi" ? hi : lang === "hg" ? (hg ?? en) : en);
}
export const tr = (lang: Lang, en: string, hi: string, hg?: string) => (lang === "hi" ? hi : lang === "hg" ? (hg ?? en) : en);

/** "8 am" / "सुबह 8 बजे" / "subah 8 baje" from "HH:MM". */
export function clockIn(lang: Lang, time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h)) return time;
  const h12 = h % 12 || 12;
  const mm = m ? `:${String(m).padStart(2, "0")}` : "";
  if (lang === "en") return `${h12}${mm} ${h < 12 ? "am" : "pm"}`;
  const part = h < 4 ? ["रात", "raat"] : h < 12 ? ["सुबह", "subah"] : h < 16 ? ["दोपहर", "dopahar"] : h < 19 ? ["शाम", "shaam"] : ["रात", "raat"];
  return lang === "hi" ? `${part[0]} ${h12}${mm} बजे` : `${part[1]} ${h12}${mm} baje`;
}

const MONTHS_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_HI = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];
const DAYS_HG = ["Ravi", "Som", "Mangal", "Budh", "Guru", "Shukra", "Shani"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "23 Oct 2026" / "23 अक्टूबर 2026"; the year only when asked. */
export function dateIn(lang: Lang, iso: string | Date, withYear = true): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const month = lang === "hi" ? MONTHS_HI[d.getMonth()] : MONTHS_EN[d.getMonth()];
  return `${d.getDate()} ${month}${withYear ? ` ${d.getFullYear()}` : ""}`;
}

/** Short day name: "Mon" / "सोम" / "Som". */
export const dayIn = (lang: Lang, d: Date) => (lang === "hi" ? DAYS_HI : lang === "hg" ? DAYS_HG : DAYS_EN)[d.getDay()];

/** The three choices, big and tappable, each written in its own language. */
export function LangChoice({ value, onChange, size = "lg" }: { value: Lang; onChange: (l: Lang) => void; size?: "lg" | "sm" }) {
  return (
    <div role="radiogroup" aria-label="भाषा · Language · Bhasha" className="grid grid-cols-3 gap-2">
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={value === l.id}
          lang={l.id === "hi" ? "hi" : l.id === "hg" ? "hi-Latn" : "en"}
          onClick={() => onChange(l.id)}
          className={`flex flex-col items-center justify-center rounded-2xl border-[3px] border-[#232326] px-1 font-bold ${size === "lg" ? "min-h-16 py-2 text-lg" : "min-h-12 py-1 text-base"} ${value === l.id ? "bg-[var(--brand)] shadow-[0_3px_0_#232326]" : "bg-card"}`}
        >
          {l.label}
          {size === "lg" ? <span className="text-xs font-normal">{l.sample}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** "Today" / "आज" / "Aaj", "Tomorrow", else "Mon 27 Oct" — for a YYYY-MM-DD in the clinic's time zone. */
export function dayWordIn(lang: Lang, day: string): string {
  const today = todayInClinic();
  if (day === today) return tr(lang, "Today", "आज", "Aaj");
  if (day === addDays(today, 1)) return tr(lang, "Tomorrow", "कल", "Kal");
  const d = slotInstant(day, "12:00");
  return `${dayIn(lang, d)} ${dateIn(lang, d, false)}`;
}

/** A booked slot: "Tomorrow, 10:30 am" / "कल, सुबह 10:30 बजे". */
export const slotIn = (lang: Lang, instant: string | Date) => `${dayWordIn(lang, dayOf(instant))}, ${clockIn(lang, timeOf(instant))}`;

const EVERY_HG: Record<number, string> = { 1: "Roz", 2: "Har 2 din", 3: "Har 3 din", 7: "Hafte mein ek baar", 14: "Har 2 hafte", 30: "Mahine mein ek baar" };

/** "Once a week" / "हफ़्ते में एक बार" / "Hafte mein ek baar". */
export function everyIn(lang: Lang, days: number | undefined): string {
  const d = Math.max(1, days ?? 1);
  if (lang === "hg") return EVERY_HG[d] ?? `Har ${d} din`;
  return everyText(d, lang);
}

/** Which voice reads aloud: Hinglish is spoken Hindi. */
export const speechLang = (lang: Lang): "hi" | "en" => (lang === "en" ? "en" : "hi");
