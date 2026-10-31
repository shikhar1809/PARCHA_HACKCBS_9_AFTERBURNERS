/**
 * Voice first: hold Space and talk.
 *
 * A marker sits at the bottom centre of the consultation. Holding Space (or
 * pressing on the marker) listens: the marker grows with the doctor's voice.
 * Letting go writes the words down and hands them to the pad, which places
 * them (see @parcha/core voice.ts) and says back what it did. If something the
 * prescription needs is still missing, Parcha asks for it, and the next thing
 * said answers it.
 *
 * Space only listens when no text box has the cursor, so typing a space in a
 * box still types a space.
 *
 * Everything stays on this computer. The words come from Whisper running here
 * (whisper.ts), never from the browser's own recogniser, which in Chrome and
 * Edge sends the sound to Google or Microsoft. Replies are read aloud only with
 * a voice installed on this computer (`localService`); where there is none,
 * they are only written.
 */
import { cn } from "@parcha/ui";
import { ChevronDown, ChevronUp, Mic, MicOff, SendHorizontal, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadWhisper, onWhisperProgress, startRecording, transcribe, whisperProgress } from "./whisper";

/** A line of what happened, shown under the marker for a few seconds. */
export type Placed = { box: string; text: string; tone?: "ok" | "ask" | "miss"; /** The same, as a sentence Parcha says back. */ say?: string };
/** One turn of the conversation: what the doctor said or typed, or what Parcha did and says back. */
export type Turn = { who: "doctor" | "parcha"; text: string; typed?: boolean; parts?: Placed[]; ask?: boolean };
const OPEN_KEY = "parcha.voice.open";

const SPEAK_KEY = "parcha.voice.speak";
type Take = Awaited<ReturnType<typeof startRecording>> | null;

/** A voice installed on this computer, Indian English first; null if there is none (an online voice is never used). */
function localVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const local = speechSynthesis.getVoices().filter((v) => v.localService);
  return local.find((v) => /^en-IN/i.test(v.lang)) ?? local.find((v) => /^en/i.test(v.lang)) ?? null;
}

/** Whether the focus is somewhere Space should type a space. */
const typing = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable || el instanceof HTMLSelectElement);

export function VoiceBar({
  onHeard,
  thread,
  question,
  onSkip,
  onClear,
}: {
  onHeard: (words: string, typed?: boolean) => void;
  thread: Turn[];
  question: string | null;
  onSkip: () => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const showThread = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* for now only */
    }
  };
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [thread.length, open]);
  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const [listening, setListening] = useState(false);
  const [writing, setWriting] = useState(false);
  const [ready, setReady] = useState(() => whisperProgress());
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [speak, setSpeak] = useState(() => {
    try {
      return localStorage.getItem(SPEAK_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const recording = useRef<Promise<Take> | null>(null);
  const holding = useRef(false);
  const onHeardRef = useRef(onHeard);
  onHeardRef.current = onHeard;

  // The model loads ahead of the first word, once.
  useEffect(() => {
    if (!supported) return;
    const off = onWhisperProgress(setReady);
    loadWhisper().catch(() => setError("Speech could not start on this computer. Type instead."));
    return () => void off();
  }, [supported]);

  // The voices on this computer arrive a moment after the page loads.
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(() => localVoice());
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const pick = () => setVoice(localVoice());
    speechSynthesis.addEventListener("voiceschanged", pick);
    pick();
    return () => speechSynthesis.removeEventListener("voiceschanged", pick);
  }, []);

  /** Turns a recording into words on this computer and hands them on. */
  const writeDown = useCallback(async (take: Promise<Take>) => {
    const r = await take;
    if (!r) return;
    const sound = await r.stop();
    // Less than a third of a second is a tap, not speech.
    if (sound.length < 16000 / 3) return;
    setWriting(true);
    try {
      const words = await transcribe(sound);
      if (words) onHeardRef.current(words);
      else setError("Nothing was heard. Hold Space a little longer, and speak close to the microphone.");
    } catch {
      setError("Speech could not start on this computer. Type instead.");
    } finally {
      setWriting(false);
    }
  }, []);

  const start = useCallback(() => {
    if (holding.current || writing) return;
    holding.current = true;
    setError(null);
    window.speechSynthesis?.cancel();
    recording.current = startRecording(setLevel).catch((e: { name?: string }) => {
      setError(e?.name === "NotAllowedError" ? "The microphone is blocked. Allow it for this app, or type instead." : "No microphone was found. Plug one in, or type instead.");
      holding.current = false;
      setListening(false);
      return null;
    });
    setListening(true);
  }, [writing]);

  const stop = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    setListening(false);
    const take = recording.current;
    recording.current = null;
    if (take) void writeDown(take);
  }, [writeDown]);

  // Hold Space to talk, anywhere on the consultation except in a text box.
  useEffect(() => {
    if (!supported) return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(document.activeElement) || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !holding.current) return;
      e.preventDefault();
      stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [supported, start, stop]);

  useEffect(() => () => {
    void recording.current?.then((t) => t?.cancel());
  }, []);

  // What Parcha says back is read aloud, if the doctor wants it: each new reply in turn (speaking again stops it).
  const spokenUpTo = useRef(thread.length);
  useEffect(() => {
    if (thread.length < spokenUpTo.current) spokenUpTo.current = thread.length;
    const fresh = thread.slice(spokenUpTo.current).filter((t) => t.who === "parcha");
    spokenUpTo.current = thread.length;
    if (!fresh.length || !speak || !voice) return;
    for (const t of fresh) {
      const u = new SpeechSynthesisUtterance(t.text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 1.05;
      speechSynthesis.speak(u);
    }
  }, [thread, speak, voice]);

  const send = () => {
    const words = draft.trim();
    if (!words) return;
    setDraft("");
    onHeard(words, true);
  };

  const toggleSpeak = () => {
    const next = !speak;
    setSpeak(next);
    if (!next) window.speechSynthesis?.cancel();
    try {
      localStorage.setItem(SPEAK_KEY, next ? "1" : "0");
    } catch {
      /* remembered for now only */
    }
  };

  const ring = 1 + level * 0.9;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {/* The conversation: what the doctor said, what Parcha did and says back. */}
      {open ? (
        <div className="pointer-events-auto flex max-h-[45vh] w-full max-w-xl flex-col rounded-2xl border-[3px] border-[#232326] bg-white shadow-[0_4px_0_#232326]">
          {thread.length > 0 || error ? (
            <>
              <div className="flex items-center justify-between border-b-2 border-[#232326]/15 px-3 py-1.5">
                <p className="text-sm font-bold">Parcha</p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={onClear} className="rounded-lg px-2 py-1 text-xs font-bold underline">
                    Clear
                  </button>
                  <button type="button" onClick={() => showThread(false)} aria-label="Hide the conversation" className="rounded-lg p-1">
                    <ChevronDown className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {error ? <p role="alert" className="text-destructive text-base font-bold">{error}</p> : null}
                {thread.map((t, i) =>
                  t.who === "doctor" ? (
                    <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[var(--brand-soft)] px-3 py-1.5 text-base">
                      {t.text}
                    </p>
                  ) : (
                    <div key={i} className={cn("w-fit max-w-[92%] rounded-2xl rounded-bl-md border-2 border-[#232326] px-3 py-1.5", t.ask ? "bg-[var(--morning-soft)]" : "bg-white")}>
                      {t.parts?.length ? (
                        <ul className="space-y-1">
                          {t.parts.map((p, j) => (
                            <li key={j} className="flex items-baseline gap-2 text-base">
                              <span className={cn("shrink-0 rounded-full border-2 border-[#232326] px-2 text-xs font-bold uppercase", p.tone === "miss" ? "bg-[oklch(0.94_0.05_25)]" : "bg-[var(--brand-soft)]")}>{p.box}</span>
                              <span className="min-w-0">{p.box === "Prescription" ? p.say : p.text}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className={cn("text-base", t.ask && "font-bold")}>{t.text}</p>
                      )}
                    </div>
                  ),
                )}
                <div ref={end} />
              </div>
            </>
          ) : null}
          {question ? (
            <div className="flex items-center gap-2 border-t-2 border-[#232326]/15 bg-[var(--morning-soft)] px-3 py-2">
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-bold">{question}</span> Hold Space and say it, or type it.
              </p>
              <button type="button" onClick={onSkip} className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold underline">
                Skip
              </button>
            </div>
          ) : null}
          <form
            className="flex items-center gap-2 border-t-2 border-[#232326]/15 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder='Type to Parcha: "make it 7 days", "read it back", "undo"'
              aria-label="Type to Parcha"
              className="min-w-0 flex-1 rounded-xl border-2 border-[#232326] px-3 py-2 text-base"
            />
            <button type="submit" aria-label="Send" className="flex size-10 items-center justify-center rounded-xl border-2 border-[#232326] bg-[#ff7f5a]">
              <SendHorizontal className="size-5" aria-hidden />
            </button>
          </form>
        </div>
      ) : (
        <button type="button" onClick={() => showThread(true)} className="pointer-events-auto flex items-center gap-1 rounded-full border-2 border-[#232326] bg-white px-3 py-1 text-sm font-bold">
          <ChevronUp className="size-4" aria-hidden /> Talk to Parcha{question ? " (it is asking something)" : ""}
        </button>
      )}

      {listening || writing ? (
        <p className="pointer-events-auto max-w-xl rounded-2xl border-[3px] border-[#232326] bg-white px-4 py-2 text-center text-lg shadow-[0_4px_0_#232326]">
          {writing ? (
            <span className="opacity-70">{ready < 1 ? `Getting speech ready on this computer… ${Math.round(ready * 100)}%` : "Writing it down…"}</span>
          ) : (
            <span className="opacity-60">Listening… let go when done</span>
          )}
        </p>
      ) : ready > 0 && ready < 1 ? (
        <p className="pointer-events-auto rounded-full border-2 border-[#232326] bg-white px-3 py-1 text-sm">Getting speech ready on this computer… {Math.round(ready * 100)}% (once only)</p>
      ) : null}

      <div className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          disabled={!supported}
          onPointerDown={(e) => {
            e.preventDefault();
            start();
          }}
          onPointerUp={stop}
          onPointerLeave={() => listening && stop()}
          aria-label={supported ? "Hold to speak (or hold Space)" : "No microphone here"}
          className={cn(
            "relative flex h-14 items-center gap-3 rounded-full border-[3px] border-[#232326] px-5 text-base font-bold shadow-[0_4px_0_#232326] transition-colors select-none",
            listening ? "bg-[#ff7f5a]" : "bg-white",
            !supported && "opacity-60",
          )}
        >
          <span className="relative flex size-8 items-center justify-center">
            {listening ? (
              <span aria-hidden className="absolute inset-0 rounded-full bg-[#ff7f5a] opacity-40" style={{ transform: `scale(${ring * 1.6})`, transition: "transform 80ms linear" }} />
            ) : null}
            {supported ? <Mic className="relative size-6" aria-hidden /> : <MicOff className="relative size-6" aria-hidden />}
          </span>
          {!supported ? "No microphone here" : listening ? "Listening… let go when done" : (
            <>
              Hold <kbd className="rounded-md border-2 border-[#232326] bg-[var(--brand-soft)] px-2 py-0.5 text-sm">Space</kbd> to speak
            </>
          )}
        </button>
        <button
          type="button"
          onClick={toggleSpeak}
          disabled={!voice}
          aria-pressed={speak && !!voice}
          aria-label={!voice ? "No voice installed on this computer, so replies are only written." : speak ? "Replies are read aloud. Turn off." : "Replies are not read aloud. Turn on."}
          title={!voice ? "No voice installed on this computer, so replies are only written." : undefined}
          className={cn("flex size-11 items-center justify-center rounded-full border-[3px] border-[#232326] bg-white shadow-[0_3px_0_#232326]", !voice && "opacity-50")}
        >
          {speak && voice ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
        </button>
      </div>
    </div>
  );
}
