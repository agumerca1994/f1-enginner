"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CockpitGrid } from "@/components/cockpit/CockpitGrid";
import { RadioDock } from "@/components/ui/RadioDock";
import { chooseCockpit, chosenCockpit, useCockpits, type Cockpit } from "@/lib/cockpit";
import { useSharedLive } from "@/lib/liveContext";

/** Keeps the screen on while the cockpit is open, re-taking the lock when the tab comes back. */
export function useScreenOn() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const take = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {}
    };
    const onVisible = () => document.visibilityState === "visible" && take();
    take();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, []);
}

/**
 * The cockpit on its own, edge to edge: a phone on a mount above the wheel, a
 * second monitor. Data comes through the server about five times a second, so
 * the shift lights are a guide, not a cue to change gear on.
 */
export function CockpitFull() {
  const { snapshot: s, status, engineer } = useSharedLive();
  const { cockpits } = useCockpits();
  const [current, setCurrent] = useState<Cockpit | null>(null);
  useScreenOn();
  useEffect(() => {
    if (cockpits) setCurrent(chosenCockpit(cockpits));
  }, [cockpits]);

  return (
    <main className="flex h-dvh flex-col gap-2 overflow-hidden bg-bg p-[max(0.5rem,env(safe-area-inset-top))_max(0.7rem,env(safe-area-inset-right))_max(0.5rem,env(safe-area-inset-bottom))_max(0.7rem,env(safe-area-inset-left))]">
      <header className="flex h-8 shrink-0 items-center gap-2">
        <Link href="/" className="btn px-3 py-1 text-[0.8rem] text-muted">
          Salir
        </Link>
        {cockpits && current && (
          <select
            aria-label="Cockpit"
            value={current.id}
            onChange={(e) => {
              const c = cockpits.find((k) => k.id === e.target.value)!;
              chooseCockpit(c.id);
              setCurrent(c);
            }}
            className="h-8 rounded-[8px] border border-line bg-panel px-2 text-[0.85rem] text-fg"
          >
            {cockpits.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {current && (
          <Link href={`/cockpit/editar?id=${current.id}`} className="btn px-3 py-1 text-[0.8rem] text-muted">
            Armar
          </Link>
        )}
        <span className={`eyebrow ml-auto ${status === "live" ? "!text-ok" : "!text-warn"}`}>{status === "live" ? "En vivo" : "Sin datos"}</span>
      </header>
      <div className="min-h-0 flex-1">
        {!s ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="display text-[2rem] uppercase">Esperando tu consola</p>
              <p className="mt-1 text-[0.9rem] text-muted">Abrí el Bridge en la compu y salí a pista.</p>
            </div>
          </div>
        ) : (
          current && <CockpitGrid cockpit={current} ctx={{ s, messages: engineer.messages }} />
        )}
      </div>
      {!current?.pieces.some((p) => p.kind === "radio") && <RadioDock compact inline />}
    </main>
  );
}
