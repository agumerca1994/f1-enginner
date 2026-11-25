"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Snapshot } from "@/lib/types";

/**
 * Talking to the engineer from a button in the game: one of its "UDP Action" buttons (1-12,
 * assigned in the game's controls), which the server counts in `snapshot.udp_actions`.
 * Hold it to talk and let go to send; a quick tap listens until the next tap.
 * The choice is per device (the one with the microphone). Action 1 unless changed.
 */
const KEY = "boton-hablar";
const MAX_HOLD_MS = 20000;
const MAX_TAP_MS = 10000;

function read(): number {
  try {
    const v = localStorage.getItem(KEY);
    if (v === null) return 1;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 12 ? n : 1;
  } catch {
    return 1;
  }
}

/** The UDP Action used to talk (0 = off), saved on this device. */
export function useTalkAction(): [number, (n: number) => void] {
  const [n, setN] = useState(1);
  useEffect(() => setN(read()), []);
  const save = useCallback((v: number) => {
    setN(v);
    try {
      localStorage.setItem(KEY, String(v));
    } catch {}
  }, []);
  return [n, save];
}

type Mic = { start: () => void; stop: () => void; listening: boolean };

export function useGameTalkButton(actions: Snapshot["udp_actions"] | undefined, mic: Mic) {
  const [action] = useTalkAction();
  const st = useRef<{ prev: number | null; mode: "hold" | "tap" | null; since: number }>({ prev: null, mode: null, since: 0 });
  const micRef = useRef(mic);
  micRef.current = mic;

  useEffect(() => {
    const s = st.current;
    if (!action || !actions) return;
    const count = actions.presses[action - 1] ?? 0;
    const down = actions.down[action - 1] ?? false;
    // First look, or a new session counting from zero: nothing was pressed yet.
    if (s.prev === null || count < s.prev) {
      s.prev = count;
      return;
    }
    const pressed = count > s.prev;
    s.prev = count;
    if (pressed) {
      if (s.mode === "tap") {
        s.mode = null;
        micRef.current.stop();
      } else if (!s.mode) {
        micRef.current.start();
        // Still down at this look: held. Already up again: it was a tap.
        s.mode = down ? "hold" : "tap";
        s.since = Date.now();
      }
      return;
    }
    if (s.mode === "hold" && !down) {
      s.mode = null;
      micRef.current.stop();
    }
  }, [actions, action]);

  // The recognizer stopped by itself (silence, error): the button starts afresh.
  useEffect(() => {
    if (!mic.listening && st.current.mode && Date.now() - st.current.since > 1500) st.current.mode = null;
  }, [mic.listening]);

  // A release lost on the console's Wi-Fi must not leave the microphone open.
  useEffect(() => {
    const id = setInterval(() => {
      const s = st.current;
      if (!s.mode) return;
      if (Date.now() - s.since > (s.mode === "hold" ? MAX_HOLD_MS : MAX_TAP_MS)) {
        s.mode = null;
        micRef.current.stop();
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);
}
