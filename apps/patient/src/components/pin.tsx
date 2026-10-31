/**
 * A helper's PIN, kept on this phone only.
 *
 * It stands between a person who needs help and the settings: leaving the
 * simple screen asks for it. It is not an account password and does not leave
 * the device; it exists so a grandmother's accidental tap cannot take her out of
 * the screen made for her. Only a hash is stored. A four-digit PIN is a speed
 * bump for an accident, not protection against a determined person with the
 * phone in their hand, and the screen says so.
 */
import { Delete } from "lucide-react";
import { useState } from "react";

import { useT } from "../i18n";

const KEY = "parcha.helperPin";

async function hash(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`parcha-helper:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hasPin(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export async function setPin(pin: string | null): Promise<void> {
  try {
    if (pin === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, await hash(pin));
  } catch {
    /* storage blocked: no PIN, and the screen can be left without one */
  }
}

export async function checkPin(pin: string): Promise<boolean> {
  try {
    return (await hash(pin)) === localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

/** A big number pad. Calls `onDone` with four digits. */
export function PinPad({ title, hint, onDone, onCancel, error }: { title: string; hint?: string; onDone: (pin: string) => void; onCancel?: () => void; error?: string | null }) {
  const t = useT();
  const [digits, setDigits] = useState("");

  function press(d: string) {
    const next = (digits + d).slice(0, 4);
    setDigits(next);
    if (next.length === 4) {
      setTimeout(() => {
        onDone(next);
        setDigits("");
      }, 120);
    }
  }

  return (
    <div className="space-y-4 text-center">
      <p className="text-xl font-bold">{title}</p>
      {hint ? <p className="text-base">{hint}</p> : null}
      <div className="flex justify-center gap-3" aria-label={t(`${digits.length} of 4 digits`, `4 में से ${digits.length} अंक`, `4 mein se ${digits.length} digit`)}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`size-5 rounded-full border-[3px] border-[#232326] ${i < digits.length ? "bg-[#232326]" : "bg-white"}`} />
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-base font-bold text-[#b3261e]">
          {error}
        </p>
      ) : null}
      <div className="mx-auto grid max-w-64 grid-cols-3 gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} className="h-14 rounded-2xl border-[3px] border-[#232326] bg-card text-2xl font-bold shadow-[0_3px_0_#232326]">
            {d}
          </button>
        ))}
        <button type="button" onClick={onCancel} className="h-14 rounded-2xl text-base font-bold">
          {onCancel ? t("Cancel", "रहने दें", "Rehne dein") : ""}
        </button>
        <button type="button" onClick={() => press("0")} className="h-14 rounded-2xl border-[3px] border-[#232326] bg-card text-2xl font-bold shadow-[0_3px_0_#232326]">
          0
        </button>
        <button type="button" aria-label={t("Delete", "मिटाएँ", "Mitayein")} onClick={() => setDigits((d) => d.slice(0, -1))} className="flex h-14 items-center justify-center rounded-2xl">
          <Delete className="size-6" aria-hidden />
        </button>
      </div>
    </div>
  );
}
