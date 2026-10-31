import { errorMessage, setAccessNeeds } from "@parcha/client";
import { ACCESS_NEEDS, type AccessNeed } from "@parcha/core";
import { cn } from "@parcha/ui";
import { Check, EarOff, EyeOff, Hand, MessageSquareText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Btn } from "../bits";

const ICON: Record<AccessNeed, typeof EyeOff> = { low_vision: EyeOff, deaf: EarOff, sign_language: Hand };

/** Toggles for a patient's access needs: low vision, deaf, sign language. */
export function AccessNeedsPicker({ value, onChange, disabled }: { value: AccessNeed[]; onChange: (v: AccessNeed[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Access needs">
      {ACCESS_NEEDS.map((n) => {
        const on = value.includes(n.id);
        const Icon = ICON[n.id];
        return (
          <button
            key={n.id}
            type="button"
            role="switch"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== n.id) : [...value, n.id])}
            className={cn(
              "inline-flex min-h-10 items-center gap-1.5 rounded-full border-[3px] border-[#232326] px-3 text-sm font-bold disabled:opacity-50",
              on ? "bg-[#232326] text-white" : "bg-white",
            )}
          >
            {on ? <Check className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
            {n.label}
          </button>
        );
      })}
    </div>
  );
}

/** What to do differently, for each need the patient has. Shown on the dossier and the intake. */
export function AccessGuidance({ needs, onShowToPatient }: { needs?: AccessNeed[]; onShowToPatient?: () => void }) {
  if (!needs?.length) return null;
  const writes = needs.includes("deaf") || needs.includes("sign_language");
  return (
    <div role="note" className="rounded-2xl border-[3px] border-[#232326] bg-[var(--morning-soft)] p-4 shadow-[3px_3px_0_#232326]">
      <ul className="space-y-2">
        {ACCESS_NEEDS.filter((n) => needs.includes(n.id)).map((n) => {
          const Icon = ICON[n.id];
          return (
            <li key={n.id} className="flex items-start gap-2.5">
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
              <p className="text-base leading-snug">
                <b>{n.label}.</b> {n.guidance}
              </p>
            </li>
          );
        })}
      </ul>
      {writes && onShowToPatient ? (
        <Btn className="mt-3" onClick={onShowToPatient}>
          <MessageSquareText className="size-4" aria-hidden /> Show to patient
        </Btn>
      ) : null}
    </div>
  );
}

const QUICK = [
  "Please wait. The doctor will see you next.",
  "Please come with me.",
  "Take one tablet in the morning and one at night, after food.",
  "Come back in one week.",
  "Does it hurt here?",
  "Have you eaten today?",
];

/**
 * "Show to patient": a big-text pad for talking with someone who cannot hear.
 * The doctor (or the desk) types, or taps a common sentence, and turns the
 * screen towards the patient. The text fills the screen, black on white.
 */
export function ShowToPatient({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [showing, setShowing] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!showing) area.current?.focus();
  }, [showing]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (showing ? setShowing(false) : onClose());
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [showing, onClose]);

  if (showing) {
    return (
      <div role="dialog" aria-label="Shown to the patient" className="fixed inset-0 z-[90] flex flex-col bg-white p-6">
        <p className="m-auto max-w-5xl text-center text-[clamp(2.5rem,7vw,6rem)] leading-[1.1] font-bold break-words text-black">{text}</p>
        <Btn className="self-center" onClick={() => setShowing(false)}>
          Back to typing
        </Btn>
      </div>
    );
  }
  return (
    <div role="dialog" aria-label="Show to patient" className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4">
      <div className="bg-background w-full max-w-2xl rounded-[2rem] border-[3px] border-[#232326] p-5 shadow-[8px_8px_0_#232326]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xl font-bold">Show to patient</p>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full border-[3px] border-[#232326] p-1.5">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <p className="mt-1 text-base">Type, or tap a sentence, then show it. The words fill the screen.</p>
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="mt-3 w-full rounded-xl border-[3px] border-[#232326] bg-white p-3 text-2xl font-bold outline-none"
          placeholder="What do you want to tell them?"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => setText(q)} className="rounded-full border-2 border-[#232326] bg-white px-3 py-1.5 text-sm font-bold">
              {q}
            </button>
          ))}
        </div>
        <Btn kind="primary" className="mt-4 w-full" disabled={!text.trim()} onClick={() => setShowing(true)}>
          <MessageSquareText className="size-5" aria-hidden /> Show it
        </Btn>
      </div>
    </div>
  );
}

/**
 * The desk's view of a patient's access needs, on the intake: set them (saved
 * at once, on the patient and their open visits), read the guidance, and open
 * Show to patient.
 */
export function AccessCard({ patientId, needs }: { patientId: string; needs?: AccessNeed[] }) {
  const [value, setValue] = useState<AccessNeed[]>(needs ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showing, setShowing] = useState(false);
  useEffect(() => setValue(needs ?? []), [needs]);

  async function change(next: AccessNeed[]) {
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      await setAccessNeeds(patientId, next);
    } catch (e) {
      setError(errorMessage(e));
      setValue(needs ?? []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <p className="text-muted-foreground text-sm tracking-wide uppercase">Seeing, hearing, language</p>
      <AccessNeedsPicker value={value} onChange={(v) => void change(v)} disabled={busy} />
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <AccessGuidance needs={value} onShowToPatient={() => setShowing(true)} />
      {showing ? <ShowToPatient onClose={() => setShowing(false)} /> : null}
    </div>
  );
}
