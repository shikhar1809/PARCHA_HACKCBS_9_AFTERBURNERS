import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A spoken message: talk, see the words appear, stop to send them.
 *
 * Private means on the device. A browser's ordinary speech recognition sends
 * the sound to the browser maker's servers, so it is never used here: only
 * recognition that runs on this computer (Chrome's on-device mode). The first
 * use may download the language model once. Where on-device recognition is not
 * available, the microphone says so and typing works; the sound is never sent
 * anywhere, and only the encrypted text leaves the device.
 */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  mode?: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type Availability = "available" | "downloadable" | "downloading" | "unavailable";
type Ctor = (new () => Recognition) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<Availability>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
  availableOnDevice?: (lang: string) => Promise<Availability>;
  installOnDevice?: (lang: string) => Promise<boolean>;
};

function recogniser(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can recognise `lang` on the device, installing it if it may. */
async function onDevice(C: Ctor, lang: string): Promise<"ok" | "no-local" | "no-lang"> {
  try {
    if (C.available) {
      const opts = { langs: [lang], processLocally: true };
      const a = await C.available(opts);
      if (a === "available") return "ok";
      if ((a === "downloadable" || a === "downloading") && C.install) return (await C.install(opts)) ? "ok" : "no-lang";
      return "no-lang";
    }
    if (C.availableOnDevice) {
      const a = await C.availableOnDevice(lang);
      if (a === "available") return "ok";
      if ((a === "downloadable" || a === "downloading") && C.installOnDevice) return (await C.installOnDevice(lang)) ? "ok" : "no-lang";
      return "no-lang";
    }
  } catch {
    return "no-lang";
  }
  return "no-local";
}

export type VoiceLang = "en-IN" | "hi-IN";

export function useVoice(lang: VoiceLang, onDone: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finals = useRef("");
  const cancelled = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback(async () => {
    const C = recogniser();
    setError(null);
    if (!C) {
      setError("This browser cannot turn speech into text on the device. Type instead.");
      return;
    }
    setPreparing(true);
    const local = await onDevice(C, lang);
    setPreparing(false);
    if (local !== "ok") {
      setError(
        local === "no-local"
          ? "For privacy, voice works only where speech is recognised on this computer (a recent Chrome). This browser would send the sound away, so it is off. Type instead."
          : `${lang === "hi-IN" ? "Hindi" : "English"} cannot be recognised on this computer yet. Try the other language, or type.`,
      );
      return;
    }
    setHeard("");
    finals.current = "";
    cancelled.current = false;
    const r = new C();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    // Both spellings of "on this device only", old and new.
    r.processLocally = true;
    r.mode = "ondevice-only";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) finals.current += `${piece.trim()} `;
        else interim += piece;
      }
      setHeard(`${finals.current}${interim}`.trim());
    };
    r.onerror = (e) => {
      if (e.error === "aborted" || e.error === "no-speech") return;
      setError(e.error === "not-allowed" ? "The microphone is blocked. Allow it for this site, or type instead." : "The microphone stopped. Type instead.");
    };
    r.onend = () => {
      setListening(false);
      const text = finals.current.trim();
      if (!cancelled.current && text) done.current(text);
      setHeard("");
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("The microphone could not start.");
    }
  }, [lang]);

  /** Stops listening and sends what was heard. */
  const stop = useCallback(() => rec.current?.stop(), []);
  /** Stops listening and throws it away. */
  const cancel = useCallback(() => {
    cancelled.current = true;
    rec.current?.abort();
  }, []);

  return { listening, preparing, heard, error, start, stop, cancel };
}
