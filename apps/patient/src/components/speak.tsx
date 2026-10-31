import { Capacitor } from "@capacitor/core";
import type { SpeechLang } from "@parcha/core";
import { Volume2 } from "lucide-react";
import { useState } from "react";

/**
 * Reading aloud, for someone who cannot see well (or cannot read).
 *
 * In the Android app the phone's own text-to-speech speaks (the in-app web
 * view has no voices of its own); in a browser, the browser's voices. Both
 * work with no connection once the phone has the voice. Hindi when the phone
 * has a Hindi voice, otherwise Indian English, otherwise any English.
 */
const LOCALE: Record<SpeechLang, string> = { hi: "hi-IN", en: "en-IN" };

async function nativeSpeak(text: string, lang: SpeechLang) {
  const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
  await TextToSpeech.stop().catch(() => undefined);
  await TextToSpeech.speak({ text, lang: LOCALE[lang], rate: 0.9, pitch: 1, volume: 1, category: "playback" });
}

function webSpeak(text: string, lang: SpeechLang) {
  const synth = window.speechSynthesis;
  if (!synth) return false;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  // Hindi text is never handed to an English voice (it would be gibberish):
  // with no Hindi voice listed, ask for Hindi and let the system choose.
  const voice =
    voices.find((v) => v.lang === LOCALE[lang]) ??
    voices.find((v) => v.lang.startsWith(lang)) ??
    (lang === "en" ? (voices.find((v) => v.lang === "en-IN") ?? voices.find((v) => v.lang.startsWith("en"))) : undefined);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? LOCALE[lang];
  u.rate = 0.9;
  synth.speak(u);
  return true;
}

/** Speaks a sentence. Returns false if this device has no way to speak. */
export async function speak(text: string, lang: SpeechLang = "en"): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      await nativeSpeak(text, lang);
      return true;
    }
  } catch {
    /* fall through to the browser's voices */
  }
  return webSpeak(text, lang);
}

export function stopSpeaking() {
  if (Capacitor.isNativePlatform()) {
    void import("@capacitor-community/text-to-speech").then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => undefined);
  }
  window.speechSynthesis?.cancel();
}

/** Whether a sentence in Hindi script should be read with a Hindi voice. */
export const langOf = (text: string): SpeechLang => (/[ऀ-ॿ]/.test(text) ? "hi" : "en");

/**
 * A speaker button: reads `text` aloud. Large and labelled, so it works with
 * a screen reader as well as for someone who just cannot read the screen.
 */
export function ListenButton({ text, label = "Listen", lang, className = "" }: { text: string; label?: string; lang?: SpeechLang; className?: string }) {
  const [speaking, setSpeaking] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        setSpeaking(true);
        await speak(text, lang ?? langOf(text));
        setTimeout(() => setSpeaking(false), 1500);
      }}
      aria-label={`${label}: ${text}`}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border-[3px] border-[#232326] bg-white px-3.5 text-base font-bold shadow-[0_2px_0_#232326] active:translate-y-0.5 ${speaking ? "bg-[var(--brand-soft)]" : ""} ${className}`}
    >
      <Volume2 className="size-5" aria-hidden /> {label}
    </button>
  );
}
