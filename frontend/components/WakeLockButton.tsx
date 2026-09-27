"use client";

import { useEffect, useRef, useState } from "react";

/** Keeps the phone's screen on during a race. The browser releases the lock when the tab is hidden, so it is re-acquired on return. */
export function WakeLockButton() {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const lock = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    setSupported("wakeLock" in navigator);
  }, []);

  useEffect(() => {
    if (!on) return;
    const acquire = async () => {
      try {
        lock.current = await navigator.wakeLock.request("screen");
      } catch {
        setOn(false);
      }
    };
    const onVisible = () => document.visibilityState === "visible" && acquire();
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock.current?.release().catch(() => {});
      lock.current = null;
    };
  }, [on]);

  if (!supported) return null;
  return (
    <button
      onClick={() => setOn((v) => !v)}
      className={`rounded-lg border px-3 py-1.5 text-sm ${on ? "border-accent text-accent" : "border-line text-muted hover:text-fg"}`}
      title="Evita que la pantalla se apague durante la carrera"
    >
      {on ? "Pantalla fija" : "Mantener pantalla"}
    </button>
  );
}
