"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { EngineerMessage } from "@/lib/types";

const STORAGE_KEY = "engineer-voice";

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "es-AR") ??
    voices.find((v) => v.lang === "es-419" || v.lang === "es-US" || v.lang === "es-MX") ??
    voices.find((v) => v.lang.startsWith("es")) ??
    null
  );
}

/**
 * Reads the engineer's radio calls aloud. Urgent calls cut whatever is being said.
 * Browsers only allow speech after a user gesture, so it starts off and is turned
 * on with a tap; the choice is remembered.
 */
export function useEngineerVoice(messages: EngineerMessage[]) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const spoken = useRef<number>(0);

  useEffect(() => {
    const ok = typeof window !== "undefined" && "speechSynthesis" in window;
    setSupported(ok);
    if (ok) {
      try {
        setEnabled(localStorage.getItem(STORAGE_KEY) === "on");
      } catch {}
      window.speechSynthesis.getVoices(); // some browsers load voices lazily
    }
  }, []);

  const say = useCallback((text: string, urgent: boolean) => {
    const synth = window.speechSynthesis;
    if (urgent) synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "es-AR";
    utterance.rate = 1.05;
    synth.speak(utterance);
  }, []);

  // Speak radio calls that arrive while the voice is on; never replay old ones.
  useEffect(() => {
    const latest = messages.slice(-1)[0];
    if (!latest) return;
    if (!enabled) {
      spoken.current = latest.id;
      return;
    }
    for (const m of messages) {
      if (m.id > spoken.current && m.radio) say(m.radio, m.prioridad === "urgente");
    }
    spoken.current = latest.id;
  }, [messages, enabled, say]);

  const toggle = useCallback(() => {
    setEnabled((on) => {
      const next = !on;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      } catch {}
      if (next) say("Radio activada.", true);
      else window.speechSynthesis.cancel();
      return next;
    });
  }, [say]);

  return { supported, enabled, toggle };
}
