"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { API_URL } from "@/lib/api";
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

// --- the radio chain ---------------------------------------------------------------

/** Telephone-band radio sound: 300-3400 Hz, a presence bump, light grit and hard compression. */
function radioChain(ctx: AudioContext, input: AudioNode): void {
  const highpass = new BiquadFilterNode(ctx, { type: "highpass", frequency: 300, Q: 0.7 });
  const lowpass = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 3400, Q: 0.7 });
  const presence = new BiquadFilterNode(ctx, { type: "peaking", frequency: 1500, Q: 1, gain: 5 });
  const curve = new Float32Array(1024).map((_, i) => Math.tanh(2.2 * (i / 511.5 - 1)) / Math.tanh(2.2));
  const grit = new WaveShaperNode(ctx, { curve });
  const comp = new DynamicsCompressorNode(ctx, { threshold: -28, knee: 6, ratio: 8, attack: 0.003, release: 0.12 });
  const out = new GainNode(ctx, { gain: 1.4 });
  input.connect(highpass).connect(lowpass).connect(presence).connect(grit).connect(comp).connect(out).connect(ctx.destination);
}

let queue: Promise<void> = Promise.resolve();
let generation = 0; // bumped by an urgent call: everything queued before it is dropped
let current: AudioBufferSourceNode | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function playBuffer(ctx: AudioContext, buffer: AudioBuffer): Promise<void> {
  return new Promise((resolve) => {
    const source = new AudioBufferSourceNode(ctx, { buffer });
    radioChain(ctx, source);
    source.onended = () => resolve();
    current = source;
    source.start();
  });
}

function speakWithBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "es-AR";
    utterance.rate = 1.05;
    utterance.onend = utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

/** Queue one radio call: the engineer's voice from the server through the radio chain,
 * or the browser's speech when the server has no audio for it. */
export function playRadio(text: string, audio: string | null | undefined, urgent: boolean): void {
  if (urgent) {
    generation++;
    current?.stop();
    window.speechSynthesis?.cancel();
    queue = Promise.resolve();
  }
  const gen = generation;
  const ctx = audioContext();
  // Start downloading now, while earlier calls are still playing.
  const decoded =
    audio && ctx
      ? fetch(API_URL + audio)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((b) => ctx.decodeAudioData(b))
      : Promise.reject(new Error("no server voice"));
  decoded.catch(() => {}); // handled below; avoid an unhandled rejection meanwhile
  queue = queue.then(async () => {
    if (gen !== generation) return;
    await sleep(radioTones(OPEN_TONES) + 60);
    try {
      const buffer = await decoded;
      if (gen === generation && ctx) await playBuffer(ctx, buffer);
    } catch {
      if (gen === generation) await speakWithBrowser(text);
    }
    radioTones(CLOSE_TONES);
    await sleep(250);
  });
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
    const ok = typeof window !== "undefined" && ("AudioContext" in window || "speechSynthesis" in window);
    setSupported(ok);
    if (ok) {
      // An overlay in OBS has nobody to tap it: it can ask to start on.
      if (alwaysOn) setEnabled(true);
      else
        try {
          setEnabled(localStorage.getItem(STORAGE_KEY) === "on");
        } catch {}
      window.speechSynthesis?.getVoices(); // some browsers load voices lazily
    }
  }, [alwaysOn]);

  // Speak radio calls that arrive while the voice is on; never replay old ones.
  useEffect(() => {
    const latest = messages.slice(-1)[0];
    if (!latest) return;
    if (!enabled) {
      spoken.current = latest.id;
      return;
    }
    for (const m of messages) {
      if (m.id > spoken.current && m.radio) playRadio(m.radio, m.audio, m.prioridad === "urgente");
    }
    spoken.current = latest.id;
  }, [messages, enabled]);

  const toggle = useCallback(() => {
    setEnabled((on) => {
      const next = !on;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      } catch {}
      if (next) radioTones(OPEN_TONES); // the tap unlocks audio; the chime confirms it
      else {
        generation++;
        current?.stop();
        window.speechSynthesis?.cancel();
      }
      return next;
    });
  }, []);

  return { supported, enabled, toggle };
}
