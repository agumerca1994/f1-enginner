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

// The broadcast team-radio chime: three pure tones back to back, G5 D6 B5, about
// 90 ms each (measured on a reference clip of the TV graphics' radio sound).
const OPEN_TONES: [number, number][] = [[784, 0.092], [1175, 0.092], [988, 0.092]];
const CLOSE_TONES: [number, number][] = [];
const TONE_GAP_S = 0;

let audio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume();
    return audio;
  } catch {
    return null;
  }
}

/** Plays the tones and returns how long they last, in milliseconds. */
export function radioTones(tones: [number, number][]): number {
  const ctx = audioContext();
  if (!ctx || !tones.length) return 0;
  let t = ctx.currentTime + 0.01;
  for (const [hz, len] of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.004);
    gain.gain.setValueAtTime(0.12, t + len - 0.004);
    gain.gain.linearRampToValueAtTime(0, t + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + len);
    t += len + TONE_GAP_S;
  }
  return Math.round((t - ctx.currentTime) * 1000);
}

/**
 * Reads the engineer's radio calls aloud, between radio keying tones. Urgent calls cut whatever is being said.
 * Browsers only allow speech after a user gesture, so it starts off and is turned
 * on with a tap; the choice is remembered.
 */
export function useEngineerVoice(messages: EngineerMessage[], { alwaysOn = false }: { alwaysOn?: boolean } = {}) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const spoken = useRef<number>(0);

  useEffect(() => {
    const ok = typeof window !== "undefined" && "speechSynthesis" in window;
    setSupported(ok);
    if (ok) {
      // An overlay in OBS has nobody to tap it: it can ask to start on.
      if (alwaysOn) setEnabled(true);
      else
        try {
          setEnabled(localStorage.getItem(STORAGE_KEY) === "on");
        } catch {}
      window.speechSynthesis.getVoices(); // some browsers load voices lazily
    }
  }, [alwaysOn]);

  const say = useCallback((text: string, urgent: boolean) => {
    const synth = window.speechSynthesis;
    if (urgent) synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "es-AR";
    utterance.rate = 1.05;
    utterance.onend = () => radioTones(CLOSE_TONES);
    const wait = synth.speaking ? 0 : radioTones(OPEN_TONES); // queued calls follow the previous close
    setTimeout(() => synth.speak(utterance), wait + 80);
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
