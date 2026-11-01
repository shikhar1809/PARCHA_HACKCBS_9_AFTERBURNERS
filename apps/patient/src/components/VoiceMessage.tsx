/**
 * One button that records a few seconds of voice for the family, and the
 * player that plays it back to them.
 *
 * For Dadi, who cannot type: "the white tablets are finished", "I feel
 * dizzy", "call me". Up to thirty seconds, heard back before it goes, and
 * sent as she said it — nothing transcribes it or guesses what it means.
 *
 * It is not an emergency service and says so next to the button: a message
 * waits until somebody opens the app, and a family must never believe
 * otherwise.
 */
import { errorMessage, heardFamilyMessage, sendFamilyMessage, type FamilyMessage } from "@parcha/client";
import { cn } from "@parcha/ui";
import { Loader2, Mic, Pause, Play, Send, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useT } from "../i18n";

const MAX_SECONDS = 30;

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

export function RecordMessage({ from, className }: { from: string; className?: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "recording" | "review" | "sending" | "sent">("idle");
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<{ url: string; data: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((tr) => tr.stop());
  }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 24_000 });
      const parts: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(parts, { type: r.mimeType || "audio/webm" });
        setClip({ url: URL.createObjectURL(blob), data: await blobToDataUrl(blob) });
        setState("review");
      };
      rec.current = r;
      r.start();
      setSeconds(0);
      setState("recording");
      const began = Date.now();
      timer.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - began) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) stop();
      }, 250);
    } catch {
      setError(t(
        "The microphone could not be opened. Allow Parcha to use it in the phone's settings.",
        "माइक नहीं खुला। फ़ोन की सेटिंग में Parcha को माइक की इजाज़त दें।",
        "Mic nahi khula. Phone ki settings mein Parcha ko mic ki permission dein.",
      ));
    }
  }

  function stop() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (rec.current?.state === "recording") rec.current.stop();
  }

  async function send() {
    if (!clip) return;
    setState("sending");
    setError(null);
    try {
      await sendFamilyMessage({ from, audio: clip.data, seconds: Math.max(1, seconds), via: "app" });
      setState("sent");
      setClip(null);
    } catch (e) {
      setError(errorMessage(e));
      setState("review");
    }
  }

  return (
    <div className={cn("space-y-2.5 rounded-3xl border-[3px] border-[#232326] bg-white p-4", className)}>
      {state === "recording" ? (
        <button type="button" onClick={stop} className="flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-[#b3261e] text-2xl font-bold text-white">
          <Square className="size-7 fill-current" aria-hidden /> {t(`Stop · ${MAX_SECONDS - seconds}s left`, `रोकें · ${MAX_SECONDS - seconds} सेकंड बाकी`, `Rokein · ${MAX_SECONDS - seconds}s baaki`)}
        </button>
      ) : state === "review" || state === "sending" ? (
        <div className="space-y-2.5">
          {clip ? <audio src={clip.url} controls className="w-full" /> : null}
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" disabled={state === "sending"} onClick={() => { setClip(null); setState("idle"); }} className="flex min-h-16 items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-white text-xl font-bold">
              <Trash2 className="size-6" aria-hidden /> {t("Delete", "मिटाएँ", "Mitayein")}
            </button>
            <button type="button" disabled={state === "sending"} onClick={() => void send()} className="flex min-h-16 items-center justify-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-[#2e9e5b] text-xl font-bold text-white">
              {state === "sending" ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <Send className="size-6" aria-hidden />} {t("Send", "भेजें", "Bhejein")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => void start()} className="flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-2xl font-bold shadow-[0_4px_0_#232326]">
          <Mic className="size-8" aria-hidden /> {t("Record a message for the family", "परिवार के लिए संदेश रिकॉर्ड करें", "Parivaar ke liye sandesh record karein")}
        </button>
      )}
      {state === "sent" ? (
        <p role="status" className="text-lg font-bold">{t("Sent. The family will hear it when they open Parcha.", "भेज दिया। परिवार Parcha खोलने पर सुनेगा।", "Bhej diya. Parivaar Parcha kholne par sunega.")}</p>
      ) : null}
      {error ? <p role="alert" className="text-base font-bold text-[#b3261e]">{error}</p> : null}
      <div className="rounded-2xl bg-[var(--morning-soft)] p-2.5">
        <p className="text-sm leading-snug">
          {t(
            "Not for emergencies: nobody is called. The family hears it only when they open the app.",
            "आपातकाल के लिए नहीं: किसी को कॉल नहीं जाती। परिवार ऐप खोलने पर ही सुनेगा।",
            "Emergency ke liye nahi: kisi ko call nahi jaati. Parivaar app kholne par hi sunega.",
          )}
        </p>
      </div>
    </div>
  );
}

/** One message, played to whoever is looking; marks it heard by them. */
export function PlayMessage({ message, by }: { message: FamilyMessage; by: string | null }) {
  const t = useT();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const heard = by ? message.heardBy.includes(by) : message.heardBy.length > 0;
  function toggle() {
    if (!audio.current) {
      audio.current = new Audio(message.audio);
      audio.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audio.current.pause();
      setPlaying(false);
      return;
    }
    void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    if (by && !heard) void heardFamilyMessage(message.id, by).catch(() => undefined);
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={playing ? t("Pause", "रोकें", "Rokein") : t("Play the message", "संदेश सुनें", "Sandesh sunein")}
      className={cn("flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl border-[3px] border-[#232326] px-3 text-base font-bold", heard ? "bg-white" : "bg-[var(--brand)]")}
    >
      {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
      {message.seconds ? `${message.seconds}s` : null}
    </button>
  );
}
