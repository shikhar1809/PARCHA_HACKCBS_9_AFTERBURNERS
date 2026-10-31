import { useCallback, useEffect, useRef, useState } from "react";

import { startRecording, transcribe } from "./whisper";

/**
 * Dictation by microphone into the dictation box: press to start, press again
 * to stop, and the words are written down.
 *
 * The words come from Whisper on this computer (whisper.ts), as for holding
 * Space: the browser's own recogniser would send the sound to the browser
 * maker, so it is never used. The text box beside it always works, and
 * everything said still goes through the same parser as everything typed.
 */
export function useMic(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = useRef<Promise<Awaited<ReturnType<typeof startRecording>> | null> | null>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => () => void take.current?.then((t) => t?.cancel()), []);

  const toggle = useCallback(() => {
    if (listening) {
      const t = take.current;
      take.current = null;
      setListening(false);
      void (async () => {
        const r = await t;
        if (!r) return;
        try {
          const words = await transcribe(await r.stop());
          if (words) cb.current(words);
        } catch {
          setError("Speech could not start on this computer. You can type instead.");
        }
      })();
      return;
    }
    setError(null);
    take.current = startRecording(() => {}).catch((e: { name?: string }) => {
      setError(e?.name === "NotAllowedError" ? "The microphone is blocked. Allow it for this app, or type instead." : "No microphone was found. You can type instead.");
      setListening(false);
      return null;
    });
    setListening(true);
  }, [listening]);

  return { supported, listening, error, toggle };
}
