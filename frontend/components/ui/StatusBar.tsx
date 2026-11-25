"use client";

import { useEffect, useState } from "react";

import { useSharedLive } from "@/lib/liveContext";

export type StatusField = "bridge" | "senal" | "dato" | "formato";
export const STATUS_FIELDS: { id: StatusField; label: string }[] = [
  { id: "bridge", label: "Bridge" },
  { id: "senal", label: "Señal" },
  { id: "dato", label: "Último dato" },
  { id: "formato", label: "Consola y formato" },
];

const KEY = "barra-estado";
const EVENT = "barra-estado-cambiada";
const DEFAULT: StatusField[] = ["bridge", "senal", "dato"];

type Prefs = { on: boolean; fields: StatusField[] };

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Prefs;
  } catch {}
  return { on: false, fields: DEFAULT };
}

/** Whether this device shows the status bar and what it shows, like the battery percentage on a phone. */
export function useStatusBarPrefs() {
  const [prefs, setPrefs] = useState<Prefs>({ on: false, fields: DEFAULT });
  useEffect(() => {
    setPrefs(read());
    const sync = () => setPrefs(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const save = (p: Prefs) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {}
    setPrefs(p);
    window.dispatchEvent(new Event(EVENT));
  };
  return { prefs, save };
}

/** A thin line of diagnostics at the very top: not for racing, for seeing at a glance that data arrives. */
export function StatusBar() {
  const { prefs } = useStatusBarPrefs();
  const { status, snapshot, receivedAt } = useSharedLive();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!prefs.on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [prefs.on]);
  if (!prefs.on) return null;

  const age = receivedAt ? (now - receivedAt) / 1000 : null;
  const fresh = status === "live" && age != null && age < 5;
  const reception = snapshot?.link.reception;
  const has = (f: StatusField) => prefs.fields.includes(f);
  return (
    <div className="flex h-6 items-center gap-4 overflow-hidden border-b border-line bg-[#08090b] px-[max(1.1rem,env(safe-area-inset-left))] font-mono text-[0.68rem] whitespace-nowrap text-dim lg:px-6">
      {has("bridge") && (
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${fresh ? "bg-ok" : status === "live" ? "bg-warn" : "bg-dim"}`} aria-hidden="true" />
          {fresh ? "Bridge conectado" : status === "offline" ? "Sin conexión con el servidor" : "Sin datos del juego"}
        </span>
      )}
      {has("senal") && reception != null && <span>señal {Math.round(reception * 100)}%</span>}
      {has("dato") && age != null && <span>último dato hace {age < 10 ? age.toFixed(1).replace(".", ",") : Math.round(age)} s</span>}
      {has("formato") && snapshot && <span>formato {snapshot.packet_format}</span>}
    </div>
  );
}
