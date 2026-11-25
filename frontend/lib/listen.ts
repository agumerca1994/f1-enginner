"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { holdRadio, stopRadio } from "@/lib/voice";

// The Web Speech API's recognition object; not in TypeScript's DOM types everywhere.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Push to talk: `start()` while the button is held, `stop()` on release; the text heard
 * goes to `onFinal`. The browser does the recognition (Chrome and Safari, in Spanish).
 */
export function useDictation(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const heard = useRef("");
  const final = useRef(onFinal);
  final.current = onFinal;

  useEffect(() => setSupported(recognitionClass() !== null), []);

  const start = useCallback(() => {
    const Cls = recognitionClass();
    if (!Cls || rec.current) return;
    // The driver keys the radio: the engineer stops talking and waits until they let go.
    stopRadio();
    holdRadio(true);
    const r = new Cls();
    r.lang = "es-AR";
    r.interimResults = true;
    r.continuous = true;
    heard.current = "";
    setInterim("");
    setError(null);
    r.onresult = (e) => {
      let done = "";
      let partial = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) done += res[0].transcript;
        else partial += res[0].transcript;
      }
      // Partial words count too: the recognizer may end before it finalises the last ones.
      heard.current = (done + " " + partial).trim();
      setInterim(heard.current);
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setError(e.error === "not-allowed" ? "El navegador no tiene permiso para usar el micrófono." : "No te escuché bien.");
      }
    };
    r.onend = () => {
      rec.current = null;
      holdRadio(false);
      setListening(false);
      const text = (heard.current || "").trim();
      setInterim("");
      if (text) final.current(text);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      holdRadio(false);
    }
  }, []);

  const stop = useCallback(() => {
    // Give the recognizer a moment to close the last words before it ends.
    const r = rec.current;
    if (r) setTimeout(() => r.stop(), 250);
  }, []);

  useEffect(
    () => () => {
      if (rec.current) holdRadio(false);
      rec.current?.abort();
    },
    [],
  );

  return { supported, listening, interim, error, start, stop };
}
